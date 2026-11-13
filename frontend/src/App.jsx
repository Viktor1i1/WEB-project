import { useEffect, useState } from 'react';
import { api, session } from './api.js';
import AuthForm from './components/AuthForm.jsx';
import Dashboard from './components/Dashboard.jsx';
import AdminPanel from './components/AdminPanel.jsx';

export default function App() {
  const [user, setUser] = useState(() => (session.token ? session.user : null));
  const [tab, setTab] = useState('tasks');
  const [limits, setLimits] = useState(null);
  const [servedBy, setServedBy] = useState('');

  const logout = () => { session.clear(); setUser(null); setTab('tasks'); };

  useEffect(() => { api.limits().then(setLimits).catch(() => {}); }, []);

  useEffect(() => {
    const onServed = (e) => setServedBy(e.detail);
    const onExpired = () => logout();
    window.addEventListener('served-by', onServed);
    window.addEventListener('session-expired', onExpired);
    return () => {
      window.removeEventListener('served-by', onServed);
      window.removeEventListener('session-expired', onExpired);
    };
  }, []);

  if (!user) {
    return <AuthForm onAuth={(token, u) => { session.save(token, u); setUser(u); }} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Важкі задачі</div>
        <nav className="tabs">
          <button className={tab === 'tasks' ? 'tab active' : 'tab'} onClick={() => setTab('tasks')}>Мої задачі</button>
          {user.role === 'admin' && (
            <button className={tab === 'admin' ? 'tab active' : 'tab'} onClick={() => setTab('admin')}>Система</button>
          )}
        </nav>
        <div className="topbar-right">
          {servedBy && <span className="chip" title="API-сервер, який відповів на останній запит">відповів {servedBy}</span>}
          <span className="who">{user.username}</span>
          <button className="btn ghost" onClick={logout}>Вийти</button>
        </div>
      </header>

      <main className="content">
        {!limits ? (
          <p className="muted">Завантажуємо обмеження із сервера…</p>
        ) : tab === 'tasks' ? (
          <Dashboard limits={limits} />
        ) : (
          <AdminPanel limits={limits} />
        )}
      </main>
    </div>
  );
}
