
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import pg from 'pg';

const WORKER_ID = process.env.WORKER_ID || os.hostname();
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 2);
const MAX_TASK_MS = Number(process.env.MAX_TASK_SECONDS || 600) * 1000;
const IS_DYNAMIC = process.env.DYNAMIC === 'true';
const POLL_MS = 1000;
const HEARTBEAT_MS = 3000;
const PROGRESS_WRITE_MS = 500;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const log = (...a) => console.log(`[${WORKER_ID}]`, ...a);

const active = new Map();
let draining = false;
let shuttingDown = false;

async function register() {
  await pool.query(
    `INSERT INTO workers (id, concurrency, is_dynamic, status, draining, running, started_at, last_heartbeat)
     VALUES ($1, $2, $3, 'online', false, 0, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       concurrency = $2, is_dynamic = $3, status = 'online', draining = false,
       running = 0, started_at = now(), last_heartbeat = now()`,
    [WORKER_ID, CONCURRENCY, IS_DYNAMIC]
  );
  draining = false;
}

async function heartbeat() {
  const { rows } = await pool.query(
    `UPDATE workers SET running = $2, load1 = $3, mem_mb = $4, last_heartbeat = now()
     WHERE id = $1 AND status = 'online' RETURNING draining`,
    [WORKER_ID, active.size, os.loadavg()[0], process.memoryUsage().rss / 1048576]
  );
  if (rows.length === 0) {
    log('Позначений як offline, скидаємо задачі й реєструємось знову');
    for (const [id, entry] of active) {
      entry.finished = true;
      clearTimeout(entry.timer);
      entry.thread.terminate();
      active.delete(id);
    }
    await register();
    return;
  }
  draining = rows[0].draining;
}

async function claimTask() {
  const { rows } = await pool.query(
    `UPDATE tasks SET status = 'running', worker_id = $1, started_at = now(), updated_at = now(), progress = 0
     WHERE id = (
       SELECT id FROM tasks WHERE status = 'queued'
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING id, type, params`,
    [WORKER_ID]
  );
  return rows[0] || null;
}

async function finish(id, status, { result = null, error = null } = {}) {
  const entry = active.get(id);
  if (!entry || entry.finished) return;
  entry.finished = true;
  clearTimeout(entry.timer);
  active.delete(id);
  entry.thread.terminate(); 

  const { rowCount } = await pool.query(
    `UPDATE tasks SET status = $3::text,
       progress = CASE WHEN $3::text = 'done' THEN 100 ELSE progress END,
       result = $4, error = $5, finished_at = now(), updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
    [id, WORKER_ID, status, result, error]
  ).catch((e) => { log('DB error in finish:', e.message); return { rowCount: 0 }; });

  if (rowCount && status === 'done') {
    pool.query(`UPDATE workers SET tasks_done = tasks_done + 1 WHERE id = $1`, [WORKER_ID]).catch(() => {});
  }
  log(`task #${id} -> ${status}`);
}

function startTask(task) {
  const thread = new Worker(new URL('./compute.js', import.meta.url), {
    workerData: { type: task.type, params: task.params },
  });
  const entry = { thread, lastWrite: 0, finished: false, timer: null };
  active.set(task.id, entry);
  log(`task #${task.id} (${task.type}) started`);

  entry.timer = setTimeout(
    () => finish(task.id, 'failed', { error: `Перевищено ліміт часу виконання (${MAX_TASK_MS / 1000} с)` }),
    MAX_TASK_MS
  );

  thread.on('message', (msg) => {
    if (msg.type === 'progress') {
      const now = Date.now();
      if (now - entry.lastWrite >= PROGRESS_WRITE_MS) {
        entry.lastWrite = now;
        pool.query(
          `UPDATE tasks SET progress = $3, updated_at = now()
           WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
          [task.id, WORKER_ID, msg.value]
        ).catch(() => {});
      }
    } else if (msg.type === 'done') {
      finish(task.id, 'done', { result: msg.result });
    }
  });
  thread.on('error', (err) => finish(task.id, 'failed', { error: err.message }));
  thread.on('exit', (code) => {
    if (!entry.finished) finish(task.id, 'failed', { error: `Потік обчислень неочікувано завершився (код ${code})` });
  });
}

async function checkCancellations() {
  if (active.size === 0) return;
  const { rows } = await pool.query(
    `SELECT id FROM tasks WHERE worker_id = $1 AND status = 'running' AND cancel_requested`,
    [WORKER_ID]
  );
  for (const { id } of rows) await finish(id, 'cancelled');
}

async function tick() {
  if (shuttingDown) return;
  try {
    await checkCancellations();
    while (!draining && active.size < CONCURRENCY) {
      const task = await claimTask();
      if (!task) break;
      startTask(task);
    }
    if (draining && active.size === 0) {
      log('Режим draining завершено, вимикаємось');
      await shutdown(0, false);
      return;
    }
  } catch (e) {
    log('tick error:', e.message);
  }
  setTimeout(tick, POLL_MS);
}

async function shutdown(code = 0, requeue = true) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [, entry] of active) {
    entry.finished = true;
    clearTimeout(entry.timer);
    entry.thread.terminate();
  }
  active.clear();
  try {
    if (requeue) {
      await pool.query(
        `UPDATE tasks SET status = 'queued', worker_id = NULL, progress = 0, started_at = NULL, updated_at = now()
         WHERE worker_id = $1 AND status = 'running'`,
        [WORKER_ID]
      );
    }
    await pool.query(`UPDATE workers SET status = 'offline', running = 0 WHERE id = $1`, [WORKER_ID]);
    await pool.end();
  } catch { /* ігноруємо */ }
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

async function start() {
  for (let i = 0; i < 40; i++) {
    try { await register(); break; }
    catch { log('Очікуємо базу даних...'); await new Promise((r) => setTimeout(r, 1500)); }
  }
  log(`started (concurrency=${CONCURRENCY}, dynamic=${IS_DYNAMIC})`);
  setInterval(() => heartbeat().catch((e) => log('heartbeat error:', e.message)), HEARTBEAT_MS);
  tick();
}
start();
