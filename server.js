const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Variables de entorno desde .env ───────────────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
    if (!line || line.trim().startsWith('#')) return;
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const express        = require('express');
const session        = require('express-session');
const passport       = require('passport');
const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');
const { getDb, all, get, run, claimOrphanGames } = require('./database/db');
const FileSessionStore = require('./lib/session-store');
const { securityHeaders, csrfGuard } = require('./lib/security');
const V = require('./lib/validate');
const { normEstado } = require('./lib/estado');

const app  = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// ── Secreto de sesión: del entorno, o generado una vez y guardado (nunca fijo en el código)
function loadSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  const f = path.join(__dirname, '.session-secret');
  try {
    const s = fs.readFileSync(f, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch (_) {}
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  console.log('🔐 Se generó un SESSION_SECRET aleatorio en .session-secret');
  return s;
}

if (IS_PROD || process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '5mb' }));
app.use(csrfGuard((process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)));
app.use(session({
  name: 'gv.sid',
  secret: loadSessionSecret(),
  resave: false,
  saveUninitialized: false,
  store: new FileSessionStore({ file: process.env.GAMEVAULT_SESSIONS || path.join(__dirname, 'sessions.json') }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD
  }
}));
app.use(passport.initialize());
app.use(passport.session());

const publicUser = u => ({ id: u.id, username: u.username, nombre: u.nombre, email: u.email, avatar: u.avatar });
const newToken = () => crypto.randomBytes(32).toString('hex');

function safeAvatar(url) {
  try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null; }
  catch (_) { return null; }
}

// Manejo uniforme de errores de validación
function fail(res, e) {
  if (e instanceof V.ValidationError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Error interno del servidor' });
}

// ── Passport ──────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const uid = V.toInt(id);
    if (!uid) return done(null, false);
    const db = await getDb();
    done(null, get(db, 'SELECT * FROM usuario WHERE id = ?', [uid]) || false);
  } catch (e) { done(e); }
});

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const db = await getDb();
    const user = get(db, 'SELECT * FROM usuario WHERE email = ? COLLATE NOCASE', [V.normEmail(email)]);
    if (!user) return done(null, false, { message: 'Email no registrado' });
    if (!user.password) return done(null, false, { message: 'Esta cuenta usa Google. Inicia sesión con Google.' });
    if (typeof password !== 'string') return done(null, false, { message: 'Contraseña incorrecta' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return done(null, false, { message: 'Contraseña incorrecta' });
    return done(null, user);
  } catch (e) { done(e); }
}));

if (GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, callbackURL: '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const db = await getDb();
      const email = V.normEmail(profile.emails && profile.emails[0] && profile.emails[0].value);
      const avatar = safeAvatar(profile.photos && profile.photos[0] && profile.photos[0].value);
      const nombre = String(profile.displayName || email.split('@')[0] || 'Usuario').slice(0, 80);
      let user = get(db, 'SELECT * FROM usuario WHERE google_id = ?', [profile.id]);
      if (!user && email) user = get(db, 'SELECT * FROM usuario WHERE email = ? COLLATE NOCASE', [email]);
      if (!user) {
        const r = run(db, 'INSERT INTO usuario (nombre, email, google_id, avatar) VALUES (?, ?, ?, ?)',
          [nombre, email, profile.id, avatar]);
        user = get(db, 'SELECT * FROM usuario WHERE id = ?', [r.lastInsertRowid]);
        if (get(db, 'SELECT COUNT(*) AS n FROM usuario').n === 1) claimOrphanGames(db, user.id);
      } else if (!user.google_id) {
        run(db, 'UPDATE usuario SET google_id = ?, avatar = ? WHERE id = ?', [profile.id, avatar, user.id]);
        user = get(db, 'SELECT * FROM usuario WHERE id = ?', [user.id]);
      }
      return done(null, user);
    } catch (e) { done(e); }
  }));
}

// ── Rate limiting ─────────────────────────────────────────────
const buckets = new Map(); // clave -> { count, resetAt }
function hit(key, windowMs) {
  const now = Date.now();
  let d = buckets.get(key);
  if (!d || now > d.resetAt) d = { count: 0, resetAt: now + windowMs };
  d.count++; buckets.set(key, d);
  return d.count;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, d] of buckets) if (now > d.resetAt) buckets.delete(k);
}, 5 * 60 * 1000).unref();

