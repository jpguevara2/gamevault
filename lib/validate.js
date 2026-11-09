// Validación estricta de entradas
class ValidationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Entero positivo seguro o null
function toInt(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v === 'string' && /^[0-9]{1,15}$/.test(v)) {
    const n = Number(v);
    return n > 0 ? n : null;
  }
  return null;
}

function normEmail(e) { return String(e || '').trim().toLowerCase(); }

function isValidEmail(e) {
  const s = String(e || '').trim();
  return s.length <= 254 && /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(s);
}

// undefined -> undefined (no enviado), null/'' -> null, string recortado
function readText(body, key, max, opts = {}) {
  const label = opts.label || key;
  let v = body ? body[key] : undefined;
  if (v === undefined) {
    if (opts.required) throw new ValidationError(`${label} es obligatorio`);
    return undefined;
  }
  if (v === null || v === '') {
    if (opts.required) throw new ValidationError(`${label} es obligatorio`);
    return null;
  }
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') throw new ValidationError(`${label} no es válido`);
  v = v.trim();
  if (!v) {
    if (opts.required) throw new ValidationError(`${label} es obligatorio`);
    return null;
  }
  if (v.length > max) throw new ValidationError(`${label} es demasiado largo (máx ${max})`);
  return v;
}

function readAnio(body) {
  const v = body ? body.anio : undefined;
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^[0-9]{4}$/.test(s)) throw new ValidationError('El año debe tener 4 dígitos');
  const n = Number(s);
  if (n < 1950 || n > 2100) throw new ValidationError('El año debe estar entre 1950 y 2100');
  return n;
}

function readNota(body) {
  const v = body ? body.nota : undefined;
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  if (!Number.isFinite(n) || n < 0 || n > 10) throw new ValidationError('La nota debe estar entre 0 y 10');
  return Math.round(n * 10) / 10;
}

// Patrón LIKE con escape (usar con ESCAPE '\')
function likePattern(s) {
  return '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
}

function qstr(v, max = 100) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

module.exports = { ValidationError, toInt, normEmail, isValidEmail, readText, readAnio, readNota, likePattern, qstr };
