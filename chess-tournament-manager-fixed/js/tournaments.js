// tournaments.js — the tournament domain model: creation, players, rounds, results.
// This is the "business logic" layer that render.js calls into; it never touches the DOM.

import { uid, playerCode } from './utils.js';
import { generateSwissPairings } from './pairingSwiss.js';
import { generateRoundRobinSchedule } from './pairingRoundRobin.js';
import { buildSingleEliminationBracket, buildDoubleEliminationBracket, buildResetMatch, cascadeBracket } from './pairingElimination.js';
import { computeStandings } from './standings.js';
import { DB } from './db.js';

export const TIEBREAK_OPTIONS = [
  { id: 'buchholz', label: 'Buchholz' },
  { id: 'sonnebornBerger', label: 'Sonneborn-Berger' },
  { id: 'progressive', label: 'Progressive Score' }
];

export function createTournament(data) {
  const now = new Date().toISOString();
  return {
    id: uid('trn'),
    name: data.name?.trim() || 'Untitled Tournament',
    organizer: data.organizer?.trim() || '',
    venue: data.venue?.trim() || '',
    date: data.date || now.slice(0, 10),
    numRounds: Math.max(1, parseInt(data.numRounds, 10) || 5),
    timeControl: data.timeControl?.trim() || '',
    type: data.type || 'swiss', // swiss | roundrobin | single-elim | double-elim
    tiebreaks: data.tiebreaks && data.tiebreaks.length ? data.tiebreaks : ['buchholz', 'sonnebornBerger', 'progressive'],
    status: 'setup', // setup | active | completed
    currentRound: 0,
    players: [],
    playerSeq: 0,
    rounds: [], // swiss / round robin
    bracket: null, // single/double elimination
    scoreAdjustments: [],
    createdAt: now,
    updatedAt: now
  };
}

