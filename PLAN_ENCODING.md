# Plan de Solución: Problemas de Encoding en Importación Excel/CSV
## GameVault Project — 2026-07-13

---

## Resumen Ejecutivo

GameVault permite importar colecciones de juegos desde archivos CSV y Excel. Sin embargo, el pipeline de importación actual presenta fallas críticas que hacen la funcionalidad prácticamente inutilizable para usuarios hispanohablantes en Windows:

1. Los caracteres especiales (tildes, ñ) se corrompen al importar CSVs generados por Excel en español, porque Excel en Windows escribe archivos en la codificación cp1252 (Windows-1252), pero el código los lee como UTF-8.
2. Los archivos `.xlsx` reales son binarios (ZIP + XML) y no se pueden leer como texto plano; actualmente la importación de `.xlsx` falla silenciosamente o produce basura.
3. El separador de campo asumido es coma (`,`), pero Excel en configuración regional española/LATAM usa punto y coma (`;`), dejando todos los campos vacíos.

El impacto es total: un usuario típico hispanohablante que exporte su colección desde Excel y luego intente reimportarla obtendrá nombres de juegos corruptos, campos vacíos o un error de parseo sin mensaje claro.

---

## Problemas a Resolver

| # | Severidad | Archivo | Línea | Descripción |
|---|-----------|---------|-------|-------------|
| 1 | CRÍTICO | `public/js/app.js` | 648 | `file.text()` usa UTF-8 fijo. CSVs de Excel en Windows/Español usan cp1252; tildes y ñ se corrompen: "Acción" → "Acci├│n" |
| 2 | CRÍTICO | `public/index.html` + `app.js` | 275 / 637-694 | El input acepta `.xlsx`/`.xls` pero el código los parsea como texto plano — `.xlsx` es un binario ZIP+XML; la importación queda completamente rota |
| 3 | MODERADO | `public/js/app.js` | 652-673 | No se hace strip del BOM UTF-8 (`﻿`) al inicio del archivo; el nombre del primer juego queda con un carácter invisible al principio |
| 4 | MODERADO | `public/js/app.js` | 655-665 | El parser CSV solo reconoce `,` como delimitador. Excel en locale español/LATAM usa `;` — todos los campos quedan nulos |
| 5 | MODERADO | `public/js/app.js` | 339-359 | Exportación `.xls` como XML SpreadsheetML: si el usuario lo re-guarda desde Excel como `.xls` binario real, futuras reimportaciones fallan |
| 6 | MENOR | `public/js/app.js` | 986 | `file.text()` en backup restore sin manejo de error de encoding; un backup guardado con encoding incorrecto falla sin mensaje descriptivo |
| 7 | MENOR | `public/js/app.js` | 263-264 | Literal `'AÑO'` en código fuente vulnerable si el archivo se re-guarda con encoding incorrecto (cp1252 en vez de UTF-8) |
| 8 | MENOR | `server.js` | 4 | Parseo de `.env` no hace strip del BOM UTF-8; si `.env` tiene BOM, la primera variable queda con el prefijo `﻿` invisible |

---

## Opciones de Implementación

---

### Opción 1: Solución Minimalista — Quick-fix sin dependencias nuevas

**Filosofía:** Reparar el pipeline existente con el mínimo de cambios posibles, usando únicamente APIs nativas del navegador (`TextDecoder`, `FileReader`) y lógica JavaScript pura. No se agrega ninguna librería externa. Solo se soporta CSV (se elimina o advierte sobre `.xlsx`). Ideal si el objetivo es desplegar un parche urgente hoy mismo.

**Pros:**
- Cero dependencias nuevas, cero riesgo de supply-chain
- Tiempo de implementación muy bajo (2-3 horas)
- Cambios mínimos, fácil de revisar y hacer rollback
- No requiere bundler ni proceso de build
- Elimina los 5 problemas más impactantes (1, 3, 4, 7, 8)

**Contras:**
- No resuelve el problema 2 (`.xlsx` real sigue sin soporte)
- La detección de encoding es heurística, no perfecta
- No hay soporte nativo para tablas Excel con múltiples hojas
- El usuario debe seguir exportando desde Excel como CSV

**Complejidad:** Baja

**Tiempo estimado:** 2-3 horas

**Cambios requeridos:**

