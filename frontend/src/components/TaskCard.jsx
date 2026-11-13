import { useState } from 'react';
import { fmtDate, fmtMs, fmtNumber, fmtSeconds, paramsSummary, STATUS_LABEL } from '../format.js';

const RESULT_LABELS = {
  unknowns: 'Кількість невідомих',
  max_abs_error: 'Максимальна похибка розв’язку',
  residual_inf_norm: 'Норма нев’язки',
  solution_preview: 'Перші значення розв’язку',
  iterations: 'Кількість ітерацій',
  sqrt2: 'Знайдене значення √2',
  reference: 'Точне значення √2',
  abs_error: 'Абсолютна похибка',
  mean_value: 'Середнє значення',
  value: 'Значення інтеграла',
  exact: 'Точне значення',
  steps: 'Кількість кроків',
};

function fmtValue(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => Number(x).toPrecision(8)).join(', ');
  if (typeof v === 'number') return Number.isInteger(v) ? fmtNumber(v) : v.toPrecision(12);
  return String(v);
}

function Ruler({ value, status }) {
  return (
    <div className={`ruler ${status}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="ruler-fill" style={{ width: `${status === 'queued' ? 100 : value}%` }} />
    </div>
  );
}

export default function TaskCard({ task, limits, onCancel, onDelete }) {
  const [open, setOpen] = useState(false);
  const t = task;
  const spec = limits.types[t.type];
  const isActive = t.status === 'queued' || t.status === 'running';
  const label = spec?.label || t.type;

  let info = null;
  if (t.status === 'queued') {
    info = t.eta_seconds === null
      ? 'У черзі. Зараз немає жодного активного сервера обчислень.'
      : `Позиція в черзі: ${t.queue_position} · почнеться через ~${fmtSeconds(t.eta_start_seconds)} · завершиться через ~${fmtSeconds(t.eta_seconds)}`;
  } else if (t.status === 'running') {
    info = t.cancel_requested
      ? 'Зупиняємо…'
      : `${Math.floor(t.progress)}% · залишилось приблизно ${fmtSeconds(t.eta_seconds)} · виконує ${t.worker_id}`;
  } else if (t.status === 'done') {
    info = `Завершено за ${fmtMs(t.elapsed_ms)} · сервер ${t.worker_id}`;
  } else if (t.status === 'cancelled') {
    info = t.started_at ? `Зупинено через ${fmtMs(t.elapsed_ms)}` : 'Скасовано до початку виконання';
  }

  return (
    <article className={`task ${t.status}`}>
      <div className="task-head">
        <div>
          <h3>#{t.id} {label}</h3>
          <p className="params">{paramsSummary(t.params, spec)}</p>
        </div>
        <span className={`badge ${t.status}`}>{STATUS_LABEL[t.status]}</span>
      </div>

      {isActive && <Ruler value={t.progress} status={t.status} />}
      {info && <p className="task-info">{info}</p>}
      {t.status === 'failed' && <p className="task-info error-text">{t.error}</p>}

      <div className="task-foot">
        <span className="muted small">Створено {fmtDate(t.created_at)}</span>
        <div className="actions">
          {t.status === 'done' && (
            <button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Сховати результат' : 'Показати результат'}</button>
          )}
          {isActive && !t.cancel_requested && <button className="btn danger small" onClick={onCancel}>Скасувати</button>}
          {!isActive && <button className="btn ghost small" onClick={onDelete}>Видалити</button>}
        </div>
      </div>

      {open && t.result && (
        <div className="result">
          <dl className="result-list">
            {Object.entries(t.result).map(([k, v]) => (
              <div key={k} className="result-row">
                <dt>{RESULT_LABELS[k] || k}</dt>
                <dd>{fmtValue(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </article>
  );
}
