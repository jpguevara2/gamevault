// Cargar variables de entorno desde .env si existe
const fs_env = require('fs');
if (fs_env.existsSync('.env')) {
  fs_env.readFileSync('.env','utf8').replace(/^﻿/, '').split('\n').forEach(line => {
    const [k,...v] = line.split('=');
    if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

const express        = require('express');
const session        = require('express-session');
const passport       = require('passport');
const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');
const path           = require('path');
const { getDb, all, get, run } = require('./database/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Configuración ─────────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SESSION_SECRET       = process.env.SESSION_SECRET       || 'gamevault_secret_2024';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 días
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Passport: serialización ───────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const db   = await getDb();
    const user = get(db, `SELECT * FROM usuario WHERE id = ${id}`);
    done(null, user);
  } catch (e) { done(e); }
});

// ── Estrategia local ──────────────────────────────────────────
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const db   = await getDb();
    const se = safeEmail(email);
    const user = get(db, `SELECT * FROM usuario WHERE email = '${se}' COLLATE NOCASE`);
    if (!user) return done(null, false, { message: 'Email no registrado' });
    if (!user.password) return done(null, false, { message: 'Esta cuenta usa Google. Inicia sesión con Google.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return done(null, false, { message: 'Contraseña incorrecta' });
    return done(null, user);
  } catch (e) { done(e); }
}));

// ── Estrategia Google ─────────────────────────────────────────
if (GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID:     GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL:  '/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const db    = await getDb();
      const email = profile.emails[0].value;
      let user    = get(db, `SELECT * FROM usuario WHERE google_id = '${esc(profile.id)}'`);
      if (!user) { const se3 = safeEmail(email); user = get(db, `SELECT * FROM usuario WHERE email = '${se3}' COLLATE NOCASE`); }
      if (!user) {
        const result = run(db, `INSERT INTO usuario (nombre, email, google_id, avatar) VALUES (
          ${esc(profile.displayName)}, ${esc(email)}, ${esc(profile.id)},
          ${esc(profile.photos?.[0]?.value || null)})`);
        user = get(db, `SELECT * FROM usuario WHERE id = ${result.lastInsertRowid}`);
      } else if (!user.google_id) {
        run(db, `UPDATE usuario SET google_id = ${esc(profile.id)}, avatar = ${esc(profile.photos?.[0]?.value || null)} WHERE id = ${user.id}`);
        user = get(db, `SELECT * FROM usuario WHERE id = ${user.id}`);
      }
      return done(null, user);
    } catch (e) { done(e); }
  }));
}

// ── Helper escape ─────────────────────────────────────────────
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Sanitiza email para uso en SQL — elimina cualquier caracter problemático
function safeEmail(email) {
  return String(email || '').trim().toLowerCase().replace(/[^a-z0-9@._+\-]/gi, '');
}

// ── Rate limiting (login) ────────────────────────────────────
const loginAttempts = new Map(); // ip -> { count, resetAt }
function checkRateLimit(ip) {
  const now  = Date.now();
  const data = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > data.resetAt) { data.count = 0; data.resetAt = now + 15 * 60 * 1000; }
  data.count++;
  loginAttempts.set(ip, data);
  return data.count;
}
function resetRateLimit(ip) { loginAttempts.delete(ip); }
// Limpiar intentos viejos cada 15 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (now > data.resetAt) loginAttempts.delete(ip);
  }
}, 15 * 60 * 1000);

// ── Validación de email ───────────────────────────────────────
function isValidEmail(email) {
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(String(email || '').trim());
}

// ── Token de sesión para invalidación ────────────────────────
function getUserSessionToken(db, userId) {
  const row = get(db, `SELECT session_token FROM usuario WHERE id = ${userId}`);
  return row ? row.session_token : null;
}

// ── Middleware auth ───────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'No autenticado' });
  // Verificar que el token de sesión sigue siendo válido
  getDb().then(db => {
    const row = get(db, `SELECT session_token FROM usuario WHERE id = ${req.user.id}`);
    const storedToken = row ? row.session_token : null;
    const sessionToken = req.session.userToken || null;
    if (storedToken && sessionToken && storedToken !== sessionToken) {
      req.logout(() => {});
      return res.status(401).json({ error: 'Sesión expirada. Inicia sesión nuevamente.' });
    }
    next();
  }).catch(() => next());
}

// ── Rutas de autenticación ────────────────────────────────────

