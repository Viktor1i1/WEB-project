import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from '../auth.js';
import { ah } from '../util.js';

const router = Router();

const validCreds = (u, p) =>
  typeof u === 'string' && /^[a-zA-Z0-9_]{3,32}$/.test(u) &&
  typeof p === 'string' && p.length >= 6 && p.length <= 72;

// Створення адміністратора при старті (якщо задано змінні середовища).
export async function bootstrapAdmin() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return;
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [ADMIN_USERNAME, hash]
  );
}

router.post('/register', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!validCreds(username, password)) {
    return res.status(400).json({
      error: 'Ім’я користувача: 3–32 символи (латинські літери, цифри, підкреслення). Пароль: щонайменше 6 символів.',
    });
  }
  const hash = await bcrypt.hash(password, 10); // пароль зберігається лише у вигляді хешу
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, role`,
      [username, hash]
    );
    res.status(201).json({ token: signToken(rows[0]), user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Це ім’я користувача вже зайняте' });
    throw e;
  }
}));

router.post('/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Потрібно вказати ім’я користувача та пароль' });
  }
  const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Невірне ім’я користувача або пароль' });
  }
  const pub = { id: user.id, username: user.username, role: user.role };
  res.json({ token: signToken(pub), user: pub });
}));

export default router;
