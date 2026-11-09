// ── Helpers de seguridad (anti-XSS) ──────────────────────────
function h(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function intId(v) { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; }
function safeUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch (_) { return ''; }
}

// ── AUTH ──────────────────────────────────────────────────────
(async function checkAuth() {
  const res  = await fetch('/auth/me');
  const data = await res.json();
  if (!data.user) { window.location.href = '/login.html'; return; }
  currentUser = data.user; // username included from /auth/me
  document.getElementById('user-name').textContent = data.user.nombre;
  if (data.user.avatar) {
    const img = document.getElementById('user-avatar');
    img.src = data.user.avatar;
    img.style.display = 'block';
  }
})();

document.getElementById('btn-logout').addEventListener('click', () => {
  document.getElementById('modal-logout').style.display = 'flex';
});

// ── NOTIFICACIONES ────────────────────────────────────────────
async function checkNotifications() {
  try {
    const data = await apiFetch('/notificaciones');
    const badge = document.getElementById('notif-badge');
    if (data.total > 0) {
      badge.textContent = data.total;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch(_) {}
}
// Verificar al cargar y cada 30 segundos
checkNotifications();
setInterval(checkNotifications, 30000);
document.getElementById('modal-logout-close').addEventListener('click', () => {
  document.getElementById('modal-logout').style.display = 'none';
});
document.getElementById('modal-logout-cancel').addEventListener('click', () => {
  document.getElementById('modal-logout').style.display = 'none';
});
document.getElementById('modal-logout-confirm').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});


// ── MODAL CUENTA ──────────────────────────────────────────────
let currentUser = null;

function showMsg(id, dur=2500) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

function openAccountModal() {
  document.getElementById('modal-account').style.display = 'flex';
  if (currentUser) {
    document.getElementById('acc-nombre').value   = currentUser.nombre   || '';
    document.getElementById('acc-username').value = currentUser.username || '';
    document.getElementById('account-info').innerHTML =
      `<strong>Nombre:</strong> ${h(currentUser.nombre)}<br>` +
      `<strong>Username:</strong> ${currentUser.username ? '@'+h(currentUser.username) : '<span style="color:#ff3d6b">No configurado</span>'}<br>` +
      `<strong>Email:</strong> ${h(currentUser.email)}` +
      (currentUser.avatar ? '<br><span style="color:#7c4dff">Cuenta Google vinculada</span>' : '');
  }
  // Limpiar campos de contraseña
  ['acc-pass-current','acc-pass-new','acc-pass-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function closeAccountModal() {
  document.getElementById('modal-account').style.display = 'none';
}

document.getElementById('btn-account').addEventListener('click', openAccountModal);
document.getElementById('modal-close').addEventListener('click', closeAccountModal);
document.getElementById('modal-account').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-account')) closeAccountModal();
});

// Cambiar contraseña
document.getElementById('btn-change-pass').addEventListener('click', async () => {
  const currentPassword = document.getElementById('acc-pass-current').value;
  const newPassword     = document.getElementById('acc-pass-new').value;
  const confirmPassword = document.getElementById('acc-pass-confirm').value;
  const errEl = document.getElementById('acc-error-text');

  if (!currentPassword || !newPassword || !confirmPassword) {
    errEl.textContent = 'Completa todos los campos.';
    return showMsg('acc-error');
  }
  if (newPassword !== confirmPassword) {
    errEl.textContent = 'Las contraseñas nuevas no coinciden.';
    return showMsg('acc-error');
  }
  if (newPassword.length < 6) {
    errEl.textContent = 'La nueva contraseña debe tener al menos 6 caracteres.';
    return showMsg('acc-error');
  }
  try {
    const res  = await fetch('/auth/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ currentPassword, newPassword }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return showMsg('acc-error'); }
    showMsg('acc-success');
    ['acc-pass-current','acc-pass-new','acc-pass-confirm'].forEach(id => document.getElementById(id).value = '');
  } catch(e) { errEl.textContent = 'Error de conexión.'; showMsg('acc-error'); }
});


// Cambiar username
document.getElementById('btn-change-username').addEventListener('click', async () => {
  const username = document.getElementById('acc-username').value.trim();
  const errEl    = document.getElementById('acc-username-error-text');
  if (!username) { errEl.textContent = 'El username no puede estar vacío.'; return showMsg('acc-username-error'); }
  try {
    const res  = await fetch('/auth/change-username', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return showMsg('acc-username-error'); }
    currentUser.username = data.username;
    document.getElementById('acc-username').value = data.username;
    document.getElementById('account-info').innerHTML =
      `<strong>Nombre:</strong> ${h(currentUser.nombre)}<br>` +
      `<strong>Username:</strong> <span style="color:#7c4dff">@${h(data.username)}</span><br>` +
      `<strong>Email:</strong> ${h(currentUser.email)}` +
      (currentUser.avatar ? '<br><span style="color:#7c4dff">Cuenta Google vinculada</span>' : '');
    showMsg('acc-username-success');
  } catch(e) { errEl.textContent = 'Error de conexión.'; showMsg('acc-username-error'); }
});

// Cambiar nombre
document.getElementById('btn-change-nombre').addEventListener('click', async () => {
  const nombre  = document.getElementById('acc-nombre').value.trim();
  const errEl   = document.getElementById('acc-nombre-error-text');
  if (!nombre) { errEl.textContent = 'El nombre no puede estar vacío.'; return showMsg('acc-nombre-error'); }
  try {
    const res  = await fetch('/auth/change-nombre', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ nombre }) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return showMsg('acc-nombre-error'); }
    currentUser.nombre = data.nombre;
    document.getElementById('user-name').textContent = data.nombre;
    document.getElementById('account-info').innerHTML =
      `<strong>Nombre:</strong> ${h(data.nombre)}<br><strong>Email:</strong> ${h(currentUser.email)}` +
      (currentUser.avatar ? '<br><span style="color:#7c4dff">Cuenta Google vinculada</span>' : '');
    showMsg('acc-nombre-success');
  } catch(e) { errEl.textContent = 'Error de conexión.'; showMsg('acc-nombre-error'); }
});

const API = '/api';
const ESTADO_COLOR = { completado:'#00e676', jugando:'#ffc400', pendiente:'#6b6b8a', abandonado:'#ff3d6b' };

