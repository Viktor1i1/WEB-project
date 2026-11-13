import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export async function waitForDb(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      console.log('Очікуємо базу даних...');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error('База даних недоступна');
}
