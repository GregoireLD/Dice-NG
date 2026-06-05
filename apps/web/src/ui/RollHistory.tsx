import { RollRecord, DIE_LABELS } from '../dice/types';

interface RollHistoryProps {
  records: RollRecord[];
  onClear: () => void;
}

export function RollHistory({ records, onClear }: RollHistoryProps) {
  if (records.length === 0) {
    return (
      <div className="history-panel">
        <h3 className="history-title">Roll History</h3>
        <p className="history-empty">No rolls yet</p>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="history-header">
        <h3 className="history-title">Roll History</h3>
        <button className="clear-btn" onClick={onClear}>Clear</button>
      </div>
      <ul className="history-list">
        {records.map((r) => (
          <li key={r.id} className="history-item">
            <div className="history-row-top">
              <span className="history-notation">{r.notation}</span>
              <span className="history-total">{r.total}</span>
            </div>
            <div className="history-row-bottom">
              <span className="history-dice">
                {r.dice.map((d, i) => (
                  <span key={i} className="die-value-chip">
                    <span className="die-type-label">{DIE_LABELS[d.sides]}</span>
                    <span className="die-value">{d.value}</span>
                  </span>
                ))}
                {r.modifier !== 0 && (
                  <span className="modifier-chip">
                    {r.modifier > 0 ? `+${r.modifier}` : r.modifier}
                  </span>
                )}
              </span>
              <span className="history-time">
                {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
