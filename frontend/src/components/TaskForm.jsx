import { useState } from 'react';
import { api } from '../api.js';
import { validateParams } from '../validate.js';
import { fmtNumber } from '../format.js';

const defaultsFor = (limits, type) =>
  Object.fromEntries(Object.entries(limits.types[type].params).map(([k, p]) => [k, String(p.default)]));

export default function TaskForm({ limits, activeCount, onCreated }) {
  const types = Object.keys(limits.types);
  const [type, setType] = useState(types[0]);
  const [values, setValues] = useState(() => defaultsFor(limits, types[0]));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const spec = limits.types[type];
  const full = activeCount >= limits.maxActiveTasksPerUser;

  const changeType = (t) => {
    setType(t);
    setValues(defaultsFor(limits, t));
    setErrors({});
    setServerError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setServerError('');
    const errs = validateParams(type, spec, values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const params = Object.fromEntries(
      Object.entries(spec.params).map(([k, p]) => [k, p.kind === 'enum' ? values[k] : Number(values[k])])
    );
    setBusy(true);
    try {
      await api.createTask(type, params);
      await onCreated();
    } catch (err) {
      setServerError(err.message); 
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <h2>Нова задача</h2>

      <label className="field">
        <span>Тип задачі</span>
        <select value={type} onChange={(e) => changeType(e.target.value)}>
          {types.map((t) => <option key={t} value={t}>{limits.types[t].label}</option>)}
        </select>
      </label>
      <p className="muted small">{spec.description}</p>

      {Object.entries(spec.params).map(([key, p]) => (
        <label className="field" key={key}>
          <span>{p.label}</span>
          {p.kind === 'enum' ? (
            <select value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>
              {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input inputMode="decimal" value={values[key]} aria-invalid={!!errors[key]}
                   onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          )}
          {errors[key]
            ? <small className="field-error">{errors[key]}</small>
            : p.kind !== 'enum' && <small className="muted">від {fmtNumber(p.min)} до {fmtNumber(p.max)}</small>}
        </label>
      ))}

      {serverError && <div className="alert error" role="alert">{serverError}</div>}

      <button className="btn primary" disabled={busy || full}>
        {busy ? 'Запуск…' : 'Запустити задачу'}
      </button>
      <p className="muted small">
        Активних задач: {activeCount} з {limits.maxActiveTasksPerUser}.
        Задачу буде автоматично зупинено через {limits.maxTaskSeconds} с.
        {full && ' Скасуйте задачу або дочекайтесь завершення, щоб запустити нову.'}
      </p>
    </form>
  );
}
