import { Router } from 'express';
import { pool } from '../db.js';
import { ah } from '../util.js';

const router = Router();

// ПУНКТ 8: дані для адмін-панелі — сервери, активні задачі, графік навантаження.
router.get('/overview', ah(async (req, res) => {
  const [workers, counts, active, metrics, users] = await Promise.all([
    pool.query(`SELECT id, concurrency, running, is_dynamic, draining, status, load1, mem_mb, tasks_done, started_at,
                       EXTRACT(EPOCH FROM (now() - last_heartbeat))::int AS heartbeat_age_s,
                       (status = 'online' AND last_heartbeat > now() - interval '15 seconds') AS alive
                FROM workers
                WHERE last_heartbeat > now() - interval '10 minutes'
                ORDER BY is_dynamic, id`),
    pool.query(`SELECT status, COUNT(*)::int AS n FROM tasks GROUP BY status`),
    pool.query(`SELECT t.id, u.username, t.type, t.status, t.progress, t.worker_id, t.est_duration_ms, t.created_at,
                       CASE WHEN t.started_at IS NULL THEN 0
                            ELSE (EXTRACT(EPOCH FROM (now() - t.started_at)) * 1000)::int END AS elapsed_ms
                FROM tasks t JOIN users u ON u.id = t.user_id
                WHERE t.status IN ('queued', 'running')
                ORDER BY t.created_at LIMIT 200`),
    pool.query(`SELECT (EXTRACT(EPOCH FROM ts) * 1000)::float8 AS t, queued, running, workers, capacity
                FROM (SELECT * FROM metrics ORDER BY ts DESC LIMIT 120) m ORDER BY ts`),
    pool.query(`SELECT COUNT(*)::int AS n FROM users`),
  ]);

  const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  res.json({
    workers: workers.rows,
    counts: byStatus,
    activeTasks: active.rows,
    metrics: metrics.rows,
    users: users.rows[0].n,
    scaling: {
      min: Number(process.env.MIN_WORKERS || 2),
      max: Number(process.env.MAX_WORKERS || 6),
    },
  });
}));

export default router;