// ── Middleware auth ───────────────────────────────────────────
async function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'No autenticado' });
  try {
    const db = await getDb();
    const row = get(db, 'SELECT session_token FROM usuario WHERE id = ?', [req.user.id]);
    const stored = row ? row.session_token : null;
    const mine = req.session.userToken || null;
    if (stored && mine && stored !== mine) {
      return req.logout(() => res.status(401).json({ error: 'Sesión expirada. Inicia sesión nuevamente.' }));
    }
    next();
  } catch (e) { fail(res, e); }
}

// Login: iniciar sesión + token de invalidación
function startSession(req, res, user) {
  req.login(user, async err => {
    if (err) return fail(res, err);
    try {
      const db = await getDb();
      const token = newToken();
      run(db, 'UPDATE usuario SET session_token = ? WHERE id = ?', [token, user.id]);
      req.session.userToken = token;
      res.json({ ok: true, user: publicUser(user) });
    } catch (e) { fail(res, e); }
  });
}

// ── Autenticación ─────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  try {
    if (hit('reg:' + req.ip, 60 * 60 * 1000) > 10)
      return res.status(429).json({ error: 'Demasiados registros desde esta red. Intenta más tarde.' });
    const db = await getDb();
    const nombre = V.readText(req.body, 'nombre', 80, { required: true, label: 'El nombre' });
    const email = V.normEmail(req.body.email);
    const password = req.body.password;
    if (!email || typeof password !== 'string') throw new V.ValidationError('Todos los campos son obligatorios');
    if (password.length < 6) throw new V.ValidationError('La contraseña debe tener al menos 6 caracteres');
    if (password.length > 200) throw new V.ValidationError('La contraseña es demasiado larga');
    if (!V.isValidEmail(email)) throw new V.ValidationError('El formato del email no es válido (ej: usuario@dominio.com)');
    if (get(db, 'SELECT id FROM usuario WHERE email = ? COLLATE NOCASE', [email]))
      throw new V.ValidationError('El email ya está registrado');
    const hash = await bcrypt.hash(password, 10);
    const r = run(db, 'INSERT INTO usuario (nombre, email, password) VALUES (?, ?, ?)', [nombre, email, hash]);
    const user = get(db, 'SELECT * FROM usuario WHERE id = ?', [r.lastInsertRowid]);
    if (get(db, 'SELECT COUNT(*) AS n FROM usuario').n === 1) claimOrphanGames(db, user.id);
    startSession(req, res, user);
  } catch (e) { fail(res, e); }
});

app.post('/auth/login', (req, res, next) => {
  const ip = req.ip || 'unknown';
  if (hit('login:' + ip, 15 * 60 * 1000) > 10)
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.' });
  passport.authenticate('local', (err, user, info) => {
    if (err) return fail(res, err);
    if (!user) return res.status(401).json({ error: (info && info.message) || 'Credenciales inválidas' });
    buckets.delete('login:' + ip);
    startSession(req, res, user);
  })(req, res, next);
});

if (GOOGLE_CLIENT_ID) {
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html?error=google' }),
    async (req, res) => {
      try {
        const db = await getDb();
        const token = newToken();
        run(db, 'UPDATE usuario SET session_token = ? WHERE id = ?', [token, req.user.id]);
        req.session.userToken = token;
        res.redirect('/');
      } catch (e) { res.redirect('/login.html?error=google'); }
    });
} else {
  app.get('/auth/google', (req, res) => res.redirect('/login.html?error=no_google'));
  app.get('/auth/google/callback', (req, res) => res.redirect('/login.html?error=no_google'));
}
app.get('/auth/google-available', (req, res) => res.json({ available: !!GOOGLE_CLIENT_ID }));

app.post('/auth/logout', (req, res) => {
  req.logout(() => req.session.destroy(() => { res.clearCookie('gv.sid'); res.json({ ok: true }); }));
});

