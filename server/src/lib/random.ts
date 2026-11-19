import { randomInt } from 'node:crypto';

/**
 * Cryptographically secure integer in [0, maxExclusive).
 */
export function secureInt(maxExclusive: number): number {
  if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`secureInt requires a positive bound, got ${maxExclusive}`);
  }
  return randomInt(0, Math.floor(maxExclusive));
}

/** Uniformly pick one element using a CSPRNG. */
export function securePick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error('securePick: empty list');
  return items[secureInt(items.length)]!;
}

/**
 * Weighted random index. Uses integer arithmetic only so the probability of a
 * prize is exactly weight / totalWeight (as close as the CSPRNG allows).
 */
export function weightedIndex(weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, Math.floor(weight)), 0);
  if (total <= 0) throw new Error('weightedIndex: total weight must be positive');

  let ticket = randomInt(0, total);
  for (let index = 0; index < weights.length; index += 1) {
    ticket -= Math.max(0, Math.floor(weights[index]!));
    if (ticket < 0) return index;
  }
  // Unreachable, kept as a safety net.
  return weights.length - 1;
}
