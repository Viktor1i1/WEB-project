process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; 

const BASE = process.env.BASE_URL || 'https://localhost:8443';
const TOTAL = Number(process.argv[2] || 20);
const PER_USER = 5;
const ADMIN = { u: process.env.ADMIN_USERNAME || 'admin', p: process.env.ADMIN_PASSWORD || 'admin12345' };

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error || res.status}`);
  return data;
}

async function getUserToken(name) {
  const creds = { username: name, password: 'loadtest123' };
  try { return (await call('/auth/register', { method: 'POST', body: creds })).token; }
  catch { return (await call('/auth/login', { method: 'POST', body: creds })).token; }
}

const TASKS = [
  { type: 'sqrt_loop', params: { iterations: 100_000_000 } },
  { type: 'linear_system', params: { n: 1500 } },
  { type: 'integral', params: { func: 'sin', a: 0, b: 10, steps: 300_000_000 } },
  { type: 'sqrt_loop', params: { iterations: 150_000_000 } },
];

async function main() {
  const users = Math.ceil(TOTAL / PER_USER);
  console.log(`Створюємо ${TOTAL} задач від ${users} користувачів на ${BASE} ...`);
  const tokens = [];
  for (let i = 1; i <= users; i++) tokens.push(await getUserToken(`loadtest_${i}`));

  let created = 0;
  for (let i = 0; i < TOTAL; i++) {
    const token = tokens[i % users];
    try {
      await call('/tasks', { method: 'POST', token, body: TASKS[i % TASKS.length] });
      created++;
    } catch (e) {
      console.log('  пропущено:', e.message);
    }
  }
  console.log(`Створено задач: ${created}. Спостерігаємо за виконанням (Ctrl+C — вихід)\n`);

  let adminToken = null;
  try { adminToken = (await call('/auth/login', { method: 'POST', body: { username: ADMIN.u, password: ADMIN.p } })).token; }
  catch { console.log('(адміністратор недоступний — стан серверів не показуємо)\n'); }

  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const sec = String(Math.round((Date.now() - started) / 1000)).padStart(4);
    if (adminToken) {
      const o = await call('/admin/overview', { token: adminToken });
      const online = o.workers.filter((w) => w.alive);
      const names = online.map((w) => `${w.id}(${w.running}/${w.concurrency})`).join(' ');
      console.log(`[${sec}s] черга=${o.counts.queued || 0} виконується=${o.counts.running || 0} готово=${o.counts.done || 0} | сервери: ${online.length} → ${names}`);
      if (!(o.counts.queued || 0) && !(o.counts.running || 0)) break;
    } else {
      console.log(`[${sec}s] очікуємо...`);
    }
  }
  console.log('\nГотово. Через ~30 с без навантаження автоскейлер вимкне зайві сервери.');
}
main().catch((e) => { console.error(e); process.exit(1); });
