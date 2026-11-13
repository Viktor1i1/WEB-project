import { fmtNumber } from './format.js';

export function validateParams(type, spec, values) {
  const errors = {};
  for (const [key, p] of Object.entries(spec.params)) {
    if (p.kind === 'enum') continue;
    const raw = values[key];
    if (raw === '' || raw === undefined) { errors[key] = 'Обов’язкове поле'; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v)) errors[key] = 'Потрібно ввести число';
    else if (p.kind === 'int' && !Number.isInteger(v)) errors[key] = 'Потрібно ціле число';
    else if (v < p.min || v > p.max) errors[key] = `Допустимо від ${fmtNumber(p.min)} до ${fmtNumber(p.max)}`;
  }
  if (type === 'integral') {
    if (!errors.a && !errors.b && Number(values.a) >= Number(values.b)) errors.b = 'Має бути більшою за нижню межу';
    if (!errors.steps && Number(values.steps) % 2 !== 0) errors.steps = 'Потрібне парне число';
  }
  return errors;
}
