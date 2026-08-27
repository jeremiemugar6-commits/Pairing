// utils.js — small shared helpers used across the app.

let idCounter = 0;
/** Generates a reasonably unique id without any external dependency. */
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Auto-generated, human-facing player codes like P-0001. */
export function playerCode(seq) {
  return `P-${String(seq).padStart(4, '0')}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ---------- Toast notifications ----------
let toastContainer = null;
export function toast(message, type = 'info', duration = 3200) {
  if (!toastContainer) toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  const icon = { success: '✓', error: '✕', info: 'ℹ', warning: '!' }[type] || 'ℹ';
  el.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--in'));
  setTimeout(() => {
    el.classList.remove('toast--in');
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

// ---------- Confirmation dialog (promise based) ----------
export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal modal--sm" role="dialog" aria-modal="true">
        <div class="modal__header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="modal__body">
          <p>${escapeHtml(message)}</p>
        </div>
        <div class="modal__footer">
          <button class="btn btn--ghost" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    root.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('modal-backdrop--in'));

    function close(result) {
      wrap.classList.remove('modal-backdrop--in');
      setTimeout(() => wrap.remove(), 180);
      resolve(result);
    }
    wrap.addEventListener('click', e => {
      if (e.target === wrap) close(false);
      const act = e.target.closest('[data-act]');
      if (!act) return;
      close(act.dataset.act === 'ok');
    });
  });
}

// ---------- File download / upload ----------
export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ---------- CSV ----------
/** Minimal CSV parser supporting quoted fields with commas. Returns array of row arrays. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCSVField(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows) {
  return rows.map(r => r.map(toCSVField).join(',')).join('\r\n');
}