function estadoKey(estado) {
  const t = String(estado||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  if (/^(no\s+terminad|no\s+complet|sin\s+terminar|pendient)/.test(t)) return 'pendiente';
  if (/^(terminad|complet|finalizad|acabad)/.test(t)) return 'completado';
  if (/^(jugand|en\s+curso|en\s+progreso)/.test(t)) return 'jugando';
  if (/^abandon/.test(t)) return 'abandonado';
  return 'pendiente';
}
function estadoColor(estado) {
  return ESTADO_COLOR[estadoKey(estado)] || '#6b6b8a';
}
let pendingDeleteId = null;
let sortCol   = 'plataforma'; // columna activa de ordenamiento
let sortDir   = 1;            // 1=asc, -1=desc
let allGames = []; // cache local para filtrado en cliente

async function apiFetch(url, options={}) {
  const res  = await fetch(API+url, { headers:{'Content-Type':'application/json'}, ...options });
  const data = await res.json();
  if (res.status === 401) {
    // Sesión expirada — redirigir a login
    window.location.href = '/login.html?error=session';
    return;
  }
  if (!res.ok) throw new Error(data.error||'Error en el servidor');
  return data;
}
function showMsg(id, dur=2500) {
  const el=document.getElementById(id);
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), dur);
}
function nullCell(val) {
  return val ? `<td>${h(val)}</td>` : `<td class="td-null">(null)</td>`;
}
function getFilters() {
  return {
    q:             document.getElementById('list-q').value.trim().toLowerCase(),
    plataforma:    document.getElementById('list-plataforma').value.trim().toLowerCase(),
    desarrolladora:document.getElementById('list-desarrolladora').value.trim().toLowerCase(),
    genero:        document.getElementById('list-genero').value.trim().toLowerCase(),
    clasificacion: document.getElementById('list-clasificacion').value.trim().toLowerCase(),
    num_jugadores: document.getElementById('list-num_jugadores').value.trim().toLowerCase(),
    estado:        document.getElementById('list-estado').value.trim().toLowerCase(),
    anio_desde:    parseInt(document.getElementById('list-anio-desde').value) || null,
    anio_hasta:    parseInt(document.getElementById('list-anio-hasta').value) || null,
    region:        document.getElementById('list-region').value.trim().toLowerCase(),
    contenido:     document.getElementById('list-contenido').value.toLowerCase(),
    global:        document.getElementById('list-global').value.trim().toLowerCase(),
  };
}

async function refreshStats() {
  try {
    const s=await apiFetch('/stats');
    document.getElementById('stat-total').textContent      = s.total;
    document.getElementById('stat-completado').textContent = s.completado;
    document.getElementById('stat-jugando').textContent    = s.jugando;
    document.getElementById('stat-pendiente').textContent  = s.pendiente;
  } catch(_){}
}

async function loadAllGames() {
  allGames = await apiFetch('/juegos?posesion=coleccion');
}

function applyFilters() {
  const f = getFilters();
  return allGames.filter(g => {
    if (f.q && !(
      (g.nombre||'').toLowerCase().includes(f.q) ||
      (g.desarrolladora||'').toLowerCase().includes(f.q)
    )) return false;
    if (f.plataforma     && (g.plataforma||'').toLowerCase() !== f.plataforma)             return false;
    if (f.desarrolladora && !(g.desarrolladora||'').toLowerCase().includes(f.desarrolladora)) return false;
    if (f.genero         && !(g.genero||'').toLowerCase().includes(f.genero))               return false;
    if (f.clasificacion  && !(g.clasificacion||'').toLowerCase().includes(f.clasificacion)) return false;
    if (f.num_jugadores  && !(g.num_jugadores||'').toLowerCase().includes(f.num_jugadores)) return false;
    if (f.estado         && (g.estado||'').toLowerCase().trim() !== f.estado.toLowerCase().trim()) return false;
    if (f.anio_desde && (!g.anio || g.anio < f.anio_desde)) return false;
    if (f.anio_hasta && (!g.anio || g.anio > f.anio_hasta)) return false;
    if (f.region     && !(g.region||'').toLowerCase().includes(f.region))  return false;
    if (f.contenido  && (g.contenido||'').toLowerCase() !== f.contenido)   return false;
    if (f.global) {
      const all = [g.nombre,g.plataforma,g.desarrolladora,g.genero,g.clasificacion,g.num_jugadores,g.estado,g.region,g.contenido,g.exclusividad,g.pila,String(g.nota==null?'':g.nota),String(g.anio||'')].map(v=>(v||'').toLowerCase()).join(' ');
      if (!all.includes(f.global)) return false;
    }
    return true;
  });
}

// ── Paginación de la colección ──
const PAGE_SIZES = [100, 150, 200, 250, 500, 750];
let pageSize = 100, pageNum = 1, lastViewKey = '';
try { const v = Number(localStorage.getItem('gv_page_size')); if (PAGE_SIZES.includes(v)) pageSize = v; } catch(_){}

function updatePager(total, from, shown, totalPages) {
  document.getElementById('page-info').textContent = `${total ? from + 1 : 0}–${from + shown} de ${total}  ·  pág. ${pageNum}/${totalPages}`;
  document.getElementById('page-prev').disabled = pageNum <= 1;
  document.getElementById('page-next').disabled = pageNum >= totalPages;
}
(function initPager() {
  const sel = document.getElementById('page-size');
  sel.innerHTML = PAGE_SIZES.map(n => `<option value="${n}"${n===pageSize?' selected':''}>${n}</option>`).join('');
  sel.addEventListener('change', e => {
    pageSize = Number(e.target.value);
    try { localStorage.setItem('gv_page_size', String(pageSize)); } catch(_){}
    renderCollection();
  });
  document.getElementById('page-prev').addEventListener('click', () => { pageNum--; renderCollection(); });
  document.getElementById('page-next').addEventListener('click', () => { pageNum++; renderCollection(); });
})();

function renderCollection() {
  const body  = document.getElementById('collection-body');
  const ef    = document.getElementById('list-empty');
  const en    = document.getElementById('list-no-games');

  if (!allGames.length) {
    body.innerHTML=''; en.style.display='block'; ef.style.display='none'; pageNum = 1; updatePager(0, 0, 0, 1); return;
  }
  en.style.display='none';

  const juegos = applyFilters();
  if (!juegos.length) {
    body.innerHTML=''; ef.style.display='block'; pageNum = 1; updatePager(0, 0, 0, 1); return;
  }
  ef.style.display='none';

  juegos.sort((a, b) => {
    if (sortCol === 'nota' || sortCol === 'anio') {
      const na = a[sortCol] == null ? Infinity : Number(a[sortCol]);
      const nb = b[sortCol] == null ? Infinity : Number(b[sortCol]);
      return na === nb ? 0 : (na < nb ? -1 : 1) * sortDir;
    }
    const va = (a[sortCol] !== null && a[sortCol] !== undefined) ? String(a[sortCol]).toLowerCase() : 'zzz';
    const vb = (b[sortCol] !== null && b[sortCol] !== undefined) ? String(b[sortCol]).toLowerCase() : 'zzz';
    if (va < vb) return -1 * sortDir;
    if (va > vb) return  1 * sortDir;
    return 0;
  });

  const cols = ['nombre','plataforma','desarrolladora','anio','genero','clasificacion','num_jugadores','estado','region','contenido','exclusividad','pila','nota'];
  const colLabels = ['NOMBRE','PLATAFORMA','DESARROLLADORA','AÑO','GENERO','CLASIFICACION','NUM_JUGADORES','ESTADO','REGION','CONTENIDO','EXCLUSIVIDAD','PILA','NOTA'];

  // Si cambian filtros, orden o tamaño de página, volver a la página 1
  const viewKey = JSON.stringify(getFilters()) + '|' + sortCol + '|' + sortDir + '|' + pageSize;
  if (viewKey !== lastViewKey) { pageNum = 1; lastViewKey = viewKey; }
  const totalPages = Math.max(1, Math.ceil(juegos.length / pageSize));
  if (pageNum > totalPages) pageNum = totalPages;
  const from = (pageNum - 1) * pageSize;
  const pageRows = juegos.slice(from, from + pageSize);

  const rows = pageRows.map(g => `
    <tr>
      <td class="td-nombre">${h(g.nombre)}</td>
      ${nullCell(g.plataforma)}
      ${nullCell(g.desarrolladora)}
      ${nullCell(g.anio)}
      ${nullCell(g.genero)}
      ${nullCell(g.clasificacion)}
      ${nullCell(g.num_jugadores)}
      <td>
        <span class="estado-dot" style="background:${estadoColor(g.estado)}"></span>
        ${h(g.estado)}
      </td>
      ${nullCell(g.region)}
      ${nullCell(g.contenido)}
      ${nullCell(g.exclusividad)}
      ${nullCell(g.pila)}
      ${nullCell(g.nota)}
    </tr>`).join('');

  body.innerHTML = `
    <div class="oracle-table-wrap">
      <table class="oracle-table" id="main-table">
        <thead>
          <tr>${cols.map((c,i) => {
            const active = c === sortCol;
            const arrow  = active ? (sortDir === 1 ? ' ▲' : ' ▼') : ' ⇅';
            return `<th class="th-sort${active?' th-active':''}" data-col="${c}">${colLabels[i]}${arrow}</th>`;
          }).join('')}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="oracle-row-count"><span>${juegos.length}</span> fila${juegos.length!==1?'s':''} seleccionada${juegos.length!==1?'s':''}.</div>
    </div>`;
  updatePager(juegos.length, from, pageRows.length, totalPages);
}

