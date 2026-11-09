// Store de sesiones persistente en archivo JSON (escritura atómica)
const session = require('express-session');
const fs = require('fs');

class FileSessionStore extends session.Store {
  constructor({ file, ttlMs = 7 * 24 * 3600 * 1000, flushDelayMs = 400 } = {}) {
    super();
    this.file = file; this.ttlMs = ttlMs; this.flushDelayMs = flushDelayMs;
    this.map = new Map(); this._timer = null;
    this._load();
    const t = setInterval(() => this._prune(), 10 * 60 * 1000);
    if (t.unref) t.unref();
  }
  _load() {
    try {
      const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [sid, v] of Object.entries(obj)) this.map.set(sid, v);
      this._prune();
    } catch (_) { /* archivo inexistente o corrupto: empezar vacío */ }
  }
  _prune() {
    const now = Date.now(); let changed = false;
    for (const [sid, v] of this.map) if (!v || v.exp <= now) { this.map.delete(sid); changed = true; }
    if (changed) this._schedule();
  }
  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flushSync(); }, this.flushDelayMs);
    if (this._timer.unref) this._timer.unref();
  }
  flushSync() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('No se pudo guardar sesiones:', e.message); }
  }
  _exp(sess) {
    const c = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : 0;
    return c || Date.now() + this.ttlMs;
  }
  get(sid, cb) {
    const v = this.map.get(sid);
    if (!v) return cb(null, null);
    if (v.exp <= Date.now()) { this.map.delete(sid); this._schedule(); return cb(null, null); }
    try { cb(null, JSON.parse(v.data)); } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    this.map.set(sid, { data: JSON.stringify(sess), exp: this._exp(sess) });
    this._schedule(); cb && cb(null);
  }
  touch(sid, sess, cb) {
    const v = this.map.get(sid);
    if (v) { v.exp = this._exp(sess); this._schedule(); }
    cb && cb(null);
  }
  destroy(sid, cb) { this.map.delete(sid); this._schedule(); cb && cb(null); }
}
module.exports = FileSessionStore;
