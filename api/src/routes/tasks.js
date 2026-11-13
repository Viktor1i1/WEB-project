import { Router } from 'express';
import { pool } from '../db.js';
import { LIMITS, validateTask } from '../limits.js';
import { estimateDuration } from '../estimate.js';
import { getSnapshot, decorate, systemSummary, TASK_COLS } from '../queue.js';
import { ah } from '../util.js';

const router = Router();
const isAdmin = (req) => req.user.role === 'admin';

async function loadTask(id) {
  const { rows } = await pool.query(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1`, [id]);
  return rows[0];
}

// Історія задач користувача + стан системи (пункт 3 і 6).
router.get('/', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${TASK_COLS} FROM tasks WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [req.user.id, LIMITS.maxHistoryPerUser]
  );
  const snap = await getSnapshot();
  res.json({ tasks: rows.map((t) => decorate(t, snap)), system: systemSummary(snap) });
}));

// Стан однієї задачі (клієнт опитує цей маршрут, щоб оновлювати прогрес-бар).
router.get('/:id', ah(async (req, res) => {
  const t = await loadTask(Number(req.params.id) || 0);
  if (!t || (t.user_id !== req.user.id && !isAdmin(req))) return res.status(404).json({ error: 'Задачу не знайдено' });
  res.json(decorate(t, await getSnapshot()));
}));

// Створення задачі: валідація -> ліміти -> запис у БД зі статусом "queued".
router.post('/', ah(async (req, res) => {
  const { type, params } = req.body || {};
  const v = validateTask(type, params);
  if (v.error) return res.status(400).json({ error: v.error });

  const est = await estimateDuration(type, v.units);
  // Пункт 1: відмова у виконанні, якщо орієнтовний час більший за ліміт.
  // (Якщо оцінка помилилась, worker однаково зупинить задачу після ліміту часу.)
  if (est > LIMITS.maxTaskSeconds * 1000) {
    return res.status(400).json({
      error: `Задача надто трудомістка: орієнтовний час ~${Math.round(est / 1000)} с, а ліміт ${LIMITS.maxTaskSeconds} с. Зменшіть параметри.`,
    });
  }
  const client = await pool.connect();
  let id;
  try {
    await client.query('BEGIN');
    // Блокування на рівні користувача, щоб паралельні запити не обійшли ліміти.
    await client.query('SELECT pg_advisory_xact_lock($1)', [req.user.id]);

    const c = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('queued','running'))::int AS active,
              COUNT(*)::int AS total
       FROM tasks WHERE user_id = $1`,
      [req.user.id]
    );
    if (c.rows[0].active >= LIMITS.maxActiveTasksPerUser) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: `Можна мати не більше ${LIMITS.maxActiveTasksPerUser} активних задач. Дочекайтесь завершення однієї з них або скасуйте її.` });
    }
    if (c.rows[0].total >= LIMITS.maxHistoryPerUser) {
      await client.query('ROLLBACK');
      return res.status(429).json({ error: `Історія заповнена (максимум ${LIMITS.maxHistoryPerUser} задач). Спершу видаліть кілька завершених задач.` });
    }
    const q = await client.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE status = 'queued'`);
    if (q.rows[0].n >= LIMITS.maxQueueLength) {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'Черга системи переповнена. Спробуйте пізніше.' });
    }

    const ins = await client.query(
      `INSERT INTO tasks (user_id, type, params, work_units, est_duration_ms)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, type, v.clean, v.units, est]
    );
    id = ins.rows[0].id;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  res.status(201).json(decorate(await loadTask(id), await getSnapshot()));
}));

// Скасування (пункт 3). queued -> одразу cancelled.
// running -> ставимо прапорець cancel_requested, worker побачить його і зупинить обчислення.
router.post('/:id/cancel', ah(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const t = await loadTask(id);
  if (!t || (t.user_id !== req.user.id && !isAdmin(req))) return res.status(404).json({ error: 'Задачу не знайдено' });

  await pool.query(
    `UPDATE tasks SET
       cancel_requested = true,
       status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
       finished_at = CASE WHEN status = 'queued' THEN now() ELSE finished_at END,
       updated_at = now()
     WHERE id = $1 AND status IN ('queued', 'running')`,
    [id]
  );
  res.json(decorate(await loadTask(id), await getSnapshot()));
}));

// Видалення завершеної задачі з історії.
router.delete('/:id', ah(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const t = await loadTask(id);
  if (!t || (t.user_id !== req.user.id && !isAdmin(req))) return res.status(404).json({ error: 'Задачу не знайдено' });
  if (t.status === 'queued' || t.status === 'running') {
    return res.status(409).json({ error: 'Спершу скасуйте задачу, а потім видаляйте її' });
  }
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
  res.json({ ok: true });
}));

export default router;
