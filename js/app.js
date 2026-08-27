// app.js — application entry point: router, global state, event wiring, modals.
// render.js only builds HTML strings; every state mutation and DOM event lives here.

import { DB } from './db.js';
import * as T from './tournaments.js';
import * as R from './render.js';
import * as P from './print.js';
import { toast, confirmDialog, downloadFile, readFileAsText, parseCSV, toCSV, escapeHtml } from './utils.js';

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let tournaments = DB.getAll();
let currentId = localStorage.getItem('ctms_current_tournament') || (tournaments[0] && tournaments[0].id) || null;
let uiState = { pairingsRound: null, resultsRound: null, playerSearch: '' };

const mainEl = document.getElementById('app-main');
const modalRoot = document.getElementById('modal-root');
const sidebar = document.getElementById('sidebar');

function current() {
  return tournaments.find(t => t.id === currentId) || null;
}
function persistCurrent(t) {
  T.saveTournament(t);
  tournaments = DB.getAll();
}
function setCurrentId(id) {
  currentId = id;
  if (id) localStorage.setItem('ctms_current_tournament', id);
  else localStorage.removeItem('ctms_current_tournament');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const NEEDS_TOURNAMENT = new Set(['players', 'pairings', 'results', 'standings', 'brackets', 'print']);

function parseRoute() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [route, ...rest] = hash.split('/');
  return { route: route || 'dashboard', rest };
}

function navigate(hash) { location.hash = '/' + hash.replace(/^#?\/?/, ''); }

function renderRoute() {
  const { route } = parseRoute();
  const t = current();

  if (NEEDS_TOURNAMENT.has(route) && !t) {
    mainEl.innerHTML = R.renderNoTournamentSelected('Select or create a tournament to continue.');
  } else {
    switch (route) {
      case 'dashboard': mainEl.innerHTML = R.renderDashboard(t); break;
      case 'list': mainEl.innerHTML = R.renderTournamentList(tournaments, currentId); break;
      case 'new': mainEl.innerHTML = R.renderTournamentForm(null); break;
      case 'edit': mainEl.innerHTML = R.renderTournamentForm(t); break;
      case 'players': mainEl.innerHTML = R.renderPlayers(t); break;
      case 'pairings': {
        if (!uiState.pairingsRound) uiState.pairingsRound = t.currentRound || 1;
        mainEl.innerHTML = R.renderPairings(t, uiState.pairingsRound);
        break;
      }
      case 'results': {
        if (!uiState.resultsRound) uiState.resultsRound = t.currentRound || 1;
        mainEl.innerHTML = R.renderResults(t, uiState.resultsRound);
        break;
      }
      case 'standings': mainEl.innerHTML = R.renderStandings(t); break;
      case 'brackets': mainEl.innerHTML = R.renderBrackets(t); break;
      case 'print': mainEl.innerHTML = R.renderPrintCenter(t); break;
      case 'settings': mainEl.innerHTML = R.renderSettings(DB.getSettings(), DB.getBackupInfo()); break;
      default: mainEl.innerHTML = R.renderDashboard(t);
    }
  }

  updateSidebar(route, t);
  window.scrollTo(0, 0);
  sidebar.classList.remove('is-open');
}

function updateSidebar(route, t) {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
    if (a.hasAttribute('data-needs-tournament')) a.classList.toggle('is-disabled', !t);
  });
  const switcher = document.getElementById('tournament-switcher');
  const options = ['<option value="">— Select tournament —</option>']
    .concat(tournaments.map(tt => `<option value="${tt.id}" ${tt.id === currentId ? 'selected' : ''}>${escapeHtml(tt.name)}</option>`));
  switcher.innerHTML = options.join('');
}

window.addEventListener('hashchange', renderRoute);

