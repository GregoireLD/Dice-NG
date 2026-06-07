import { useEffect, useRef, useState } from 'react';
import { DiceSimulation } from '../physics/DiceSimulation';
import type { DieSides } from '../dice/types';

// Chi-squared critical values at p=0.10 / 0.05 / 0.01 for df = numOutcomes-1
const CHI2: Record<number, { p10: number; p05: number; p01: number }> = {
  1:  { p10: 2.706,  p05: 3.841,  p01: 6.635  },  // d2 (2 outcomes)
  3:  { p10: 6.251,  p05: 7.815,  p01: 11.345 },  // d4
  5:  { p10: 9.236,  p05: 11.070, p01: 15.086 },  // d6
  7:  { p10: 12.017, p05: 14.067, p01: 18.475 },  // d8
  9:  { p10: 14.684, p05: 16.919, p01: 21.666 },  // d10
  11: { p10: 17.275, p05: 19.675, p01: 24.725 },  // d12
  19: { p10: 27.204, p05: 30.144, p01: 36.191 },  // d20
};

type Verdict = 'fair' | 'marginal' | 'suspect' | 'biased';

function getVerdict(chi2: number, df: number): { label: string; type: Verdict } {
  const t = CHI2[df];
  if (!t || chi2 < t.p10) return { label: '✓ Fair',     type: 'fair'     };
  if (chi2 < t.p05)        return { label: '~ Marginal', type: 'marginal' };
  if (chi2 < t.p01)        return { label: '⚠ Suspect',  type: 'suspect'  };
  return                          { label: '✗ Biased',   type: 'biased'   };
}

// The valid face values for each die type.
// d2 (coin) uses [0, 1] — all others use [1 .. sides].
function faceRange(sides: number): number[] {
  return sides === 2 ? [0, 1] : Array.from({ length: sides }, (_, i) => i + 1);
}

// Human-readable label for a face chip.
function faceLabel(sides: number, face: number): string {
  if (sides === 2) return face === 1 ? 'H' : 'T'; // Heads / Tails
  return String(face);
}

function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 5) return '< 5s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface DieStat {
  sides: number;
  rolls: number;
  counts: Record<number, number>;
  chiSquared: number;
  verdict: { label: string; type: Verdict };
}

const TEST_PLAN: { sides: DieSides; rolls: number }[] = [
  { sides: 2,  rolls: 2500 },
  { sides: 4,  rolls: 3000 },
  { sides: 6,  rolls: 3000 },
  { sides: 8,  rolls: 4000 },
  { sides: 10, rolls: 4000 },
  { sides: 12, rolls: 5000 },
  { sides: 20, rolls: 6000 },
];

const TOTAL_ROLLS = TEST_PLAN.reduce((s, d) => s + d.rolls, 0);

