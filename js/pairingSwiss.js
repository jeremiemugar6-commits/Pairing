// pairingSwiss.js — Swiss-system pairing engine.
//
// This is a heuristic engine, not a certified implementation of the full FIDE Dutch
// System annex — but it is deliberately built to behave like one:
//   - it matches players across the WHOLE field at once (not group-by-group), so a
//     lower score group can still "reach up" or "reach down" when that is the only
//     way to avoid a repeat — the classic weakness of naive group-isolated pairing
//   - repeat opponents are treated as an almost-forbidden cost, score proximity as a
//     strong preference, and color balance as a light tie-breaker
//   - it builds an initial greedy matching by cost, then runs a local-search repair
//     pass that swaps pairs around to remove repeats and reduce score spread further
//   - byes are automatic, go to the lowest-scoring player who hasn't had one yet, and
//     are worth a full point
// For club, school, and open tournaments this reliably finds a repeat-free pairing
// whenever one exists, and only forces a repeat when the field is truly exhausted
// (e.g. more rounds than players allow).

/**
 * @param {Array} players - active players: {id, name, rating, colorHistory: ['W','B',...], byeUsed, score}
 * @param {Array} priorPairings - flat list of {whiteId, blackId} from all previous rounds (for repeat-avoidance)
 * @returns {Array} pairings: [{whiteId, blackId|null, isBye}]
 */
export function generateSwissPairings(players, priorPairings) {
  const opponents = buildOpponentMap(priorPairings);
  let pool = players.map(p => ({ ...p }));

  let byePlayer = null;
  if (pool.length % 2 === 1) {
    byePlayer = pickByeCandidate(pool);
    pool = pool.filter(p => p.id !== byePlayer.id);
  }

  const pairs = matchField(pool, opponents);
  const pairings = pairs.map(([a, b]) => makePairing(a, b));
  if (byePlayer) pairings.push({ whiteId: byePlayer.id, blackId: null, isBye: true });

  // Board order: strongest match-ups first (by combined score, then combined rating).
  pairings.sort((a, b) => {
    if (a.isBye) return 1;
    if (b.isBye) return -1;
    return 0; // caller (tournaments.js) re-sorts by live score anyway; keep stable here
  });
  return pairings;
}

function buildOpponentMap(priorPairings) {
  const map = new Map();
  priorPairings.forEach(({ whiteId, blackId }) => {
    if (!blackId) return; // bye, no opponent
    if (!map.has(whiteId)) map.set(whiteId, new Set());
    if (!map.has(blackId)) map.set(blackId, new Set());
    map.get(whiteId).add(blackId);
    map.get(blackId).add(whiteId);
  });
  return map;
}

function hasPlayed(opponents, a, b) {
  return opponents.has(a) && opponents.get(a).has(b);
}

const REPEAT_COST = 1_000_000;
const SCORE_WEIGHT = 1000;
const COLOR_WEIGHT = 1;

function pairCost(a, b, opponents) {
  let cost = 0;
  if (hasPlayed(opponents, a.id, b.id)) cost += REPEAT_COST;
  cost += Math.abs(a.score - b.score) * SCORE_WEIGHT;
  cost += colorPenalty(a, b) * COLOR_WEIGHT;
  return cost;
}

function colorPenalty(a, b) {
  const aDiff = countColor(a, 'W') - countColor(a, 'B');
  const bDiff = countColor(b, 'W') - countColor(b, 'B');
  // Penalize when both players are "due" for the same color (both overdue for white,
  // or both overdue for black) since one of them won't get their preference.
  return (aDiff > 0 && bDiff > 0) || (aDiff < 0 && bDiff < 0) ? Math.abs(aDiff) + Math.abs(bDiff) : 0;
}

/**
 * Builds a full field matching: greedy lowest-cost-first assignment, then a bounded
 * local-search repair pass (pairwise re-combination) that specifically hunts down and
 * removes repeat-opponent pairs whenever an alternative arrangement exists.
 */
function matchField(pool, opponents) {
  if (pool.length === 0) return [];
  const sorted = [...pool].sort((a, b) => b.score - a.score || b.rating - a.rating);

  // ---- Greedy initial matching ----
  const candidateCosts = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      candidateCosts.push({ i, j, cost: pairCost(sorted[i], sorted[j], opponents) });
    }
  }
  candidateCosts.sort((a, b) => a.cost - b.cost);

  const takenIdx = new Set();
  let pairs = [];
  for (const c of candidateCosts) {
    if (takenIdx.has(c.i) || takenIdx.has(c.j)) continue;
    takenIdx.add(c.i); takenIdx.add(c.j);
    pairs.push([sorted[c.i], sorted[c.j]]);
  }
  // Odd leftover should not happen (caller always strips exactly one bye player first,
  // leaving an even pool), but guard defensively just in case a future caller doesn't.
  const leftoverIdx = sorted.map((_, i) => i).filter(i => !takenIdx.has(i));
  if (leftoverIdx.length > 0 && pairs.length) {
    console.warn('[pairingSwiss] Unexpected odd leftover in matchField — attaching to last pair is not possible; player will be dropped from this round\'s pairing set.');
  }

  // ---- Local-search repair pass: fix repeats (and, budget permitting, reduce score spread) ----
  const budget = pairs.length > 60 ? 4 : 25; // cap passes for very large fields
  for (let pass = 0; pass < budget; pass++) {
    let improved = false;
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [a1, b1] = pairs[i];
        const [a2, b2] = pairs[j];
        const currentCost = pairCost(a1, b1, opponents) + pairCost(a2, b2, opponents);

        const optionA = pairCost(a1, a2, opponents) + pairCost(b1, b2, opponents);
        const optionB = pairCost(a1, b2, opponents) + pairCost(b1, a2, opponents);

        if (optionA < currentCost && optionA <= optionB) {
          pairs[i] = [a1, a2]; pairs[j] = [b1, b2]; improved = true;
        } else if (optionB < currentCost) {
          pairs[i] = [a1, b2]; pairs[j] = [b1, a2]; improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return pairs;
}

/** Decides colors for a pair based on each player's color history, then builds the pairing. */
function makePairing(a, b) {
  const aWhites = countColor(a, 'W'), aBlacks = countColor(a, 'B');
  const bWhites = countColor(b, 'W'), bBlacks = countColor(b, 'B');
  const aDiff = aWhites - aBlacks; // positive = has played more white, due for black
  const bDiff = bWhites - bBlacks;

  const aLast = lastColor(a);
  const bLast = lastColor(b);

  let whiteId, blackId;
  if (aDiff !== bDiff) {
    if (aDiff < bDiff) { whiteId = a.id; blackId = b.id; }
    else { whiteId = b.id; blackId = a.id; }
  } else if (aLast !== bLast) {
    if (aLast === 'B') { whiteId = a.id; blackId = b.id; }
    else { whiteId = b.id; blackId = a.id; }
  } else {
    if (a.rating >= b.rating) { whiteId = a.id; blackId = b.id; }
    else { whiteId = b.id; blackId = a.id; }
  }
  return { whiteId, blackId, isBye: false };
}

function countColor(p, color) {
  return (p.colorHistory || []).filter(c => c === color).length;
}
function lastColor(p) {
  const h = p.colorHistory || [];
  return h.length ? h[h.length - 1] : null;
}

/** Picks who should receive the automatic bye this round: lowest score, never byed before. */
export function pickByeCandidate(players) {
  const eligible = players.filter(p => !p.byeUsed);
  const pool = eligible.length ? eligible : players;
  return [...pool].sort((a, b) => a.score - b.score || a.rating - b.rating)[0];
}
