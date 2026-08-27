// pairingElimination.js — Single and Double Elimination bracket construction.
//
// Brackets are built once, fully, as a graph of match objects linked by "feeds" pointers.
// Recording a result only ever sets winner/loser on the match itself; a separate cascade
// pass pushes those values along the feed pointers into downstream matches (including
// automatic bye advances). This keeps the bracket data structure simple to persist as JSON
// and simple to re-render.
//
// Double elimination uses the standard generalized layout (losers bracket alternates
// between "consolidation" rounds — LB winners play each other — and "drop-down" rounds
// where LB winners meet the newest Winners-Bracket losers), finishing with a Grand Final
// that includes a reset match if the Losers-Bracket finalist wins the first Grand Final.
// It requires the bracket to be padded to a power of two, same as single elimination.

const TBD = 'TBD'; // slot not yet fed by anything upstream

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(p, 2);
}

/** Standard seeded bracket order, e.g. for 8: [1,8,4,5,2,7,3,6]. */
function seedOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const size = order.length * 2;
    const next = [];
    order.forEach(s => { next.push(s); next.push(size + 1 - s); });
    order = next;
  }
  return order;
}

let idCounter = 0;
function nextId(prefix) { idCounter += 1; return `${prefix}_${idCounter}`; }

/**
 * Builds the Winners/Single-Elimination bracket.
 * @param {Array} players sorted by seed (best seed first)
 * @returns {{size, totalRounds, matches}}
 */
function buildWinnersBracket(players) {
  const size = nextPow2(players.length);
  const order = seedOrder(size);
  const seedToPlayer = {};
  for (let s = 1; s <= size; s++) seedToPlayer[s] = players[s - 1] || null;

  const totalRounds = Math.log2(size);
  const matches = [];
  const round1 = [];
  for (let i = 0; i < size / 2; i++) {
    const seedA = order[i * 2], seedB = order[i * 2 + 1];
    const pA = seedToPlayer[seedA], pB = seedToPlayer[seedB];
    const m = {
      id: nextId('wb'), bracket: 'WB', round: 1, slot: i,
      player1: pA ? pA.id : null, player2: pB ? pB.id : null,
      winner: null, loser: null, isBye: (!pA || !pB),
      feedsWinnerTo: null, feedsLoserTo: null
    };
    if (m.isBye) { m.winner = pA ? pA.id : (pB ? pB.id : null); m.loser = null; }
    round1.push(m);
  }
  matches.push(...round1);

  let prev = round1;
  for (let r = 2; r <= totalRounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < prev.length / 2; i++) {
      const m = {
        id: nextId('wb'), bracket: 'WB', round: r, slot: i,
        player1: TBD, player2: TBD, winner: null, loser: null, isBye: false,
        feedsWinnerTo: null, feedsLoserTo: null
      };
      roundMatches.push(m);
      prev[i * 2].feedsWinnerTo = { matchId: m.id, slot: 0 };
      prev[i * 2 + 1].feedsWinnerTo = { matchId: m.id, slot: 1 };
    }
    matches.push(...roundMatches);
    prev = roundMatches;
  }

  return { size, totalRounds, matches };
}

/** Cascades resolved winners/losers along feed pointers, including automatic bye advances. */
export function cascadeBracket(allMatches) {
  const byId = Object.fromEntries(allMatches.map(m => [m.id, m]));
  let changed = true;
  while (changed) {
    changed = false;
    allMatches.forEach(m => {
      if (m.winner && m.feedsWinnerTo) {
        const target = byId[m.feedsWinnerTo.matchId];
        const key = m.feedsWinnerTo.slot === 0 ? 'player1' : 'player2';
        if (target[key] === TBD) { target[key] = m.winner; changed = true; }
      }
      if (m.feedsLoserTo && (m.winner !== null || m.isBye)) {
        const target = byId[m.feedsLoserTo.matchId];
        const key = m.feedsLoserTo.slot === 0 ? 'player1' : 'player2';
        const loserValue = m.loser; // may legitimately be null (bye => no one drops down)
        if (target[key] === TBD) { target[key] = loserValue; changed = true; }
      }
    });
    // Auto-resolve any match where both slots are known and exactly one is null (a bye).
    allMatches.forEach(m => {
      if (m.winner !== null) return;
      if (m.player1 === TBD || m.player2 === TBD) return;
      if (m.player1 === null && m.player2 === null) return; // both empty, nothing to do
      if (m.player1 === null || m.player2 === null) {
        m.winner = m.player1 || m.player2;
        m.loser = null;
        m.isBye = true;
        changed = true;
      }
    });
  }
}

