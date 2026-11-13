import { pool } from './db.js';
export const TASK_COLS = `
  id, user_id, type, params, status, progress, result, error, cancel_requested,
  worker_id, est_duration_ms, created_at, started_at, finished_at,
  CASE WHEN started_at IS NULL THEN 0
       ELSE (EXTRACT(EPOCH FROM (COALESCE(finished_at, now()) - started_at)) * 1000)::int
  END AS elapsed_ms`;

const remainingMs = (t) =>
  t.progress >= 3
    ? (t.elapsed_ms / t.progress) * (100 - t.progress)
    : t.est_duration_ms * (1 - t.progress / 100);

export async function getSnapshot() {
  const [q, r, w] = await Promise.all([
    pool.query(`SELECT id, est_duration_ms FROM tasks WHERE status = 'queued' ORDER BY created_at, id`),
    pool.query(`SELECT progress, est_duration_ms,
                       (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int AS elapsed_ms
                FROM tasks WHERE status = 'running'`),
    pool.query(`SELECT COALESCE(SUM(concurrency), 0)::int AS slots
                FROM workers
                WHERE status = 'online' AND NOT draining
                  AND last_heartbeat > now() - interval '15 seconds'`),
  ]);

  const queued = q.rows;
  const slots = w.rows[0].slots;
  const running = r.rows.length;

  const times = r.rows.map((t) => Math.max(0, remainingMs(t)));
  while (times.length < slots) times.push(0);
  const starts = new Map();
  if (times.length > 0) {
    for (const t of queued) {
      times.sort((a, b) => a - b);
      const start = times.shift();
      starts.set(t.id, start);
      times.push(start + t.est_duration_ms);
    }
  }

  return { queued, running, slots, starts, busy: slots === 0 || running >= slots };
}

export function decorate(t, snap) {
  const out = { ...t, queue_position: null, eta_start_seconds: null, eta_seconds: null };
  delete out.user_id;
  if (t.status === 'queued') {
    const idx = snap.queued.findIndex((q) => q.id === t.id);
    out.queue_position = idx >= 0 ? idx + 1 : null;
    const start = snap.starts.get(t.id);
    if (start !== undefined) {
      out.eta_start_seconds = Math.round(start / 1000);
      out.eta_seconds = Math.round((start + t.est_duration_ms) / 1000);
    }
  } else if (t.status === 'running') {
    out.eta_seconds = Math.max(0, Math.round(remainingMs(t) / 1000));
  }
  return out;
}

export const systemSummary = (snap) => ({
  busy: snap.busy,
  queued: snap.queued.length,
  running: snap.running,
  slots: snap.slots,
});
