const TOKEN_KEY = 'ht_token';
const USER_KEY = 'ht_user';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const served = res.headers.get('X-Served-By');
  if (served) window.dispatchEvent(new CustomEvent('served-by', { detail: served }));

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && session.token) window.dispatchEvent(new Event('session-expired'));
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  register: (username, password) => request('/auth/register', { method: 'POST', body: { username, password } }),
  limits: () => request('/limits'),
  tasks: () => request('/tasks'),
  createTask: (type, params) => request('/tasks', { method: 'POST', body: { type, params } }),
  cancelTask: (id) => request(`/tasks/${id}/cancel`, { method: 'POST' }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  adminOverview: () => request('/admin/overview'),
};