// ---------------------------------------------------------------------------
// Sidebar chrome
// ---------------------------------------------------------------------------
document.getElementById('tournament-switcher').addEventListener('change', e => {
  setCurrentId(e.target.value || null);
  uiState = { pairingsRound: null, resultsRound: null, playerSearch: '' };
  navigate('dashboard');
  renderRoute();
});
document.getElementById('btn-collapse-sidebar').addEventListener('click', () => sidebar.classList.toggle('is-collapsed'));
document.getElementById('btn-mobile-nav').addEventListener('click', () => sidebar.classList.toggle('is-open'));

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------
function openModal({ title, bodyHtml, size = '', onSubmit, submitLabel = 'Save' }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal__header"><h3>${title}</h3><button class="modal__close" data-act="close">&times;</button></div>
      <form class="modal__body" id="modal-form">${bodyHtml}</form>
      <div class="modal__footer">
        <button class="btn btn--ghost" data-act="close">Cancel</button>
        <button class="btn btn--primary" data-act="submit">${submitLabel}</button>
      </div>
    </div>`;
  modalRoot.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('modal-backdrop--in'));

  function close() {
    wrap.classList.remove('modal-backdrop--in');
    setTimeout(() => wrap.remove(), 180);
  }
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-act="close"]')) close();
  });
  const form = wrap.querySelector('#modal-form');
  wrap.querySelector('[data-act="submit"]').addEventListener('click', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const multi = {};
    form.querySelectorAll('[name]').forEach(el => {
      if (el.multiple || form.querySelectorAll(`[name="${el.name}"]`).length > 1) {
        multi[el.name] = [...form.querySelectorAll(`[name="${el.name}"]:checked`)].map(x => x.value);
      }
    });
    const ok = onSubmit({ ...data, ...multi }, form);
    if (ok !== false) close();
  });
  return { close, form };
}

// ---------------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------------
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  // Forms carry data-action for the 'submit' delegate below; a click bubbling up to
  // an ancestor <form> must never be treated as if that form's action were clicked
  // directly (it would double-fire alongside the native submit event).
  if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'FORM') return;
  const action = btn.dataset.action;
  const handler = actions[action];
  if (handler) handler(btn, e);
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]');
  // Same reasoning as the click delegate: a field's 'change' event bubbling up to a
  // <form data-action="..."> must not prematurely trigger that form's submit handler.
  if (!el || el.tagName === 'FORM') return;
  const handler = actions[el.dataset.action];
  if (handler) handler(el, e);
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-action="search-players"]');
  if (el) actions['search-players'](el, e);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-action]');
  if (!form) return;
  e.preventDefault();
  const handler = actions[form.dataset.action];
  if (handler) handler(form, e);
});

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------
const actions = {

  // ---- Tournament list / lifecycle ----
  'select-tournament': (el) => { setCurrentId(el.dataset.id); navigate('dashboard'); renderRoute(); },
  'duplicate-tournament': async (el) => {
    const src = tournaments.find(t => t.id === el.dataset.id);
    if (!src) return;
    const copy = T.createTournament({ ...src, name: src.name + ' (Copy)' });
    copy.tiebreaks = [...src.tiebreaks];
    src.players.forEach(p => {
      const np = T.addPlayer(copy, { name: p.name, rating: p.rating, federation: p.federation, contact: p.contact });
      np.seed = p.seed;
    });
    persistCurrent(copy);
    setCurrentId(copy.id);
    toast('Tournament duplicated', 'success');
    navigate('dashboard'); renderRoute();
  },
  'export-tournament': (el) => {
    const t = tournaments.find(x => x.id === el.dataset.id);
    if (!t) return;
    downloadFile(`${slug(t.name)}.json`, JSON.stringify(t, null, 2));
    toast('Tournament exported', 'success');
  },
  'delete-tournament': async (el) => {
    const t = tournaments.find(x => x.id === el.dataset.id);
    if (!t) return;
    const ok = await confirmDialog({ title: 'Delete tournament?', message: `"${t.name}" and all its data will be permanently removed.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    DB.remove(t.id);
    tournaments = DB.getAll();
    if (currentId === t.id) setCurrentId(tournaments[0] ? tournaments[0].id : null);
    toast('Tournament deleted', 'success');
    renderRoute();
  },
  'export-all': () => {
    downloadFile('chess-tournaments-export.json', DB.exportAllJSON());
    toast('All tournaments exported', 'success');
  },
  'import-json-file': async (el) => {
    const file = el.files[0]; if (!file) return;
    try {
      const text = await readFileAsText(file);
      const payload = JSON.parse(text);
      const result = DB.importJSON(payload, 'merge');
      tournaments = DB.getAll();
      toast(`Imported: ${result.added} added, ${result.updated} updated`, 'success');
      renderRoute();
    } catch (err) {
      toast('Import failed: invalid JSON file', 'error');
    }
    el.value = '';
  },

  'submit-tournament-form': (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    data.tiebreaks = [...form.querySelectorAll('input[name="tiebreak"]:checked')].map(x => x.value);
    const existingId = form.dataset.id;
    if (existingId) {
      const t = tournaments.find(x => x.id === existingId);
      Object.assign(t, {
        name: data.name.trim(), organizer: data.organizer, venue: data.venue, date: data.date,
        numRounds: Math.max(1, parseInt(data.numRounds, 10) || t.numRounds),
        timeControl: data.timeControl, tiebreaks: data.tiebreaks.length ? data.tiebreaks : t.tiebreaks
      });
      persistCurrent(t);
      toast('Tournament updated', 'success');
      setCurrentId(t.id); navigate('dashboard'); renderRoute();
    } else {
      const t = T.createTournament(data);
      persistCurrent(t);
      setCurrentId(t.id);
      toast('Tournament created', 'success');
      navigate('players'); renderRoute();
    }
  },

  // ---- Players ----
  'open-add-player': () => openPlayerModal(null),
  'open-edit-player': (el) => openPlayerModal(el.dataset.id),
  'withdraw-player': async (el) => {
    const t = current();
    const ok = await confirmDialog({ title: 'Withdraw player?', message: 'They will be excluded from future pairings but their record stays intact.', confirmText: 'Withdraw', danger: true });
    if (!ok) return;
    T.withdrawPlayer(t, el.dataset.id);
    persistCurrent(t); toast('Player withdrawn', 'success'); renderRoute();
  },
  'rejoin-player': (el) => {
    const t = current();
    T.rejoinPlayer(t, el.dataset.id);
    persistCurrent(t); toast('Player rejoined', 'success'); renderRoute();
  },
  'delete-player': async (el) => {
    const t = current();
    const ok = await confirmDialog({ title: 'Delete player?', message: 'This removes them entirely. Only possible if they have no recorded games.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    const result = T.deletePlayer(t, el.dataset.id);
    if (!result.ok) { toast(result.reason, 'error'); return; }
    persistCurrent(t); toast('Player deleted', 'success'); renderRoute();
  },
  'randomize-seeds': () => { const t = current(); T.randomizeSeeds(t); persistCurrent(t); toast('Seeds randomized', 'success'); renderRoute(); },
  'seed-by-rating': () => { const t = current(); T.seedByRating(t); persistCurrent(t); toast('Seeded by rating', 'success'); renderRoute(); },
  'open-adjust-score': (el) => openAdjustScoreModal(el.dataset.id),
  'search-players': (el) => {
    uiState.playerSearch = el.value.trim().toLowerCase();
    document.querySelectorAll('#players-table tbody tr').forEach(row => {
      row.style.display = row.dataset.search.includes(uiState.playerSearch) ? '' : 'none';
    });
  },
  'export-players-csv': () => {
    const t = current();
    const rows = [['Seed', 'Code', 'Name', 'Rating', 'Federation', 'Contact', 'Status']];
    [...t.players].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)).forEach(p => rows.push([p.seed, p.code, p.name, p.rating, p.federation, p.contact, p.status]));
    downloadFile(`${slug(t.name)}-players.csv`, toCSV(rows), 'text/csv');
    toast('Player list exported', 'success');
  },
  'import-players-csv': async (el) => {
    const file = el.files[0]; if (!file) return;
    const t = current();
    try {
      const text = await readFileAsText(file);
      const rows = parseCSV(text);
      if (!rows.length) throw new Error('empty');
      const header = rows[0].map(h => h.trim().toLowerCase());
      const idx = name => header.indexOf(name);
      const iName = idx('name'), iRating = idx('rating'), iFed = idx('federation') >= 0 ? idx('federation') : idx('club'), iContact = idx('contact');
      if (iName === -1) throw new Error('Missing "Name" column');
      let added = 0;
      rows.slice(1).forEach(r => {
        if (!r[iName] || !r[iName].trim()) return;
        T.addPlayer(t, {
          name: r[iName], rating: iRating >= 0 ? r[iRating] : 0,
          federation: iFed >= 0 ? r[iFed] : '', contact: iContact >= 0 ? r[iContact] : ''
        });
        added++;
      });
      persistCurrent(t);
      toast(`Imported ${added} players from CSV`, 'success');
      renderRoute();
    } catch (err) {
      toast('CSV import failed: expected a header row with at least a "Name" column', 'error');
    }
    el.value = '';
  },

  // ---- Pairings ----
  'change-round': (el) => { uiState.pairingsRound = parseInt(el.value, 10); renderRoute(); },
  'change-round-results': (el) => { uiState.resultsRound = parseInt(el.value, 10); renderRoute(); },
  'generate-round': async (el) => {
    const t = current();
    const roundNumber = parseInt(el.dataset.round, 10);
    const round = t.rounds.find(r => r.number === roundNumber);
    if (round && round.status === 'locked') { toast('Unlock the round before regenerating.', 'error'); return; }
    if (round) {
      const hasResults = round.pairings.some(p => p.result && !p.isBye);
      const ok = await confirmDialog({
        title: 'Regenerate pairings?',
        message: hasResults ? 'This will erase recorded results for this round. Continue?' : `This replaces the current pairings for Round ${roundNumber}.`,
        confirmText: 'Regenerate', danger: hasResults
      });
      if (!ok) return;
    }
    T.generateRound(t, roundNumber);
    persistCurrent(t);
    toast(`Round ${roundNumber} pairings generated`, 'success');
    renderRoute();
  },
  'lock-round': (el) => {
    const t = current();
    T.lockRound(t, parseInt(el.dataset.round, 10));
    persistCurrent(t); toast('Round locked', 'success'); renderRoute();
  },
  'unlock-round': (el) => {
    const t = current();
    T.unlockRound(t, parseInt(el.dataset.round, 10));
    persistCurrent(t); toast('Round unlocked', 'success'); renderRoute();
  },
  'open-manual-pairing': (el) => openManualPairingModal(parseInt(el.dataset.board, 10)),

  // ---- Results ----
  'record-result': (el) => {
    const t = current();
    const round = parseInt(el.dataset.round, 10), board = parseInt(el.dataset.board, 10);
    T.recordResult(t, round, board, el.value || null);
    persistCurrent(t);
    toast('Result saved', 'success');
  },

  // ---- Standings / print shortcuts ----
  'goto-print-standings': () => navigate('print'),
  'goto-print-bracket': () => navigate('print'),

  // ---- Brackets ----
  'build-bracket': async (el) => {
    const t = current();
    if (t.players.filter(p => p.status === 'active').length < 2) { toast('Need at least 2 active players', 'error'); return; }
    const ok = await confirmDialog({ title: 'Generate bracket?', message: 'The bracket will be built from current seed order. Add all players before generating.', confirmText: 'Generate' });
    if (!ok) return;
    T.buildBracket(t);
    persistCurrent(t); toast('Bracket generated', 'success'); renderRoute();
  },
  'record-bracket-result': (el) => {
    const t = current();
    T.recordBracketResult(t, el.dataset.match, el.dataset.winner);
    persistCurrent(t);
    if (T.isBracketComplete(t)) toast('Tournament complete!', 'success');
    else toast('Result recorded', 'success');
    renderRoute();
  },

  // ---- Print center ----
  'print-pairing-sheet': () => {
    const t = current();
    const round = parseInt(document.getElementById('print-round-select').value, 10);
    P.printPairingSheet(t, round);
  },
  'print-standings': () => P.printStandings(current(), false),
  'print-final-rankings': () => P.printStandings(current(), true),
  'print-bracket': () => P.printBracket(current()),
  'print-players': () => P.printPlayerList(current()),
  'print-summary': () => P.printDashboardSummary(current()),

  // ---- Settings ----
  'submit-settings-form': (form) => {
    const data = Object.fromEntries(new FormData(form).entries());
    DB.saveSettings({ ...DB.getSettings(), ...data });
    toast('Settings saved', 'success');
  },
  'restore-backup': async () => {
    const ok = await confirmDialog({ title: 'Restore last backup?', message: 'This overwrites all current tournament data with the last auto-backup.', confirmText: 'Restore', danger: true });
    if (!ok) return;
    if (DB.restoreBackup()) { tournaments = DB.getAll(); toast('Backup restored', 'success'); renderRoute(); }
    else toast('No backup available', 'error');
  },
  'clear-all-data': async () => {
    const ok = await confirmDialog({ title: 'Clear all data?', message: 'Every tournament will be permanently deleted from this browser. This cannot be undone.', confirmText: 'Clear Everything', danger: true });
    if (!ok) return;
    DB.saveAll([]);
    tournaments = []; setCurrentId(null);
    toast('All data cleared', 'success');
    navigate('list'); renderRoute();
  }
};

