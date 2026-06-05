import { VALID_SIDES, DieSides, ParsedDie, ParsedNotation } from './types';

export function parseNotation(input: string): ParsedNotation {
  const s = input.toLowerCase().replace(/\s+/g, '');
  if (!s) throw new Error('Empty notation');

  const dice: ParsedDie[] = [];
  let modifier = 0;

  // Split on + or - boundaries, keeping the sign with each term
  const terms = s.split(/(?=[+-])/);

  for (const term of terms) {
    if (!term) continue;
    const negative = term[0] === '-';
    const bare = term.replace(/^[+-]/, '');

    const dieMatch = bare.match(/^(\d*)d(\d+)$/);
    if (dieMatch) {
      if (negative) throw new Error('Negative dice count is not supported');
      const count = dieMatch[1] ? parseInt(dieMatch[1], 10) : 1;
      const sides = parseInt(dieMatch[2], 10);
      if (!VALID_SIDES.includes(sides as DieSides)) {
        throw new Error(
          `d${sides} is not supported. Valid: ${VALID_SIDES.map((s) => 'd' + s).join(', ')}`
        );
      }
      if (count < 1 || count > 100) throw new Error('Dice count must be 1–100');
      dice.push({ count, sides: sides as DieSides });
    } else if (/^\d+$/.test(bare)) {
      modifier += (negative ? -1 : 1) * parseInt(bare, 10);
    } else if (bare !== '') {
      throw new Error(`Cannot parse: "${term}"`);
    }
  }

  if (dice.length === 0) throw new Error('No dice found in notation');

  return { dice, modifier, raw: input.trim() };
}

export function formatNotation(notation: ParsedNotation): string {
  const parts = notation.dice.map((d) =>
    d.count === 1 ? `d${d.sides}` : `${d.count}d${d.sides}`
  );
  if (notation.modifier > 0) parts.push(`+${notation.modifier}`);
  else if (notation.modifier < 0) parts.push(`${notation.modifier}`);
  return parts.join('+');
}

/** Total number of physical dice to spawn */
export function totalDiceCount(notation: ParsedNotation): number {
  return notation.dice.reduce((sum, d) => sum + d.count, 0);
}

/** Flat list of die sides to spawn, one entry per physical die */
export function expandDice(notation: ParsedNotation): DieSides[] {
  const result: DieSides[] = [];
  for (const { count, sides } of notation.dice) {
    for (let i = 0; i < count; i++) result.push(sides);
  }
  return result;
}
