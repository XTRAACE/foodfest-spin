/**
 * Verifies the randomness helpers used for prize and customer selection.
 * Run with: npm --workspace server run verify:logic
 */
import { securePick, weightedIndex } from '../lib/random.js';

const SAMPLES = 200_000;
let failures = 0;

function check(name: string, actual: number, expected: number, tolerance: number) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${(actual * 100).toFixed(2)}% (expected ~${(expected * 100).toFixed(2)}%)`);
  if (!ok) failures += 1;
}

// 1. Weighted selection with the example configuration: 5 / 5 / 10.
const counts = [0, 0, 0];
const weights = [5, 5, 10];
for (let i = 0; i < SAMPLES; i += 1) {
  counts[weightedIndex(weights)] += 1;
}
check('₹1 Sweet (weight 5)', counts[0]! / SAMPLES, 0.25, 0.01);
check('½ ₹ Sweet (weight 5)', counts[1]! / SAMPLES, 0.25, 0.01);
check('Better Luck (weight 10)', counts[2]! / SAMPLES, 0.5, 0.01);

// 2. Uniform customer selection inside a group of three (1/3 each).
const picks = [0, 0, 0];
const members = ['001', '002', '003'];
for (let i = 0; i < SAMPLES; i += 1) {
  picks[members.indexOf(securePick(members))] += 1;
}
for (let i = 0; i < 3; i += 1) {
  check(`Group member ${members[i]}`, picks[i]! / SAMPLES, 1 / 3, 0.01);
}

// 3. Edge case: a zero total weight must never silently award a prize.
let threw = false;
try {
  weightedIndex([0, 0]);
} catch {
  threw = true;
}
console.log(`${threw ? 'PASS' : 'FAIL'} zero total weight is rejected instead of awarding a prize`);
if (!threw) failures += 1;

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll randomness checks passed');