function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tournament'; }

// ---------------------------------------------------------------------------
// Modal builders (player form, score adjustment, manual pairing)
// ---------------------------------------------------------------------------
function openPlayerModal(playerId) {
  const t = current();
  const p = playerId ? t.players.find(x => x.id === playerId) : null;
  openModal({
    title: p ? 'Edit Player' : 'Add Player',
    bodyHtml: R.playerFormFields(p),
    submitLabel: p ? 'Save Changes' : 'Add Player',
    onSubmit: (data) => {
      if (p) T.editPlayer(t, p.id, data);
      else T.addPlayer(t, data);
      persistCurrent(t);
      toast(p ? 'Player updated' : 'Player added', 'success');
      renderRoute();
    }
  });
}

function openAdjustScoreModal(playerId) {
  const t = current();
  const p = t.players.find(x => x.id === playerId);
  if (!p) return;
  openModal({
    title: `Adjust Score — ${escapeHtml(p.name)}`,
    submitLabel: 'Apply Adjustment',
    bodyHtml: `
      <div class="form-grid">
        <div class="field">
          <label>Point Adjustment (+/-)</label>
          <input type="number" step="0.5" name="delta" required placeholder="e.g. -1 or 0.5">
        </div>
        <div class="field field--full">
          <label>Reason</label>
          <input type="text" name="reason" placeholder="e.g. Correction for missing Round 2 result">
        </div>
      </div>`,
    onSubmit: (data) => {
      T.adjustScore(t, p.id, data.delta, data.reason);
      persistCurrent(t);
      toast('Score adjustment applied', 'success');
      renderRoute();
    }
  });
}

