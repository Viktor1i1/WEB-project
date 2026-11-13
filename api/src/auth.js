import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const signToken = (user) =>
  jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: '8h' });

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Потрібна авторизація' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Сесія завершилась, увійдіть знову' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Потрібні права адміністратора' });
  next();
}