export function saveTournament(t) {
  DB.upsert(t);
  return t;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function addPlayer(t, data) {
  t.playerSeq = (t.playerSeq || 0) + 1;
  const player = {
    id: uid('plr'),
    code: playerCode(t.playerSeq),
    name: (data.name || '').trim(),
    rating: parseInt(data.rating, 10) || 0,
    federation: (data.federation || '').trim(),
    contact: (data.contact || '').trim(),
    seed: data.seed ?? (t.players.filter(p => p.status !== 'withdrawn').length + 1),
    status: 'active',
    byeUsed: false,
    createdAt: new Date().toISOString()
  };
  t.players.push(player);
  renumberSeeds(t);
  return player;
}

export function editPlayer(t, playerId, data) {
  const p = t.players.find(x => x.id === playerId);
  if (!p) return null;
  if (data.name !== undefined) p.name = data.name.trim();
  if (data.rating !== undefined) p.rating = parseInt(data.rating, 10) || 0;
  if (data.federation !== undefined) p.federation = data.federation.trim();
  if (data.contact !== undefined) p.contact = data.contact.trim();
  return p;
}

export function deletePlayer(t, playerId) {
  const hasPlayed = t.rounds.some(r => r.pairings.some(p => p.whiteId === playerId || p.blackId === playerId));
  if (hasPlayed || t.bracket) {
    // Once a player has actual game history, delete would corrupt standings/bracket — withdraw instead.
    return { ok: false, reason: 'Player already has recorded games. Withdraw instead of deleting.' };
  }
  t.players = t.players.filter(p => p.id !== playerId);
  renumberSeeds(t);
  return { ok: true };
}

export function withdrawPlayer(t, playerId) {
  const p = t.players.find(x => x.id === playerId);
  if (!p) return null;
  p.status = 'withdrawn';
  return p;
}

export function rejoinPlayer(t, playerId) {
  const p = t.players.find(x => x.id === playerId);
  if (!p) return null;
  p.status = 'active';
  return p;
}

export function activePlayers(t) {
  return t.players.filter(p => p.status === 'active');
}

function renumberSeeds(t) {
  // Seed order follows current array order; used as the default (rating-independent) order.
  t.players.forEach((p, i) => { if (p.seed === undefined || p.seed === null) p.seed = i + 1; });
}

export function randomizeSeeds(t) {
  const shuffled = [...t.players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  shuffled.forEach((p, i) => { p.seed = i + 1; });
}

export function seedByRating(t) {
  const sorted = [...t.players].sort((a, b) => b.rating - a.rating);
  sorted.forEach((p, i) => { p.seed = i + 1; });
}

export function setManualSeed(t, playerId, newSeed) {
  const p = t.players.find(x => x.id === playerId);
  if (!p) return;
  newSeed = Math.max(1, Math.min(t.players.length, parseInt(newSeed, 10) || p.seed));
  const others = t.players.filter(x => x.id !== playerId).sort((a, b) => a.seed - b.seed);
  others.splice(newSeed - 1, 0, p);
  others.forEach((pl, i) => { pl.seed = i + 1; });
  t.players = others;
}

export function adjustScore(t, playerId, delta, reason) {
  t.scoreAdjustments = t.scoreAdjustments || [];
  t.scoreAdjustments.push({ id: uid('adj'), playerId, delta: parseFloat(delta) || 0, reason: reason || '', date: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Standings (Swiss / Round Robin)
// ---------------------------------------------------------------------------

export function getStandings(t) {
  return computeStandings(t.players, t.rounds, t.scoreAdjustments);
}

function seededOrder(t) {
  return [...activePlayers(t)].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
}

// ---------------------------------------------------------------------------
// Swiss / Round Robin round generation
// ---------------------------------------------------------------------------

/** Generates (or regenerates) the pairings for the given round number. */
export function generateRound(t, roundNumber) {
  if (t.type === 'roundrobin') return generateRoundRobinRound(t, roundNumber);
  return generateSwissRound(t, roundNumber);
}

function priorPairingsFlat(t, beforeRound) {
  const flat = [];
  t.rounds.forEach(r => {
    if (r.number >= beforeRound) return;
    r.pairings.forEach(p => flat.push({ whiteId: p.whiteId, blackId: p.blackId }));
  });
  return flat;
}

function generateSwissRound(t, roundNumber) {
  const standings = computeStandings(t.players, t.rounds.filter(r => r.number < roundNumber), t.scoreAdjustments);
  const scoreById = new Map(standings.map(s => [s.id, s]));
  const byePlayerIds = new Set();
  t.rounds.forEach(r => r.pairings.forEach(p => { if (p.isBye) byePlayerIds.add(p.whiteId); }));

  const pool = activePlayers(t).map(p => {
    const s = scoreById.get(p.id);
    return {
      id: p.id, rating: p.rating,
      score: s ? s.points : 0,
      colorHistory: s ? s.colorHistory : [],
      byeUsed: byePlayerIds.has(p.id)
    };
  });

  const prior = priorPairingsFlat(t, roundNumber);
  const pairings = generateSwissPairings(pool, prior).map((p, i) => ({
    board: i + 1, whiteId: p.whiteId, blackId: p.blackId, isBye: !!p.isBye,
    result: p.isBye ? 'bye' : null
  }));
  sortBoardsByStrength(pairings, pool);
  upsertRound(t, roundNumber, pairings);
}

function generateRoundRobinRound(t, roundNumber) {
  if (!t.rrSchedule) {
    const order = seededOrder(t);
    t.rrSchedule = generateRoundRobinSchedule(order.map(p => ({ id: p.id, rating: p.rating })));
    t.numRounds = t.rrSchedule.length;
  }
  const roundPairs = t.rrSchedule[roundNumber - 1] || [];
  const pairings = roundPairs.map((p, i) => ({
    board: i + 1, whiteId: p.whiteId, blackId: p.blackId, isBye: !!p.isBye,
    result: p.isBye ? 'bye' : null
  }));
  upsertRound(t, roundNumber, pairings);
}

function sortBoardsByStrength(pairings, pool) {
  const scoreById = new Map(pool.map(p => [p.id, p.score]));
  pairings.sort((a, b) => {
    const sa = a.isBye ? -999 : (scoreById.get(a.whiteId) || 0) + (scoreById.get(a.blackId) || 0);
    const sb = b.isBye ? -999 : (scoreById.get(b.whiteId) || 0) + (scoreById.get(b.blackId) || 0);
    return sb - sa;
  });
  pairings.forEach((p, i) => { p.board = i + 1; });
}

function upsertRound(t, roundNumber, pairings) {
  const existingIdx = t.rounds.findIndex(r => r.number === roundNumber);
  const round = { number: roundNumber, status: 'pending', pairings };
  if (existingIdx >= 0) t.rounds[existingIdx] = round;
  else { t.rounds.push(round); t.rounds.sort((a, b) => a.number - b.number); }
  t.currentRound = Math.max(t.currentRound, roundNumber);
  if (t.status === 'setup') t.status = 'active';
}

export function canRegenerateRound(t, roundNumber) {
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return true;
  if (round.status === 'locked') return false;
  return !round.pairings.some(p => p.result && !p.isBye);
}

export function setManualPairing(t, roundNumber, board, whiteId, blackId) {
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return;
  const pairing = round.pairings.find(p => p.board === board);
  if (!pairing) return;
  pairing.whiteId = whiteId;
  pairing.blackId = blackId || null;
  pairing.isBye = !blackId;
  pairing.result = pairing.isBye ? 'bye' : null;
}

export function recordResult(t, roundNumber, board, result) {
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return;
  const pairing = round.pairings.find(p => p.board === board);
  if (!pairing) return;
  pairing.result = result;
}

export function lockRound(t, roundNumber) {
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return;
  round.status = 'locked';
}

export function unlockRound(t, roundNumber) {
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return;
  round.status = 'pending';
}

export function roundIsComplete(round) {
  return round.pairings.every(p => p.result);
}

// ---------------------------------------------------------------------------
// Elimination brackets
// ---------------------------------------------------------------------------

export function buildBracket(t) {
  const order = seededOrder(t);
  if (t.type === 'single-elim') {
    t.bracket = buildSingleEliminationBracket(order);
  } else if (t.type === 'double-elim') {
    const b = buildDoubleEliminationBracket(order);
    // t.bracket.matches is the single source of truth for every match in the bracket
    // (WB + LB + GF, tagged via each match's own `bracket`/`isGrandFinal`/`isReset` fields).
    // We deliberately do NOT keep separate wbMatches/lbMatches/grandFinal object references:
    // after a save/reload round-trip through localStorage (JSON.stringify/parse), those would
    // become disconnected copies of the objects in `matches`, so any later mutation applied to
    // `matches` (via recordBracketResult) would silently stop showing up in them. Every reader
    // (rendering, isBracketComplete, getChampion) derives WB/LB/GF views from `matches` instead.
    t.bracket = { type: b.type, size: b.size, totalRounds: b.totalRounds, matches: [...b.matches, ...(b.lbMatches || []), b.grandFinal].filter(Boolean) };
  }
  t.status = 'active';
  t.currentRound = 1;
}

/** Derives the current Grand Final match (game 1) from the single matches list. */
function findGrandFinal(t) {
  return t.bracket.matches.find(m => m.isGrandFinal && !m.isReset) || null;
}
/** Derives the bracket-reset Grand Final (game 2), if one has been created. */
function findGrandFinalReset(t) {
  return t.bracket.matches.find(m => m.isGrandFinal && m.isReset) || null;
}

export function recordBracketResult(t, matchId, winnerId) {
  const match = t.bracket.matches.find(m => m.id === matchId);
  if (!match) return;
  match.winner = winnerId;
  match.loser = match.player1 === winnerId ? match.player2 : match.player1;

  if (t.type === 'double-elim' && match.isGrandFinal && !match.isReset) {
    if (winnerId === match.player2) {
      // Losers-bracket finalist beat the Winners-bracket champion — bracket reset required.
      const reset = buildResetMatch(match);
      t.bracket.matches.push(reset);
    }
  }
  cascadeBracket(t.bracket.matches);

  const allDone = isBracketComplete(t);
  if (allDone) t.status = 'completed';
}

export function isBracketComplete(t) {
  if (!t.bracket) return false;
  if (t.type === 'single-elim') {
    const final = t.bracket.matches.filter(m => m.round === t.bracket.totalRounds);
    return final.length > 0 && final.every(m => m.winner);
  }
  if (t.type === 'double-elim') {
    const reset = findGrandFinalReset(t);
    if (reset) return !!reset.winner;
    const gf = findGrandFinal(t);
    if (!gf || !gf.winner) return false;
    // If GF1 winner is the WB champion (player1), the tournament is over outright.
    return gf.winner === gf.player1;
  }
  return false;
}

export function getChampion(t) {
  if (!t.bracket) return null;
  if (t.type === 'single-elim') {
    const final = t.bracket.matches.find(m => m.round === t.bracket.totalRounds);
    return final && final.winner ? t.players.find(p => p.id === final.winner) : null;
  }
  if (t.type === 'double-elim') {
    const reset = findGrandFinalReset(t);
    if (reset) return reset.winner ? t.players.find(p => p.id === reset.winner) : null;
    const gf = findGrandFinal(t);
    return gf && gf.winner === gf.player1 ? t.players.find(p => p.id === gf.winner) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dashboard helpers
// ---------------------------------------------------------------------------

export function tournamentStats(t) {
  const players = activePlayers(t).length;
  let completed = 0, remaining = 0;
  if (t.type === 'single-elim' || t.type === 'double-elim') {
    const matches = t.bracket ? t.bracket.matches.filter(m => !m.isBye) : [];
    completed = matches.filter(m => m.winner).length;
    remaining = matches.filter(m => !m.winner && m.player1 !== 'TBD' && m.player2 !== 'TBD' && m.player1 !== null && m.player2 !== null).length;
  } else {
    t.rounds.forEach(r => r.pairings.forEach(p => {
      if (p.isBye) return;
      if (p.result) completed++; else remaining++;
    }));
  }
  let leader = null;
  if (t.type === 'single-elim' || t.type === 'double-elim') {
    leader = getChampion(t);
  } else {
    const standings = getStandings(t);
    leader = standings[0] ? t.players.find(p => p.id === standings[0].id) : null;
  }
  return { players, completed, remaining, leader, currentRound: t.currentRound, totalRounds: t.numRounds, status: t.status };
}
