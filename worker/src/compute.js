// ============================================================================
// Обчислення виконуються в ОКРЕМОМУ потоці (worker_threads), щоб важкий цикл
// не блокував основний потік worker-а (heartbeat, оновлення БД, скасування).
// Основний потік може в будь-який момент зупинити цей потік через terminate().
// ============================================================================
import { parentPort, workerData } from 'node:worker_threads';

const { type, params } = workerData;

// Відправляємо прогрес (відсотки) основному потоку з кроком 0.5%.
let lastReported = -1;
function report(pct) {
  const v = Math.floor(Math.min(pct, 99.5) * 2) / 2;
  if (v > lastReported) {
    lastReported = v;
    parentPort.postMessage({ type: 'progress', value: v });
  }
}

// Простий детермінований генератор випадкових чисел (результати відтворювані).
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 1. Система лінійних рівнянь: метод Гауса з вибором головного елемента ----------
// Генератор рядків матриці: однаковий seed дає ту саму матрицю, тож для перевірки
// нев'язки матрицю не треба зберігати вдруге (економія пам'яті при великих N).
function matrixRows(n) {
  const rand = mulberry32(12345);
  const xTrue = new Float64Array(n);
  for (let i = 0; i < n; i++) xTrue[i] = rand() * 10 - 5;
  // Діагонально домінантна матриця — гарантовано розв'язувана і стійка.
  const nextRow = (row) => {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      const v = rand() * 2 - 1;
      row[j] = v;
      rowSum += Math.abs(v);
    }
    return rowSum + 1; // значення діагонального елемента
  };
  return { xTrue, nextRow };
}

function linearSystem({ n }) {
  const A = new Float64Array(n * n);
  const { xTrue, nextRow } = matrixRows(n);
  for (let i = 0; i < n; i++) {
    const row = A.subarray(i * n, (i + 1) * n);
    row[i] = nextRow(row);
  }
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i * n + j] * xTrue[j];
    b[i] = s;
  }
  const b0 = Float64Array.from(b); // копія правої частини для обчислення нев'язки

  // Прямий хід. Крок k коштує ~ (n-k)^2 операцій, тому прогрес рахуємо за кумулятивною вартістю.
  for (let k = 0; k < n - 1; k++) {
    let p = k;
    let max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > max) { max = v; p = i; }
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const tmp = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = tmp;
      }
      const tb = b[k]; b[k] = b[p]; b[p] = tb;
    }
    const rowK = k * n;
    const pivot = A[rowK + k];
    for (let i = k + 1; i < n; i++) {
      const rowI = i * n;
      const f = A[rowI + k] / pivot;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[rowI + j] -= f * A[rowK + j];
      b[i] -= f * b[k];
    }
    report(98 * (1 - ((n - k - 1) / n) ** 3));
  }

  // Зворотний хід
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }

  // Перевірка: похибка відносно точного розв'язку і нев'язка ||A·x − b||
  // (рядки вихідної матриці генеруються заново тим самим генератором).
  const gen = matrixRows(n);
  const row = new Float64Array(n);
  let maxErr = 0;
  let residual = 0;
  for (let i = 0; i < n; i++) {
    maxErr = Math.max(maxErr, Math.abs(x[i] - xTrue[i]));
    row[i] = gen.nextRow(row);
    let s = 0;
    for (let j = 0; j < n; j++) s += row[j] * x[j];
    residual = Math.max(residual, Math.abs(s - b0[i]));
  }
  return {
    unknowns: n,
    max_abs_error: maxErr,
    residual_inf_norm: residual,
    solution_preview: Array.from(x.slice(0, 5)),
  };
}

// ---------- 2. Цикл із пошуком кореня з 2 (імітація навантаження на процесор) ----------
function sqrtLoop({ iterations }) {
  // Ітерацій може бути більше за 2^31, тому цикл іде блоками (лічильник у блоці — мале ціле).
  const BLOCK = 1 << 20; // кратне 4, тож (j & 3) дає ту саму послідовність, що й (i & 3)
  let acc = 0;
  let last = 0;
  for (let base = 0; base < iterations; base += BLOCK) {
    const end = Math.min(BLOCK, iterations - base);
    for (let j = 0; j < end; j++) {
      let x = 1 + (j & 3) * 0.25; // різні початкові значення, щоб цикл не оптимізувався
      for (let s = 0; s < 20; s++) x = 0.5 * (x + 2 / x); // метод Ньютона для sqrt(2)
      acc += x;
      last = x;
    }
    report((100 * (base + end)) / iterations);
  }
  return {
    iterations,
    sqrt2: last,
    reference: Math.SQRT2,
    abs_error: Math.abs(last - Math.SQRT2),
    mean_value: acc / iterations,
  };
}

// ---------- 3. Чисельне інтегрування: формула Сімпсона ----------
const FUNCS = {
  sin: Math.sin,
  x_sin_x: (x) => x * Math.sin(x),
  exp_neg_x2: (x) => Math.exp(-x * x),
};
// Точні значення (де відомі) — для порівняння
const EXACT = {
  sin: (a, b) => Math.cos(a) - Math.cos(b),
  x_sin_x: (a, b) => Math.sin(b) - b * Math.cos(b) - (Math.sin(a) - a * Math.cos(a)),
  exp_neg_x2: null,
};

function integral({ func, a, b, steps }) {
  const f = FUNCS[func];
  const h = (b - a) / steps;
  // Кроків може бути більше за 2^31, тому цикл іде блоками: лічильник усередині блоку
  // лишається малим цілим числом (так швидше), а прогрес звітуємо після кожного блоку.
  const BLOCK = 1 << 20; // парне, тож парність індексу = парність j
  let sum = f(a) + f(b);
  for (let base = 0; base < steps; base += BLOCK) {
    const end = Math.min(BLOCK, steps - base);
    let part = 0;
    for (let j = base === 0 ? 1 : 0; j < end; j++) {
      part += ((j & 1) === 0 ? 2 : 4) * f(a + (base + j) * h);
    }
    sum += part;
    report((100 * (base + end)) / steps);
  }
  const value = (sum * h) / 3;
  const exact = EXACT[func] ? EXACT[func](a, b) : null;
  return { value, exact, abs_error: exact === null ? null : Math.abs(value - exact), steps };
}

const HANDLERS = { linear_system: linearSystem, sqrt_loop: sqrtLoop, integral };
const result = HANDLERS[type](params);
parentPort.postMessage({ type: 'done', result });
