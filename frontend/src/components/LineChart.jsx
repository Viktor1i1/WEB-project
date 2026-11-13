import { fmtTime } from '../format.js';

export default function LineChart({ times, series }) {
  const W = 640, H = 190, L = 34, R = 8, T = 10, B = 22;
  const n = times.length;
  if (n < 2) return <p className="muted">Збираємо дані… графік з’явиться за кілька секунд.</p>;

  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const top = Math.ceil(maxVal / 2) * 2 || 2;
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = [0, top / 2, top];

  return (
    <div>
      <div className="legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Навантаження в часі">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} className="grid-line" />
            <text x={L - 6} y={y(tv) + 4} textAnchor="end" className="axis">{tv}</text>
          </g>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
                    points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ))}
        <text x={L} y={H - 4} className="axis">{fmtTime(times[0])}</text>
        <text x={W - R} y={H - 4} textAnchor="end" className="axis">{fmtTime(times[n - 1])}</text>
      </svg>
    </div>
  );
}