export function DiceStatsModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [doneSoFar, setDoneSoFar] = useState(0);
  const [currentDieIdx, setCurrentDieIdx] = useState(0);
  const [currentDieDone, setCurrentDieDone] = useState(0);
  const [results, setResults] = useState<DieStat[]>([]);
  const abortRef = useRef(false);
  const simRef = useRef<DiceSimulation | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => () => {
    abortRef.current = true;
    simRef.current?.dispose();
  }, []);

  async function run() {
    abortRef.current = false;
    setPhase('running');
    setResults([]);
    setDoneSoFar(0);
    setCurrentDieIdx(0);
    setCurrentDieDone(0);
    startedAtRef.current = Date.now();

    const sim = await DiceSimulation.create();
    simRef.current = sim;

    const runId = Date.now();
    let totalDone = 0;
    const accumulated: DieStat[] = [];

    for (let dieIdx = 0; dieIdx < TEST_PLAN.length; dieIdx++) {
      if (abortRef.current) break;
      const { sides, rolls } = TEST_PLAN[dieIdx];
      setCurrentDieIdx(dieIdx);
      setCurrentDieDone(0);

      sim.setDice([sides]);
      const faces = faceRange(sides);
      const counts: Record<number, number> = {};
      for (const f of faces) counts[f] = 0;

      for (let i = 0; i < rolls; i++) {
        if (abortRef.current) break;

        sim.roll(`stats-${runId}-${sides}-${i}`);

        let lastYield = performance.now();
        while (!sim.isAllSettled()) {
          sim.stepMany(60); // 1 sim-second per chunk
          const now = performance.now();
          if (now - lastYield > 16) {
            await new Promise<void>((r) => setTimeout(r, 0));
            if (abortRef.current) break;
            lastYield = performance.now();
          }
        }

        if (abortRef.current) break;

        const value = sim.getTransforms()[0]?.value ?? faces[0];
        if (value in counts) counts[value]++;

        totalDone++;
        setDoneSoFar(totalDone);
        setCurrentDieDone(i + 1);

        // Yield every 25 rolls so React can flush state and repaint the progress bar.
        // Without this, fast-settling dice never hit the inner 16ms yield and the bar
        // stays at 0% until the entire test finishes.
        if ((i + 1) % 25 === 0) {
          await new Promise<void>((r) => setTimeout(r, 0));
          if (abortRef.current) break;
        }
      }

      if (abortRef.current) break;

      const expected = rolls / faces.length;
      let chi2 = 0;
      for (const f of faces) chi2 += ((counts[f] - expected) ** 2) / expected;
      chi2 = Math.round(chi2 * 100) / 100;

      const df = faces.length - 1;
      accumulated.push({
        sides,
        rolls,
        counts,
        chiSquared: chi2,
        verdict: getVerdict(chi2, df),
      });
      setResults([...accumulated]);
    }

    simRef.current = null;
    sim.dispose();
    setPhase(abortRef.current ? 'idle' : 'done');
  }

  // Derived progress values
  const totalPct = TOTAL_ROLLS > 0 ? (doneSoFar / TOTAL_ROLLS) * 100 : 0;
  const currentPlan = TEST_PLAN[currentDieIdx];
  const diePct = currentPlan ? (currentDieDone / currentPlan.rolls) * 100 : 0;

  const elapsed = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;
  const rate = elapsed > 0 ? doneSoFar / elapsed : 0;
  const remainingMs = rate > 0 ? (TOTAL_ROLLS - doneSoFar) / rate : 0;
  const eta = elapsed > 2000 && doneSoFar > 10 ? `~${formatEta(remainingMs)}` : '';

  const isRunning = phase === 'running';
  const isDone = phase === 'done';

  return (
    <div className="stats-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="stats-modal">
        <div className="stats-header">
          <h2 className="stats-title">Dice Fairness Test</h2>
          <button className="stats-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Progress section — always visible so user knows where to look */}
        <div className="stats-progress-area">
          <div className="stats-progress-header">
            {isRunning && currentPlan ? (
              <>
                <span className="stats-progress-die">
                  <strong>d{currentPlan.sides}</strong>
                  <span className="stats-die-idx">({currentDieIdx + 1}/{TEST_PLAN.length})</span>
                </span>
                <span className="stats-progress-counts">
                  {doneSoFar.toLocaleString()} / {TOTAL_ROLLS.toLocaleString()} rolls
                </span>
                {eta && <span className="stats-eta">{eta}</span>}
              </>
            ) : (
              <span className="stats-progress-counts">
                {isDone ? 'Complete' : `${TOTAL_ROLLS.toLocaleString()} rolls planned`}
              </span>
            )}
          </div>

          {/* Overall bar */}
          <div className="stats-progress-track">
            <div className="stats-progress-fill" style={{ width: `${totalPct}%` }} />
          </div>
          <div className="stats-progress-pct">{totalPct.toFixed(1)}%</div>

          {/* Per-die bar — only meaningful while running */}
          {isRunning && currentPlan && (
            <>
              <div className="stats-die-progress-label">
                Current die — {currentDieDone.toLocaleString()} / {currentPlan.rolls.toLocaleString()}
              </div>
              <div className="stats-progress-track stats-progress-track-sm">
                <div className="stats-progress-fill stats-progress-fill-dim" style={{ width: `${diePct}%` }} />
              </div>
            </>
          )}

          {/* Action button */}
          {isRunning ? (
            <button className="stats-cancel-btn" onClick={() => { abortRef.current = true; }}>
              Cancel
            </button>
          ) : isDone ? (
            <button className="stats-run-btn" onClick={run}>Run Again</button>
          ) : (
            <button className="stats-run-btn" onClick={run}>
              Start — {TOTAL_ROLLS.toLocaleString()} rolls
            </button>
          )}
        </div>

        {!isDone && phase === 'idle' && (
          <p className="stats-intro-note">
            Chi-squared (χ²) goodness-of-fit test across all die geometries.
            Headless simulation — no rendering. Takes several minutes.
          </p>
        )}

        {results.length > 0 && (
          <div className="stats-results">
            {results.map((s) => <StatRow key={s.sides} stat={s} />)}
          </div>
        )}

        {isDone && (
          <p className="stats-note">
            Thresholds: Fair p&gt;0.10 · Marginal p≈0.10 · Suspect p&lt;0.05 · Biased p&lt;0.01.{' '}
            Face chip color: <span style={{ color: '#4ade80' }}>green</span> within 1σ ·{' '}
            <span style={{ color: '#fbbf24' }}>yellow</span> 1–2σ ·{' '}
            <span style={{ color: '#f87171' }}>red</span> &gt;2σ from expected.
            d2: H=Heads (1) / T=Tails (0).
          </p>
        )}
      </div>
    </div>
  );
}

function StatRow({ stat }: { stat: DieStat }) {
  const { sides, rolls, counts, chiSquared } = stat;
  const faces = faceRange(sides);
  const expected = rolls / faces.length;
  const sigma = Math.sqrt(rolls * (1 / faces.length) * (1 - 1 / faces.length));
  const df = faces.length - 1;
  const t = CHI2[df];
  const v = stat.verdict;

  return (
    <div className={`stat-row stat-${v.type}`}>
      <div className="stat-row-head">
        <span className="stat-die">d{sides}</span>
        <span className="stat-meta">{rolls} rolls · exp {expected.toFixed(1)}/face</span>
        <span className="stat-chi">
          χ²={chiSquared}
          {t && <span className="stat-crit"> (crit {t.p05})</span>}
        </span>
        <span className={`stat-verdict stat-verdict-${v.type}`}>{v.label}</span>
      </div>
      <div className="stat-chips">
        {faces.map((face) => {
          const count = counts[face] ?? 0;
          const dev = (count - expected) / sigma;
          const cls = Math.abs(dev) < 1 ? 'chip-ok' : Math.abs(dev) < 2 ? 'chip-warn' : 'chip-bad';
          return (
            <span
              key={face}
              className={`stat-chip ${cls}`}
              title={`Face ${face}: ${count} rolls (${dev >= 0 ? '+' : ''}${dev.toFixed(1)}σ)`}
            >
              {faceLabel(sides, face)}:{count}
            </span>
          );
        })}
      </div>
    </div>
  );
}
