// standings.js — Score and tie-break computation for Swiss and Round Robin events.
// Elimination formats don't use this (their "standing" is just bracket position),
// but this module is still used to show a simple W/L record table for them.

/**
 * @param {Array} players - active + withdrawn players: {id, name, rating, status}
 * @param {Array} rounds - tournament.rounds, each {number, status, pairings:[{whiteId, blackId, result}]}
 * @param {Array} adjustments - optional manual score adjustments: {playerId, delta, reason}
 * @returns {Array} standings rows, sorted best-first, with all computed fields attached
 */
export function computeStandings(players, rounds, adjustments = []) {
  const stats = new Map();
  players.forEach(p => {
    stats.set(p.id, {
      id: p.id, name: p.name, rating: p.rating, federation: p.federation, code: p.code,
      played: 0, wins: 0, draws: 0, losses: 0, byes: 0,
      points: 0, progressive: 0, progressiveHistory: [],
      opponents: [], // ordered list of {opponentId|null, result, color}
      colorHistory: []
    });
  });

  const completedRounds = rounds.filter(r => r.status === 'locked' || r.status === 'completed' || r.pairings.some(p => p.result));

  completedRounds.forEach(round => {
    round.pairings.forEach(pair => {
      if (!pair.result) return;
      const white = stats.get(pair.whiteId);
      if (pair.isBye || pair.blackId === null) {
        if (white) {
          white.byes += 1;
          white.points += 1; // standard: a bye is worth a full point
          white.played += 1;
          white.opponents.push({ opponentId: null, result: 'bye', color: null });
        }
        return;
      }
      const black = stats.get(pair.blackId);
      if (!white || !black) return;

      white.played += 1; black.played += 1;
      white.colorHistory.push('W'); black.colorHistory.push('B');

      if (pair.result === '1-0') {
        white.wins += 1; white.points += 1;
        black.losses += 1;
        white.opponents.push({ opponentId: black.id, result: 'win', color: 'W' });
        black.opponents.push({ opponentId: white.id, result: 'loss', color: 'B' });
      } else if (pair.result === '0-1') {
        black.wins += 1; black.points += 1;
        white.losses += 1;
        white.opponents.push({ opponentId: black.id, result: 'loss', color: 'W' });
        black.opponents.push({ opponentId: white.id, result: 'win', color: 'B' });
      } else if (pair.result === '1/2-1/2') {
        white.draws += 1; white.points += 0.5;
        black.draws += 1; black.points += 0.5;
        white.opponents.push({ opponentId: black.id, result: 'draw', color: 'W' });
        black.opponents.push({ opponentId: white.id, result: 'draw', color: 'B' });
      }
    });

    // snapshot cumulative points after this round for the progressive tie-break
    stats.forEach(s => s.progressiveHistory.push(s.points));
  });

  stats.forEach(s => {
    s.progressive = s.progressiveHistory.reduce((sum, v) => sum + v, 0);
  });

  // Buchholz: sum of the current scores of every real opponent faced.
  // Sonneborn-Berger: sum of (beaten opponents' scores) + 0.5 * (drawn opponents' scores).
  stats.forEach(s => {
    let buchholz = 0, sb = 0;
    s.opponents.forEach(o => {
      if (o.opponentId === null) return; // byes don't count toward either
      const opp = stats.get(o.opponentId);
      if (!opp) return;
      buchholz += opp.points;
      if (o.result === 'win') sb += opp.points;
      else if (o.result === 'draw') sb += opp.points * 0.5;
    });
    s.buchholz = round2(buchholz);
    s.sonnebornBerger = round2(sb);
  });

  // Manual arbiter adjustments (corrections, penalties, forfeits handled outside the pairing flow).
  const adjTotals = new Map();
  (adjustments || []).forEach(a => {
    adjTotals.set(a.playerId, (adjTotals.get(a.playerId) || 0) + a.delta);
  });
  stats.forEach(s => {
    const adj = adjTotals.get(s.id) || 0;
    s.adjustment = adj;
    s.points = round2(s.points + adj);
  });

  const rows = [...stats.values()];
  rows.sort((a, b) =>
    b.points - a.points ||
    b.buchholz - a.buchholz ||
    b.sonnebornBerger - a.sonnebornBerger ||
    b.progressive - a.progressive ||
    b.wins - a.wins ||
    b.rating - a.rating
  );
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function round2(n) { return Math.round(n * 100) / 100; }

/** Simple W/L/D record table for elimination formats (no tie-break math needed there). */
export function computeEliminationRecord(players, matches) {
  const stats = new Map();
  players.forEach(p => stats.set(p.id, { id: p.id, name: p.name, rating: p.rating, wins: 0, losses: 0, stillIn: true }));
  matches.forEach(m => {
    if (!m.winner) return;
    const w = stats.get(m.winner);
    const l = m.loser ? stats.get(m.loser) : null;
    if (w) w.wins += 1;
    if (l) { l.losses += 1; l.stillIn = false; }
  });
  return [...stats.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses);
}