async function refreshCollection() {
  const body = document.getElementById('collection-body');
  body.innerHTML='<div class="loading"><i class="ti ti-loader-2"></i> Cargando...</div>';
  try {
    await loadAllGames();
    renderCollection();
  } catch(e) {
    body.innerHTML=`<div class="msg msg-error show"><i class="ti ti-alert-circle"></i> ${h(e.message)}</div>`;
  }
}

// Filtros en tiempo real (sin llamadas extra al servidor)
['list-q','list-plataforma','list-desarrolladora','list-genero',
 'list-clasificacion','list-num_jugadores',
 'list-anio-desde','list-anio-hasta','list-region','list-global'].forEach(id => {
  document.getElementById(id).addEventListener('input', renderCollection);
});
document.getElementById('list-estado').addEventListener('change', renderCollection);
document.getElementById('list-contenido').addEventListener('change', renderCollection);

// ── ORDENAR POR COLUMNA ────────────────────────────────────────
document.getElementById('collection-body').addEventListener('click', e => {
  const th = e.target.closest('.th-sort');
  if (!th) return;
  const col = th.dataset.col;
  if (sortCol === col) { sortDir *= -1; }
  else { sortCol = col; sortDir = 1; }
  renderCollection();
});

// ── EXPORTAR ──────────────────────────────────────────────────
function exportData(format) {
  var juegos = applyFilters();
  if (!juegos.length) { alert('No hay juegos para exportar.'); return; }
  var headers = ['NOMBRE','PLATAFORMA','DESARROLLADORA','ANIO','GENERO','CLASIFICACION','NUM_JUGADORES','ESTADO','REGION','CONTENIDO','EXCLUSIVIDAD','PILA','NOTA'];
  var fields  = ['nombre','plataforma','desarrolladora','anio','genero','clasificacion','num_jugadores','estado','region','contenido','exclusividad','pila','nota'];
  var rows = juegos.map(function(g) {
    return fields.map(function(f) { return (g[f] != null) ? String(g[f]) : ''; });
  });
  var allRows = [headers].concat(rows);
  if (format === 'csv') {
    var csv = allRows.map(function(r) {
      return r.map(function(v) { return '"' + v.replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var bom = '\xEF\xBB\xBF';
    download('gamevault_coleccion.csv', 'text/csv;charset=utf-8;', bom + csv);
  } else {
    var cells = allRows.map(function(r) {
      return '<Row>' + r.map(function(v) {
        var s = v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return '<Cell><Data ss:Type="String">' + s + '</Data></Cell>';
      }).join('') + '</Row>';
    }).join('');
    var ns = 'urn:schemas-microsoft-com:office:spreadsheet';
    var xml = '<?xml version="1.0" encoding="UTF-8"?>'
            + '<?mso-application progid="Excel.Sheet"?>'
            + '<Workbook xmlns="' + ns + '" xmlns:ss="' + ns + '">'
            + '<Worksheet ss:Name="Coleccion"><Table>'
            + cells
            + '</Table></Worksheet></Workbook>';
    download('gamevault_coleccion.xls', 'application/vnd.ms-excel', xml);
  }
}
function download(filename, mime, data) {
  var blob = new Blob([data], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}
document.getElementById('btn-export-csv').addEventListener('click', () => exportData('csv'));
document.getElementById('btn-export-excel').addEventListener('click', () => exportData('excel'));

document.getElementById('btn-clear-filters').addEventListener('click', () => {
  ['list-q','list-plataforma','list-desarrolladora','list-genero',
   'list-clasificacion','list-num_jugadores','list-estado',
   'list-anio-desde','list-anio-hasta','list-region','list-contenido','list-global'].forEach(id => document.getElementById(id).value='');
  renderCollection();
});

// ── AGREGAR ────────────────────────────────────────────────────
document.getElementById('btn-add').addEventListener('click', async () => {
  const nombre = document.getElementById('add-nombre').value.trim();
  if (!nombre) { showMsg('add-error'); return; }
  const btn = document.getElementById('btn-add'); btn.disabled=true;
  try {
    await apiFetch('/juegos', { method:'POST', body: JSON.stringify({
      nombre,
      anio:           document.getElementById('add-anio').value || null,
      plataforma:     document.getElementById('add-plataforma').value.trim() || null,
      genero:         document.getElementById('add-genero').value.trim() || null,
      desarrolladora: document.getElementById('add-desarrolladora').value.trim() || null,
      clasificacion:  document.getElementById('add-clasificacion').value.trim() || null,
      num_jugadores:  document.getElementById('add-num_jugadores').value.trim() || null,
      estado:         document.getElementById('add-estado').value.trim() || 'pendiente',
      posesion:       'coleccion',
      region:         document.getElementById('add-region').value.trim() || null,
      contenido:      document.getElementById('add-contenido').value || null,
      exclusividad:   document.getElementById('add-exclusividad').value || null,
      pila:           document.getElementById('add-pila').value || null,
      nota:           document.getElementById('add-nota').value || null
    })});
    document.querySelectorAll('#panel-add .form-input').forEach(el => el.value='');
    document.getElementById('add-contenido').value='';
    ['add-exclusividad','add-pila'].forEach(id => document.getElementById(id).value='');
    showMsg('add-success'); refreshStats();
  } catch(e) {
    document.getElementById('add-error-text').textContent=e.message;
    showMsg('add-error');
  } finally { btn.disabled=false; }
});

// ── MODIFICAR ──────────────────────────────────────────────────
let allEditGames = [];

async function refreshEditSelect() {
  const sel = document.getElementById('edit-select');
  const cur = sel.value;
  try {
    allEditGames = await apiFetch('/juegos?posesion=coleccion');
    renderEditSelect(cur);
    document.getElementById('edit-empty').style.display = allEditGames.length ? 'none' : 'block';
  } catch(_){}
}

function renderEditSelect(keepVal) {
  const sel = document.getElementById('edit-select');
  const cur = keepVal !== undefined ? keepVal : sel.value;
  const qN = document.getElementById('edit-search-nombre').value.trim().toLowerCase();
  const qP = document.getElementById('edit-search-plataforma').value.trim().toLowerCase();
  const qD = document.getElementById('edit-search-desarrolladora').value.trim().toLowerCase();
  const qG = document.getElementById('edit-search-genero').value.trim().toLowerCase();
  const qC = document.getElementById('edit-search-clasificacion').value.trim().toLowerCase();

  const filtered = allEditGames.filter(g =>
    (!qN || (g.nombre||'').toLowerCase().includes(qN)) &&
    (!qP || (g.plataforma||'').toLowerCase() === qP) &&
    (!qD || (g.desarrolladora||'').toLowerCase().includes(qD)) &&
    (!qG || (g.genero||'').toLowerCase().includes(qG)) &&
    (!qC || (g.clasificacion||'').toLowerCase().includes(qC))
  );

  sel.innerHTML = '<option value="">— Elige un juego —</option>' +
    filtered.map(g => `<option value="${intId(g.id)}">[${h(g.plataforma||'Sin plataforma')}] ${h(g.nombre)}</option>`).join('');

  if (filtered.find(g => String(g.id) === cur)) { sel.value = cur; loadEditForm(cur); }
  else document.getElementById('edit-form').style.display = 'none';
}
async function loadEditForm(id) {
  if (!id) { document.getElementById('edit-form').style.display='none'; return; }
  try {
    const g = await apiFetch('/juegos/'+id);
    document.getElementById('edit-form').style.display='block';
    document.getElementById('edit-nombre').value         = g.nombre||'';
    document.getElementById('edit-anio').value           = g.anio||'';
    document.getElementById('edit-plataforma').value     = g.plataforma||'';
    document.getElementById('edit-genero').value         = g.genero||'';
    document.getElementById('edit-desarrolladora').value = g.desarrolladora||'';
    document.getElementById('edit-clasificacion').value  = g.clasificacion||'';
    document.getElementById('edit-num_jugadores').value  = g.num_jugadores||'';
    document.getElementById('edit-estado').value         = g.estado||'';
    document.getElementById('edit-region').value         = g.region||'';
    document.getElementById('edit-contenido').value      = g.contenido||'';
    document.getElementById('edit-exclusividad').value   = g.exclusividad||'';
    document.getElementById('edit-pila').value           = g.pila||'';
    document.getElementById('edit-nota').value           = (g.nota===null||g.nota===undefined) ? '' : g.nota;
  } catch(_){}
}
['edit-search-nombre','edit-search-plataforma','edit-search-desarrolladora',
 'edit-search-genero','edit-search-clasificacion'].forEach(id =>
  document.getElementById(id).addEventListener('input', () => renderEditSelect())
);
document.getElementById('btn-clear-edit-filters').addEventListener('click', () => {
  ['edit-search-nombre','edit-search-plataforma','edit-search-desarrolladora',
   'edit-search-genero','edit-search-clasificacion'].forEach(id =>
    document.getElementById(id).value = ''
  );
  renderEditSelect();
});

document.getElementById('edit-select').addEventListener('change', e => loadEditForm(e.target.value));
document.getElementById('btn-save-edit').addEventListener('click', async () => {
  const id = document.getElementById('edit-select').value; if (!id) return;
  const btn = document.getElementById('btn-save-edit'); btn.disabled=true;
  try {
    await apiFetch('/juegos/'+id, { method:'PUT', body: JSON.stringify({
      nombre:         document.getElementById('edit-nombre').value.trim(),
      anio:           document.getElementById('edit-anio').value||null,
      plataforma:     document.getElementById('edit-plataforma').value.trim()||null,
      genero:         document.getElementById('edit-genero').value.trim()||null,
      desarrolladora: document.getElementById('edit-desarrolladora').value.trim()||null,
      clasificacion:  document.getElementById('edit-clasificacion').value.trim()||null,
      num_jugadores:  document.getElementById('edit-num_jugadores').value.trim()||null,
      estado:         document.getElementById('edit-estado').value.trim()||'pendiente',
      region:         document.getElementById('edit-region').value.trim()||null,
      contenido:      document.getElementById('edit-contenido').value||null,
      exclusividad:   document.getElementById('edit-exclusividad').value||null,
      pila:           document.getElementById('edit-pila').value||null,
      nota:           document.getElementById('edit-nota').value||null
    })});
    showMsg('edit-success'); refreshStats();
    await refreshEditSelect(); renderEditSelect(id);
    document.getElementById('edit-select').value = id;
  } catch(e) { showMsg('edit-error'); }
  finally { btn.disabled=false; }
});

// ── ELIMINAR ───────────────────────────────────────────────────
let allDeleteGames = [];

async function refreshDeleteList() {
  const list  = document.getElementById('delete-list');
  const empty = document.getElementById('delete-empty');
  list.innerHTML = '<div class="loading"><i class="ti ti-loader-2"></i> Cargando...</div>';
  try {
    allDeleteGames = await apiFetch('/juegos?posesion=coleccion');
    renderDeleteList();
  } catch(_){}
}

function renderDeleteList() {
  const list  = document.getElementById('delete-list');
  const empty = document.getElementById('delete-empty');
  const qN = document.getElementById('del-nombre').value.trim().toLowerCase();
  const qP = document.getElementById('del-plataforma').value.trim().toLowerCase();
  const qD = document.getElementById('del-desarrolladora').value.trim().toLowerCase();
  const qG = document.getElementById('del-genero').value.trim().toLowerCase();
  const qC = document.getElementById('del-clasificacion').value.trim().toLowerCase();

  const filtered = allDeleteGames.filter(g =>
    (!qN || (g.nombre||'').toLowerCase().includes(qN)) &&
    (!qP || (g.plataforma||'').toLowerCase() === qP) &&
    (!qD || (g.desarrolladora||'').toLowerCase().includes(qD)) &&
    (!qG || (g.genero||'').toLowerCase().includes(qG)) &&
    (!qC || (g.clasificacion||'').toLowerCase().includes(qC))
  );

  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = filtered.map(g => `
    <div class="delete-item">
      <div style="flex:1;min-width:0">
        <div class="di-title">${h(g.nombre)}</div>
        <div class="di-sub">${h([g.plataforma, g.desarrolladora, g.anio].filter(Boolean).join(' · '))} · ${h(g.estado)}</div>
      </div>
      <button class="btn btn-danger btn-sm" data-del="${intId(g.id)}" data-nombre="${h(g.nombre)}">
        <i class="ti ti-trash"></i> Eliminar
      </button>
    </div>`).join('');
  list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
    pendingDeleteId = btn.dataset.del;
    document.getElementById('confirm-text').textContent = `¿Eliminar "${btn.dataset.nombre}" de la colección?`;
    document.getElementById('confirm-dialog').classList.add('show');
  }));
}
['del-nombre','del-plataforma','del-desarrolladora','del-genero','del-clasificacion'].forEach(id =>
  document.getElementById(id).addEventListener('input', renderDeleteList)
);
document.getElementById('btn-delete-all').addEventListener('click', async () => {
  const txt = window.prompt('Se eliminarán TODOS tus juegos (colección y títulos buscados). Esto no se puede deshacer.\n\nTip: antes descarga un respaldo desde tu cuenta.\n\nEscribe ELIMINAR para confirmar:');
  if (txt !== 'ELIMINAR') return;
  try {
    const r = await apiFetch('/juegos', { method:'DELETE', body: JSON.stringify({ confirmar: 'ELIMINAR' }) });
    allGames = []; 
    await Promise.all([refreshStats(), refreshDeleteList(), refreshCollection()]);
    alert('Listo: se eliminaron ' + r.eliminados + ' juegos.');
  } catch (e) { alert(e.message); }
});
document.getElementById('btn-clear-del-filters').addEventListener('click', () => {
  ['del-nombre','del-plataforma','del-desarrolladora','del-genero','del-clasificacion'].forEach(id =>
    document.getElementById(id).value = ''
  );
  renderDeleteList();
});

document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-dialog').classList.remove('show'); pendingDeleteId=null;
});
document.getElementById('confirm-ok').addEventListener('click', async ()=>{
  if (!pendingDeleteId) return;
  try {
    await apiFetch('/juegos/'+pendingDeleteId,{method:'DELETE'});
    document.getElementById('confirm-dialog').classList.remove('show');
    pendingDeleteId=null; refreshStats(); refreshDeleteList();
  } catch(_){}
});

