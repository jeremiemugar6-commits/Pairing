// pairingRoundRobin.js — Berger table (circle method) round robin scheduler.
// Every player meets every other player exactly once. Colors are assigned using the
// standard Berger alternation so each player's color count stays as balanced as possible.

/**
 * @param {Array} players - [{id, rating, name}], any order (seed order recommended)
 * @returns {Array} rounds — each an array of {whiteId, blackId|null, isBye}
 */
export function generateRoundRobinSchedule(players) {
  const list = [...players];
  const hasBye = list.length % 2 !== 0;
  if (hasBye) list.push({ id: null, isDummy: true }); // dummy = bye slot

  const n = list.length;
  const numRounds = n - 1;
  const half = n / 2;

  // Fixed player stays at index 0; everyone else rotates.
  const fixed = list[0];
  let rotating = list.slice(1);

  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    const arrangement = [fixed, ...rotating];
    const pairings = [];
    for (let i = 0; i < half; i++) {
      const a = arrangement[i];
      const b = arrangement[n - 1 - i];
      if (a.isDummy || b.isDummy) {
        const real = a.isDummy ? b : a;
        pairings.push({ whiteId: real.id, blackId: null, isBye: true });
        continue;
      }
      // Berger color rule: on odd rounds table 0 is reversed to balance colors long-run.
      const swap = (r % 2 === 1) && i === 0;
      const white = swap ? b : a;
      const black = swap ? a : b;
      pairings.push({ whiteId: white.id, blackId: black.id, isBye: false });
    }
    rounds.push(pairings);
    // Rotate: last element of `rotating` moves to the front for the next round.
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, rotating.length - 1)];
  }

  return rounds;
}