// Registro
app.post('/auth/register', async (req, res) => {
  try {
    const db = await getDb();
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (password.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'El formato del email no es válido (ej: usuario@dominio.com)' });
    const se2 = safeEmail(email);
    if (!se2 || !se2.includes('@')) return res.status(400).json({ error: 'Email inválido' });
    const existe = get(db, `SELECT id FROM usuario WHERE email = '${se2}' COLLATE NOCASE`);
    if (existe) return res.status(400).json({ error: 'El email ya está registrado' });
    const hash   = await bcrypt.hash(password, 10);
    const emailSafe = safeEmail(email);
    const result = run(db, `INSERT INTO usuario (nombre, email, password) VALUES (${esc(nombre)}, '${emailSafe}', ${esc(hash)})`);
    const user   = get(db, `SELECT * FROM usuario WHERE id = ${result.lastInsertRowid}`);
    req.login(user, async err => {
      if (err) return res.status(500).json({ error: err.message });
      const token = require('crypto').randomBytes(32).toString('hex');
      run(db, `UPDATE usuario SET session_token = '${token}' WHERE id = ${user.id}`);
      req.session.userToken = token;
      res.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, avatar: user.avatar, username: user.username } });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Login local
app.post('/auth/login', (req, res, next) => {
  const ip       = req.ip || req.connection.remoteAddress || 'unknown';
  const attempts = checkRateLimit(ip);
  if (attempts > 10) {
    return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.' });
  }
  passport.authenticate('local', async (err, user, info) => {
    if (err)   return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: info?.message || 'Credenciales inválidas' });
    resetRateLimit(ip);
    req.login(user, async err => {
      if (err) return res.status(500).json({ error: err.message });
      // Guardar token de sesión
      const db    = await getDb();
      const token = require('crypto').randomBytes(32).toString('hex');
      run(db, `UPDATE usuario SET session_token = '${token}' WHERE id = ${user.id}`);
      req.session.userToken = token;
      res.json({ ok: true, user: { id: user.id, nombre: user.nombre, email: user.email, avatar: user.avatar, username: user.username } });
    });
  })(req, res, next);
});

// Google OAuth — solo activo si hay credenciales configuradas
if (GOOGLE_CLIENT_ID) {
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login.html?error=google' }),
    (req, res) => res.redirect('/')
  );
} else {
  app.get('/auth/google', (req, res) => res.redirect('/login.html?error=no_google'));
  app.get('/auth/google/callback', (req, res) => res.redirect('/login.html?error=no_google'));
}

// Endpoint para saber si Google está disponible
app.get('/auth/google-available', (req, res) => res.json({ available: !!GOOGLE_CLIENT_ID }));