export function buildSingleEliminationBracket(players) {
  const wb = buildWinnersBracket(players);
  cascadeBracket(wb.matches);
  return { type: 'single', size: wb.size, totalRounds: wb.totalRounds, matches: wb.matches };
}

export function buildDoubleEliminationBracket(players) {
  const wb = buildWinnersBracket(players);
  const R = wb.totalRounds;
  const size = wb.size;
  const wbByRound = r => wb.matches.filter(m => m.round === r);

  const lbMatches = [];

  if (size < 4) {
    // Degenerate case: 2 players, one match decides it. No losers bracket to speak of.
    cascadeBracket(wb.matches);
    const gf = {
      id: nextId('gf'), bracket: 'GF', round: 1, slot: 0,
      player1: TBD, player2: null, winner: null, loser: null, isBye: false,
      feedsWinnerTo: null, feedsLoserTo: null, isGrandFinal: true, isReset: false
    };
    wb.matches[0].feedsWinnerTo = { matchId: gf.id, slot: 0 };
    const all = [...wb.matches, gf];
    cascadeBracket(all);
    return { type: 'double', size, totalRounds: R, matches: wb.matches, lbMatches: [], grandFinal: gf, allMatches: all };
  }

  const totalLBRounds = 2 * R - 2;
  const lbRounds = [];
  for (let k = 1; k <= totalLBRounds; k++) {
    const tier = Math.ceil(k / 2);
    const count = size / Math.pow(2, tier + 1);
    const roundMatches = [];
    for (let i = 0; i < count; i++) {
      roundMatches.push({
        id: nextId('lb'), bracket: 'LB', round: k, slot: i,
        player1: TBD, player2: TBD, winner: null, loser: null, isBye: false,
        feedsWinnerTo: null, feedsLoserTo: null
      });
    }
    lbRounds.push(roundMatches);
    lbMatches.push(...roundMatches);
  }

  // Wire round 1: pair up Winners-Bracket round-1 losers.
  const wbR1 = wbByRound(1);
  lbRounds[0].forEach((m, i) => {
    wbR1[i * 2].feedsLoserTo = { matchId: m.id, slot: 0 };
    wbR1[i * 2 + 1].feedsLoserTo = { matchId: m.id, slot: 1 };
  });

  // Wire rounds 2..totalLBRounds.
  for (let k = 2; k <= totalLBRounds; k++) {
    const prevRound = lbRounds[k - 2];
    const thisRound = lbRounds[k - 1];
    if (k % 2 === 0) {
      // Drop-down round: LB survivors meet the newest WB-round losers.
      const wbRoundIdx = k / 2 + 1;
      const wbRound = wbByRound(wbRoundIdx);
      thisRound.forEach((m, i) => {
        prevRound[i].feedsWinnerTo = { matchId: m.id, slot: 0 };
        wbRound[i].feedsLoserTo = { matchId: m.id, slot: 1 };
      });
    } else {
      // Consolidation round: LB survivors play each other.
      thisRound.forEach((m, i) => {
        prevRound[i * 2].feedsWinnerTo = { matchId: m.id, slot: 0 };
        prevRound[i * 2 + 1].feedsWinnerTo = { matchId: m.id, slot: 1 };
      });
    }
  }

  // Grand Final: Winners-Bracket champion vs Losers-Bracket champion.
  const gf = {
    id: nextId('gf'), bracket: 'GF', round: 1, slot: 0,
    player1: TBD, player2: TBD, winner: null, loser: null, isBye: false,
    feedsWinnerTo: null, feedsLoserTo: null, isGrandFinal: true, isReset: false
  };
  const wbFinal = wbByRound(R)[0];
  const lbFinal = lbRounds[lbRounds.length - 1][0];
  wbFinal.feedsWinnerTo = { matchId: gf.id, slot: 0 };
  lbFinal.feedsWinnerTo = { matchId: gf.id, slot: 1 };

  const allMatches = [...wb.matches, ...lbMatches, gf];
  cascadeBracket(allMatches);

  return {
    type: 'double', size, totalRounds: R,
    matches: wb.matches, lbMatches, grandFinal: gf, allMatches
  };
}

/** Builds the (initially empty) reset match played only if the LB finalist wins Grand Final #1. */
export function buildResetMatch(grandFinal) {
  return {
    id: nextId('gf'), bracket: 'GF', round: 2, slot: 0,
    player1: grandFinal.player1, player2: grandFinal.player2,
    winner: null, loser: null, isBye: false,
    feedsWinnerTo: null, feedsLoserTo: null, isGrandFinal: true, isReset: true
  };
}

export { TBD };
