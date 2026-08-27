// print.js — builds print-ready HTML and sends it to the hidden print iframe.
// Print styling lives in css/print.css, which is linked directly inside the iframe
// document so normal on-screen styles never leak into the printed page.

import { escapeHtml, formatDate } from './utils.js';
import { activePlayers, getStandings, tournamentStats } from './tournaments.js';

function playerName(t, id) {
  if (!id) return 'BYE';
  const p = t.players.find(x => x.id === id);
  return p ? p.name : 'Unknown';
}
function playerRating(t, id) {
  if (!id) return '—';
  const p = t.players.find(x => x.id === id);
  return p ? (p.rating || '—') : '—';
}

function header(t, subtitle) {
  return `
    <div class="ps-header">
      <h1>${escapeHtml(t.name)}</h1>
      <div class="ps-sub">${escapeHtml(subtitle)}</div>
      <div class="ps-meta">
        <span>Organizer: ${escapeHtml(t.organizer || '—')}</span>
        <span>Venue: ${escapeHtml(t.venue || '—')}</span>
        <span>Date: ${escapeHtml(formatDate(t.date))}</span>
        <span>Time control: ${escapeHtml(t.timeControl || '—')}</span>
      </div>
    </div>`;
}

function renderIntoFrame(html) {
  const frame = document.getElementById('print-frame');
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="css/print.css">
    </head><body>${html}</body></html>`);
  doc.close();
  frame.onload = null;
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }, 150);
}

export function printPairingSheet(t, roundNumber) {
  const round = t.rounds.find(r => r.number === roundNumber);
  if (!round) return;
  const rows = round.pairings.map(p => `
    <tr>
      <td class="center">${p.board}</td>
      <td>${escapeHtml(playerName(t, p.whiteId))} <span class="dim">(${playerRating(t, p.whiteId)})</span></td>
      <td>${p.isBye ? '<em>BYE</em>' : escapeHtml(playerName(t, p.blackId)) + ` <span class="dim">(${playerRating(t, p.blackId)})</span>`}</td>
      <td class="center result-box"></td>
      <td class="center sign-box"></td>
    </tr>`).join('');

  const html = `
    ${header(t, `Round ${roundNumber} — Pairing Sheet`)}
    <table class="ps-table">
      <thead><tr><th>Bd</th><th>White</th><th>Black</th><th>Result</th><th>Signatures</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="ps-footer">Printed ${new Date().toLocaleString()}</div>`;
  renderIntoFrame(html);
}

export function printStandings(t, isFinal = false) {
  const standings = getStandings(t);
  const tbLabels = { buchholz: 'Buchholz', sonnebornBerger: 'SB', progressive: 'Progr.' };
  const rows = standings.map(s => `
    <tr>
      <td class="center">${s.rank}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="center">${s.rating || '—'}</td>
      <td class="center">${s.points}</td>
      <td class="center">${s.wins}</td>
      <td class="center">${s.draws}</td>
      <td class="center">${s.losses}</td>
      <td class="center">${s.buchholz}</td>
      <td class="center">${s.sonnebornBerger}</td>
      <td class="center">${s.progressive}</td>
    </tr>`).join('');

  const html = `
    ${header(t, isFinal ? 'Final Rankings' : `Standings after Round ${t.currentRound}`)}
    <table class="ps-table">
      <thead><tr><th>#</th><th>Player</th><th>Rtg</th><th>Pts</th><th>W</th><th>D</th><th>L</th>
        <th>Bu</th><th>SB</th><th>Pr</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="ps-footer">Printed ${new Date().toLocaleString()}</div>`;
  renderIntoFrame(html);
}

export function printPlayerList(t) {
  const rows = [...t.players].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)).map(p => `
    <tr>
      <td class="center">${p.seed ?? '—'}</td>
      <td>${escapeHtml(p.code)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td class="center">${p.rating || '—'}</td>
      <td>${escapeHtml(p.federation || '—')}</td>
      <td class="center">${p.status === 'withdrawn' ? 'Withdrawn' : 'Active'}</td>
    </tr>`).join('');

  const html = `
    ${header(t, 'Player List')}
    <table class="ps-table">
      <thead><tr><th>Seed</th><th>ID</th><th>Name</th><th>Rtg</th><th>Federation/Club</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="ps-footer">Total players: ${t.players.length} — Printed ${new Date().toLocaleString()}</div>`;
  renderIntoFrame(html);
}

export function printBracket(t) {
  if (!t.bracket) return;
  const roundsMap = new Map();
  (t.bracket.matches || []).forEach(m => {
    const label = m.bracket === 'GF' ? (m.isReset ? 'Grand Final (Reset)' : 'Grand Final') : `${m.bracket} Round ${m.round}`;
    if (!roundsMap.has(label)) roundsMap.set(label, []);
    roundsMap.get(label).push(m);
  });
  let sections = '';
  roundsMap.forEach((matches, label) => {
    const slotLabel = id => id === 'TBD' ? 'TBD' : playerName(t, id);
    const rows = matches.map(m => `
      <tr>
        <td>${escapeHtml(slotLabel(m.player1))}</td>
        <td class="center">vs</td>
        <td>${escapeHtml(slotLabel(m.player2))}</td>
        <td class="center">${m.winner ? '→ ' + escapeHtml(playerName(t, m.winner)) : ''}</td>
      </tr>`).join('');
    sections += `<h3>${escapeHtml(label)}</h3><table class="ps-table"><tbody>${rows}</tbody></table>`;
  });
  const html = `${header(t, 'Bracket')}${sections}<div class="ps-footer">Printed ${new Date().toLocaleString()}</div>`;
  renderIntoFrame(html);
}

export function printDashboardSummary(t) {
  const stats = tournamentStats(t);
  const html = `
    ${header(t, 'Tournament Summary')}
    <table class="ps-table">
      <tbody>
        <tr><td>Type</td><td>${escapeHtml(t.type)}</td></tr>
        <tr><td>Status</td><td>${escapeHtml(t.status)}</td></tr>
        <tr><td>Players</td><td>${stats.players}</td></tr>
        <tr><td>Current round</td><td>${stats.currentRound} / ${stats.totalRounds}</td></tr>
        <tr><td>Completed games</td><td>${stats.completed}</td></tr>
        <tr><td>Remaining games</td><td>${stats.remaining}</td></tr>
        <tr><td>Leader</td><td>${stats.leader ? escapeHtml(stats.leader.name) : '—'}</td></tr>
      </tbody>
    </table>
    <div class="ps-footer">Printed ${new Date().toLocaleString()}</div>`;
  renderIntoFrame(html);
}