app.get('/auth/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

app.post('/auth/change-password', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { currentPassword, newPassword } = req.body;
    const user = get(db, 'SELECT * FROM usuario WHERE id = ?', [req.user.id]);
    if (!user.password) throw new V.ValidationError('Esta cuenta usa Google. No puedes cambiar la contraseña.');
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword)
      throw new V.ValidationError('Completa todos los campos');
    if (newPassword.length < 6) throw new V.ValidationError('La nueva contraseña debe tener al menos 6 caracteres');
    if (newPassword.length > 200) throw new V.ValidationError('La contraseña es demasiado larga');
    if (!(await bcrypt.compare(currentPassword, user.password))) throw new V.ValidationError('La contraseña actual es incorrecta', 401);
    const hash = await bcrypt.hash(newPassword, 10);
    const token = newToken();
    run(db, 'UPDATE usuario SET password = ?, session_token = ? WHERE id = ?', [hash, token, req.user.id]);
    req.session.userToken = token;
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/auth/change-nombre', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const nombre = V.readText(req.body, 'nombre', 80, { required: true, label: 'El nombre' });
    run(db, 'UPDATE usuario SET nombre = ? WHERE id = ?', [nombre, req.user.id]);
    res.json({ ok: true, nombre });
  } catch (e) { fail(res, e); }
});

app.post('/auth/change-username', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const raw = V.readText(req.body, 'username', 30, { required: true, label: 'El username' });
    const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (safe.length < 3) throw new V.ValidationError('El username debe tener al menos 3 caracteres (letras, números, _ . -)');
    if (get(db, 'SELECT id FROM usuario WHERE LOWER(username) = LOWER(?) AND id != ?', [safe, req.user.id]))
      throw new V.ValidationError('Ese username ya está en uso');
    run(db, 'UPDATE usuario SET username = ? WHERE id = ?', [safe, req.user.id]);
    res.json({ ok: true, username: safe });
  } catch (e) { fail(res, e); }
});

// ── AMIGOS ────────────────────────────────────────────────────
function areFriends(db, a, b) {
  return !!get(db, `SELECT id FROM amistad WHERE estado = 'aceptada'
    AND ((solicitante = ? AND receptor = ?) OR (solicitante = ? AND receptor = ?))`, [a, b, b, a]);
}
function friendId(req) {
  const id = V.toInt(req.params.amigo_id);
  if (!id) throw new V.ValidationError('ID inválido');
  return id;
}

app.get('/api/usuarios/buscar', requireAuth, async (req, res) => {
  try {
    if (hit('search:' + req.user.id, 60 * 1000) > 30) return res.status(429).json({ error: 'Demasiadas búsquedas, espera un momento' });
    const db = await getDb();
    const q = V.qstr(req.query.q, 30);
    if (q.length < 2) return res.json([]);
    res.json(all(db, `SELECT id, username, nombre, avatar FROM usuario
      WHERE username LIKE ? ESCAPE '\\' AND id != ? LIMIT 10`, [V.likePattern(q), req.user.id]));
  } catch (e) { fail(res, e); }
});