// ── TÍTULOS BUSCADOS ───────────────────────────────────────────
async function refreshWishList() {
  const list  = document.getElementById('wish-list');
  const empty = document.getElementById('wish-empty');
  try {
    const juegos = await apiFetch('/juegos?posesion=buscado');
    // cache para filtrar sin nueva llamada
    list.dataset.cache = JSON.stringify(juegos);
    renderWishList(juegos);
  } catch(_){}
}

function renderWishList(juegos) {
  const list  = document.getElementById('wish-list');
  const empty = document.getElementById('wish-empty');
  const q     = (document.getElementById('wish-search').value || '').trim().toLowerCase();
  const qPlat = (document.getElementById('wish-search-plat').value || '').trim().toLowerCase();
  const sort  = document.getElementById('wish-sort').value;
  let filtered = juegos.filter(g =>
    (!q     || (g.nombre||'').toLowerCase().includes(q)) &&
    (!qPlat || (g.plataforma||'').toLowerCase() === qPlat)
  );
  if (sort === 'nombre')        filtered = [...filtered].sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''));
  else if (sort === 'nombre-desc') filtered = [...filtered].sort((a,b) => (b.nombre||'').localeCompare(a.nombre||''));
  else if (sort === 'plataforma')  filtered = [...filtered].sort((a,b) => (a.plataforma||'zzz').localeCompare(b.plataforma||'zzz') || (a.nombre||'').localeCompare(b.nombre||''));

  empty.style.display = filtered.length ? 'none' : 'block';
  list.innerHTML = filtered.map(g => `
    <div class="wish-item">
      <div class="wish-title">${g.plataforma ? `<span class="wish-platform">[${h(g.plataforma)}]</span> ` : ''}${h(g.nombre)}</div>
      <button class="wish-remove" data-wi="${intId(g.id)}" aria-label="Quitar"><i class="ti ti-x"></i></button>
    </div>`).join('');
  list.querySelectorAll('[data-wi]').forEach(btn => btn.addEventListener('click', async () => {
    await apiFetch('/juegos/'+btn.dataset.wi, {method:'DELETE'});
    refreshWishList(); refreshStats();
  }));
}

