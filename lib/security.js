function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
}

// Protección CSRF: en métodos que modifican, Origin/Referer deben ser del mismo host
// y el cuerpo (si existe) debe ser JSON (un <form> externo no puede enviar JSON).
function csrfGuard(extraHosts = []) {
  const allowed = new Set(extraHosts);
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const src = req.headers.origin || req.headers.referer;
    if (src) {
      let host = null;
      try { host = new URL(src).host; } catch (_) {}
      if (!host || (host !== req.headers.host && !allowed.has(host)))
        return res.status(403).json({ error: 'Origen no permitido' });
    } else if (req.headers.cookie) {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
    const len = Number(req.headers['content-length'] || 0);
    const hasBody = len > 0 || req.headers['transfer-encoding'];
    if (hasBody && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json'))
      return res.status(415).json({ error: 'Se requiere application/json' });
    next();
  };
}
module.exports = { securityHeaders, csrfGuard };