app.post('/api/amigos/solicitar', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id;
    const rid = V.toInt(req.body.receptor_id);
    if (!rid || rid === uid) throw new V.ValidationError('ID inválido');
    if (!get(db, 'SELECT id FROM usuario WHERE id = ?', [rid])) throw new V.ValidationError('Usuario no encontrado', 404);
    if (get(db, `SELECT id FROM amistad WHERE (solicitante = ? AND receptor = ?) OR (solicitante = ? AND receptor = ?)`, [uid, rid, rid, uid]))
      throw new V.ValidationError('Ya existe una solicitud o amistad con este usuario');
    run(db, `INSERT INTO amistad (solicitante, receptor, estado) VALUES (?, ?, 'pendiente')`, [uid, rid]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/amigos/responder', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id;
    const aid = V.toInt(req.body.amistad_id);
    if (!aid) throw new V.ValidationError('ID inválido');
    const sol = get(db, `SELECT * FROM amistad WHERE id = ? AND receptor = ? AND estado = 'pendiente'`, [aid, uid]);
    if (!sol) throw new V.ValidationError('Solicitud no encontrada', 404);
    if (req.body.accion === 'aceptar') {
      run(db, `UPDATE amistad SET estado = 'aceptada' WHERE id = ?`, [aid]);
      run(db, 'INSERT OR IGNORE INTO privacidad_amigo (usuario_id, amigo_id) VALUES (?, ?)', [uid, sol.solicitante]);
      run(db, 'INSERT OR IGNORE INTO privacidad_amigo (usuario_id, amigo_id) VALUES (?, ?)', [sol.solicitante, uid]);
    } else {
      run(db, 'DELETE FROM amistad WHERE id = ?', [aid]);
    }
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.delete('/api/amigos/:amigo_id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id, fid = friendId(req);
    run(db, `DELETE FROM amistad WHERE (solicitante = ? AND receptor = ?) OR (solicitante = ? AND receptor = ?)`, [uid, fid, fid, uid]);
    run(db, `DELETE FROM privacidad_amigo WHERE (usuario_id = ? AND amigo_id = ?) OR (usuario_id = ? AND amigo_id = ?)`, [uid, fid, fid, uid]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.get('/api/amigos', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id;
    const rows = all(db, `SELECT a.id AS amistad_id, a.estado,
        CASE WHEN a.solicitante = ? THEN a.receptor ELSE a.solicitante END AS amigo_id,
        CASE WHEN a.solicitante = ? THEN 'enviada' ELSE 'recibida' END AS direccion
      FROM amistad a WHERE a.solicitante = ? OR a.receptor = ?`, [uid, uid, uid, uid]);
    res.json(rows.map(a => ({
      ...a, usuario: get(db, 'SELECT id, username, nombre, avatar FROM usuario WHERE id = ?', [a.amigo_id])
    })));
  } catch (e) { fail(res, e); }
});

app.get('/api/amigos/:amigo_id/privacidad', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const priv = get(db, 'SELECT * FROM privacidad_amigo WHERE usuario_id = ? AND amigo_id = ?', [req.user.id, friendId(req)]);
    res.json(priv || { ver_coleccion: 1, ver_jugando: 1, ver_buscados: 1 });
  } catch (e) { fail(res, e); }
});

app.put('/api/amigos/:amigo_id/privacidad', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id, fid = friendId(req);
    if (!areFriends(db, uid, fid)) throw new V.ValidationError('No son amigos', 403);
    const b = req.body || {};
    run(db, `INSERT OR REPLACE INTO privacidad_amigo (usuario_id, amigo_id, ver_coleccion, ver_jugando, ver_buscados)
      VALUES (?, ?, ?, ?, ?)`, [uid, fid, b.ver_coleccion ? 1 : 0, b.ver_jugando ? 1 : 0, b.ver_buscados ? 1 : 0]);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.get('/api/amigos/:amigo_id/coleccion', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id, fid = friendId(req);
    if (!areFriends(db, uid, fid)) throw new V.ValidationError('No son amigos', 403);
    const priv = get(db, 'SELECT * FROM privacidad_amigo WHERE usuario_id = ? AND amigo_id = ?', [fid, uid]);
    const vc = !priv || priv.ver_coleccion, vj = !priv || priv.ver_jugando, vb = !priv || priv.ver_buscados;
    const result = {};
    if (vc) result.coleccion = all(db, `SELECT * FROM juego WHERE usuario_id = ? AND posesion = 'coleccion' ORDER BY plataforma, nombre`, [fid]);
    if (vj) result.jugando = all(db, `SELECT * FROM juego WHERE usuario_id = ? AND LOWER(TRIM(estado)) = 'jugando' AND posesion = 'coleccion' ORDER BY nombre`, [fid]);
    if (vb) result.buscados = all(db, `SELECT * FROM juego WHERE usuario_id = ? AND posesion = 'buscado' ORDER BY nombre`, [fid]);
    result.privacidad = { ver_coleccion: vc ? 1 : 0, ver_jugando: vj ? 1 : 0, ver_buscados: vb ? 1 : 0 };
    result.amigo = get(db, 'SELECT id, username, nombre, avatar FROM usuario WHERE id = ?', [fid]);
    res.json(result);
  } catch (e) { fail(res, e); }
});

// ── Backup ────────────────────────────────────────────────────
app.get('/api/backup', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const juegos = all(db, 'SELECT * FROM juego WHERE usuario_id = ? ORDER BY id', [req.user.id]);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gamevault_backup_${req.user.id}_${Date.now()}.json"`);
    res.send(JSON.stringify({
      exportado_en: new Date().toISOString(),
      usuario: { id: req.user.id, nombre: req.user.nombre, email: req.user.email },
      total_juegos: juegos.length, juegos
    }, null, 2));
  } catch (e) { fail(res, e); }
});

