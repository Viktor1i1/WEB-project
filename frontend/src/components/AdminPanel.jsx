import { useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../hooks.js';
import { fmtMs, STATUS_LABEL } from '../format.js';
import LineChart from './LineChart.jsx';

const workerState = (w) => (!w.alive ? 'offline' : w.draining ? 'draining' : 'online');
const WORKER_STATE_LABEL = { online: 'онлайн', draining: 'вимикається', offline: 'офлайн' };

export default function AdminPanel({ limits }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    try { setData(await api.adminOverview()); setError(''); }
    catch (e) { setError(e.message); }
  };
  usePolling(refresh, 3000);

  if (error && !data) return <div className="alert error">{error}</div>;
  if (!data) return <p className="muted">Завантаження…</p>;

  const online = data.workers.filter((w) => w.alive);
  const usable = online.filter((w) => !w.draining);
  const capacity = usable.reduce((s, w) => s + w.concurrency, 0);
  const running = online.reduce((s, w) => s + w.running, 0);
  const queued = data.counts.queued || 0;
  const dynamic = online.filter((w) => w.is_dynamic).length;

  const m = data.metrics;
  const cancel = async (id) => { try { await api.cancelTask(id); await refresh(); } catch (e) { setError(e.message); } };

  return (
    <div className="admin">
      {error && <div className="alert error">{error}</div>}

      <div className="readout">
        <div><b>{queued}</b><span>у черзі</span></div>
        <div><b>{running}<small>/{capacity}</small></b><span>слотів зайнято</span></div>
        <div><b>{online.length}<small>/{data.scaling.max}</small></b><span>серверів онлайн</span></div>
        <div><b>{dynamic}</b><span>запущено автоскейлером</span></div>
        <div><b>{data.users}</b><span>користувачів</span></div>
      </div>

      <section className="panel">
        <h2>Навантаження в часі</h2>
        <LineChart
          times={m.map((p) => p.t)}
          series={[
            { name: 'У черзі', color: '#C27A0E', values: m.map((p) => p.queued) },
            { name: 'Виконується', color: '#2F5BFF', values: m.map((p) => p.running) },
            { name: 'Сервери', color: '#138A5B', values: m.map((p) => p.workers) },
          ]}
        />
        <p className="muted small">
          Автомасштабування підтримує від {data.scaling.min} до {data.scaling.max} серверів. Воно додає сервер, коли задачі
          чекають на вільний слот, і прибирає зайві, коли кластер здебільшого простоює.
        </p>
      </section>

      <section className="panel">
        <h2>Сервери обчислень</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Сервер</th><th>Тип</th><th>Стан</th><th>Задачі</th><th>Пам’ять</th><th>Виконано</th><th>Останній сигнал</th></tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.id}</td>
                  <td>{w.is_dynamic ? 'автомасштабований' : 'постійний'}</td>
                  <td><span className={`badge ${workerState(w)}`}>{WORKER_STATE_LABEL[workerState(w)]}</span></td>
                  <td>{w.running} / {w.concurrency}</td>
                  <td>{Math.round(w.mem_mb)} МБ</td>
                  <td>{w.tasks_done}</td>
                  <td>{w.heartbeat_age_s} с тому</td>
                </tr>
              ))}
              {data.workers.length === 0 && <tr><td colSpan="8" className="muted">Жоден сервер ще не зареєструвався.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Активні задачі</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Користувач</th><th>Тип</th><th>Стан</th><th>Прогрес</th><th>Сервер</th><th>Виконується</th><th /></tr>
            </thead>
            <tbody>
              {data.activeTasks.map((t) => (
                <tr key={t.id}>
                  <td className="mono">#{t.id}</td>
                  <td>{t.username}</td>
                  <td>{limits.types[t.type]?.label || t.type}</td>
                  <td><span className={`badge ${t.status}`}>{STATUS_LABEL[t.status]}</span></td>
                  <td>{t.status === 'running' ? `${Math.floor(t.progress)}%` : '—'}</td>
                  <td className="mono">{t.worker_id || '—'}</td>
                  <td>{t.status === 'running' ? fmtMs(t.elapsed_ms) : '—'}</td>
                  <td><button className="btn danger small" onClick={() => cancel(t.id)}>Скасувати</button></td>
                </tr>
              ))}
              {data.activeTasks.length === 0 && <tr><td colSpan="8" className="muted">Зараз нічого не виконується.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Завершено загалом: успішно — {data.counts.done || 0}, з помилкою — {data.counts.failed || 0}, скасовано — {data.counts.cancelled || 0}.
        </p>
      </section>
    </div>
  );
}
