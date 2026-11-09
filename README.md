# 🎮 GameVault

Gestor de colección de videojuegos (Node.js + Express + SQLite vía sql.js).

## Ejecutar (Windows, CMD)
    cd gamevault
    npm install
    node server.js
Abrir http://localhost:3000

## Seguridad
- Consultas SQL parametrizadas; los IDs se validan como enteros.
- Todo dato de usuario se escapa antes de mostrarse (`h()` en `public/js/app.js`).
- Sesiones persistentes en `sessions.json`, cookie `httpOnly` + `sameSite=lax` (`secure` con `NODE_ENV=production`).
- Secreto de sesión: `SESSION_SECRET` o uno aleatorio en `.session-secret` (no se sube a git).
- Protección CSRF (Origin/Referer + JSON) y cabeceras de seguridad.
- Juegos sin dueño (de antes de las cuentas) se asignan al primer usuario registrado.

## Respaldo
La base es el archivo `database/gamevault.db` (cópialo para respaldar). También hay backup/restore JSON desde la app.
