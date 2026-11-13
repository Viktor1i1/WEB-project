import { pool } from './db.js';

const FALLBACK_MS_PER_UNIT = {
  linear_system: 1.2e-6,
  sqrt_loop: 7e-5,
  integral: 1.1e-5,
};

export async function estimateDuration(type, units) {
  const { rows } = await pool.query(
    `SELECT AVG(ms / wu) AS k FROM (
       SELECT EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS ms, work_units AS wu
       FROM tasks
       WHERE type = $1 AND status = 'done' AND started_at IS NOT NULL AND work_units > 0
       ORDER BY finished_at DESC LIMIT 20
     ) t`,
    [type]
  );
  const k = rows[0].k !== null ? Number(rows[0].k) : FALLBACK_MS_PER_UNIT[type];
  return Math.max(500, Math.round(units * k));
}
