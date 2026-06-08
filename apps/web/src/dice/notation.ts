import { VALID_SIDES, DieSides, ParsedDie, ParsedNotation } from './types';

// Sides users can type directly — excludes the internal tens-die (1000)
const USER_VALID_SIDES = new Set<number>(VALID_SIDES.filter((s) => s !== 1000));

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

    // Optional trailing 'z' suffix selects the Zocchihedron variant (e.g. d100z)
    const dieMatch = bare.match(/^(\d*)d(\d+)(z?)$/);
    if (dieMatch) {
      if (negative) throw new Error('Negative dice count is not supported');
      const count = dieMatch[1] ? parseInt(dieMatch[1], 10) : 1;
      const rawSides = parseInt(dieMatch[2], 10);
      const zSuffix = dieMatch[3] === 'z';

      if (count < 1 || count > 50) throw new Error('Dice count must be 1–50');

      if (rawSides === 100 && !zSuffix) {
        // d100 → percentile pair: tens die (00-90) + units die (1-10)
        // Both use dedicated internal types so they can be collapsed into one result later.
        dice.push({ count, sides: 1000 });
        dice.push({ count, sides: 1001 });
      } else if (rawSides === 100 && zSuffix) {
        // d100z → 100-face Zocchihedron sphere
        dice.push({ count, sides: 100 });
      } else if (zSuffix) {
        throw new Error(`d${rawSides}z is not supported`);
      } else if (!USER_VALID_SIDES.has(rawSides)) {
        throw new Error(
          `d${rawSides} is not supported. Valid: ${[...USER_VALID_SIDES].map((s) => 'd' + s).join(', ')}, d100z`
        );
      } else {
        dice.push({ count, sides: rawSides as DieSides });
      }
    } else if (/^\d+$/.test(bare)) {
      modifier += (negative ? -1 : 1) * parseInt(bare, 10);
    } else if (bare !== '') {
      throw new Error(`Cannot parse: "${term}"`);
    }
  }

  if (dice.length === 0) throw new Error('No dice found in notation');

  const totalPhysical = dice.reduce((sum, d) => sum + d.count, 0);
  if (totalPhysical > 50) throw new Error('Total dice count must not exceed 50');

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
