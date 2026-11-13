import fs from 'node:fs';
import path from 'node:path';
import { root, loadEnv, withDefaults, dbUrl, requirePg, explainDbError } from './lib.js';

const raw = loadEnv();
if (!raw) { console.error('Файл local.env не знайдено. Спершу виконайте: npm run setup'); process.exit(1); }
const cfg = withDefaults(raw);
if (!cfg.PG_PASSWORD || cfg.PG_PASSWORD.includes('ЗАМІНІТЬ')) {
  console.error('Впишіть пароль PostgreSQL у файл local.env (рядок PG_PASSWORD=...) і повторіть.');
  process.exit(1);
}

const pg = requirePg();
const reset = process.argv.includes('--reset');

async function main() {
  const admin = new pg.Client({ connectionString: dbUrl(cfg, 'postgres') });
  await admin.connect();
  console.log('Підключення до PostgreSQL: успішно');

  if (reset) {
    await admin.query(`DROP DATABASE IF EXISTS "${cfg.DB_NAME}" WITH (FORCE)`);
    console.log(`Базу ${cfg.DB_NAME} видалено`);
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.DB_NAME]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${cfg.DB_NAME}"`);
    console.log(`Базу ${cfg.DB_NAME} створено`);
  } else {
    console.log(`База ${cfg.DB_NAME} уже існує`);
  }
  await admin.end();

  const app = new pg.Client({ connectionString: dbUrl(cfg) });
  await app.connect();
  const has = await app.query(`SELECT to_regclass('public.tasks') AS t`);
  if (has.rows[0].t) {
    console.log('Таблиці вже існують — нічого робити не треба');
  } else {
    await app.query(fs.readFileSync(path.join(root, 'db', 'init.sql'), 'utf8'));
    console.log('Таблиці створено (users, tasks, workers, metrics)');
  }
  await app.end();
}

main().catch((e) => { console.error('\nПомилка:', explainDbError(e)); process.exit(1); });
