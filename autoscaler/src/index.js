import pg from 'pg';
import { spawn, spawnSync } from 'node:child_process';

const env = process.env;
const MODE = env.SCALER_MODE || 'docker';
const MAX_WORKERS = Number(env.MAX_WORKERS || 6);
const CONCURRENCY = Number(env.WORKER_CONCURRENCY || 2);
const TICK_MS = Number(env.TICK_MS || 5000);
const SCALE_UP_TICKS = Number(env.SCALE_UP_TICKS || 2);     
const SCALE_DOWN_TICKS = Number(env.SCALE_DOWN_TICKS || 6); 
const DOWN_UTILIZATION = Number(env.DOWN_UTILIZATION || 0.3);
const UP_COOLDOWN_MS = 20000; 

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3 });
const log = (...a) => console.log('[autoscaler]', ...a);

async function makeDockerBackend() {
  const { default: Docker } = await import('dockerode');
  const docker = new Docker({ socketPath: '/var/run/docker.sock' });
  const IMAGE = env.WORKER_IMAGE || 'heavy-tasks-worker:latest';
  const NETWORK = env.DOCKER_NETWORK || 'heavy-tasks-net';
  const ROLE_LABEL = 'heavy-tasks.role=worker';

  return {
    async prepare() {
      const containers = await docker.listContainers({ all: true, filters: { label: [ROLE_LABEL] } });
      for (const c of containers) {
        if (c.Labels['heavy-tasks.dynamic'] === 'true' && c.State === 'exited') {
          await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
          log(`Прибрано зупинений сервер ${c.Names[0]}`);
        }
      }
      return containers.filter((c) => ['running', 'created', 'restarting'].includes(c.State)).length;
    },
    async spawn() {
      const name = `ht-worker-dyn-${Date.now().toString(36)}`;
      const container = await docker.createContainer({
        Image: IMAGE,
        name,
        Env: [
          `DATABASE_URL=${env.DATABASE_URL}`,
          `WORKER_ID=${name}`,
          `WORKER_CONCURRENCY=${CONCURRENCY}`,
          `MAX_TASK_SECONDS=${env.MAX_TASK_SECONDS || 600}`,
          'DYNAMIC=true',
        ],
        Labels: { 'heavy-tasks.role': 'worker', 'heavy-tasks.dynamic': 'true' },
        HostConfig: { NetworkMode: NETWORK },
      });
      await container.start();
      log(`Запущено новий сервер (контейнер): ${name}`);
    },
    async stopAll() {
      const containers = await docker.listContainers({ all: true, filters: { label: ['heavy-tasks.dynamic=true'] } });
      await Promise.all(containers.map((c) => docker.getContainer(c.Id).remove({ force: true }).catch(() => {})));
    },
  };
}

function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function makeProcessBackend() {
  const STATIC_WORKERS = Number(env.STATIC_WORKERS || 2);
  const children = new Map();

  return {
    async prepare() {
      return STATIC_WORKERS + children.size;
    },
    async spawn() {
      const name = `proc-worker-dyn-${Date.now().toString(36)}`;
      const child = spawn(process.execPath, [env.WORKER_SCRIPT], {
        env: { ...process.env, WORKER_ID: name, DYNAMIC: 'true' },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      children.set(name, child);
      child.on('exit', () => {
        children.delete(name);
        log(`Процес ${name} завершився`);
      });
      log(`Запущено новий сервер (процес): ${name}`);
    },
    async stopAll() {
      for (const child of children.values()) killTree(child);
    },
  };
}

const backend = MODE === 'docker' ? await makeDockerBackend() : makeProcessBackend();

let upTicks = 0;
let downTicks = 0;
let lastScaleUp = 0;

async function reapDeadWorkers() {
  const dead = await pool.query(
    `UPDATE workers SET status = 'offline', running = 0
     WHERE status = 'online' AND last_heartbeat < now() - interval '20 seconds'
     RETURNING id`
  );
  if (dead.rows.length > 0) {
    const ids = dead.rows.map((r) => r.id);
    const r = await pool.query(
      `UPDATE tasks SET status = 'queued', worker_id = NULL, progress = 0, started_at = NULL, updated_at = now()
       WHERE status = 'running' AND worker_id = ANY($1)`,
      [ids]
    );
    log(`Мертві worker-и: ${ids.join(', ')}; повернуто в чергу задач: ${r.rowCount}`);
  }
  await pool.query(`DELETE FROM workers WHERE status = 'offline' AND last_heartbeat < now() - interval '10 minutes'`);
}

async function tick() {
  await reapDeadWorkers();

  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM tasks WHERE status = 'queued')::int  AS queued,
       (SELECT COUNT(*) FROM tasks WHERE status = 'running')::int AS running,
       (SELECT COALESCE(SUM(concurrency), 0) FROM workers WHERE status = 'online' AND NOT draining)::int AS capacity,
       (SELECT COUNT(*) FROM workers WHERE status = 'online')::int AS workers`
  );
  const { queued, running, capacity, workers } = rows[0];

  await pool.query(`INSERT INTO metrics (queued, running, workers, capacity) VALUES ($1, $2, $3, $4)`, [queued, running, workers, capacity]);
  await pool.query(`DELETE FROM metrics WHERE ts < now() - interval '1 hour'`);

  const total = await backend.prepare(); 
  const pendingSlots = Math.max(0, total - workers) * CONCURRENCY;
  const free = Math.max(0, capacity - running);

  const needMore = queued > free + pendingSlots;
  upTicks = needMore ? upTicks + 1 : 0;

  if (upTicks >= SCALE_UP_TICKS && Date.now() - lastScaleUp > UP_COOLDOWN_MS) {
    const undrained = await pool.query(`UPDATE workers SET draining = false WHERE status = 'online' AND draining RETURNING id`);
    if (undrained.rowCount > 0) {
      log(`Скасовано вимкнення серверів: ${undrained.rows.map((r) => r.id).join(', ')}`);
      lastScaleUp = Date.now();
      upTicks = 0;
    } else if (total < MAX_WORKERS) {
      const deficit = queued - free - pendingSlots;
      const toAdd = Math.min(Math.ceil(deficit / CONCURRENCY), MAX_WORKERS - total, 2);
      for (let i = 0; i < toAdd; i++) await backend.spawn();
      lastScaleUp = Date.now();
      upTicks = 0;
    } else {
      log(`Досягнуто максимум серверів (${MAX_WORKERS}), задачі чекають у черзі`);
    }
  }

  const utilization = capacity > 0 ? running / capacity : 0;
  downTicks = queued === 0 && utilization <= DOWN_UTILIZATION ? downTicks + 1 : 0;

  if (downTicks >= SCALE_DOWN_TICKS) {
    const r = await pool.query(
      `UPDATE workers SET draining = true WHERE id = (
         SELECT id FROM workers WHERE is_dynamic AND status = 'online' AND NOT draining
         ORDER BY running ASC, started_at DESC LIMIT 1
       ) RETURNING id`
    );
    if (r.rowCount > 0) log(`Навантаження низьке, вимикаємо сервер ${r.rows[0].id}`);
    downTicks = 0;
  }
}

async function loop() {
  try { await tick(); } catch (e) { log('Помилка такту:', e.message); }
  setTimeout(loop, TICK_MS);
}

async function cleanup() {
  log('Зупинка: прибираємо динамічні сервери');
  try { await backend.stopAll(); } catch { /* ігноруємо */ }
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

log(`Старт (режим: ${MODE}): максимум серверів = ${MAX_WORKERS}, обсяг на сервер = ${CONCURRENCY}`);
loop();