['wish-search','wish-search-plat'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const cache = document.getElementById('wish-list').dataset.cache;
    if (cache) renderWishList(JSON.parse(cache));
  });
});
document.getElementById('wish-sort').addEventListener('change', () => {
  const cache = document.getElementById('wish-list').dataset.cache;
  if (cache) renderWishList(JSON.parse(cache));
});
document.getElementById('btn-wish-add').addEventListener('click', async ()=>{
  const val=document.getElementById('wish-input').value.trim();
  if (!val) { showMsg('wish-error'); return; }
  try {
    const plat = document.getElementById('wish-plataforma').value.trim() || null;
    await apiFetch('/juegos',{method:'POST',body:JSON.stringify({nombre:val,plataforma:plat,estado:'pendiente',posesion:'buscado'})});
    document.getElementById('wish-input').value='';
    document.getElementById('wish-plataforma').value='';
    refreshWishList(); refreshStats();
  } catch(_){}
});
document.getElementById('wish-input').addEventListener('keydown',e=>{
  if(e.key==='Enter') document.getElementById('btn-wish-add').click();
});


// ── IMPORTAR CSV/EXCEL ────────────────────────────────────────
let importRows = [];

document.getElementById('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('modal-import').style.display = 'flex';
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-confirm-btn').style.display = 'none';
  document.getElementById('import-error').classList.remove('show');
  document.getElementById('import-success').classList.remove('show');
  importRows = [];

  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4B;          // .xlsx = ZIP
    const isOle = head[0] === 0xD0 && head[1] === 0xCF;          // .xls antiguo
    if (isOle || (/\.xls$/i.test(file.name) && !isZip))
      throw new Error('El formato .xls antiguo no es compatible. En Excel usa Guardar como → Libro de Excel (.xlsx) y vuelve a intentarlo.');
    if (isZip) {
      // ── Excel (.xlsx): todas las hojas de una vez ──
      const sheets = await window.readXlsx(await file.arrayBuffer());
      const res = window.GVNormalize.fromSheets(sheets);
      if (!res.juegos.length) throw new Error('No se encontraron juegos. Cada hoja debe tener un encabezado con la columna "Nombre".');
      await loadAllGames();
      const key = g => (g.nombre||'').trim().toLowerCase() + '|' + (g.plataforma||'').trim().toLowerCase();
      const existentes = new Set(allGames.map(key));
      const nuevos = res.juegos.filter(g => !existentes.has(key(g)));
      const repetidos = res.juegos.length - nuevos.length;
      if (!nuevos.length) throw new Error('Los ' + res.juegos.length + ' juegos del archivo ya están en tu colección.');
      importRows = nuevos;
      const fieldsX = ['nombre','plataforma','desarrolladora','anio','genero','clasificacion','num_jugadores','estado','region','contenido','exclusividad','pila','nota'];
      const tableX = `<table class="oracle-table" style="font-size:11px">
        <thead><tr>${fieldsX.map(f => `<th>${h(f.toUpperCase())}</th>`).join('')}</tr></thead>
        <tbody>${nuevos.slice(0,10).map(r => `<tr>${fieldsX.map(f => `<td>${r[f] != null && r[f] !== '' ? h(r[f]) : '<span style="color:#444">(null)</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>${nuevos.length > 10 ? `<p style="font-size:11px;color:#6b6b8a;margin-top:6px">... y ${nuevos.length-10} más</p>` : ''}`;
      document.getElementById('import-table-wrap').innerHTML = tableX;
      let resumen = `${nuevos.length} juego${nuevos.length!==1?'s':''} nuevo${nuevos.length!==1?'s':''} en ${res.hojas.length} hoja${res.hojas.length!==1?'s':''}: ` +
        res.hojas.map(x => `${x.name} (${x.count})`).join(', ');
      if (repetidos) resumen += ` · ${repetidos} ya existían y se omiten`;
      if (res.omitidas.length) resumen += ` · hojas ignoradas: ${res.omitidas.join(', ')}`;
      if (res.avisos.length) resumen += ` · ${res.avisos.length} aviso(s): ` + res.avisos.slice(0,3).join('; ') + (res.avisos.length > 3 ? '…' : '');
      document.getElementById('import-count').textContent = resumen;
      document.getElementById('import-preview').style.display = 'block';
      const cb = document.getElementById('import-confirm-btn');
      cb.innerHTML = `<i class="ti ti-upload"></i> Importar ${nuevos.length} juegos`;
      cb.style.display = 'inline-flex';
      e.target.value = '';
      return;
    }
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('El archivo debe tener al menos una fila de datos además del encabezado.');

    const fields = ['nombre','plataforma','desarrolladora','anio','genero','clasificacion','num_jugadores','estado','region','contenido','exclusividad','pila','nota'];

    // Delimitador: ; o ,
    const delim = ((lines[0].match(/;/g)||[]).length > (lines[0].match(/,/g)||[]).length) ? ';' : ',';
    // Parse CSV (simple, maneja comillas)
    function parseLine(line) {
      const vals = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === delim && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      vals.push(cur.trim());
      return vals;
    }

    // Mapear columnas por el nombre del encabezado (si se reconoce), si no por orden
    const ALIAS = { nombre:['nombre','titulo','título'], plataforma:['plataforma','consola'], desarrolladora:['desarrolladora','empresa'],
      anio:['anio','año'], genero:['genero','género','tipo'], clasificacion:['clasificacion','clasificación'],
      num_jugadores:['num_jugadores','n_jugadores','jugadores','n° jugadores'], estado:['estado','progreso'], region:['region','región'],
      contenido:['contenido'], exclusividad:['exclusividad'], pila:['pila'], nota:['nota','nota ign'] };
    const headerCells = parseLine(lines[0]).map(x => x.toLowerCase().trim());
    const idx = {};
    fields.forEach(f => { const i = headerCells.findIndex(c => ALIAS[f].includes(c)); if (i >= 0) idx[f] = i; });
    const byName = Object.keys(idx).length >= 2 && idx.nombre !== undefined;
    const rows = lines.slice(1).map(l => {
      const vals = parseLine(l);
      const obj = {};
      fields.forEach((f, i) => { const j = byName ? idx[f] : i; obj[f] = (j !== undefined && vals[j]) ? vals[j] : null; });
      return obj;
    }).filter(r => r.nombre);

    if (!rows.length) throw new Error('No se encontraron filas con datos válidos.');

    importRows = rows;

    // Preview
    const tableHtml = `<table class="oracle-table" style="font-size:11px">
      <thead><tr>${fields.map(f => `<th>${h(f.toUpperCase())}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0,10).map(r => `<tr>${fields.map(f => `<td>${r[f] ? h(r[f]) : '<span style="color:#444">(null)</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>${rows.length > 10 ? `<p style="font-size:11px;color:#6b6b8a;margin-top:6px">... y ${rows.length-10} más</p>` : ''}`;

    document.getElementById('import-table-wrap').innerHTML = tableHtml;
    document.getElementById('import-count').textContent = `${rows.length} juego${rows.length!==1?'s':''} detectado${rows.length!==1?'s':''}`;
    document.getElementById('import-preview').style.display = 'block';
    const cbtn = document.getElementById('import-confirm-btn');
    cbtn.innerHTML = `<i class="ti ti-upload"></i> Importar ${rows.length} juegos`;
    cbtn.style.display = 'inline-flex';
  } catch(err) {
    document.getElementById('import-error-text').textContent = err.message;
    document.getElementById('import-error').classList.add('show');
  }
  e.target.value = ''; // reset input
});

document.getElementById('import-confirm-btn').addEventListener('click', async () => {
  if (!importRows.length) return;
  const btn = document.getElementById('import-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Importando...';
  let ok = 0, fail = 0;
  try {
    const payload = importRows.map(row => ({ ...row, posesion: 'coleccion' }));
    const res = await fetch('/api/backup/restore', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ juegos: payload }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al importar');
    ok = data.importados; fail = data.omitidos;
  } catch (err) {
    fail = importRows.length;
    document.getElementById('import-error-text').textContent = err.message;
    document.getElementById('import-error').classList.add('show');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-upload"></i> Importar';
  const succEl = document.getElementById('import-success-text');
  succEl.textContent = `${ok} juego${ok!==1?'s':''} importado${ok!==1?'s':''}${fail ? ` (${fail} con error)` : ''}.`;
  document.getElementById('import-success').classList.add('show');
  document.getElementById('import-confirm-btn').style.display = 'none';
  importRows = [];
  refreshStats();
  await loadAllGames();
  renderCollection();
});

function closeImportModal() {
  document.getElementById('modal-import').style.display = 'none';
  importRows = [];
}
document.getElementById('modal-import-close').addEventListener('click', closeImportModal);
document.getElementById('import-cancel-btn').addEventListener('click', closeImportModal);
document.getElementById('modal-import').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-import')) closeImportModal();
});


// ── SISTEMA DE AMIGOS ─────────────────────────────────────────
let amigoSeleccionado = null;
let amigosData = [];

async function loadAmigos() {
  amigosData = await apiFetch('/amigos');
  renderAmigos();
  checkNotifications();
}

function renderAmigos() {
  const list      = document.getElementById('amigos-list');
  const solSec    = document.getElementById('solicitudes-section');
  const solList   = document.getElementById('solicitudes-list');
  const aceptados = amigosData.filter(a => a.estado === 'aceptada');
  const recibidas = amigosData.filter(a => a.estado === 'pendiente' && a.direccion === 'recibida');
  const enviadas  = amigosData.filter(a => a.estado === 'pendiente' && a.direccion === 'enviada');

  // Solicitudes recibidas
  solSec.style.display = recibidas.length ? 'block' : 'none';
  solList.innerHTML = recibidas.map(a => `
    <div class="solicitud-card">
      <div class="solicitud-nombre">${h(a.usuario.nombre)} <span style="color:#7c4dff">@${h(a.usuario.username||'')}</span></div>
      <div class="solicitud-btns">
        <button class="btn btn-success btn-sm" data-resp="${intId(a.amistad_id)}" data-accion="aceptar"><i class="ti ti-check"></i> Aceptar</button>
        <button class="btn btn-danger btn-sm"  data-resp="${intId(a.amistad_id)}" data-accion="rechazar"><i class="ti ti-x"></i> Rechazar</button>
      </div>
    </div>`).join('');
  solList.querySelectorAll('[data-resp]').forEach(b => b.addEventListener('click', () =>
    responderSolicitud(Number(b.dataset.resp), b.dataset.accion)));

  // Amigos aceptados
  if (!aceptados.length && !enviadas.length) {
    list.innerHTML = '<div class="empty-state" style="padding:1.5rem 0"><i class="ti ti-user-plus" style="font-size:32px"></i><p>Aún no tienes amigos.<br>¡Busca por username!</p></div>';
  } else {
    list.innerHTML = aceptados.map(a => `
      <div class="amigo-card ${amigoSeleccionado?.amistad_id === a.amistad_id ? 'active' : ''}" data-amistad="${intId(a.amistad_id)}">
        ${safeUrl(a.usuario.avatar) ? `<img src="${h(safeUrl(a.usuario.avatar))}" class="user-avatar" style="width:32px;height:32px" />` : `<i class="ti ti-user-circle" style="font-size:28px;color:var(--am)"></i>`}
        <div class="amigo-card-info">
          <div class="amigo-card-nombre">${h(a.usuario.nombre)}</div>
          <div class="amigo-card-username">@${h(a.usuario.username||'sin username')}</div>
        </div>
      </div>`).join('') +
    (enviadas.length ? `<div style="font-size:11px;color:var(--am);margin-top:0.75rem;letter-spacing:1px">PENDIENTES ENVIADAS</div>` +
      enviadas.map(a => `
        <div class="amigo-card" style="opacity:0.6;cursor:default">
          <i class="ti ti-clock" style="font-size:20px;color:var(--am)"></i>
          <div class="amigo-card-info">
            <div class="amigo-card-nombre">${h(a.usuario.nombre)}</div>
            <div class="amigo-card-username">@${h(a.usuario.username||'')} · Solicitud enviada</div>
          </div>
        </div>`).join('') : '');
    list.querySelectorAll('[data-amistad]').forEach(c => c.addEventListener('click', () =>
      seleccionarAmigo(Number(c.dataset.amistad))));
  }
}

async function responderSolicitud(id, accion) {
  await apiFetch('/amigos/responder', { method:'POST', body: JSON.stringify({ amistad_id: id, accion }) });
  await loadAmigos();
  checkNotifications();
}

async function seleccionarAmigo(amistad_id) {
  const amigo = amigosData.find(a => a.amistad_id === amistad_id);
  if (!amigo) return;
  amigoSeleccionado = amigo;
  renderAmigos();
  document.getElementById('amigo-placeholder').style.display = 'none';
  document.getElementById('amigo-detalle').style.display = 'block';
  // Header
  const u = amigo.usuario;
  document.getElementById('amigo-detalle-nombre').textContent   = u.nombre;
  document.getElementById('amigo-detalle-username').textContent = '@' + (u.username || '');
  const av = document.getElementById('amigo-avatar');
  if (safeUrl(u.avatar)) { av.src = safeUrl(u.avatar); av.style.display = 'block'; } else av.style.display = 'none';
  document.getElementById('priv-amigo-nombre').textContent = u.nombre;
  // Load data
  await loadAmigoColeccion(amigo.amigo_id);
}

async function loadAmigoColeccion(amigo_id) {
  try {
    const data = await apiFetch('/amigos/' + amigo_id + '/coleccion');
    const p = data.privacidad;

    // Colección
    const colView = document.getElementById('amigo-coleccion-view');
    if (p.ver_coleccion) {
      const juegos = data.coleccion || [];
      if (!juegos.length) { colView.innerHTML = '<div class="empty-state" style="padding:2rem 0"><i class="ti ti-ghost"></i><p>No tiene juegos en su colección.</p></div>'; }
      else {
        const byPlat = {};
        juegos.forEach(g => { const k = g.plataforma||'Sin plataforma'; if(!byPlat[k])byPlat[k]=[]; byPlat[k].push(g); });
        colView.innerHTML = Object.keys(byPlat).sort().map(plat => `
          <div class="platform-section">
            <div class="platform-header"><i class="ti ti-device-gamepad"></i><span class="platform-name">${h(plat)}</span><span class="platform-count">${byPlat[plat].length} juego${byPlat[plat].length!==1?'s':''}</span></div>
            <div class="games-grid">${byPlat[plat].map(g=>`
              <div class="game-card">
                <div class="dot ${{'completado':'s-completado','jugando':'s-jugando','pendiente':'s-pendiente','abandonado':'s-abandonado'}[estadoKey(g.estado)]||'s-pendiente'}"></div>
                <div class="game-card-title">${h(g.nombre)}</div>
                ${g.genero?`<div class="game-card-meta">${h(g.genero)}</div>`:''}
                ${g.desarrolladora?`<div class="game-card-dev"><i class="ti ti-building-factory-2"></i> ${h(g.desarrolladora)}</div>`:''}
              </div>`).join('')}</div>
          </div>`).join('');
      }
    } else colView.innerHTML = '<div class="priv-locked"><i class="ti ti-lock"></i>Este amigo no comparte su colección contigo.</div>';

    // Jugando
    const jugView = document.getElementById('amigo-jugando-view');
    if (p.ver_jugando) {
      const juegos = data.jugando || [];
      if (!juegos.length) jugView.innerHTML = '<div class="empty-state" style="padding:2rem 0"><i class="ti ti-device-gamepad"></i><p>No está jugando nada actualmente.</p></div>';
      else jugView.innerHTML = '<div class="games-grid">' + juegos.map(g=>`
        <div class="game-card">
          <span class="badge-jugando" style="position:absolute;top:8px;right:8px">Jugando</span>
          <div class="game-card-title" style="padding-right:70px">${h(g.nombre)}</div>
          ${g.plataforma?`<div class="game-card-meta">${h(g.plataforma)}</div>`:''}
        </div>`).join('') + '</div>';
    } else jugView.innerHTML = '<div class="priv-locked"><i class="ti ti-lock"></i>Este amigo no comparte lo que está jugando.</div>';

    // Buscados
    const busView = document.getElementById('amigo-buscados-view');
    if (p.ver_buscados) {
      const juegos = data.buscados || [];
      if (!juegos.length) busView.innerHTML = '<div class="empty-state" style="padding:2rem 0"><i class="ti ti-bookmark"></i><p>No tiene títulos en búsqueda.</p></div>';
      else busView.innerHTML = '<div class="wish-list">' + juegos.map((g,i)=>`
        <div class="wish-item">
          <div class="wish-num">${String(i+1).padStart(2,'0')}</div>
          <div class="wish-title">${g.plataforma?`<span class="wish-platform">[${h(g.plataforma)}]</span> `:''}${h(g.nombre)}</div>
        </div>`).join('') + '</div>';
    } else busView.innerHTML = '<div class="priv-locked"><i class="ti ti-lock"></i>Este amigo no comparte sus títulos buscados.</div>';

    // Guardar privacidad actual para el modal
    document.getElementById('priv-coleccion').checked = !!p.ver_coleccion;
    document.getElementById('priv-jugando').checked   = !!p.ver_jugando;
    document.getElementById('priv-buscados').checked  = !!p.ver_buscados;

    // Cargar mi privacidad hacia él
    const miPriv = await apiFetch('/amigos/' + amigo_id + '/privacidad');
    document.getElementById('priv-coleccion').checked = !!miPriv.ver_coleccion;
    document.getElementById('priv-jugando').checked   = !!miPriv.ver_jugando;
    document.getElementById('priv-buscados').checked  = !!miPriv.ver_buscados;

  } catch(e) { console.error(e); }
}

// Buscar usuarios
document.getElementById('btn-amigo-search').addEventListener('click', async () => {
  const q = document.getElementById('amigo-search-input').value.trim();
  if (!q) return;
  const results = await apiFetch('/usuarios/buscar?q=' + encodeURIComponent(q));
  const div = document.getElementById('amigo-search-results');
  if (!results.length) { div.innerHTML = '<p style="font-size:12px;color:var(--am);margin:8px 0">No se encontraron usuarios.</p>'; return; }
  div.innerHTML = results.map(u => {
    const yaAmigo = amigosData.find(a => a.amigo_id === u.id);
    return `<div class="search-result-card">
      <div class="search-result-info">
        <div style="font-family:Orbitron,monospace;font-size:12px;color:var(--at)">${h(u.nombre)}</div>
        <div style="font-size:11px;color:#7c4dff">@${h(u.username||'sin username')}</div>
      </div>
      ${yaAmigo
        ? `<span style="font-size:11px;color:var(--am)">${yaAmigo.estado === 'aceptada' ? 'Ya son amigos' : 'Solicitud pendiente'}</span>`
        : `<button class="btn btn-primary btn-sm" data-solicitar="${intId(u.id)}"><i class="ti ti-user-plus"></i> Agregar</button>`}
    </div>`;
  }).join('');
  div.querySelectorAll('[data-solicitar]').forEach(b => b.addEventListener('click', () =>
    enviarSolicitud(Number(b.dataset.solicitar))));
});
document.getElementById('amigo-search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-amigo-search').click();
});