#### `public/index.html` — línea 274
Restringir el input para aceptar solo CSV, o mostrar advertencia para xlsx:
```html
<!-- ANTES -->
<input type="file" id="file-import" accept=".csv,.xls,.xlsx" style="display:none" />

<!-- DESPUÉS -->
<input type="file" id="file-import" accept=".csv" style="display:none" />
```
Y actualizar el label del botón:
```html
<!-- ANTES -->
<label ...>Importar CSV/Excel

<!-- DESPUÉS -->
<label ...>Importar CSV
```

#### `public/js/app.js` — función de importación (líneas 637-694)
Reemplazar `file.text()` por lectura con `TextDecoder` y detección de encoding + strip de BOM + detección de separador:

```javascript
// REEMPLAZAR el bloque try de la línea 647-694 por:

try {
  // 1. Leer el archivo como ArrayBuffer para controlar el encoding
  const buffer = await file.arrayBuffer();
  const bytes  = new Uint8Array(buffer);

  // 2. Detectar BOM y encoding
  //    BOM UTF-8: EF BB BF
  //    BOM UTF-16 LE: FF FE
  let encoding = 'windows-1252'; // default para Excel en Windows/Español
  let offset = 0;

  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    encoding = 'utf-8';
    offset = 3; // skip BOM
  } else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    encoding = 'utf-16le';
    offset = 2;
  } else {
    // Heurística: si hay bytes > 0x7F típicos de cp1252, usar cp1252
    // TextDecoder soporta 'windows-1252' en todos los navegadores modernos
    const sample = bytes.slice(0, 2000);
    const hasHighBytes = sample.some(b => b > 0x7F);
    encoding = hasHighBytes ? 'windows-1252' : 'utf-8';
  }

  const decoder = new TextDecoder(encoding);
  let text = decoder.decode(bytes.slice(offset));

  // 3. Normalizar saltos de línea y filtrar vacíos
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('El archivo debe tener al menos una fila de datos además del encabezado.');

  // 4. Detectar separador automáticamente desde la primera línea
  const firstLine = lines[0];
  const commaCount     = (firstLine.match(/,/g)  || []).length;
  const semicolonCount = (firstLine.match(/;/g)  || []).length;
  const tabCount       = (firstLine.match(/\t/g) || []).length;
  let sep = ',';
  if (semicolonCount > commaCount && semicolonCount > tabCount) sep = ';';
  else if (tabCount > commaCount) sep = '\t';

  const fields = ['nombre','plataforma','desarrolladora','anio','genero','clasificacion','num_jugadores','estado','region','contenido'];

  // 5. Parser CSV que respeta el separador detectado y maneja comillas
  function parseLine(line, separator) {
    const vals = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; } // escape ""
        else inQ = !inQ;
      } else if (c === separator && !inQ) {
        vals.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    vals.push(cur.trim());
    return vals;
  }

  // 6. Intentar mapear por header (si los headers coinciden con los campos)
  const headerVals = parseLine(lines[0], sep).map(h => h.toLowerCase().trim()
    .replace(/[áà]/g,'a').replace(/[éè]/g,'e').replace(/[íì]/g,'i')
    .replace(/[óò]/g,'o').replace(/[úù]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''));

  const fieldAliases = {
    nombre: ['nombre','name','titulo','title','juego'],
    plataforma: ['plataforma','platform','consola'],
    desarrolladora: ['desarrolladora','developer','dev','estudio','studio'],
    anio: ['anio','ano','year','año','fecha'],
    genero: ['genero','genre','genero'],
    clasificacion: ['clasificacion','rating','pegi','esrb'],
    num_jugadores: ['num_jugadores','jugadores','players','numjugadores'],
    estado: ['estado','status','completado'],
    region: ['region','zona'],
    contenido: ['contenido','content','notas','notes']
  };

  // Construir mapa de índice de columna → campo
  const colMap = {};
  headerVals.forEach((h, i) => {
    for (const [field, aliases] of Object.entries(fieldAliases)) {
      if (aliases.includes(h)) { colMap[i] = field; break; }
    }
  });

  // Si no se detectaron headers, caer en mapeo posicional
  const useHeaderMap = Object.keys(colMap).length >= 3;

  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l, sep);
    const obj  = {};
    if (useHeaderMap) {
      vals.forEach((v, i) => { if (colMap[i]) obj[colMap[i]] = v || null; });
    } else {
      fields.forEach((f, i) => { obj[f] = vals[i] || null; });
    }
    return obj;
  }).filter(r => r.nombre);

  if (!rows.length) throw new Error('No se encontraron filas con datos válidos. Verifica que el archivo tenga una fila de encabezado y datos.');

  importRows = rows;
  // ... resto del código de preview sin cambios ...
```

