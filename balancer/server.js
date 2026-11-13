import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'frontend', 'dist'));
const FAIL_PAUSE_MS = 10000;

const backends = (process.env.API_BACKENDS || 'http://127.0.0.1:3001,http://127.0.0.1:3002')
  .split(',')
  .map((u) => ({ url: new URL(u.trim()), active: 0, served: 0, failedUntil: 0 }));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

async function loadCert() {
  const dir = path.join(__dirname, 'certs');
  const keyFile = path.join(dir, 'server.key');
  const crtFile = path.join(dir, 'server.crt');
  if (!fs.existsSync(keyFile) || !fs.existsSync(crtFile)) {
    fs.mkdirSync(dir, { recursive: true });
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
      days: 365, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }],
    });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(crtFile, pems.cert);
    console.log('Створено самопідписаний сертифікат:', crtFile);
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(crtFile) };
}

function pick(tried) {
  const now = Date.now();
  let candidates = backends.filter((b) => !tried.has(b) && b.failedUntil <= now);
  if (candidates.length === 0) candidates = backends.filter((b) => !tried.has(b));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.active - b.active || a.served - b.served);
  return candidates[0];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function forward(b, req, body) {
  return new Promise((resolve, reject) => {
    const preq = http.request({
      hostname: b.url.hostname, port: b.url.port, path: req.url, method: req.method,
      headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': req.socket.remoteAddress },
      timeout: 30000,
    }, resolve);
    preq.on('timeout', () => preq.destroy(new Error('Upstream timeout')));
    preq.on('error', reject);
    preq.end(body);
  });
}

async function proxy(req, res) {
  let body;
  try { body = await readBody(req); }
  catch { res.writeHead(413); return res.end('Request too large'); }

  const tried = new Set();
  for (;;) {
    const b = pick(tried);
    if (!b) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No API servers available' }));
    }
    tried.add(b);
    b.active++;
    b.served++;
    let released = false;
    const release = () => { if (!released) { released = true; b.active--; } };
    try {
      const pres = await forward(b, req, body);
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
      pres.on('end', release);
      pres.on('close', release);
      pres.on('error', release);
      return;
    } catch {
      release();
      b.failedUntil = Date.now() + FAIL_PAUSE_MS;
      console.log(`API ${b.url.host} недоступний, пробуємо інший`);
    }
  }
}

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }

  let file = path.join(STATIC_DIR, path.normalize(urlPath));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(STATIC_DIR, 'index.html'); 
    fs.readFile(file, (e, data) => {
      if (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Frontend не зібрано. Виконайте: npm run setup');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

const handler = (req, res) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url.startsWith('/api/')) proxy(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* */ } });
  else serveStatic(req, res);
};

const tls = await loadCert();
const server = https.createServer(tls, handler);
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `Порт ${HTTPS_PORT} уже зайнятий. Якщо працює Docker-версія, зупиніть її: docker compose down`
    : e);
  process.exit(1);
});
server.listen(HTTPS_PORT, () => {
  console.log(`Балансувальник: https://localhost:${HTTPS_PORT} -> API: ${backends.map((b) => b.url.host).join(', ')}`);
});

http.createServer((req, res) => {
  res.writeHead(301, { Location: `https://localhost:${HTTPS_PORT}${req.url}` });
  res.end();
}).on('error', () => {}).listen(HTTP_PORT);
