// db.js — LocalStorage persistence layer.
// Everything the app knows lives under a small set of keys. No backend, no network.

const KEYS = {
  TOURNAMENTS: 'ctms_tournaments_v1',
  SETTINGS: 'ctms_settings_v1',
  BACKUP: 'ctms_backup_v1'
};

/** Safely parse JSON from localStorage, falling back to a default value. */
function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[db] Failed to read "${key}" from storage:`, err);
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[db] Failed to write "${key}" to storage:`, err);
    return false;
  }
}

export const DB = {
  /** Returns the full array of tournaments. */
  getAll() {
    return safeGet(KEYS.TOURNAMENTS, []);
  },

  /** Returns a single tournament by id, or null. */
  getById(id) {
    return this.getAll().find(t => t.id === id) || null;
  },

  /** Persists the full tournament array and writes a rolling backup copy. */
  saveAll(tournaments) {
    const ok = safeSet(KEYS.TOURNAMENTS, tournaments);
    if (ok) this.writeBackup(tournaments);
    return ok;
  },

  /** Inserts or updates a single tournament (matched by id). */
  upsert(tournament) {
    const all = this.getAll();
    const idx = all.findIndex(t => t.id === tournament.id);
    tournament.updatedAt = new Date().toISOString();
    if (idx >= 0) all[idx] = tournament;
    else all.push(tournament);
    this.saveAll(all);
    return tournament;
  },

  /** Removes a tournament permanently. */
  remove(id) {
    const all = this.getAll().filter(t => t.id !== id);
    this.saveAll(all);
  },

  /** Keeps a single most-recent auto-backup so a bad edit can be recovered. */
  writeBackup(tournaments) {
    safeSet(KEYS.BACKUP, { savedAt: new Date().toISOString(), tournaments });
  },

  restoreBackup() {
    const backup = safeGet(KEYS.BACKUP, null);
    if (!backup) return false;
    this.saveAll(backup.tournaments);
    return true;
  },

  getBackupInfo() {
    const backup = safeGet(KEYS.BACKUP, null);
    return backup ? backup.savedAt : null;
  },

  getSettings() {
    return safeGet(KEYS.SETTINGS, {
      theme: 'dark',
      arbiterName: '',
      defaultTimeControl: '90+30'
    });
  },

  saveSettings(settings) {
    safeSet(KEYS.SETTINGS, settings);
  },

  /** Full export of every tournament, for a single JSON download. */
  exportAllJSON() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), tournaments: this.getAll() }, null, 2);
  },

  /** Import tournaments from a parsed JSON payload. Merges by id, keeping the newest updatedAt. */
  importJSON(payload, mode = 'merge') {
    const incoming = Array.isArray(payload) ? payload : (payload.tournaments || []);
    if (!Array.isArray(incoming)) throw new Error('Invalid tournament file: no tournaments array found.');

    if (mode === 'replace') {
      this.saveAll(incoming);
      return { added: incoming.length, updated: 0 };
    }

    const all = this.getAll();
    let added = 0, updated = 0;
    incoming.forEach(t => {
      const idx = all.findIndex(x => x.id === t.id);
      if (idx >= 0) {
        const existingTime = new Date(all[idx].updatedAt || 0).getTime();
        const incomingTime = new Date(t.updatedAt || 0).getTime();
        if (incomingTime >= existingTime) { all[idx] = t; updated++; }
      } else {
        all.push(t);
        added++;
      }
    });
    this.saveAll(all);
    return { added, updated };
  }
};