function openManualPairingModal(board) {
  const t = current();
  const round = t.rounds.find(r => r.number === uiState.pairingsRound);
  const pairing = round.pairings.find(p => p.board === board);
  const options = t.players.filter(p => p.status === 'active').map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.rating})</option>`).join('');
  openModal({
    title: `Manual Pairing — Board ${board}`,
    submitLabel: 'Apply',
    bodyHtml: `
      <div class="form-grid">
        <div class="field">
          <label>White</label>
          <select name="whiteId">${options}</select>
        </div>
        <div class="field">
          <label>Black (leave as BYE for a bye)</label>
          <select name="blackId"><option value="">— BYE —</option>${options}</select>
        </div>
      </div>
      <p class="hint">Overriding a pairing does not check for repeat opponents — use with care.</p>`,
    onSubmit: (data) => {
      T.setManualPairing(t, uiState.pairingsRound, board, data.whiteId, data.blackId || null);
      persistCurrent(t);
      toast('Pairing updated', 'success');
      renderRoute();
    }
  });
  // Pre-select current values after the modal is in the DOM.
  const form = document.getElementById('modal-form');
  form.querySelector('[name="whiteId"]').value = pairing.whiteId;
  if (pairing.blackId) form.querySelector('[name="blackId"]').value = pairing.blackId;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!location.hash) location.hash = '#/dashboard';
renderRoute();
