const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = path.join(__dirname, 'gamevault.db');
let _db = null;

async function getDb() {
  if (_db) return _db;
  const SQL = await initSqlJs();
  _db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  _db.run(`
    CREATE TABLE IF NOT EXISTS usuario (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT UNIQUE,
      nombre       TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      password     TEXT,
      google_id    TEXT,
      avatar       TEXT,
      creado_en    TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS juego (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id     INTEGER NOT NULL REFERENCES usuario(id),
      nombre         TEXT NOT NULL,
      plataforma     TEXT,
      desarrolladora TEXT,
      anio           INTEGER,
      genero         TEXT,
      clasificacion  TEXT,
      num_jugadores  TEXT,
      estado         TEXT NOT NULL DEFAULT 'pendiente',
      posesion       TEXT NOT NULL DEFAULT 'coleccion',
      region         TEXT,
      contenido      TEXT,
      creado_en      TEXT DEFAULT (datetime('now'))
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS amistad (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitante   INTEGER NOT NULL REFERENCES usuario(id),
      receptor      INTEGER NOT NULL REFERENCES usuario(id),
      estado        TEXT NOT NULL DEFAULT 'pendiente',
      creado_en     TEXT DEFAULT (datetime('now')),
      UNIQUE(solicitante, receptor)
    )
  `);

  _db.run(`
    CREATE TABLE IF NOT EXISTS privacidad_amigo (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id      INTEGER NOT NULL REFERENCES usuario(id),
      amigo_id        INTEGER NOT NULL REFERENCES usuario(id),
      ver_coleccion   INTEGER NOT NULL DEFAULT 1,
      ver_jugando     INTEGER NOT NULL DEFAULT 1,
      ver_buscados    INTEGER NOT NULL DEFAULT 1,
      UNIQUE(usuario_id, amigo_id)
    )
  `);

  // Migraciones
  const cols = _exec(_db, 'PRAGMA table_info(juego)');
  const jMigs = [
    ['region',     'ALTER TABLE juego ADD COLUMN region TEXT'],
    ['contenido',  'ALTER TABLE juego ADD COLUMN contenido TEXT'],
    ['usuario_id', 'ALTER TABLE juego ADD COLUMN usuario_id INTEGER'],
  ];
  jMigs.forEach(([col, sql]) => {
    if (cols.length && !cols.find(c => c.name === col)) _db.run(sql);
  });

  const uCols = _exec(_db, 'PRAGMA table_info(usuario)');
  const uMigs = [
    ['username',      'ALTER TABLE usuario ADD COLUMN username TEXT'],
    ['session_token', 'ALTER TABLE usuario ADD COLUMN session_token TEXT'],
  ];
  uMigs.forEach(([col, sql]) => {
    if (uCols.length && !uCols.find(c => c.name === col)) _db.run(sql);
  });

  save();
  return _db;
}

function save() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

function _exec(db, sql) {
  const results = db.exec(sql);
  if (!results || !results.length) return [];
  const { columns, values } = results[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function all(db, sql) { return _exec(db, sql); }
function get(db, sql) { return _exec(db, sql)[0] || null; }
function run(db, sql) {
  db.run(sql);
  save();
  const row = _exec(db, 'SELECT last_insert_rowid() as id')[0];
  return { lastInsertRowid: row ? row.id : null };
}

module.exports = { getDb, all, get, run };
