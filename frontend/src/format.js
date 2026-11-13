export const fmtNumber = (n) => Number(n).toLocaleString('uk-UA');

export function fmtSeconds(s) {
  if (s === null || s === undefined) return '—';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} хв ${r} с` : `${m} хв`;
  return `${Math.floor(m / 60)} год ${m % 60} хв`;
}

export const fmtMs = (ms) => fmtSeconds(ms / 1000);

export const fmtDate = (iso) =>
  new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const STATUS_LABEL = {
  queued: 'У черзі',
  running: 'Виконується',
  done: 'Готово',
  failed: 'Помилка',
  cancelled: 'Скасовано',
};

export function paramsSummary(params, spec) {
  return Object.entries(params)
    .map(([key, value]) => {
      const p = spec?.params?.[key];
      const label = p ? p.label.replace(/\s*\(.*\)\s*$/, '') : key;
      let shown = value;
      if (p?.kind === 'enum') shown = p.options.find((o) => o.value === value)?.label ?? value;
      else if (typeof value === 'number') shown = fmtNumber(value);
      return `${label}: ${shown}`;
    })
    .join(' · ');
}
