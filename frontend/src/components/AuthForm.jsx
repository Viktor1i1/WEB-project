import { useState } from 'react';
import { api } from '../api.js';

export default function AuthForm({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (username.trim().length < 3) return setError('Ім’я користувача має містити щонайменше 3 символи');
    if (password.length < 6) return setError('Пароль має містити щонайменше 6 символів');
    setBusy(true);
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const { token, user } = await fn(username.trim(), password);
      onAuth(token, user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Важкі задачі</h1>
        <p className="muted">Запускайте довгі обчислення й стежте за їхнім виконанням.</p>

        <label className="field">
          <span>Ім’я користувача</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>

        {error && <div className="alert error" role="alert">{error}</div>}

        <button className="btn primary" disabled={busy}>
          {busy ? 'Зачекайте…' : mode === 'login' ? 'Увійти' : 'Створити акаунт'}
        </button>
        <button type="button" className="btn link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'Ще немає акаунта? Зареєструватися' : 'Уже є акаунт? Увійти'}
        </button>
      </form>
    </div>
  );
}