// Campos de un juego, validados (compartido por restore / alta / edición)
function readGame(body, { partial = false } = {}) {
  const g = {
    nombre:         V.readText(body, 'nombre', 200, { required: !partial, label: 'El nombre' }),
    plataforma:     V.readText(body, 'plataforma', 60),
    desarrolladora: V.readText(body, 'desarrolladora', 120),
    anio:           V.readAnio(body),
    genero:         V.readText(body, 'genero', 80),
    clasificacion:  V.readText(body, 'clasificacion', 40),
    num_jugadores:  V.readText(body, 'num_jugadores', 40),
    estado:         V.readText(body, 'estado', 30),
    region:         V.readText(body, 'region', 40),
    contenido:      V.readText(body, 'contenido', 60),
    exclusividad:   V.readText(body, 'exclusividad', 10),
    pila:           V.readText(body, 'pila', 10),
    nota:           V.readNota(body)
  };
  if (g.estado) g.estado = normEstado(g.estado) || g.estado;
  return g;
}

app.post('/api/backup/restore', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const uid = req.user.id;
    const juegos = req.body.juegos;
    if (!Array.isArray(juegos)) throw new V.ValidationError('Formato inválido');
    if (juegos.length > 20000) throw new V.ValidationError('Demasiados juegos en el backup');
    let ok = 0, omitidos = 0;
    for (const raw of juegos) {
      try {
        if (!raw || typeof raw !== 'object') throw new V.ValidationError('x');
        const g = readGame(raw);
        const pos = raw.posesion === 'buscado' ? 'buscado' : 'coleccion';
        run(db, `INSERT INTO juego (usuario_id, nombre, plataforma, desarrolladora, anio, genero, clasificacion, num_jugadores, estado, posesion, region, contenido, exclusividad, pila, nota)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid, g.nombre, g.plataforma, g.desarrolladora, g.anio, g.genero, g.clasificacion, g.num_jugadores,
           g.estado || 'pendiente', pos, g.region, g.contenido, g.exclusividad, g.pila, g.nota]);
        ok++;
      } catch (e) {
        if (e instanceof V.ValidationError) omitidos++; else throw e;
      }
    }
    res.json({ ok: true, importados: ok, omitidos });
  } catch (e) { fail(res, e); }
});

app.get('/api/notificaciones', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const solicitudes = all(db, `SELECT a.id, a.solicitante, u.nombre, u.username, u.avatar
      FROM amistad a JOIN usuario u ON u.id = a.solicitante
      WHERE a.receptor = ? AND a.estado = 'pendiente'`, [req.user.id]);
    res.json({ solicitudes, total: solicitudes.length });
  } catch (e) { fail(res, e); }
});

// ── Página principal: exige sesión ANTES de servir estáticos ──
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => res.redirect('/'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── API juegos ────────────────────────────────────────────────
function gameId(req) {
  const id = V.toInt(req.params.id);
  if (!id) throw new V.ValidationError('ID inválido');
  return id;
}

app.get('/api/juegos', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { q, plataforma, genero, estado, num_jugadores, posesion } = req.query;
    const params = [req.user.id, posesion === 'buscado' ? 'buscado' : 'coleccion'];
    let sql = 'SELECT * FROM juego WHERE usuario_id = ? AND posesion = ?';
    const like = (col, val) => { sql += ` AND LOWER(${col}) LIKE LOWER(?) ESCAPE '\\'`; params.push(V.likePattern(val)); };
    if (V.qstr(q))             { const p = V.likePattern(V.qstr(q));
      sql += ` AND (LOWER(nombre) LIKE LOWER(?) ESCAPE '\\' OR LOWER(desarrolladora) LIKE LOWER(?) ESCAPE '\\')`; params.push(p, p); }
    if (V.qstr(plataforma))    { sql += ' AND LOWER(plataforma) = LOWER(?)'; params.push(V.qstr(plataforma)); }
    if (V.qstr(genero))        like('genero', V.qstr(genero));
    if (V.qstr(estado))        like('TRIM(estado)', V.qstr(estado));
    if (V.qstr(num_jugadores)) like('num_jugadores', V.qstr(num_jugadores));
    sql += ' ORDER BY plataforma ASC, nombre ASC';
    res.json(all(db, sql, params));
  } catch (e) { fail(res, e); }
});

app.get('/api/juegos/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const juego = get(db, 'SELECT * FROM juego WHERE id = ? AND usuario_id = ?', [gameId(req), req.user.id]);
    if (!juego) throw new V.ValidationError('Juego no encontrado', 404);
    res.json(juego);
  } catch (e) { fail(res, e); }
});

app.post('/api/juegos', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const g = readGame(req.body);
    const pos = req.body.posesion === 'buscado' ? 'buscado' : 'coleccion';
    const r = run(db, `INSERT INTO juego (usuario_id, nombre, plataforma, desarrolladora, anio, genero, clasificacion, num_jugadores, estado, posesion, region, contenido, exclusividad, pila, nota)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, g.nombre, g.plataforma, g.desarrolladora, g.anio, g.genero, g.clasificacion, g.num_jugadores,
       g.estado || 'pendiente', pos, g.region, g.contenido, g.exclusividad, g.pila, g.nota]);
    res.status(201).json(get(db, 'SELECT * FROM juego WHERE id = ?', [r.lastInsertRowid]));
  } catch (e) { fail(res, e); }
});

