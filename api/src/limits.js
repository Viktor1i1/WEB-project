export const LIMITS = {
  maxActiveTasksPerUser: 5,   
  maxHistoryPerUser: 50,      
  maxQueueLength: 100,        
  maxTaskSeconds: Number(process.env.MAX_TASK_SECONDS || 600),

  types: {
    linear_system: {
      label: 'Система лінійних рівнянь (метод Гауса)',
      description: 'Розв’язує систему A·x = b для випадкової матриці N×N із діагональною перевагою.',
      params: {
        n: { kind: 'int', label: 'Кількість невідомих (N)', min: 2, max: 7000, default: 3000 },
      },
    },
    sqrt_loop: {
      label: 'Квадратний корінь з 2 (цикл на процесорі)',
      description: 'Багато разів повторює метод Ньютона для √2, щоб навантажити процесор.',
      params: {
        iterations: { kind: 'int', label: 'Кількість ітерацій', min: 1000, max: 8_000_000_000, default: 500_000_000 },
      },
    },
    integral: {
      label: 'Чисельне інтегрування (метод Сімпсона)',
      description: 'Обчислює інтеграл функції на відрізку [a, b] методом Сімпсона.',
      params: {
        func: {
          kind: 'enum', label: 'Функція', default: 'sin',
          options: [
            { value: 'sin', label: 'sin(x)' },
            { value: 'x_sin_x', label: 'x·sin(x)' },
            { value: 'exp_neg_x2', label: 'exp(−x²)' },
          ],
        },
        a: { kind: 'number', label: 'Нижня межа (a)', min: -100, max: 100, default: 0 },
        b: { kind: 'number', label: 'Верхня межа (b)', min: -100, max: 100, default: 10 },
        steps: { kind: 'int', label: 'Кількість кроків (парне число)', min: 1000, max: 50_000_000_000, default: 3_000_000_000 },
      },
    },
  },
};
const UNITS = {
  linear_system: (p) => p.n ** 3,
  sqrt_loop: (p) => p.iterations,
  integral: (p) => p.steps,
};

export function validateTask(type, params) {
  const spec = LIMITS.types[type];
  if (!spec) return { error: 'Невідомий тип задачі' };
  if (typeof params !== 'object' || params === null) return { error: 'Потрібно вказати параметри' };

  const clean = {};
  for (const [key, p] of Object.entries(spec.params)) {
    const raw = params[key];
    if (p.kind === 'enum') {
      if (!p.options.some((o) => o.value === raw)) return { error: `${p.label}: недопустиме значення` };
      clean[key] = raw;
      continue;
    }
    const v = Number(raw);
    if (raw === '' || raw === null || !Number.isFinite(v)) return { error: `${p.label}: потрібно ввести число` };
    if (p.kind === 'int' && !Number.isInteger(v)) return { error: `${p.label}: має бути цілим числом` };
    if (v < p.min || v > p.max) return { error: `${p.label}: має бути від ${p.min} до ${p.max}` };
    clean[key] = v;
  }

  if (type === 'integral') {
    if (clean.a >= clean.b) return { error: 'Нижня межа має бути меншою за верхню' };
    if (clean.steps % 2 !== 0) return { error: 'Кількість кроків має бути парним числом' };
  }

  return { clean, units: UNITS[type](clean) };
}
