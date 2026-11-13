import express from 'express';
import { waitForDb } from './db.js';
import { requireAuth, requireAdmin } from './auth.js';
import { LIMITS } from './limits.js';
import authRoutes, { bootstrapAdmin } from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import adminRoutes from './routes/admin.js';

const INSTANCE = process.env.INSTANCE_NAME || 'api';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Served-By', INSTANCE);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, instance: INSTANCE }));
app.get('/api/limits', (req, res) => res.json(LIMITS));

app.use('/api/auth', authRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Не знайдено' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некоректний JSON' });
  console.error(err);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
});

await waitForDb();
await bootstrapAdmin();
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`[${INSTANCE}] API listening on :${PORT}`));