#### `public/js/app.js` — exportación CSV (líneas 339-344)
El BOM ya está presente (`'\xEF\xBB\xBF'`), bien. Asegurar que el separador exportado sea coma estándar y documentarlo:
```javascript
// Sin cambios en la lógica, pero agregar comentario y asegurar que
// el MIME type incluya charset:
download('gamevault_coleccion.csv', 'text/csv;charset=utf-8;', bom + csv);
// Ya está correcto. El BOM garantiza que Excel lo abra en UTF-8.
```

#### `public/js/app.js` — exportación Excel (líneas 346-359)
Cambiar extensión a `.xlsx` para que sea más claro que es XML, o renombrar a `.xml` para evitar confusión:
```javascript
// ANTES:
download('gamevault_coleccion.xls', 'application/vnd.ms-excel', xml);

// DESPUÉS: usar .xml para evitar que el usuario piense que es binario
// y luego lo re-guarde como binario real
download('gamevault_coleccion_excel.xml', 'application/vnd.ms-excel', xml);
// Alternativa: agregar advertencia en el botón sobre reimportación
```

#### `server.js` — línea 4
Strip del BOM en la primera línea del `.env`:
```javascript
// ANTES:
fs_env.readFileSync('.env','utf8').split('\n').forEach(line => {

// DESPUÉS:
fs_env.readFileSync('.env','utf8')
  .replace(/^﻿/, '')   // strip BOM UTF-8 si existe
  .split('\n').forEach(line => {
```

---

### Opción 2: Solución Intermedia — Parser Robusto con Detección Automática + Soporte XLS Legacy

**Filosofía:** Mejorar el pipeline de importación existente agregando una librería ligera de detección de encoding (`chardet` o similar en el lado cliente via CDN) y soporte para el formato SpreadsheetML (`.xls` como XML de Microsoft) que el propio GameVault exporta. Para `.xlsx` binario real se muestra un error descriptivo con instrucciones claras. Se mantiene la arquitectura actual (frontend puro, sin servidor) pero se añaden dependencias livianas via CDN.

**Pros:**
- Cubre el 90% de los casos reales de uso (CSV + XLS generado por GameVault)
- Soporte de reimportación del XLS que genera el propio GameVault
- Detección de encoding más robusta que la heurística manual
- Mensajes de error descriptivos para casos no soportados
- No requiere bundler; se agrega via `<script>` tag

**Contras:**
- Dependencia de CDN (riesgo de disponibilidad offline)
- `.xlsx` binario real (generado externamente) sigue sin soporte
- Añade ~50-100 KB de JS al bundle
- Complejidad media de implementación

**Complejidad:** Media

**Tiempo estimado:** 4-6 horas

**Cambios requeridos:**

#### `public/index.html` — sección `<head>`
Agregar librería `jschardet` (detección de encoding, ~30 KB minificado) via CDN:
```html
<!-- Agregar ANTES del cierre de </head> o antes de app.js -->
<script src="https://cdn.jsdelivr.net/npm/jschardet@3.0.0/dist/jschardet.min.js"></script>
```

#### `public/index.html` — línea 274
Mantener soporte para `.xls` y `.csv` (no `.xlsx` binario):
```html
<input type="file" id="file-import" accept=".csv,.xls" style="display:none" />
```

#### `public/js/app.js` — función principal de importación (línea 637 en adelante)
Reemplazar el handler de importación completo:

