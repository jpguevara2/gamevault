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
      estado         TEXT NOT NULL DEFAULT 'no terminado',
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
    ['region',       'ALTER TABLE juego ADD COLUMN region TEXT'],
    ['contenido',    'ALTER TABLE juego ADD COLUMN contenido TEXT'],
    ['usuario_id',   'ALTER TABLE juego ADD COLUMN usuario_id INTEGER'],
    ['exclusividad', 'ALTER TABLE juego ADD COLUMN exclusividad TEXT'],
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

  // Migración de datos: renombrar los valores de progreso del juego
  // "Completado" -> "Terminado" y "Pendiente" -> "No terminado" (idempotente:
  // una vez migradas las filas, LOWER(TRIM(estado)) ya no coincide con los valores
  // viejos y las siguientes ejecuciones no vuelven a tocarlas). Esto es solo sobre
  // la columna `estado` de la tabla `juego` (progreso del juego) — NO afecta a la
  // columna `estado` de la tabla `amistad` (solicitudes de amistad, valor 'pendiente'
  // independiente que no se debe tocar).
  _db.run(`UPDATE juego SET estado='Terminado' WHERE LOWER(TRIM(estado))='completado' AND estado != 'Terminado'`);
  _db.run(`UPDATE juego SET estado='No terminado' WHERE LOWER(TRIM(estado))='pendiente' AND estado != 'No terminado'`);
  // Normaliza también variantes de mayúsculas/minúsculas de los valores nuevos que ya
  // pudieran existir (p. ej. filas insertadas entre corridas de esta migración), para que
  // el valor mostrado en la Colección sea siempre exactamente "Terminado" / "No terminado".
  _db.run(`UPDATE juego SET estado='Terminado' WHERE LOWER(TRIM(estado))='terminado' AND estado != 'Terminado'`);
  _db.run(`UPDATE juego SET estado='No terminado' WHERE LOWER(TRIM(estado))='no terminado' AND estado != 'No terminado'`);

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
  const row = _exec(db, 'SELECT last_insert_rowid() as id')[0];
  save();
  return { lastInsertRowid: row ? row.id : null };
}

module.exports = { getDb, all, get, run };
