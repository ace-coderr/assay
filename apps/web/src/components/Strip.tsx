import { useEffect, useState } from "react";

interface Props {
  /** Deviation of DEX price from reference in basis points. undefined = unavailable. */
  deviationBps?: number;
  /** Normal range half-width (band). */
  bandBps?: number;
  /** Half-width of the whole scale. */
  rangeBps?: number;
  state?: string;
  label?: string;
}

const W = 600;
const PAD = 24;

/** The signature visual: a scale with a needle that sweeps in and settles. Coral on drift. */
export function Strip({ deviationBps, bandBps = 100, rangeBps = 300, state, label }: Props) {
  const x = (bps: number) => PAD + ((Math.max(-rangeBps, Math.min(rangeBps, bps)) + rangeBps) / (2 * rangeBps)) * (W - 2 * PAD);
  const [pos, setPos] = useState(-rangeBps);
  useEffect(() => {
    if (deviationBps == null) return;
    setPos(-rangeBps);
    // A timer, not requestAnimationFrame: rAF is suspended in background tabs, which would leave the needle at its start.
    const id = setTimeout(() => setPos(deviationBps), 60);
    return () => clearTimeout(id);
  }, [deviationBps, rangeBps]);

  const unavailable = deviationBps == null;
  const warn = state === "Drifting" || state === "Broken" || (deviationBps != null && Math.abs(deviationBps) > bandBps);
  const stale = state === "Stale";
  const ticks: number[] = [];
  for (let b = -rangeBps; b <= rangeBps; b += 50) ticks.push(b);
  const aria = unavailable
    ? `${label ?? "Reading"}: unavailable`
    : `${label ?? "Reading"}: ${deviationBps!.toFixed(0)} basis points from reference, state ${state ?? "unknown"}`;

  return (
    <svg className={`strip ${warn ? "warn" : ""} ${stale ? "stale" : ""}`} viewBox={`0 0 ${W} 78`} role="img" aria-label={aria}>
      {unavailable ? (
        <rect className="na" x={PAD} y="22" width={W - 2 * PAD} height="22" rx="6" />
      ) : (
        <rect className="band" x={x(-bandBps)} y="22" width={x(bandBps) - x(-bandBps)} height="22" rx="4" />
      )}
      <line className="axis" x1={PAD} x2={W - PAD} y1="33" y2="33" />
      {ticks.map((b) => (
        <g key={b}>
          <line className="axis" x1={x(b)} x2={x(b)} y1={b % 100 === 0 ? 26 : 29} y2={b % 100 === 0 ? 40 : 37} />
          {b % 100 === 0 && (
            <text className="tick-l" x={x(b)} y="58" textAnchor="middle">
              {b > 0 ? `+${b}` : b}
            </text>
          )}
        </g>
      ))}
      <text className="tick-l" x={W / 2} y="74" textAnchor="middle">
        {unavailable ? "unavailable: no reading to place on the scale" : "bps from reference"}
      </text>
      {!unavailable && (
        <g className="needle" style={{ transform: `translateX(${x(pos)}px)` }}>
          <line x1="0" x2="0" y1="12" y2="44" strokeWidth="2.5" strokeLinecap="round" />
          <polygon points="-6,6 6,6 0,15" />
          <circle cx="0" cy="33" r="3.5" />
        </g>
      )}
    </svg>
  );
}