```javascript
document.getElementById('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // ... setup UI igual que antes ...

  try {
    const buffer = await file.arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    const ext    = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx') {
      // .xlsx real es un ZIP binario — no soportado en esta opción
      throw new Error(
        'Los archivos .xlsx requieren la versión Excel de importación. ' +
        'Por favor, guarda tu archivo desde Excel como "CSV UTF-8 (delimitado por comas)" ' +
        'o usa la opción "Guardar como > CSV" y luego impórtalo.'
      );
    }

    // Detectar si es SpreadsheetML (el .xls que GameVault exporta)
    const header = String.fromCharCode(...bytes.slice(0, 6));
    const isXmlExcel = header.startsWith('<?xml') || header.startsWith('<﻿?xml');

    if (ext === 'xls' || isXmlExcel) {
      // Parsear SpreadsheetML (XML de Microsoft Office)
      const xmlText = new TextDecoder('utf-8').decode(bytes);
      importRows = parseSpreadsheetML(xmlText);
    } else {
      // CSV: detectar encoding con jschardet
      importRows = await parseCsvWithEncoding(buffer, bytes);
    }

    if (!importRows.length) throw new Error('No se encontraron filas con datos válidos.');
    // ... código de preview sin cambios ...

  } catch(err) {
    document.getElementById('import-error-text').textContent = err.message;
    document.getElementById('import-error').classList.add('show');
  }
  e.target.value = '';
});

// --- Funciones auxiliares ---

async function parseCsvWithEncoding(buffer, bytes) {
  // 1. Detectar encoding con jschardet
  const detected = jschardet.detect(Buffer.from ? Buffer.from(bytes) : bytes);
  let encoding = (detected && detected.encoding) ? detected.encoding : 'windows-1252';
  // Normalizar nombres que TextDecoder no reconoce
  const encodingMap = { 'ISO-8859-1': 'windows-1252', 'ASCII': 'utf-8', 'UTF-8-SIG': 'utf-8' };
  encoding = encodingMap[encoding.toUpperCase()] || encoding.toLowerCase();

  // 2. Decodificar, stripeando BOM si existe
  let text;
  try {
    const decoder = new TextDecoder(encoding);
    text = decoder.decode(bytes);
  } catch(_) {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  text = text.replace(/^﻿/, ''); // strip BOM

  // 3. Detectar separador
  const firstLine = text.split(/\r?\n/)[0];
  const sep = detectSeparator(firstLine);

  // 4. Parsear
  const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('El archivo debe tener al menos una fila de datos.');
  return mapCsvRows(lines, sep);
}

function parseSpreadsheetML(xmlText) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlText, 'application/xml');
  const rows   = Array.from(doc.querySelectorAll('Row'));
  if (rows.length < 2) throw new Error('El archivo Excel no contiene datos.');

  const fields = ['nombre','plataforma','desarrolladora','anio','genero',
                   'clasificacion','num_jugadores','estado','region','contenido'];

  // Primera fila = headers
  const headers = Array.from(rows[0].querySelectorAll('Cell Data'))
    .map(d => d.textContent.toLowerCase().trim()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n'));

  return rows.slice(1).map(row => {
    const cells = Array.from(row.querySelectorAll('Cell Data')).map(d => d.textContent.trim());
    const obj   = {};
    headers.forEach((h, i) => {
      const field = fields.find(f => f === h || h.startsWith(f.slice(0,4)));
      if (field) obj[field] = cells[i] || null;
    });
    // Fallback posicional si no hay headers reconocibles
    if (!obj.nombre && cells[0]) {
      fields.forEach((f, i) => { obj[f] = cells[i] || null; });
    }
    return obj;
  }).filter(r => r.nombre);
}

function detectSeparator(line) {
  const counts = {
    ',': (line.match(/,/g)  || []).length,
    ';': (line.match(/;/g)  || []).length,
    '\t': (line.match(/\t/g) || []).length
  };
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
}

function parseLine(line, sep) {
  const vals = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) { vals.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  vals.push(cur.trim());
  return vals;
}

function mapCsvRows(lines, sep) {
  const fields = ['nombre','plataforma','desarrolladora','anio','genero',
                   'clasificacion','num_jugadores','estado','region','contenido'];
  return lines.slice(1).map(l => {
    const vals = parseLine(l, sep);
    const obj  = {};
    fields.forEach((f, i) => { obj[f] = vals[i] || null; });
    return obj;
  }).filter(r => r.nombre);
}
```

#### `server.js` — línea 4
Igual que Opción 1:
```javascript
fs_env.readFileSync('.env','utf8').replace(/^﻿/, '').split('\n').forEach(...)
```

#### `public/js/app.js` — backup restore (línea 986)
Agregar manejo de encoding:
```javascript
// ANTES:
const text = await file.text();

// DESPUÉS:
const buffer = await file.arrayBuffer();
const bytes  = new Uint8Array(buffer);
// Los backups JSON son siempre UTF-8; strip BOM por si acaso
const text   = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
```

---

### Opción 3: Solución Completa — Integración de SheetJS para Soporte Nativo de Excel

