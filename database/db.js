const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = process.env.GAMEVAULT_DB || path.join(__dirname, 'gamevault.db');
let _db = null;
let _dbPromise = null;

function _params(p) { return (p || []).map(v => (v === undefined ? null : v)); }

function all(db, sql, params) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(_params(params));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally { stmt.free(); }
}
function get(db, sql, params) { return all(db, sql, params)[0] || null; }

function run(db, sql, params) {
  const stmt = db.prepare(sql);
  try { stmt.bind(_params(params)); stmt.step(); } finally { stmt.free(); }
  const changes = db.getRowsModified();
  const row = all(db, 'SELECT last_insert_rowid() AS id')[0];
  save();
  return { lastInsertRowid: row ? row.id : null, changes };
}

// Guardado atómico: archivo temporal + rename
function save() {
  if (!_db) return;
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(_db.export()));
  fs.renameSync(tmp, DB_PATH);
}

// Punto 4: asignar juegos huérfanos (sin dueño) al primer usuario registrado
function claimOrphanGames(db, userId) {
  const target = userId || (get(db, 'SELECT MIN(id) AS id FROM usuario') || {}).id;
  if (!target) return 0;
  const n = get(db, 'SELECT COUNT(*) AS n FROM juego WHERE usuario_id IS NULL').n;
  if (!n) return 0;
  run(db, 'UPDATE juego SET usuario_id = ? WHERE usuario_id IS NULL', [target]);
  console.log(`🎮 ${n} juego(s) sin dueño asignados al usuario #${target}`);
  return n;
}

async function getDb() {
  if (_db) return _db;
  if (_dbPromise) return _dbPromise;
  _dbPromise = (async () => {
    const SQL = await initSqlJs();
    _db = fs.existsSync(DB_PATH)
      ? new SQL.Database(fs.readFileSync(DB_PATH))
      : new SQL.Database();

    _db.run(`CREATE TABLE IF NOT EXISTS usuario (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nombre TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE, password TEXT, google_id TEXT, avatar TEXT,
      creado_en TEXT DEFAULT (datetime('now')))`);
    _db.run(`CREATE TABLE IF NOT EXISTS juego (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL REFERENCES usuario(id),
      nombre TEXT NOT NULL, plataforma TEXT, desarrolladora TEXT, anio INTEGER, genero TEXT,
      clasificacion TEXT, num_jugadores TEXT, estado TEXT NOT NULL DEFAULT 'pendiente',
      posesion TEXT NOT NULL DEFAULT 'coleccion', region TEXT, contenido TEXT, exclusividad TEXT, pila TEXT, nota REAL,
      creado_en TEXT DEFAULT (datetime('now')))`);
    _db.run(`CREATE TABLE IF NOT EXISTS amistad (
      id INTEGER PRIMARY KEY AUTOINCREMENT, solicitante INTEGER NOT NULL REFERENCES usuario(id),
      receptor INTEGER NOT NULL REFERENCES usuario(id), estado TEXT NOT NULL DEFAULT 'pendiente',
      creado_en TEXT DEFAULT (datetime('now')), UNIQUE(solicitante, receptor))`);
    _db.run(`CREATE TABLE IF NOT EXISTS privacidad_amigo (
      id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL REFERENCES usuario(id),
      amigo_id INTEGER NOT NULL REFERENCES usuario(id),
      ver_coleccion INTEGER NOT NULL DEFAULT 1, ver_jugando INTEGER NOT NULL DEFAULT 1,
      ver_buscados INTEGER NOT NULL DEFAULT 1, UNIQUE(usuario_id, amigo_id))`);

    // Migraciones de bases antiguas
    const jCols = all(_db, 'PRAGMA table_info(juego)').map(c => c.name);
    [['region','TEXT'],['contenido','TEXT'],['usuario_id','INTEGER'],['exclusividad','TEXT'],['pila','TEXT'],['nota','REAL']].forEach(([c,t]) => {
      if (!jCols.includes(c)) _db.run(`ALTER TABLE juego ADD COLUMN ${c} ${t}`);
    });
    const uCols = all(_db, 'PRAGMA table_info(usuario)').map(c => c.name);
    [['username','TEXT'],['session_token','TEXT']].forEach(([c,t]) => {
      if (!uCols.includes(c)) _db.run(`ALTER TABLE usuario ADD COLUMN ${c} ${t}`);
    });

    // Normalizar estados guardados (Terminado -> Completado, etc.)
    try {
      const { normEstado } = require('../lib/estado');
      let fixed = 0;
      for (const g of all(_db, 'SELECT id, estado FROM juego')) {
        const n = normEstado(g.estado);
        if (n && n !== g.estado) { _db.run('UPDATE juego SET estado = ? WHERE id = ?', [n, g.id]); fixed++; }
      }
      if (fixed) console.log(`🎮 ${fixed} estado(s) normalizados`);
    } catch (e) { console.error('Normalización de estados:', e.message); }
    save();
    claimOrphanGames(_db);
    return _db;
  })();
  return _dbPromise;
}

module.exports = { getDb, all, get, run, claimOrphanGames };
