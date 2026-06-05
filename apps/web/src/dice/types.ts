export const BUTTON_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export const VALID_SIDES = [1, 2, 3, 4, 6, 8, 10, 12, 20, 100] as const;
export type DieSides = (typeof VALID_SIDES)[number];

export const DIE_COLORS: Record<DieSides, number> = {
  1: 0xfbbf24,   // gold
  2: 0x94a3b8,   // silver
  3: 0x14b8a6,   // teal
  4: 0xf97316,   // orange
  6: 0x3b82f6,   // blue
  8: 0xa855f7,   // purple
  10: 0xef4444,  // red
  12: 0x22c55e,  // green
  20: 0xf59e0b,  // amber
  100: 0xe2e8f0, // silver-white
};

export const DIE_LABELS: Record<DieSides, string> = {
  1: 'D1', 2: 'D2', 3: 'D3', 4: 'D4', 6: 'D6', 8: 'D8', 10: 'D10', 12: 'D12', 20: 'D20', 100: 'D100',
};

export interface ParsedDie {
  count: number;
  sides: DieSides;
}

export interface ParsedNotation {
  dice: ParsedDie[];
  modifier: number;
  raw: string;
}

export interface DieResult {
  sides: DieSides;
  value: number;
}

export interface RollRecord {
  id: string;
  notation: string;
  dice: DieResult[];
  modifier: number;
  total: number;
  timestamp: number;
}
