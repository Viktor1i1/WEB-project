import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const file = path.join(root, 'local.env');
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export const withDefaults = (c) => ({
  PG_HOST: '127.0.0.1', PG_PORT: '5432', PG_USER: 'postgres', PG_PASSWORD: '', DB_NAME: 'heavy',
  JWT_SECRET: 'change-me-please', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin12345',
  MAX_WORKERS: '6', WORKER_CONCURRENCY: '2', MAX_TASK_SECONDS: '600', HTTPS_PORT: '8443',
  ...c,
});

export const dbUrl = (cfg, dbName = cfg.DB_NAME) =>
  `postgres://${encodeURIComponent(cfg.PG_USER)}:${encodeURIComponent(cfg.PG_PASSWORD)}@${cfg.PG_HOST}:${cfg.PG_PORT}/${dbName}`;
export const requirePg = () => createRequire(path.join(root, 'api', 'package.json'))('pg');

export function explainDbError(e) {
  if (e.code === '28P01') return 'Невірний пароль PostgreSQL. Перевірте PG_PASSWORD у файлі local.env.';
  if (e.code === 'ECONNREFUSED') return 'PostgreSQL не відповідає. Запустіть службу: Start-Service postgresql-x64-18 (PowerShell від імені адміністратора).';
  if (e.code === '3D000') return 'Бази даних ще немає. Виконайте: npm run db';
  return `${e.code || ''} ${e.message}`;
}
