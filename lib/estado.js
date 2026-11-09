// Estado de avance canónico: Pendiente | Jugando | Completado | Abandonado
function normEstado(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s) return null;
  if (/^(no\s+terminad|no\s+complet|sin\s+terminar|pendient)/.test(s)) return 'Pendiente';
  if (/^(terminad|complet|finalizad|acabad|listo|100)/.test(s)) return 'Completado';
  if (/^(jugand|en\s+curso|en\s+progreso|progreso)/.test(s)) return 'Jugando';
  if (/^abandon/.test(s)) return 'Abandonado';
  return null; // desconocido: se deja como está
}
module.exports = { normEstado };
