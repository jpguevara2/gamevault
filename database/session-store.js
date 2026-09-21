const session = require('express-session');
const fs      = require('fs');
const path    = require('path');

// Store de sesiones persistente en un archivo JSON. Reemplaza al MemoryStore por defecto
// de express-session, que pierde todas las sesiones al reiniciar el servidor (y `npm start`
// usa `node --watch`, que reinicia con cada cambio de código).
//
// Las sesiones viven en memoria y se escriben a disco solo cuando cambian (login, logout,
// registro, cambio de contraseña), no en cada request. Como no implementa touch(), el
// vencimiento cuenta desde la última vez que se guardó la sesión, igual que la cookie.
class FileStore extends session.Store {
  constructor(file) {
    super();
    this.file     = file;
    this.sessions = new Map(); // sid -> sesión serializada (JSON), como hace MemoryStore
    this._load();
    // Limpia sesiones vencidas cada hora
    setInterval(() => this._prune(), 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    const raw = this.sessions.get(sid);
    if (!raw) return cb(null, null);
    const sess = JSON.parse(raw);
    if (this._expired(sess)) {
      this.sessions.delete(sid);
      this._persist();
      return cb(null, null);
    }
    cb(null, sess);
  }

  set(sid, sess, cb) {
    this.sessions.set(sid, JSON.stringify(sess));
    this._persist();
    cb && cb(null);
  }

  destroy(sid, cb) {
    this.sessions.delete(sid);
    this._persist();
    cb && cb(null);
  }

  _expired(sess) {
    const exp = sess.cookie && sess.cookie.expires;
    return !!exp && new Date(exp).getTime() <= Date.now();
  }

  _prune() {
    let changed = false;
    for (const [sid, raw] of this.sessions) {
      if (this._expired(JSON.parse(raw))) { this.sessions.delete(sid); changed = true; }
    }
    if (changed) this._persist();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [sid, raw] of Object.entries(data)) this.sessions.set(sid, raw);
      this._prune();
    } catch (_) { /* sin archivo todavía o ilegible: se empieza sin sesiones */ }
  }

  // Escritura atómica (archivo temporal + rename) para no dejar el JSON a medias si el
  // proceso se corta justo al escribir.
  _persist() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.sessions)));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('No se pudieron guardar las sesiones:', e.message);
    }
  }
}

module.exports = { FileStore, SESSIONS_PATH: path.join(__dirname, 'sessions.json') };
