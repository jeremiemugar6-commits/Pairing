// render.js — turns application state into HTML strings for each page.
// These functions are pure: they read data and return markup. All state changes
// and event wiring live in app.js, which re-renders by calling these again.

import { escapeHtml, formatDate, formatDateTime } from './utils.js';
import { activePlayers, getStandings, tournamentStats, TIEBREAK_OPTIONS, getChampion } from './tournaments.js';

const TYPE_LABELS = {
  swiss: 'Swiss System',
  roundrobin: 'Round Robin',
  'single-elim': 'Single Elimination',
  'double-elim': 'Double Elimination'
};

export function typeLabel(type) { return TYPE_LABELS[type] || type; }

function pageHeader(eyebrow, title, actionsHtml = '') {
  return `
    <div class="page-header">
      <div class="page-header__title">
        <span class="eyebrow">${escapeHtml(eyebrow)}</span>
        <h1>${title}</h1>
      </div>
      <div class="page-header__actions">${actionsHtml}</div>
    </div>`;
}

function emptyState(icon, title, message, actionHtml = '') {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${actionHtml}
    </div>`;
}

export function renderNoTournamentSelected(message) {
  return emptyState('&#9820;', 'No tournament selected', message,
    `<a class="btn btn--primary" href="#/list">View Tournaments</a>`);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export function renderDashboard(t) {
  if (!t) {
    return pageHeader('Overview', 'Dashboard') +
      emptyState('&#9820;', 'No tournaments yet', 'Create your first tournament to see live stats here.',
        `<a class="btn btn--primary" href="#/new">Create Tournament</a>`);
  }
  const s = tournamentStats(t);
  const leaderLine = s.leader ? `${escapeHtml(s.leader.name)}` : '—';

  return `
    ${pageHeader(typeLabel(t.type), t.name, `
      <button class="btn" data-action="duplicate-tournament" data-id="${t.id}">Duplicate</button>
      <a class="btn btn--primary" href="#/pairings">Manage Round</a>
    `)}
    <div class="grid grid--stats">
      <div class="card stat-card"><div class="stat-card__label">Total Players</div><div class="stat-card__value">${s.players}</div></div>
      <div class="card stat-card"><div class="stat-card__label">Current Round</div><div class="stat-card__value">${s.currentRound || 0} / ${s.totalRounds}</div></div>
      <div class="card stat-card"><div class="stat-card__label">Completed Games</div><div class="stat-card__value">${s.completed}</div></div>
      <div class="card stat-card"><div class="stat-card__label">Remaining Games</div><div class="stat-card__value">${s.remaining}</div></div>
      <div class="card stat-card"><div class="stat-card__label">Tournament Leader</div><div class="stat-card__value" style="font-size:1.3rem">${leaderLine}</div></div>
      <div class="card stat-card"><div class="stat-card__label">Tournament Type</div><div class="stat-card__value" style="font-size:1.3rem">${escapeHtml(typeLabel(t.type))}</div></div>
    </div>

    <div class="section-title-row"><h2>Details</h2></div>
    <div class="grid grid--2">
      <div class="card">
        <p><strong>Organizer:</strong> ${escapeHtml(t.organizer || '—')}</p>
        <p><strong>Venue:</strong> ${escapeHtml(t.venue || '—')}</p>
        <p><strong>Date:</strong> ${formatDate(t.date)}</p>
        <p><strong>Time control:</strong> ${escapeHtml(t.timeControl || '—')}</p>
        <p><strong>Status:</strong> <span class="tag tag--${t.status === 'completed' ? 'completed' : 'active'}">${escapeHtml(t.status)}</span></p>
      </div>
      <div class="card">
        <h3>Quick actions</h3>
        <div class="btn-row">
          <a class="btn" href="#/players">Manage Players</a>
          <a class="btn" href="#/standings">View Standings</a>
          <a class="btn" href="#/print">Print Center</a>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Tournament list
// ---------------------------------------------------------------------------
export function renderTournamentList(all, currentId) {
  const actions = `<a class="btn btn--primary" href="#/new">+ New Tournament</a>
    <button class="btn" data-action="export-all">Export All (JSON)</button>
    <label class="btn" style="cursor:pointer;">Import JSON<input type="file" accept=".json" style="display:none" data-action="import-json-file"></label>`;

  if (!all.length) {
    return pageHeader('All Tournaments', 'Tournaments', actions) +
      emptyState('&#9783;', 'No tournaments yet', 'Get started by creating your first tournament.',
        `<a class="btn btn--primary" href="#/new">Create Tournament</a>`);
  }

  const rows = all.map(t => `
    <tr class="${t.id === currentId ? 'rank-1' : ''}">
      <td>${escapeHtml(t.name)}</td>
      <td>${escapeHtml(typeLabel(t.type))}</td>
      <td>${formatDate(t.date)}</td>
      <td>${activePlayersCountLabel(t)}</td>
      <td>${t.currentRound || 0} / ${t.numRounds}</td>
      <td><span class="tag tag--${t.status === 'completed' ? 'completed' : 'active'}">${escapeHtml(t.status)}</span></td>
      <td>
        <div class="btn-row">
          <button class="btn btn--sm btn--primary" data-action="select-tournament" data-id="${t.id}">Open</button>
          <button class="btn btn--sm" data-action="duplicate-tournament" data-id="${t.id}">Duplicate</button>
          <button class="btn btn--sm" data-action="export-tournament" data-id="${t.id}">Export</button>
          <button class="btn btn--sm btn--danger" data-action="delete-tournament" data-id="${t.id}">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  return `
    ${pageHeader('All Tournaments', 'Tournaments', actions)}
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Type</th><th>Date</th><th>Players</th><th>Round</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
function activePlayersCountLabel(t) { return activePlayers(t).length; }

// ---------------------------------------------------------------------------
// Create / Edit tournament form (rendered inline as a page)
// ---------------------------------------------------------------------------
export function renderTournamentForm(existing = null) {
  const t = existing || { name: '', organizer: '', venue: '', date: new Date().toISOString().slice(0, 10), numRounds: 5, timeControl: '90+30', type: 'swiss', tiebreaks: ['buchholz', 'sonnebornBerger', 'progressive'] };
  const typeOptions = Object.entries(TYPE_LABELS).map(([val, label]) =>
    `<option value="${val}" ${t.type === val ? 'selected' : ''}>${label}</option>`).join('');
  const tbCheckboxes = TIEBREAK_OPTIONS.map(opt => `
    <label class="checkbox-row">
      <input type="checkbox" name="tiebreak" value="${opt.id}" ${t.tiebreaks.includes(opt.id) ? 'checked' : ''}>
      ${opt.label}
    </label>`).join('');

  return `
    ${pageHeader('Setup', existing ? 'Edit Tournament' : 'Create Tournament')}
    <form class="card" id="tournament-form" data-action="submit-tournament-form" data-id="${existing ? existing.id : ''}">
      <div class="form-grid">
        <div class="field field--full">
          <label>Tournament Name *</label>
          <input type="text" name="name" required value="${escapeHtml(t.name)}" placeholder="e.g. Spring Open 2026">
        </div>
        <div class="field">
          <label>Organizer</label>
          <input type="text" name="organizer" value="${escapeHtml(t.organizer)}">
        </div>
        <div class="field">
          <label>Venue</label>
          <input type="text" name="venue" value="${escapeHtml(t.venue)}">
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" name="date" value="${t.date}">
        </div>
        <div class="field">
          <label>Number of Rounds</label>
          <input type="number" name="numRounds" min="1" max="30" value="${t.numRounds}">
          <span class="hint">Round Robin recalculates this automatically from player count.</span>
        </div>
        <div class="field">
          <label>Time Control</label>
          <input type="text" name="timeControl" value="${escapeHtml(t.timeControl)}" placeholder="e.g. 90+30">
        </div>
        <div class="field">
          <label>Tournament Type</label>
          <select name="type" ${existing ? 'disabled' : ''}>${typeOptions}</select>
          ${existing ? '<span class="hint">Type can\'t change after creation.</span>' : ''}
        </div>
        <div class="field field--full">
          <fieldset>
            <legend>Tie-break methods (Swiss / Round Robin)</legend>
            ${tbCheckboxes}
          </fieldset>
        </div>
      </div>
      <div class="btn-row" style="margin-top:18px;">
        <button type="submit" class="btn btn--primary">${existing ? 'Save Changes' : 'Create Tournament'}</button>
        <a class="btn btn--ghost" href="#/list">Cancel</a>
      </div>
    </form>`;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
export function renderPlayers(t) {
  const actions = `
    <input type="search" id="player-search" placeholder="Search players..." style="width:200px" data-action="search-players">
    <button class="btn" data-action="open-add-player">+ Add Player</button>
    <button class="btn" data-action="randomize-seeds">Randomize Seed</button>
    <button class="btn" data-action="seed-by-rating">Seed by Rating</button>
    <label class="btn" style="cursor:pointer;">Import CSV<input type="file" accept=".csv" style="display:none" data-action="import-players-csv"></label>
    <button class="btn" data-action="export-players-csv">Export CSV</button>
  `;

  if (!t.players.length) {
    return pageHeader(t.name, 'Players', actions) +
      emptyState('&#9823;', 'No players registered', 'Add players individually or import a CSV file to get started.');
  }

  const rows = [...t.players].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)).map(p => `
    <tr data-player-row="${p.id}" data-search="${escapeHtml((p.name + ' ' + p.federation + ' ' + p.code).toLowerCase())}">
      <td class="num">${p.seed ?? '—'}</td>
      <td>${escapeHtml(p.code)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${p.rating || '—'}</td>
      <td>${escapeHtml(p.federation || '—')}</td>
      <td>${escapeHtml(p.contact || '—')}</td>
      <td><span class="tag tag--${p.status}">${p.status === 'withdrawn' ? 'Withdrawn' : 'Active'}</span></td>
      <td>
        <div class="btn-row">
          <button class="btn btn--sm" data-action="open-edit-player" data-id="${p.id}">Edit</button>
          ${p.status === 'active'
            ? `<button class="btn btn--sm btn--danger" data-action="withdraw-player" data-id="${p.id}">Withdraw</button>`
            : `<button class="btn btn--sm" data-action="rejoin-player" data-id="${p.id}">Rejoin</button>`}
          <button class="btn btn--sm" data-action="open-adjust-score" data-id="${p.id}">Adjust Score</button>
          <button class="btn btn--sm btn--danger" data-action="delete-player" data-id="${p.id}">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  return `
    ${pageHeader(t.name, 'Players', actions)}
    <div class="table-wrap">
      <table class="data-table" id="players-table">
        <thead><tr><th>Seed</th><th>ID</th><th>Name</th><th>Rtg</th><th>Federation</th><th>Contact</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">Players who have already recorded games can only be withdrawn, not deleted, to keep standings accurate. Adding a new player is allowed at any point — they'll be included from the next generated round onward.</p>`;
}

export function playerFormFields(p = null) {
  return `
    <div class="form-grid">
      <div class="field">
        <label>Name *</label>
        <input type="text" name="name" required value="${p ? escapeHtml(p.name) : ''}">
      </div>
      <div class="field">
        <label>Rating (ELO)</label>
        <input type="number" name="rating" value="${p ? p.rating : ''}">
      </div>
      <div class="field">
        <label>Federation / Club</label>
        <input type="text" name="federation" value="${p ? escapeHtml(p.federation) : ''}">
      </div>
      <div class="field">
        <label>Contact (optional)</label>
        <input type="text" name="contact" value="${p ? escapeHtml(p.contact) : ''}">
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Pairings (generate / manual override / lock)
// ---------------------------------------------------------------------------
export function renderPairings(t, roundNumber) {
  const rounds = roundSelectorOptions(t, roundNumber);
  if (t.type === 'single-elim' || t.type === 'double-elim') {
    return pageHeader(t.name, 'Pairings') +
      emptyState('&#9824;', 'Elimination format', 'Single and Double Elimination pairings are generated as a bracket. Head to the Brackets page to view and advance matches.',
        `<a class="btn btn--primary" href="#/brackets">Go to Brackets</a>`);
  }
  if (!activePlayers(t).length) {
    return pageHeader(t.name, 'Pairings') + emptyState('&#9817;', 'No active players', 'Register players before generating pairings.');
  }

  const round = t.rounds.find(r => r.number === roundNumber);
  const actions = `
    <select data-action="change-round" style="width:auto">${rounds}</select>
    <button class="btn btn--primary" data-action="generate-round" data-round="${roundNumber}">
      ${round ? 'Regenerate Pairings' : 'Generate Pairings'}
    </button>
    ${round && round.status !== 'locked' ? `<button class="btn" data-action="lock-round" data-round="${roundNumber}">Lock Round</button>` : ''}
    ${round && round.status === 'locked' ? `<button class="btn" data-action="unlock-round" data-round="${roundNumber}">Unlock Round</button>` : ''}
  `;

  if (!round) {
    return pageHeader(t.name, `Pairings — Round ${roundNumber}`, actions) +
      emptyState('&#9817;', `Round ${roundNumber} not generated yet`, 'Click "Generate Pairings" to pair players for this round.');
  }

  const canEdit = round.status !== 'locked';
  const rows = round.pairings.map(p => boardRow(t, p, canEdit)).join('');

  return `
    ${pageHeader(t.name, `Pairings — Round ${roundNumber}`, actions)}
    <div class="card" style="padding:0;">
      <div class="board-list">${rows}</div>
    </div>
    <p class="hint">Use "Swap" on any board to manually override a pairing before the round starts. Regenerating wipes the current round's pairings (results, if any, will be lost — locked rounds cannot be regenerated).</p>`;
}

function boardRow(t, p, canEdit) {
  const white = t.players.find(x => x.id === p.whiteId);
  const black = t.players.find(x => x.id === p.blackId);
  return `
    <div class="board-row">
      <div class="board-row__num">${p.board}</div>
      <div class="board-row__white"><span class="piece-w"></span>${escapeHtml(white ? white.name : '—')} <span class="dim">${white ? white.rating : ''}</span></div>
      <div class="vs">vs</div>
      <div class="board-row__black">${p.isBye ? '<em class="dim">BYE</em>' : `<span class="piece-b"></span>${escapeHtml(black ? black.name : '—')} <span class="dim">${black ? black.rating : ''}</span>`}</div>
      <div class="btn-row">
        ${canEdit && !p.isBye ? `<button class="btn btn--sm" data-action="open-manual-pairing" data-board="${p.board}">Swap</button>` : ''}
      </div>
    </div>`;
}

function roundSelectorOptions(t, current) {
  const max = t.type === 'roundrobin' && t.rrSchedule ? t.rrSchedule.length : t.numRounds;
  let opts = '';
  for (let i = 1; i <= max; i++) opts += `<option value="${i}" ${i === current ? 'selected' : ''}>Round ${i}</option>`;
  return opts;
}

// ---------------------------------------------------------------------------
// Round Results
// ---------------------------------------------------------------------------
const RESULT_OPTIONS = [
  { v: '', label: '— result —' },
  { v: '1-0', label: '1 – 0 (White wins)' },
  { v: '0-1', label: '0 – 1 (Black wins)' },
  { v: '1/2-1/2', label: '½ – ½ (Draw)' }
];

export function renderResults(t, roundNumber) {
  if (t.type === 'single-elim' || t.type === 'double-elim') {
    return pageHeader(t.name, 'Round Results') +
      emptyState('&#9824;', 'Elimination format', 'Enter results directly on the Brackets page — winners advance automatically.',
        `<a class="btn btn--primary" href="#/brackets">Go to Brackets</a>`);
  }
  const rounds = roundSelectorOptions(t, roundNumber);
  const round = t.rounds.find(r => r.number === roundNumber);
  const actions = `<select data-action="change-round-results" style="width:auto">${rounds}</select>`;

  if (!round) {
    return pageHeader(t.name, `Round Results — Round ${roundNumber}`, actions) +
      emptyState('&#9813;', 'No pairings for this round', 'Generate pairings on the Pairings page first.');
  }

  const rows = round.pairings.map(p => {
    const white = t.players.find(x => x.id === p.whiteId);
    const black = t.players.find(x => x.id === p.blackId);
    if (p.isBye) {
      return `<tr><td class="num">${p.board}</td><td>${escapeHtml(white ? white.name : '—')}</td><td><em class="dim">BYE</em></td><td class="num">1.0</td><td>—</td></tr>`;
    }
    const options = RESULT_OPTIONS.map(o => `<option value="${o.v}" ${p.result === o.v ? 'selected' : ''}>${o.label}</option>`).join('');
    return `
      <tr>
        <td class="num">${p.board}</td>
        <td>${escapeHtml(white ? white.name : '—')}</td>
        <td>${escapeHtml(black ? black.name : '—')}</td>
        <td>
          <select class="result-select" data-action="record-result" data-round="${roundNumber}" data-board="${p.board}">
            ${options}
          </select>
        </td>
        <td>${p.result ? '<span class="tag tag--completed">Recorded</span>' : '<span class="tag tag--pending">Pending</span>'}</td>
      </tr>`;
  }).join('');

  const lockActions = round.status === 'locked'
    ? `<button class="btn" data-action="unlock-round" data-round="${roundNumber}">Unlock Round</button>`
    : `<button class="btn btn--primary" data-action="lock-round" data-round="${roundNumber}">Lock Round</button>`;

  return `
    ${pageHeader(t.name, `Round Results — Round ${roundNumber}`, actions)}
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Bd</th><th>White</th><th>Black</th><th>Result</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="btn-row" style="margin-top:14px;">${lockActions}</div>
    <p class="hint">Results can be corrected any time, including on locked or past rounds — standings recalculate instantly.</p>`;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------
export function renderStandings(t) {
  if (t.type === 'single-elim' || t.type === 'double-elim') {
    return pageHeader(t.name, 'Standings') +
      emptyState('&#127942;', 'Elimination format', 'Elimination tournaments are decided by bracket position, not a points table. See the Brackets page for live results.',
        `<a class="btn btn--primary" href="#/brackets">Go to Brackets</a>`);
  }
  const standings = getStandings(t);
  if (!standings.length) {
    return pageHeader(t.name, 'Standings') + emptyState('&#127942;', 'No results yet', 'Standings will appear once games are recorded.');
  }
  const rows = standings.map(s => `
    <tr class="${s.rank === 1 ? 'rank-1' : ''}">
      <td class="num">${s.rank}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.rating || '—'}</td>
      <td class="num"><strong>${s.points}</strong></td>
      <td class="num">${s.played}</td>
      <td class="num">${s.wins}</td>
      <td class="num">${s.draws}</td>
      <td class="num">${s.losses}</td>
      <td class="num">${s.buchholz}</td>
      <td class="num">${s.sonnebornBerger}</td>
      <td class="num">${s.progressive}</td>
      <td class="num">${s.adjustment ? (s.adjustment > 0 ? '+' : '') + s.adjustment : '—'}</td>
    </tr>`).join('');

  return `
    ${pageHeader(t.name, 'Standings', `<button class="btn" data-action="goto-print-standings">Print Standings</button>`)}
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Player</th><th class="num">Rtg</th><th class="num">Pts</th><th class="num">Pld</th>
          <th class="num">W</th><th class="num">D</th><th class="num">L</th>
          <th class="num">Buchholz</th><th class="num">Sonneborn-Berger</th><th class="num">Progressive</th><th class="num">Adj.</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Brackets
// ---------------------------------------------------------------------------
export function renderBrackets(t) {
  if (t.type !== 'single-elim' && t.type !== 'double-elim') {
    return pageHeader(t.name, 'Brackets') +
      emptyState('&#9824;', 'Not an elimination tournament', 'Brackets only apply to Single or Double Elimination tournaments. Check Standings instead.',
        `<a class="btn btn--primary" href="#/standings">Go to Standings</a>`);
  }
  if (!t.bracket) {
    return pageHeader(t.name, 'Brackets', `<button class="btn btn--primary" data-action="build-bracket">Generate Bracket</button>`) +
      emptyState('&#9824;', 'Bracket not generated', 'Register all players and generate the bracket to begin.');
  }

  const champion = getChampion(t);
  const banner = champion ? `<div class="card" style="border-color:var(--gold-500); margin-bottom:18px;"><h3>&#127942; Champion: ${escapeHtml(champion.name)}</h3></div>` : '';

  const html = t.type === 'single-elim' ? renderSingleElimBracket(t) : renderDoubleElimBracket(t);
  return `${pageHeader(t.name, 'Brackets', `<button class="btn" data-action="goto-print-bracket">Print Bracket</button>`)}${banner}${html}`;
}

function matchBox(t, m) {
  const name = id => {
    if (id === 'TBD' || id === undefined) return { label: 'TBD', cls: 'is-tbd' };
    if (id === null) return { label: 'BYE', cls: 'is-tbd' };
    const p = t.players.find(x => x.id === id);
    return { label: p ? p.name : '—', cls: '' };
  };
  const a = name(m.player1), b = name(m.player2);
  const canPlay = m.player1 && m.player2 && m.player1 !== 'TBD' && m.player2 !== 'TBD' && !m.winner;
  const rowA = `<div class="bracket-match__row ${m.winner === m.player1 ? 'is-winner' : a.cls}">${escapeHtml(a.label)}${canPlay ? `<button class="btn btn--sm" data-action="record-bracket-result" data-match="${m.id}" data-winner="${m.player1}">Win</button>` : ''}</div>`;
  const rowB = `<div class="bracket-match__row ${m.winner === m.player2 ? 'is-winner' : b.cls}">${escapeHtml(b.label)}${canPlay ? `<button class="btn btn--sm" data-action="record-bracket-result" data-match="${m.id}" data-winner="${m.player2}">Win</button>` : ''}</div>`;
  return `<div class="bracket-match">${rowA}${rowB}</div>`;
}

function renderSingleElimBracket(t) {
  const byRound = new Map();
  t.bracket.matches.forEach(m => {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round).push(m);
  });
  const cols = [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => `
    <div class="bracket__round">
      <div class="bracket__round-title">${round === t.bracket.totalRounds ? 'Final' : 'Round ' + round}</div>
      ${matches.map(m => matchBox(t, m)).join('')}
    </div>`).join('');
  return `<div class="bracket">${cols}</div>`;
}

function renderDoubleElimBracket(t) {
  // Derive WB/LB/GF views from the single source of truth (t.bracket.matches) rather than
  // relying on cached wbMatches/lbMatches/grandFinal references, which can go stale after a
  // save/reload round-trip through localStorage.
  const wbMatches = t.bracket.matches.filter(m => m.bracket === 'WB');
  const lbMatches = t.bracket.matches.filter(m => m.bracket === 'LB');
  const grandFinal = t.bracket.matches.find(m => m.isGrandFinal && !m.isReset) || null;
  const grandFinal2 = t.bracket.matches.find(m => m.isGrandFinal && m.isReset) || null;

  const wbByRound = new Map();
  wbMatches.forEach(m => { if (!wbByRound.has(m.round)) wbByRound.set(m.round, []); wbByRound.get(m.round).push(m); });
  const lbByRound = new Map();
  lbMatches.forEach(m => { if (!lbByRound.has(m.round)) lbByRound.set(m.round, []); lbByRound.get(m.round).push(m); });

  const wbCols = [...wbByRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => `
    <div class="bracket__round">
      <div class="bracket__round-title">WB Round ${round}</div>
      ${matches.map(m => matchBox(t, m)).join('')}
    </div>`).join('');
  const lbCols = [...lbByRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => `
    <div class="bracket__round">
      <div class="bracket__round-title">LB Round ${round}</div>
      ${matches.map(m => matchBox(t, m)).join('')}
    </div>`).join('');

  const gfCol = grandFinal ? `
    <div class="bracket__round">
      <div class="bracket__round-title">Grand Final</div>
      ${matchBox(t, grandFinal)}
      ${grandFinal2 ? `<div class="bracket__round-title">Reset</div>${matchBox(t, grandFinal2)}` : ''}
    </div>` : '';

  return `
    <h3>Winners Bracket</h3>
    <div class="bracket">${wbCols}${gfCol}</div>
    <h3>Losers Bracket</h3>
    <div class="bracket">${lbCols}</div>`;
}

// ---------------------------------------------------------------------------
// Print Center
// ---------------------------------------------------------------------------
export function renderPrintCenter(t) {
  const isElim = t.type === 'single-elim' || t.type === 'double-elim';
  const rounds = roundSelectorOptions(t, t.currentRound || 1);
  return `
    ${pageHeader(t.name, 'Print Center')}
    <div class="grid grid--2">
      ${!isElim ? `
      <div class="card">
        <h3>Pairing Sheet</h3>
        <p>Board-by-board sheet with signature area, for a specific round.</p>
        <div class="field"><label>Round</label><select id="print-round-select">${rounds}</select></div>
        <button class="btn btn--primary" data-action="print-pairing-sheet">Print Pairing Sheet</button>
      </div>
      <div class="card">
        <h3>Standings</h3>
        <p>Full tie-break table as it stands right now.</p>
        <button class="btn btn--primary" data-action="print-standings">Print Standings</button>
      </div>
      <div class="card">
        <h3>Final Rankings</h3>
        <p>Same table, labeled as the tournament's final result.</p>
        <button class="btn btn--primary" data-action="print-final-rankings">Print Final Rankings</button>
      </div>` : `
      <div class="card">
        <h3>Bracket</h3>
        <p>Full bracket tree with current results.</p>
        <button class="btn btn--primary" data-action="print-bracket">Print Bracket</button>
      </div>`}
      <div class="card">
        <h3>Player List</h3>
        <p>Seed order, ratings, federations and status.</p>
        <button class="btn btn--primary" data-action="print-players">Print Player List</button>
      </div>
      <div class="card">
        <h3>Tournament Summary</h3>
        <p>Dashboard snapshot: rounds, completion, leader.</p>
        <button class="btn btn--primary" data-action="print-summary">Print Summary</button>
      </div>
    </div>
    <p class="hint">Printing opens your browser's print dialog. Choose "Save as PDF" as the destination to export a PDF instead of printing on paper.</p>`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function renderSettings(settings, backupInfo) {
  return `
    ${pageHeader('App', 'Settings')}
    <div class="grid grid--2">
      <div class="card">
        <h3>Arbiter Defaults</h3>
        <form data-action="submit-settings-form">
          <div class="field" style="margin-bottom:12px;">
            <label>Default Arbiter Name</label>
            <input type="text" name="arbiterName" value="${escapeHtml(settings.arbiterName || '')}">
          </div>
          <div class="field" style="margin-bottom:12px;">
            <label>Default Time Control</label>
            <input type="text" name="defaultTimeControl" value="${escapeHtml(settings.defaultTimeControl || '')}">
          </div>
          <button type="submit" class="btn btn--primary">Save Settings</button>
        </form>
      </div>
      <div class="card">
        <h3>Data &amp; Backup</h3>
        <p>Everything is stored in this browser's LocalStorage — nothing leaves your device.</p>
        <p class="hint">Last auto-backup: ${backupInfo ? formatDateTime(backupInfo) : 'none yet'}</p>
        <div class="btn-row">
          <button class="btn" data-action="restore-backup">Restore Last Backup</button>
          <button class="btn btn--danger" data-action="clear-all-data">Clear All Data</button>
        </div>
      </div>
    </div>`;
}
