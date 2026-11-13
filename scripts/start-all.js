import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadEnv, withDefaults, dbUrl, requirePg, explainDbError } from './lib.js';

const raw = loadEnv();
if (!raw) { 
  console.error('Файл local.env не знайдено. Спершу виконайте: npm run setup'); process.exit(1); 
}
const cfg = withDefaults(raw);
if (!cfg.PG_PASSWORD || cfg.PG_PASSWORD.includes('ЗАМІНІТЬ')) {
  console.error('Впишіть пароль PostgreSQL у файл local.env (рядок PG_PASSWORD=...) і повторіть.');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'frontend', 'dist', 'index.html'))) {
  console.error('Фронтенд не зібрано. Виконайте: npm run setup');
  process.exit(1);
}

const pg = requirePg();
const DATABASE_URL = dbUrl(cfg);
try {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const r = await client.query(`SELECT to_regclass('public.tasks') AS t`);
  await client.end();
  if (!r.rows[0].t) throw Object.assign(new Error('no schema'), { code: '3D000' });
} catch (e) {
  console.error('Не вдалося підключитись до бази даних:', explainDbError(e));
  process.exit(1);
}

const baseEnv = {
  DATABASE_URL,
  JWT_SECRET: cfg.JWT_SECRET,
  ADMIN_USERNAME: cfg.ADMIN_USERNAME,
  ADMIN_PASSWORD: cfg.ADMIN_PASSWORD,
  MAX_WORKERS: cfg.MAX_WORKERS,
  MIN_WORKERS: '2',
  WORKER_CONCURRENCY: cfg.WORKER_CONCURRENCY,
  MAX_TASK_SECONDS: cfg.MAX_TASK_SECONDS,
};

const children = [];
let stopping = false;

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function run(name, dir, script, extra = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: path.join(root, dir),
    env: { ...process.env, ...baseEnv, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${name}]`.padEnd(12);
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) if (l.trim()) console.log(`${prefix} ${l}`);
    });
  }
  child.on('exit', (code) => { if (!stopping) console.log(`${prefix} завершився (код ${code})`); });
  children.push(child);
}

run('api1', 'api', 'src/index.js', { PORT: '3001', INSTANCE_NAME: 'api1' });
run('api2', 'api', 'src/index.js', { PORT: '3002', INSTANCE_NAME: 'api2' });
run('worker1', 'worker', 'src/index.js', { WORKER_ID: 'worker1' });
run('worker2', 'worker', 'src/index.js', { WORKER_ID: 'worker2' });
run('autoscaler', 'autoscaler', 'src/index.js', {
  SCALER_MODE: 'process',
  STATIC_WORKERS: '2',
  WORKER_SCRIPT: path.join(root, 'worker', 'src', 'index.js'),
});
run('balancer', 'balancer', 'server.js', {
  HTTPS_PORT: cfg.HTTPS_PORT,
  API_BACKENDS: 'http://127.0.0.1:3001,http://127.0.0.1:3002',
  STATIC_DIR: path.join(root, 'frontend', 'dist'),
});

console.log(`\nСистема запускається. Відкрийте: https://localhost:${cfg.HTTPS_PORT}`);
console.log(`Адміністратор: ${cfg.ADMIN_USERNAME} / ${cfg.ADMIN_PASSWORD}.  Зупинка: Ctrl+C\n`);

async function stopAll() {
  if (stopping) return;
  stopping = true;
  console.log('\nЗупинка системи...');
  for (const c of children) killTree(c);
  try {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`UPDATE tasks SET status = 'queued', worker_id = NULL, progress = 0, started_at = NULL WHERE status = 'running'`);
    await client.query(`UPDATE workers SET status = 'offline', running = 0`);
    await client.end();
  } catch { /* ігноруємо */ }
  process.exit(0);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
