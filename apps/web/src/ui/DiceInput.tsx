import { useState, FormEvent, KeyboardEvent } from 'react';
import { BUTTON_SIDES, DIE_LABELS } from '../dice/types';

interface DiceInputProps {
  onRoll: (notation: string) => void;
  disabled: boolean;
}

// d100z = 100-face Zocchihedron sphere (legacy fun mode)
const PRESETS = ['d20', '2d6', 'd100', 'd20+5', '4d6', 'd100z'];

export function DiceInput({ onRoll, disabled }: DiceInputProps) {
  const [value, setValue] = useState('2d6');
  const [error, setError] = useState('');

  function submit(notation: string) {
    const trimmed = notation.trim();
    if (!trimmed) return;
    setError('');
    onRoll(trimmed);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(value);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit(value);
  }

  function addDie(sides: number) {
    const tag = DIE_LABELS[sides as keyof typeof DIE_LABELS] ?? `d${sides}`;
    const current = value.trim();
    setValue(current ? `${current}+d${sides}` : `d${sides}`);
    setError('');
    // Auto-label is already lowercase
    void tag;
  }

  return (
    <div className="dice-input-panel">
      <div className="die-buttons">
        {BUTTON_SIDES.map((s) => (
          <button
            key={s}
            className="die-btn"
            onClick={() => addDie(s)}
            disabled={disabled}
            title={`Add ${DIE_LABELS[s]}`}
          >
            {DIE_LABELS[s]}
          </button>
        ))}
      </div>

      <form className="notation-form" onSubmit={handleSubmit}>
        <input
          className="notation-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={handleKey}
          placeholder="e.g. 2d6+3  (d100z for 100-face ball)"
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="roll-btn" type="submit" disabled={disabled}>
          {disabled ? 'Rolling…' : 'Roll'}
        </button>
      </form>

      {error && <p className="input-error">{error}</p>}

      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            className="preset-btn"
            onClick={() => { setValue(p); setError(''); }}
            disabled={disabled}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