async function enviarSolicitud(usuario_id) {
  try {
    await apiFetch('/amigos/solicitar', { method:'POST', body: JSON.stringify({ receptor_id: usuario_id }) });
    document.getElementById('amigo-search-results').innerHTML = '<p style="font-size:12px;color:var(--agr);margin:8px 0">✅ Solicitud enviada.</p>';
    await loadAmigos();
  } catch(e) { alert(e.message); }
}

// Eliminar amigo — modal de confirmación
document.getElementById('btn-eliminar-amigo').addEventListener('click', () => {
  if (!amigoSeleccionado) return;
  document.getElementById('del-amigo-nombre').textContent = amigoSeleccionado.usuario.nombre;
  document.getElementById('modal-del-amigo').style.display = 'flex';
});
document.getElementById('modal-del-amigo-close').addEventListener('click', () => {
  document.getElementById('modal-del-amigo').style.display = 'none';
});
document.getElementById('modal-del-amigo-cancel').addEventListener('click', () => {
  document.getElementById('modal-del-amigo').style.display = 'none';
});
document.getElementById('modal-del-amigo-confirm').addEventListener('click', async () => {
  if (!amigoSeleccionado) return;
  await apiFetch('/amigos/' + amigoSeleccionado.amigo_id, { method:'DELETE' });
  document.getElementById('modal-del-amigo').style.display = 'none';
  amigoSeleccionado = null;
  document.getElementById('amigo-detalle').style.display = 'none';
  document.getElementById('amigo-placeholder').style.display = 'flex';
  await loadAmigos();
  checkNotifications();
});