**Filosofía:** Integrar la librería SheetJS (`xlsx`) que es el estándar de facto para leer/escribir archivos Excel en el navegador. SheetJS soporta de forma nativa `.xlsx`, `.xls`, `.csv`, `.ods` y todos los encodings. Elimina completamente el parser CSV manual, el problema de encoding y el de formato binario. Adicionalmente, mejora la exportación para generar `.xlsx` reales en lugar del XML legacy. Esta es la solución de calidad de producción.

**Pros:**
- Resuelve los 8 problemas de forma definitiva
- Soporte nativo de `.xlsx`, `.xls`, `.csv` con cualquier encoding
- Lectura correcta de múltiples hojas, fechas, tipos de dato
- Exportación `.xlsx` real (binario) en lugar del XML legacy
- API estable y ampliamente probada (>25M descargas/semana en npm)
- No requiere servidor — todo en el frontend

**Contras:**
- Dependencia significativa: SheetJS ~700 KB minificado (o ~240 KB gzip)
- La versión Community (MIT) tiene algunas limitaciones; la Pro es de pago
- Primera carga de página más pesada
- Si se usa via CDN, requiere conexión a internet
- Requiere más tiempo de pruebas para validar casos edge

**Complejidad:** Alta

**Tiempo estimado:** 6-8 horas (incluyendo pruebas)

**Cambios requeridos:**

#### `public/index.html` — sección `<head>`
Cargar SheetJS via CDN (o descargar y servir localmente desde `public/js/`):
```html
<!-- Opción A: CDN (requiere internet) -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>

<!-- Opción B: local (recomendado para producción) -->
<!-- Descargar de https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
     y guardar en public/js/xlsx.full.min.js -->
<script src="/js/xlsx.full.min.js"></script>
```

#### `public/index.html` — línea 274
Restaurar soporte completo para todos los formatos:
```html
<input type="file" id="file-import" accept=".csv,.xls,.xlsx,.ods" style="display:none" />
```
Y actualizar el label del botón:
```html
<label ...><i class="ti ti-file-import"></i> Importar CSV/Excel
```

#### `public/js/app.js` — reemplazar el handler de importación completo (líneas 637-694)

