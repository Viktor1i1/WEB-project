import { useState } from 'react';
import { api } from '../api.js';
import { usePolling } from '../hooks.js';
import { fmtSeconds } from '../format.js';
import TaskForm from './TaskForm.jsx';
import TaskCard from './TaskCard.jsx';

export default function Dashboard({ limits }) {
  const [tasks, setTasks] = useState([]);
  const [system, setSystem] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [actionError, setActionError] = useState('');

  const refresh = async () => {
    try {
      const data = await api.tasks();
      setTasks(data.tasks);
      setSystem(data.system);
      setOffline(false);
      setLoaded(true);
    } catch (e) {
      if (e.status !== 401) setOffline(true);
    }
  };

  usePolling(refresh, 2000);

  const act = async (fn) => {
    setActionError('');
    try { await fn(); await refresh(); } catch (e) { setActionError(e.message); }
  };

  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'running');
  const queued = tasks.filter((t) => t.status === 'queued');
  const nextStart = queued.length ? Math.min(...queued.map((t) => t.eta_start_seconds ?? Infinity)) : null;

  return (
    <div className="grid">
      <aside className="side">
        <TaskForm limits={limits} activeCount={active.length} onCreated={refresh} />
      </aside>

      <section className="main">
        {queued.length > 0 && (
          <div className="alert warn" role="status">
            <strong>Усі сервери зайняті.</strong> Ваших задач у черзі: {queued.length}.
            {Number.isFinite(nextStart)
              ? ` Перша має почати виконання приблизно через ${fmtSeconds(nextStart)}.`
              : ' Зараз немає жодного активного сервера обчислень.'}
            {' '}Сторінку можна закрити: задачі в черзі збережені й виконаються в будь-якому разі.
          </div>
        )}
        {offline && <div className="alert error">Зв’язок із сервером втрачено. Пробуємо ще раз…</div>}
        {actionError && <div className="alert error">{actionError}</div>}

        <div className="list-head">
          <h2>Історія</h2>
          <span className="muted">
            Збережено: {tasks.length} з {limits.maxHistoryPerUser}
            {system && ` · кластер: виконується ${system.running}, у черзі ${system.queued}`}
          </span>
        </div>

        {!loaded ? (
          <p className="muted">Завантаження…</p>
        ) : tasks.length === 0 ? (
          <div className="empty">Задач ще немає. Оберіть тип задачі ліворуч і натисніть «Запустити задачу».</div>
        ) : (
          <div className="tasks">
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} limits={limits}
                        onCancel={() => act(() => api.cancelTask(t.id))}
                        onDelete={() => act(() => api.deleteTask(t.id))} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