// Logout
app.post('/auth/logout', (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

// Usuario actual
app.get('/auth/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ user: null });
  const u = req.user;
  res.json({ user: { id: u.id, username: u.username, nombre: u.nombre, email: u.email, avatar: u.avatar } });
});

// ── Cambiar contraseña ────────────────────────────────────────
app.post('/auth/change-password', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { currentPassword, newPassword } = req.body;
    const user = get(db, `SELECT * FROM usuario WHERE id = ${req.user.id}`);
    if (!user.password) return res.status(400).json({ error: 'Esta cuenta usa Google. No puedes cambiar la contraseña.' });
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Completa todos los campos' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    const hash = await bcrypt.hash(newPassword, 10);
    // Nuevo token invalida otras sesiones
    const newToken = require('crypto').randomBytes(32).toString('hex');
    run(db, `UPDATE usuario SET password = ${esc(hash)}, session_token = '${newToken}' WHERE id = ${req.user.id}`);
    req.session.userToken = newToken; // mantener sesión actual válida
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cambiar nombre ────────────────────────────────────────────
app.post('/auth/change-nombre', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    run(db, `UPDATE usuario SET nombre = ${esc(nombre.trim())} WHERE id = ${req.user.id}`);
    const updated = get(db, `SELECT * FROM usuario WHERE id = ${req.user.id}`);
    req.user.nombre = updated.nombre;
    res.json({ ok: true, nombre: updated.nombre });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── AMIGOS ────────────────────────────────────────────────────

// Buscar usuario por username
app.get('/api/usuarios/buscar', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const q  = safeEmail(req.query.q || '').replace('@','');
    const username = String(req.query.q || '').trim().replace(/'/g,"''");
    if (!username) return res.json([]);
    const results = all(db, `SELECT id, username, nombre, avatar FROM usuario
      WHERE username LIKE '%${username}%' AND id != ${req.user.id} LIMIT 10`);
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Enviar solicitud de amistad
app.post('/api/amigos/solicitar', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const { receptor_id } = req.body;
    if (!receptor_id || receptor_id == uid) return res.status(400).json({ error: 'ID inválido' });
    const existe = get(db, `SELECT id FROM amistad WHERE (solicitante=${uid} AND receptor=${receptor_id}) OR (solicitante=${receptor_id} AND receptor=${uid})`);
    if (existe) return res.status(400).json({ error: 'Ya existe una solicitud o amistad con este usuario' });
    run(db, `INSERT INTO amistad (solicitante, receptor, estado) VALUES (${uid}, ${receptor_id}, 'pendiente')`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Responder solicitud (aceptar/rechazar)
app.post('/api/amigos/responder', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const { amistad_id, accion } = req.body;
    const sol = get(db, `SELECT * FROM amistad WHERE id=${amistad_id} AND receptor=${uid} AND estado='pendiente'`);
    if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (accion === 'aceptar') {
      run(db, `UPDATE amistad SET estado='aceptada' WHERE id=${amistad_id}`);
      // Crear privacidad por defecto para ambos
      run(db, `INSERT OR IGNORE INTO privacidad_amigo (usuario_id, amigo_id) VALUES (${uid}, ${sol.solicitante})`);
      run(db, `INSERT OR IGNORE INTO privacidad_amigo (usuario_id, amigo_id) VALUES (${sol.solicitante}, ${uid})`);
    } else {
      run(db, `DELETE FROM amistad WHERE id=${amistad_id}`);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Eliminar amigo
app.delete('/api/amigos/:amigo_id', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const aid = req.params.amigo_id;
    run(db, `DELETE FROM amistad WHERE (solicitante=${uid} AND receptor=${aid}) OR (solicitante=${aid} AND receptor=${uid})`);
    run(db, `DELETE FROM privacidad_amigo WHERE (usuario_id=${uid} AND amigo_id=${aid}) OR (usuario_id=${aid} AND amigo_id=${uid})`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Listar amigos y solicitudes
app.get('/api/amigos', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const amigos = all(db, `SELECT a.id as amistad_id, a.estado,
      CASE WHEN a.solicitante=${uid} THEN a.receptor ELSE a.solicitante END as amigo_id,
      CASE WHEN a.solicitante=${uid} THEN 'enviada' ELSE 'recibida' END as direccion
      FROM amistad a WHERE (a.solicitante=${uid} OR a.receptor=${uid})`);
    const result = amigos.map(a => {
      const u = get(db, `SELECT id, username, nombre, avatar FROM usuario WHERE id=${a.amigo_id}`);
      return { ...a, usuario: u };
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Obtener/actualizar privacidad para un amigo
app.get('/api/amigos/:amigo_id/privacidad', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const aid = req.params.amigo_id;
    const priv = get(db, `SELECT * FROM privacidad_amigo WHERE usuario_id=${uid} AND amigo_id=${aid}`);
    res.json(priv || { ver_coleccion:1, ver_jugando:1, ver_buscados:1 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/amigos/:amigo_id/privacidad', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const aid = req.params.amigo_id;
    const { ver_coleccion, ver_jugando, ver_buscados } = req.body;
    const vc = ver_coleccion ? 1 : 0;
    const vj = ver_jugando ? 1 : 0;
    const vb = ver_buscados ? 1 : 0;
    run(db, `INSERT OR REPLACE INTO privacidad_amigo (usuario_id, amigo_id, ver_coleccion, ver_jugando, ver_buscados)
      VALUES (${uid}, ${aid}, ${vc}, ${vj}, ${vb})`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ver colección de un amigo (respeta privacidad)
app.get('/api/amigos/:amigo_id/coleccion', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const aid = req.params.amigo_id;
    // Verificar que son amigos
    const amistad = get(db, `SELECT * FROM amistad WHERE estado='aceptada' AND ((solicitante=${uid} AND receptor=${aid}) OR (solicitante=${aid} AND receptor=${uid}))`);
    if (!amistad) return res.status(403).json({ error: 'No son amigos' });
    // Verificar privacidad del amigo hacia mí
    const priv = get(db, `SELECT * FROM privacidad_amigo WHERE usuario_id=${aid} AND amigo_id=${uid}`);
    const vc = !priv || priv.ver_coleccion;
    const vj = !priv || priv.ver_jugando;
    const vb = !priv || priv.ver_buscados;
    const result = {};
    if (vc) result.coleccion = all(db, `SELECT * FROM juego WHERE usuario_id=${aid} AND posesion='coleccion' ORDER BY plataforma,nombre`);
    if (vj) result.jugando   = all(db, `SELECT * FROM juego WHERE usuario_id=${aid} AND LOWER(TRIM(estado))='jugando' AND posesion='coleccion' ORDER BY nombre`);
    if (vb) result.buscados  = all(db, `SELECT * FROM juego WHERE usuario_id=${aid} AND posesion='buscado' ORDER BY nombre`);
    result.privacidad = { ver_coleccion: vc ? 1:0, ver_jugando: vj ? 1:0, ver_buscados: vb ? 1:0 };
    const amigo = get(db, `SELECT id, username, nombre, avatar FROM usuario WHERE id=${aid}`);
    result.amigo = amigo;
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Actualizar username
app.post('/auth/change-username', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { username } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ error: 'El username no puede estar vacío' });
    const safe = username.trim().replace(/[^a-zA-Z0-9_.-]/g, '');
    if (safe.length < 3) return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres (letras, números, _ . -)' });
    const existe = get(db, `SELECT id FROM usuario WHERE LOWER(username)=LOWER('${safe.replace(/'/g,"''")}') AND id != ${req.user.id}`);
    if (existe) return res.status(400).json({ error: 'Ese username ya está en uso' });
    run(db, `UPDATE usuario SET username='${safe.replace(/'/g,"''")}' WHERE id=${req.user.id}`);
    res.json({ ok: true, username: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Backup de base de datos ──────────────────────────────────
app.get('/api/backup', requireAuth, async (req, res) => {
  try {
    const db     = await getDb();
    const juegos = all(db, `SELECT * FROM juego WHERE usuario_id = ${req.user.id} ORDER BY id`);
    const backup = {
      exportado_en: new Date().toISOString(),
      usuario: { id: req.user.id, nombre: req.user.nombre, email: req.user.email },
      total_juegos: juegos.length,
      juegos
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="gamevault_backup_${req.user.id}_${Date.now()}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Restaurar desde backup ────────────────────────────────────
app.post('/api/backup/restore', requireAuth, async (req, res) => {
  try {
    const db     = await getDb();
    const uid    = req.user.id;
    const juegos = req.body.juegos;
    if (!Array.isArray(juegos)) return res.status(400).json({ error: 'Formato inválido' });
    let ok = 0;
    for (const g of juegos) {
      if (!g.nombre) continue;
      const pos = g.posesion === 'buscado' ? 'buscado' : 'coleccion';
      run(db, `INSERT INTO juego (usuario_id, nombre, plataforma, desarrolladora, anio, genero, clasificacion, num_jugadores, estado, posesion, region, contenido)
        VALUES (${uid}, ${esc(String(g.nombre).trim())}, ${esc(g.plataforma||null)}, ${esc(g.desarrolladora||null)},
          ${g.anio ? parseInt(g.anio) : 'NULL'}, ${esc(g.genero||null)}, ${esc(g.clasificacion||null)},
          ${esc(g.num_jugadores||null)}, ${esc(g.estado||'pendiente')}, ${esc(pos)},
          ${esc(g.region||null)}, ${esc(g.contenido||null)})`);
      ok++;
    }
    res.json({ ok: true, importados: ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notificaciones ────────────────────────────────────────────
app.get('/api/notificaciones', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const solicitudes = all(db, `SELECT a.id, a.solicitante, u.nombre, u.username, u.avatar
      FROM amistad a JOIN usuario u ON u.id = a.solicitante
      WHERE a.receptor = ${uid} AND a.estado = 'pendiente'`);
    res.json({ solicitudes, total: solicitudes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Archivos estáticos (login.html público) ───────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API juegos (protegida) ────────────────────────────────────

app.get('/api/juegos', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const { q, plataforma, genero, estado, num_jugadores, posesion } = req.query;
    const pos = (posesion === 'buscado') ? 'buscado' : 'coleccion';
    let sql = `SELECT * FROM juego WHERE usuario_id = ${uid} AND posesion = ${esc(pos)}`;
    if (q)            sql += ` AND (LOWER(nombre) LIKE LOWER('%${String(q).replace(/'/g,"''")}%') OR LOWER(desarrolladora) LIKE LOWER('%${String(q).replace(/'/g,"''")}%'))`;
    if (plataforma)   sql += ` AND LOWER(plataforma) = LOWER('${String(plataforma).replace(/'/g,"''")}')`;
    if (genero)       sql += ` AND LOWER(genero) LIKE LOWER('%${String(genero).replace(/'/g,"''")}%')`;
    if (estado)       sql += ` AND LOWER(TRIM(estado)) LIKE LOWER('%${String(estado).replace(/'/g,"''")}%')`;
    if (num_jugadores)sql += ` AND LOWER(num_jugadores) LIKE LOWER('%${String(num_jugadores).replace(/'/g,"''")}%')`;
    sql += ' ORDER BY plataforma ASC, nombre ASC';
    res.json(all(db, sql));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/juegos/:id', requireAuth, async (req, res) => {
  try {
    const db    = await getDb();
    const juego = get(db, `SELECT * FROM juego WHERE id = ${esc(req.params.id)} AND usuario_id = ${req.user.id}`);
    if (!juego) return res.status(404).json({ error: 'Juego no encontrado' });
    res.json(juego);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/juegos', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const { nombre, plataforma, desarrolladora, anio, genero, clasificacion, num_jugadores, estado, posesion, region, contenido } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const pos = (posesion === 'buscado') ? 'buscado' : 'coleccion';
    const sql = `INSERT INTO juego (usuario_id, nombre, plataforma, desarrolladora, anio, genero, clasificacion, num_jugadores, estado, posesion, region, contenido)
      VALUES (${uid}, ${esc(String(nombre).trim())}, ${esc(plataforma||null)}, ${esc(desarrolladora||null)},
        ${anio ? parseInt(anio) : 'NULL'}, ${esc(genero||null)}, ${esc(clasificacion||null)},
        ${esc(num_jugadores||null)}, ${esc(estado||'pendiente')}, ${esc(pos)}, ${esc(region||null)}, ${esc(contenido||null)})`;
    const result = run(db, sql);
    res.status(201).json(get(db, `SELECT * FROM juego WHERE id = ${result.lastInsertRowid}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/juegos/:id', requireAuth, async (req, res) => {
  try {
    const db    = await getDb();
    const juego = get(db, `SELECT * FROM juego WHERE id = ${esc(req.params.id)} AND usuario_id = ${req.user.id}`);
    if (!juego) return res.status(404).json({ error: 'Juego no encontrado' });
    const { nombre, plataforma, desarrolladora, anio, genero, clasificacion, num_jugadores, estado, region, contenido } = req.body;
    if (nombre !== undefined && !String(nombre).trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    const v = (val, fb) => val !== undefined ? val : fb;
    run(db, `UPDATE juego SET
      nombre=${esc(v(nombre,juego.nombre))}, plataforma=${esc(v(plataforma,juego.plataforma))},
      desarrolladora=${esc(v(desarrolladora,juego.desarrolladora))},
      anio=${v(anio,juego.anio) ? parseInt(v(anio,juego.anio)) : 'NULL'},
      genero=${esc(v(genero,juego.genero))}, clasificacion=${esc(v(clasificacion,juego.clasificacion))},
      num_jugadores=${esc(v(num_jugadores,juego.num_jugadores))}, estado=${esc(v(estado,juego.estado))},
      region=${esc(v(region,juego.region))}, contenido=${esc(v(contenido,juego.contenido))}
      WHERE id = ${esc(req.params.id)} AND usuario_id = ${req.user.id}`);
    res.json(get(db, `SELECT * FROM juego WHERE id = ${esc(req.params.id)}`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/juegos/:id', requireAuth, async (req, res) => {
  try {
    const db    = await getDb();
    const juego = get(db, `SELECT * FROM juego WHERE id = ${esc(req.params.id)} AND usuario_id = ${req.user.id}`);
    if (!juego) return res.status(404).json({ error: 'Juego no encontrado' });
    run(db, `DELETE FROM juego WHERE id = ${esc(req.params.id)} AND usuario_id = ${req.user.id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const db  = await getDb();
    const uid = req.user.id;
    const n   = (sql) => (get(db, sql) || { n: 0 }).n;
    res.json({
      total:      n(`SELECT COUNT(*) as n FROM juego WHERE usuario_id=${uid} AND posesion='coleccion'`),
      completado: n(`SELECT COUNT(*) as n FROM juego WHERE usuario_id=${uid} AND LOWER(TRIM(estado))='completado' AND posesion='coleccion'`),
      jugando:    n(`SELECT COUNT(*) as n FROM juego WHERE usuario_id=${uid} AND LOWER(TRIM(estado))='jugando' AND posesion='coleccion'`),
      pendiente:  n(`SELECT COUNT(*) as n FROM juego WHERE usuario_id=${uid} AND LOWER(TRIM(estado))='pendiente' AND posesion='coleccion'`),
      buscados:   n(`SELECT COUNT(*) as n FROM juego WHERE usuario_id=${uid} AND posesion='buscado'`),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Redirigir raíz a login si no autenticado
app.get('/', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`\n🎮 GameVault corriendo en http://localhost:${PORT}\n`));