```javascript
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
    const buffer = await file.arrayBuffer();

    // SheetJS lee el ArrayBuffer directamente, sin preocuparse del encoding
    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellText: true,   // convierte todo a texto
      raw: false,       // aplicar formato de celda
      codepage: 1252,   // fallback de encoding para XLS legado
    });

    // Tomar la primera hoja del workbook
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('El archivo no contiene hojas de datos.');
    const sheet = workbook.Sheets[sheetName];

    // Convertir a array de objetos con headers de la primera fila
    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,        // array de arrays
      defval: null,     // null para celdas vacías
      blankrows: false, // ignorar filas completamente vacías
    });

    if (rawRows.length < 2) throw new Error('El archivo debe tener al menos una fila de encabezado y una de datos.');

    // Mapear headers a campos internos (normalización de acentos y guiones)
    const normalize = s => (s || '').toString().toLowerCase().trim()
      .replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e')
      .replace(/[íìïî]/g,'i').replace(/[óòöô]/g,'o')
      .replace(/[úùüû]/g,'u').replace(/ñ/g,'n')
      .replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');

    const headerRow  = rawRows[0].map(normalize);
    const fields     = ['nombre','plataforma','desarrolladora','anio','genero',
                        'clasificacion','num_jugadores','estado','region','contenido'];
    const fieldAliases = {
      nombre:         ['nombre','name','titulo','title','juego','game'],
      plataforma:     ['plataforma','platform','consola','console'],
      desarrolladora: ['desarrolladora','developer','dev','estudio','studio'],
      anio:           ['anio','ano','year','fecha','ano_lanzamiento','release_year'],
      genero:         ['genero','genre','categoria','category'],
      clasificacion:  ['clasificacion','rating','pegi','esrb','clasificacion_edad'],
      num_jugadores:  ['num_jugadores','jugadores','players','numjugadores','numero_jugadores'],
      estado:         ['estado','status','completado','completion'],
      region:         ['region','zona','area','market'],
      contenido:      ['contenido','content','notas','notes','descripcion']
    };

    // Crear mapa columna → campo
    const colMap = {};
    headerRow.forEach((h, i) => {
      for (const [field, aliases] of Object.entries(fieldAliases)) {
        if (aliases.includes(h)) { colMap[i] = field; break; }
      }
    });

    const hasHeaders = Object.keys(colMap).length >= 3;

    const rows = rawRows.slice(1).map(rowArr => {
      const obj = {};
      if (hasHeaders) {
        rowArr.forEach((v, i) => {
          if (colMap[i]) obj[colMap[i]] = (v !== null && v !== undefined && v !== '') ? String(v).trim() : null;
        });
      } else {
        // Mapeo posicional de fallback
        fields.forEach((f, i) => {
          const v = rowArr[i];
          obj[f] = (v !== null && v !== undefined && v !== '') ? String(v).trim() : null;
        });
      }
      return obj;
    }).filter(r => r.nombre && r.nombre.trim());

    if (!rows.length) throw new Error('No se encontraron filas con datos válidos. Verifica que el archivo tenga encabezado y datos.');

    importRows = rows;

    // Preview — igual que el código original
    const tableHtml = `<table class="oracle-table" style="font-size:11px">
      <thead><tr>${fields.map(f => `<th>${f.toUpperCase()}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0,10).map(r =>
        `<tr>${fields.map(f => `<td>${r[f] || '<span style="color:#444">(null)</span>'}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>${rows.length > 10 ? `<p style="font-size:11px;color:#6b6b8a;margin-top:6px">... y ${rows.length-10} más</p>` : ''}`;

    document.getElementById('import-table-wrap').innerHTML = tableHtml;
    document.getElementById('import-count').textContent = `${rows.length} juego${rows.length!==1?'s':''} detectado${rows.length!==1?'s':''}`;
    document.getElementById('import-preview').style.display = 'block';
    document.getElementById('import-btn-count').textContent = rows.length;
    document.getElementById('import-confirm-btn').style.display = 'inline-flex';

  } catch(err) {
    document.getElementById('import-error-text').textContent = err.message;
    document.getElementById('import-error').classList.add('show');
  }
  e.target.value = '';
});
```

#### `public/js/app.js` — mejorar exportación Excel (líneas 345-359)
Reemplazar el XML SpreadsheetML por un `.xlsx` real generado con SheetJS:

```javascript
// En la función exportData, reemplazar el bloque 'else' (formato excel):
} else {
  // Generar .xlsx real con SheetJS
  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.aoa_to_sheet(allRows);

  // Ajustar ancho de columnas automáticamente
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...rows.map(r => (r[i] || '').length)
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Coleccion');

  // Escribir como ArrayBuffer y descargar
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = 'gamevault_coleccion.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

#### `server.js` — línea 4
Igual que opciones anteriores:
```javascript
fs_env.readFileSync('.env','utf8').replace(/^﻿/, '').split('\n').forEach(...)
```

#### `public/js/app.js` — backup restore (línea 986)
```javascript
// Agregar strip de BOM para robustez:
const buffer = await file.arrayBuffer();
const text   = new TextDecoder('utf-8').decode(new Uint8Array(buffer)).replace(/^﻿/, '');
const data   = JSON.parse(text);
```

---

## Comparación de Opciones

| Criterio | Opción 1: Minimalista | Opción 2: Intermedia | Opción 3: SheetJS Completo |
|----------|----------------------|---------------------|---------------------------|
| Soporte `.csv` UTF-8 | SI | SI | SI |
| Soporte `.csv` cp1252/España | SI (heurística) | SI (jschardet) | SI (nativo) |
| Soporte `.xls` SpreadsheetML | NO | SI | SI |
| Soporte `.xlsx` binario real | NO | NO | SI |
| Detección automática de separador | SI | SI | N/A (SheetJS lo maneja) |
| Strip de BOM | SI | SI | SI |
| Exportación `.xlsx` real | NO | NO | SI |
| Dependencias nuevas | Ninguna | jschardet (~30 KB) | SheetJS (~700 KB) |
| Requiere CDN / build | NO | CDN opcional | CDN o local |
| Tiempo de implementación | 2-3 h | 4-6 h | 6-8 h |
| Complejidad de mantenimiento | Baja | Media | Baja (la librería hace el trabajo) |
| Riesgo de regresión | Muy bajo | Bajo | Bajo-Medio |
| Problemas resueltos (de 8) | 6/8 | 7/8 | 8/8 |

---

## Recomendación

**Se recomienda la Opción 3 (SheetJS)** para una solución de producción duradera, con el siguiente razonamiento:

1. **Completitud:** Resuelve los 8 problemas identificados, incluyendo el más crítico: soporte real de `.xlsx` que cualquier usuario promedio de Excel va a intentar importar.
2. **Mantenibilidad:** Delegar el parsing a una librería probada con >25M descargas semanales es más seguro que mantener un parser casero con heurísticas de encoding. Los edge cases (fechas serializadas, celdas con fórmulas, múltiples hojas) están cubiertos.
3. **Experiencia de usuario:** Con la Opción 1 o 2, si el usuario intenta importar un `.xlsx` real desde Excel, recibe un error o datos corruptos. Con SheetJS, simplemente funciona.
4. **Exportación mejorada:** El XLS actual (XML SpreadsheetML) genera advertencias en Excel moderno y puede corrupcionar al re-guardarse. Exportar `.xlsx` real elimina ese problema.

**Si el tiempo es crítico** (necesidad de deploy urgente esta semana), implementar primero la **Opción 1** como parche de emergencia, y luego la **Opción 3** como mejora planificada en el siguiente sprint.

**Nota sobre el peso de SheetJS:** Los ~700 KB del bundle se pueden mitigar descargando solo el módulo `xlsx.mini.min.js` (~200 KB) si no se necesita soporte de formatos exóticos (ODS, XLSB), o configurando lazy loading de la librería solo cuando el usuario abre el modal de importación.

---

## Plan de Pruebas

Para verificar que los problemas están resueltos, ejecutar la siguiente batería de pruebas manualmente:

### Prueba 1 — CSV UTF-8 con BOM (el que genera GameVault)
- Exportar la colección como CSV desde GameVault
- Importar el mismo CSV
- Verificar: nombres con tildes/ñ aparecen correctamente, sin carácter `﻿` al inicio del primer nombre

### Prueba 2 — CSV generado por Excel en Windows (cp1252, separador `;`)
- En Excel: Archivo > Guardar como > CSV (delimitado por comas)
  - En un sistema con locale español, esto produce separador `;` y encoding cp1252
- Importar en GameVault
- Verificar: tildes y ñ se leen correctamente, campos en las columnas correctas

### Prueba 3 — CSV UTF-8 sin BOM (generado por LibreOffice, Google Sheets, macOS)
- Exportar desde Google Sheets como "Valores separados por comas (.csv)"
- Importar en GameVault
- Verificar: tildes correctas, campos correctos

### Prueba 4 — XLSX desde Excel (solo Opción 3)
- Crear una hoja en Excel con columnas: NOMBRE, PLATAFORMA, DESARROLLADORA, ANIO, GENERO
- Rellenar 5 juegos con nombres que incluyan tildes y ñ (ej. "Año de la Conquista", "Acción RPG")
- Guardar como `.xlsx`
- Importar en GameVault
- Verificar: todos los campos correctos, sin corrupción de caracteres

### Prueba 5 — XLS SpreadsheetML (el que exporta GameVault, Opciones 2 y 3)
- Exportar como Excel desde GameVault (genera `.xls` XML)
- Importar ese mismo archivo
- Verificar: datos íntegros, reimportación exitosa

### Prueba 6 — Archivo con encoding incorrecto / extensión incorrecta
- Intentar importar un PDF renombrado a `.csv`
- Verificar: aparece mensaje de error descriptivo (no un crash)

### Prueba 7 — .env con BOM
- Abrir `.env` en Notepad, guardarlo "con BOM" (Archivo > Guardar como > Codificación: UTF-8 con BOM)
- Reiniciar el servidor
- Verificar: las variables de entorno funcionan correctamente (no hay `﻿` al inicio de PORT u otras claves)

### Prueba 8 — Backup restore con encoding
- Crear un backup desde GameVault
- Restaurarlo
- Verificar: juegos con tildes/ñ restaurados correctamente

### Criterios de éxito
- "Acción" no aparece como "Acci├│n" en ningún caso
- "AÑO" no aparece como "AÃ'O" o similar
- El campo `nombre` de la primera fila no empieza con el carácter invisible `﻿` (U+FEFF)
- Con separador `;`: los 10 campos se mapean correctamente (no todo en el primer campo)
- Sin errores de consola del navegador durante la importación
- El servidor arranca sin advertencias sobre variables de entorno con prefijo extraño

---

*Plan generado para GameVault — 2026-07-13*
*Archivos afectados: `public/js/app.js`, `public/index.html`, `server.js`*