// Privacidad
document.getElementById('btn-privacidad').addEventListener('click', () => {
  document.getElementById('modal-privacidad').style.display = 'flex';
});
document.getElementById('modal-priv-close').addEventListener('click', () => {
  document.getElementById('modal-privacidad').style.display = 'none';
});
document.getElementById('modal-privacidad').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-privacidad')) document.getElementById('modal-privacidad').style.display = 'none';
});
document.getElementById('btn-save-priv').addEventListener('click', async () => {
  if (!amigoSeleccionado) return;
  await apiFetch('/amigos/' + amigoSeleccionado.amigo_id + '/privacidad', {
    method: 'PUT',
    body: JSON.stringify({
      ver_coleccion: document.getElementById('priv-coleccion').checked ? 1 : 0,
      ver_jugando:   document.getElementById('priv-jugando').checked   ? 1 : 0,
      ver_buscados:  document.getElementById('priv-buscados').checked  ? 1 : 0,
    })
  });
  showMsg('priv-success');
});

// Sub-tabs del amigo
document.getElementById('amigo-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.amigo-tab'); if (!btn) return;
  document.querySelectorAll('.amigo-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.amigo-view').forEach(v => { v.classList.remove('active'); v.style.display='none'; });
  btn.classList.add('active');
  const view = document.getElementById('amigo-' + btn.dataset.view + '-view');
  view.classList.add('active'); view.style.display = 'block';
});