app.put('/api/juegos/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const id = gameId(req);
    const juego = get(db, 'SELECT * FROM juego WHERE id = ? AND usuario_id = ?', [id, req.user.id]);
    if (!juego) throw new V.ValidationError('Juego no encontrado', 404);
    const g = readGame(req.body, { partial: true });
    if (g.nombre === null) throw new V.ValidationError('El nombre no puede estar vacío');
    const v = (n, o) => (n !== undefined ? n : o);
    run(db, `UPDATE juego SET nombre = ?, plataforma = ?, desarrolladora = ?, anio = ?, genero = ?, clasificacion = ?,
        num_jugadores = ?, estado = ?, region = ?, contenido = ?, exclusividad = ?, pila = ?, nota = ? WHERE id = ? AND usuario_id = ?`,
      [v(g.nombre, juego.nombre), v(g.plataforma, juego.plataforma), v(g.desarrolladora, juego.desarrolladora),
       v(g.anio, juego.anio), v(g.genero, juego.genero), v(g.clasificacion, juego.clasificacion),
       v(g.num_jugadores, juego.num_jugadores), v(g.estado === null ? undefined : g.estado, juego.estado),
       v(g.region, juego.region), v(g.contenido, juego.contenido),
       v(g.exclusividad, juego.exclusividad), v(g.pila, juego.pila), v(g.nota, juego.nota), id, req.user.id]);
    res.json(get(db, 'SELECT * FROM juego WHERE id = ? AND usuario_id = ?', [id, req.user.id]));
  } catch (e) { fail(res, e); }
});

// Vaciar TODA la lista del usuario (colección y buscados). Requiere confirmación explícita.
app.delete('/api/juegos', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    if (!req.body || req.body.confirmar !== 'ELIMINAR') throw new V.ValidationError('Falta la confirmación');
    const r = run(db, 'DELETE FROM juego WHERE usuario_id = ?', [req.user.id]);
    res.json({ ok: true, eliminados: r.changes });
  } catch (e) { fail(res, e); }
});

app.delete('/api/juegos/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const r = run(db, 'DELETE FROM juego WHERE id = ? AND usuario_id = ?', [gameId(req), req.user.id]);
    if (!r.changes) throw new V.ValidationError('Juego no encontrado', 404);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const rows = all(db, `SELECT estado, posesion FROM juego WHERE usuario_id = ?`, [req.user.id]);
    const out = { total: 0, completado: 0, jugando: 0, pendiente: 0, buscados: 0 };
    for (const g of rows) {
      if (g.posesion === 'buscado') { out.buscados++; continue; }
      out.total++;
      const e = normEstado(g.estado);
      if (e === 'Completado') out.completado++;
      else if (e === 'Jugando') out.jugando++;
      else out.pendiente++;      // Pendiente, Abandonado o sin estado
    }
    res.json(out);
  } catch (e) { fail(res, e); }
});

app.get('*', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Archivo demasiado grande' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

getDb().then(() => {
  app.listen(PORT, () => console.log(`\n🎮 GameVault corriendo en http://localhost:${PORT}\n`));
});