// ── BACKUP ───────────────────────────────────────────────────
document.getElementById('btn-backup-download').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/backup');
    if (!res.ok) throw new Error('Error al generar backup');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'gamevault_backup_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) {
    document.getElementById('backup-error-text').textContent = e.message;
    showMsg('backup-error');
  }
});

document.getElementById('file-backup-restore').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.juegos || !Array.isArray(data.juegos)) throw new Error('Formato de backup inválido');
    if (!confirm(`¿Restaurar ${data.juegos.length} juegos? Se agregarán a tu colección actual sin borrar los existentes.`)) return;
    const res  = await fetch('/api/backup/restore', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ juegos: data.juegos }) });
    const resp = await res.json();
    if (!res.ok) throw new Error(resp.error);
    document.getElementById('backup-success-text').textContent = `${resp.importados} juegos restaurados correctamente.`;
    showMsg('backup-success', 4000);
    refreshStats();
    await loadAllGames();
    renderCollection();
  } catch(e) {
    document.getElementById('backup-error-text').textContent = e.message;
    showMsg('backup-error');
  }
  e.target.value = '';
});

// ── NAVEGACIÓN ─────────────────────────────────────────────────
document.getElementById('tabs').addEventListener('click', e=>{
  const btn=e.target.closest('.tab'); if(!btn)return;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
  ({
    list:   ()=>{ refreshStats(); refreshCollection(); },
    edit:   ()=>refreshEditSelect(),
    delete: ()=>refreshDeleteList(),
    wish:   ()=>refreshWishList(),
    amigos: ()=>loadAmigos()
  })[btn.dataset.tab]?.();
});

refreshStats();
