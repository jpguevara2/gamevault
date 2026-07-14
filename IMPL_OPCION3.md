# Plan de Implementación — Opción 3: SheetJS
## GameVault Project — 2026-07-13

## Objetivo

Integrar la librería SheetJS (`xlsx` 0.20.3, Community Edition MIT) para reemplazar el pipeline de importación/exportación actual de GameVault. El pipeline actual falla de forma crítica con archivos reales de usuarios hispanohablantes: lee `.xlsx` binarios como texto plano (corrupción total), asume UTF-8 en CSVs que Excel genera en cp1252 (caracteres corruptos), y solo reconoce coma como separador (falla con configuración regional española/LATAM que usa punto y coma). SheetJS resuelve los 8 problemas identificados de forma definitiva, delegando el parsing a una librería probada con más de 25 millones de descargas semanales en npm.

## Pre-requisitos

- **Versión de SheetJS:** xlsx 0.20.3 (Community Edition, licencia MIT)
- **Cómo obtenerla:**
  - **Opción A — CDN (más rápido):** URL directa: `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`
  - **Opción B — Local (recomendado para producción):** Descargar el archivo anterior y guardarlo en `C:\Users\HP\Desktop\gamevault\public\js\xlsx.full.min.js`
- **Tamaño:** ~700 KB sin comprimir, ~240 KB con gzip
- **Verificación del entorno:**
  - El proyecto es frontend puro (sin bundler/webpack), se carga todo via `<script>` tags en `index.html`
  - Node.js/servidor (`server.js`) no necesita la librería — SheetJS solo corre en el navegador
  - El servidor debe estar corriendo (`node server.js`) para probar la app durante la implementación

---

## Fase 1: Instalación y Setup de SheetJS

**Objetivo de la fase:** Tener SheetJS disponible en el navegador como variable global `XLSX`, verificable desde la consola del navegador, sin haber tocado ninguna lógica de `app.js`.

**Duración estimada:** 20-30 minutos

**Archivos modificados:** `public/index.html`

---

### Paso 1.1 — Descargar SheetJS localmente (recomendado)

Descargar el archivo de distribución completa de SheetJS 0.20.3 y colocarlo en la carpeta de scripts del proyecto. Esto evita dependencia de red en producción y carga de página más predecible.

**Comando para descargar (PowerShell):**
```powershell
Invoke-WebRequest `
  -Uri "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" `
  -OutFile "C:\Users\HP\Desktop\gamevault\public\js\xlsx.full.min.js"
```

**Verificar que el archivo existe y tiene tamaño razonable:**
```powershell
Get-Item "C:\Users\HP\Desktop\gamevault\public\js\xlsx.full.min.js" | Select-Object Name, Length
# Debe mostrar Length alrededor de 700000 (700 KB)
```

Si la descarga falla o no hay conexión en ese momento, se puede usar el CDN temporalmente en el Paso 1.2 y descargar después.

---

### Paso 1.2 — Agregar la etiqueta `<script>` en `index.html`

SheetJS debe cargarse **antes** que `app.js` para que el objeto `XLSX` esté disponible cuando el código de importación/exportación se ejecute.

**Archivo:** `public/index.html`

Buscar la etiqueta `<script>` que carga `app.js` (aproximadamente al final del `<body>`). Agregar el script de SheetJS inmediatamente antes.

**ANTES** (buscar esta línea al final del archivo, cerca del cierre de `</body>`):
```html
    <script src="/js/app.js"></script>
```

**DESPUÉS:**
```html
    <!-- SheetJS 0.20.3 — Lectura/escritura de Excel y CSV con soporte de encoding nativo -->
    <!-- Opción A: local (recomendado) — requiere haber ejecutado el Paso 1.1 -->
    <script src="/js/xlsx.full.min.js"></script>
    <!-- Opción B: CDN (usar si no se descargó localmente, requiere internet) -->
    <!-- <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script> -->
    <script src="/js/app.js"></script>
```

Solo una de las dos opciones (A o B) debe estar activa al mismo tiempo. La otra debe quedar comentada.

---

### Verificación de Fase 1

**Sin modificar `app.js`**, abrir la aplicación en el navegador y verificar que SheetJS cargó correctamente:

1. Iniciar el servidor: `node server.js`
2. Abrir `http://localhost:3000` (o el puerto configurado) en Chrome/Firefox
3. Abrir la consola del navegador (F12 > Console)
4. Escribir y ejecutar:
   ```javascript
   typeof XLSX
   // Resultado esperado: "object"

   XLSX.version
   // Resultado esperado: "0.20.3"

   typeof XLSX.read
   // Resultado esperado: "function"

   typeof XLSX.utils.sheet_to_json
   // Resultado esperado: "function"
   ```
5. Verificar en la pestaña Network (F12 > Network, recargar página) que `xlsx.full.min.js` se carga con estado 200

**Si SheetJS NO carga:**
- Revisar la consola por errores de 404 (el archivo no está en la ruta correcta)
- Confirmar que el archivo está en `public/js/xlsx.full.min.js` y no en otra subcarpeta
- Si se usa CDN, verificar conexión a internet y que la URL es correcta
- Verificar que la etiqueta `<script>` está antes de `<script src="/js/app.js"></script>` y no después

**No continuar a la Fase 2 hasta que `typeof XLSX === "object"` sea confirmado.**

---

## Fase 2: Reemplazar el Pipeline de Importación

**Objetivo de la fase:** Reemplazar completamente el handler de importación en `app.js` para usar SheetJS. Al terminar esta fase, se podrá importar correctamente CSV con encoding cp1252, CSV UTF-8, CSV con separador `;`, y archivos `.xlsx` reales de Excel — todo sin corrupción de caracteres. La exportación no se toca en esta fase.

**Duración estimada:** 2-3 horas

**Archivos modificados:** `public/js/app.js`, `public/index.html`

---

### Paso 2.1 — Reemplazar el handler completo del evento `change` en `file-import`

Este es el cambio principal de la fase. El handler actual (líneas 637–695 de `app.js`) usa `file.text()` que fuerza UTF-8 y solo parsea CSV con separador coma. Se reemplaza íntegramente por un handler que usa `XLSX.read()`.

**Archivo:** `public/js/app.js`

**ANTES** (líneas 637–695, bloque completo a reemplazar):
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
    const text = await file.text();
    const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('El archivo debe tener al menos una fila de datos además del encabezado.');

    const fields = ['nombre','plataforma','desarrolladora','anio','genero','clasificacion','num_jugadores','estado','region','contenido'];

    // Parse CSV (simple, maneja comillas)
    function parseLine(line) {
      const vals = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      vals.push(cur.trim());
      return vals;
    }

    const rows = lines.slice(1).map(l => {
      const vals = parseLine(l);
      const obj = {};
      fields.forEach((f, i) => { obj[f] = vals[i] || null; });
      return obj;
    }).filter(r => r.nombre);

    if (!rows.length) throw new Error('No se encontraron filas con datos válidos.');

    importRows = rows;

    // Preview
    const tableHtml = `<table class="oracle-table" style="font-size:11px">
      <thead><tr>${fields.map(f => `<th>${f.toUpperCase()}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0,10).map(r => `<tr>${fields.map(f => `<td>${r[f]||'<span style="color:#444">(null)</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
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
  e.target.value = ''; // reset input
});
```

**DESPUÉS** (reemplazar el bloque anterior completo por este):
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
    // Guardia: verificar que SheetJS está disponible antes de continuar
    if (typeof XLSX === 'undefined') {
      throw new Error(
        'La librería de importación (SheetJS) no está disponible. ' +
        'Recarga la página. Si el problema persiste, verifica tu conexión a internet.'
      );
    }

    const buffer = await file.arrayBuffer();

    // SheetJS lee el ArrayBuffer directamente y maneja encoding nativo
    // (UTF-8, cp1252, UTF-16, etc.) para CSV, XLS y XLSX sin configuración adicional
    const workbook = XLSX.read(buffer, {
      type: 'array',     // el input es un ArrayBuffer
      cellText: true,    // convierte valores numéricos/fecha a texto
      raw: false,        // aplicar formato de celda (no valores raw)
      codepage: 1252,    // codepage de fallback para XLS legado y CSV sin BOM
    });

    // Tomar la primera hoja disponible del workbook
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('El archivo no contiene hojas de datos.');
    const sheet = workbook.Sheets[sheetName];

    // Convertir la hoja a array de arrays (primera fila = headers)
    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,        // devuelve array de arrays en lugar de array de objetos
      defval: null,     // celdas vacías quedan como null
      blankrows: false, // ignorar filas completamente vacías
    });

    if (!rawRows || rawRows.length < 2) {
      throw new Error('El archivo debe tener al menos una fila de encabezado y una fila de datos.');
    }

    // Normalizar headers: minúsculas, sin acentos, sin caracteres especiales
    const normalizeHeader = s => (s || '').toString().toLowerCase().trim()
      .replace(/[áàäâã]/g, 'a').replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g,  'i').replace(/[óòöôõ]/g, 'o')
      .replace(/[úùüû]/g,  'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    const headerRow = rawRows[0].map(normalizeHeader);

    const fields = [
      'nombre', 'plataforma', 'desarrolladora', 'anio', 'genero',
      'clasificacion', 'num_jugadores', 'estado', 'region', 'contenido'
    ];

    // Tabla de aliases: permite importar archivos con distintos nombres de columna
    const fieldAliases = {
      nombre:         ['nombre', 'name', 'titulo', 'title', 'juego', 'game'],
      plataforma:     ['plataforma', 'platform', 'consola', 'console'],
      desarrolladora: ['desarrolladora', 'developer', 'dev', 'estudio', 'studio'],
      anio:           ['anio', 'ano', 'year', 'fecha', 'ano_lanzamiento', 'release_year'],
      genero:         ['genero', 'genre', 'categoria', 'category'],
      clasificacion:  ['clasificacion', 'rating', 'pegi', 'esrb', 'clasificacion_edad'],
      num_jugadores:  ['num_jugadores', 'jugadores', 'players', 'numjugadores', 'numero_jugadores'],
      estado:         ['estado', 'status', 'completado', 'completion'],
      region:         ['region', 'zona', 'area', 'market'],
      contenido:      ['contenido', 'content', 'notas', 'notes', 'descripcion']
    };

    // Construir mapa de índice de columna → nombre de campo interno
    const colMap = {};
    headerRow.forEach((h, i) => {
      for (const [field, aliases] of Object.entries(fieldAliases)) {
        if (aliases.includes(h)) { colMap[i] = field; break; }
      }
    });

    // Si se reconocen 3 o más columnas por nombre, usar mapeo por header.
    // Si no, usar mapeo posicional (columna 0 = nombre, 1 = plataforma, etc.)
    const hasHeaders = Object.keys(colMap).length >= 3;

    const rows = rawRows.slice(1).map(rowArr => {
      const obj = {};
      if (hasHeaders) {
        rowArr.forEach((v, i) => {
          if (colMap[i]) {
            obj[colMap[i]] = (v !== null && v !== undefined && v !== '') ? String(v).trim() : null;
          }
        });
      } else {
        // Fallback posicional: asume orden estándar de GameVault
        fields.forEach((f, i) => {
          const v = rowArr[i];
          obj[f] = (v !== null && v !== undefined && v !== '') ? String(v).trim() : null;
        });
      }
      return obj;
    }).filter(r => r.nombre && r.nombre.trim() !== '');

    if (!rows.length) {
      throw new Error(
        'No se encontraron filas con datos válidos. ' +
        'Verifica que el archivo tenga una fila de encabezado con los nombres de columna ' +
        'y al menos una fila de datos con el campo "NOMBRE" o "nombre" completado.'
      );
    }

    importRows = rows;

    // Preview — misma estructura visual que el código original
    const tableHtml = `<table class="oracle-table" style="font-size:11px">
      <thead><tr>${fields.map(f => `<th>${f.toUpperCase()}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 10).map(r =>
        `<tr>${fields.map(f => `<td>${r[f] || '<span style="color:#444">(null)</span>'}</td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table>${rows.length > 10 ? `<p style="font-size:11px;color:#6b6b8a;margin-top:6px">... y ${rows.length - 10} más</p>` : ''}`;

    document.getElementById('import-table-wrap').innerHTML = tableHtml;
    document.getElementById('import-count').textContent = `${rows.length} juego${rows.length !== 1 ? 's' : ''} detectado${rows.length !== 1 ? 's' : ''}`;
    document.getElementById('import-preview').style.display = 'block';
    document.getElementById('import-btn-count').textContent = rows.length;
    document.getElementById('import-confirm-btn').style.display = 'inline-flex';

  } catch (err) {
    document.getElementById('import-error-text').textContent = err.message;
    document.getElementById('import-error').classList.add('show');
  }
  e.target.value = ''; // reset input para permitir reimportar el mismo archivo
});
```

---

### Paso 2.2 — Funciones auxiliares (ya integradas en el handler)

A diferencia de las Opciones 1 y 2, con SheetJS no se necesitan funciones auxiliares externas para normalización de encoding ni para parsear CSV manualmente. La función `normalizeHeader` y la tabla `fieldAliases` están definidas dentro del handler en el Paso 2.1.

La única función que conviene extraer si el proyecto crece es `normalizeHeader`, pero para el estado actual del proyecto es suficiente mantenerla inline.

**No hay código adicional que agregar para este paso.** Si en el futuro se necesita reutilizar la normalización en otro contexto, extraer así:

```javascript
// Función auxiliar reutilizable (extraer antes del handler si se necesita en más lugares)
function normalizeFieldName(s) {
  return (s || '').toString().toLowerCase().trim()
    .replace(/[áàäâã]/g, 'a').replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g,  'i').replace(/[óòöôõ]/g, 'o')
    .replace(/[úùüû]/g,  'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}
```

---

### Paso 2.3 — Actualizar el atributo `accept` del input file en `index.html`

El input actualmente acepta `.csv,.xls,.xlsx`. Con SheetJS también se puede aceptar `.ods` (LibreOffice). Actualizar para reflejar el soporte real.

**Archivo:** `public/index.html`

**Línea:** 274 (aproximadamente)

**ANTES:**
```html
        <label class="btn btn-ghost btn-sm" id="btn-import-label" style="cursor:pointer"><i class="ti ti-file-import"></i> Importar CSV/Excel
          <input type="file" id="file-import" accept=".csv,.xls,.xlsx" style="display:none" />
        </label>
```

**DESPUÉS:**
```html
        <label class="btn btn-ghost btn-sm" id="btn-import-label" style="cursor:pointer"><i class="ti ti-file-import"></i> Importar CSV/Excel
          <input type="file" id="file-import" accept=".csv,.xls,.xlsx,.ods" style="display:none" />
        </label>
```

---

### Verificación de Fase 2

Ejecutar las siguientes pruebas en orden. Cada prueba debe pasar antes de continuar a la siguiente.

**Prueba 2-A — CSV generado por GameVault (UTF-8 con BOM, separador coma):**
1. Exportar la colección actual desde GameVault como CSV
2. Importar ese mismo archivo CSV
3. Resultado esperado: todos los juegos aparecen en el preview con tildes y ñ correctos, sin carácter invisible al inicio del primer nombre
4. Confirmar importación y verificar en la colección

**Prueba 2-B — CSV generado por Excel en Windows (cp1252, separador punto y coma):**
1. Abrir cualquier CSV en Excel > Guardar como > CSV (separado por comas) con locale español activado
   - En la práctica esto genera encoding cp1252 y separador `;`
   - Si no se tiene Excel disponible, crear un archivo de texto con contenido:
     ```
     NOMBRE;PLATAFORMA;ANIO
     Acción RPG;PlayStation 4;2021
     El Año Perdido;Nintendo Switch;2020
     ```
     y guardarlo como `.csv` con encoding ANSI (cp1252) desde Notepad (Guardar como > Codificación: ANSI)
2. Importar en GameVault
3. Resultado esperado: "Acción RPG" se muestra como "Acción RPG" (no "Acci├│n RPG"), "El Año Perdido" correcto, los campos se separan correctamente en las columnas correspondientes

**Prueba 2-C — XLSX real de Excel:**
1. Crear un archivo `.xlsx` en Excel con columnas: NOMBRE, PLATAFORMA, DESARROLLADORA, ANIO, GENERO
2. Agregar filas con nombres que incluyan tildes: "Año de la Conquista", "Acción RPG", "Señor de los Anillos"
3. Guardar como `.xlsx`
4. Importar en GameVault
5. Resultado esperado: todos los campos correctos, sin corrupción de caracteres

**Prueba 2-D — Fallback cuando SheetJS no está cargado:**
1. Comentar temporalmente la etiqueta `<script src="/js/xlsx.full.min.js"></script>` en `index.html`
2. Recargar la página
3. Intentar importar cualquier archivo
4. Resultado esperado: aparece el mensaje "La librería de importación (SheetJS) no está disponible. Recarga la página..."
5. Descomentar la etiqueta antes de continuar

**Criterios de éxito de Fase 2:**
- "Acción" no aparece como "Acci├│n" en ningún caso
- "AÑO" no aparece como "AÃ'O" o similar
- El campo `nombre` de la primera fila no empieza con el carácter invisible U+FEFF
- Con separador `;` los campos se distribuyen correctamente entre columnas
- Sin errores de consola del navegador (F12 > Console) durante la importación

---

## Fase 3: Mejorar la Exportación y Fixes Menores

**Objetivo de la fase:** Reemplazar la exportación Excel legacy (XML SpreadsheetML `.xls`) por un `.xlsx` binario real usando SheetJS, y aplicar los tres fixes menores restantes: BOM en `server.js`, encoding en backup restore, y salvaguarda del literal `AÑO`. Al terminar esta fase los 8 problemas del plan están resueltos.

**Duración estimada:** 1-2 horas

**Archivos modificados:** `public/js/app.js`, `server.js`

---

### Paso 3.1 — Reemplazar exportación XLS XML por XLSX real con SheetJS

La exportación actual (líneas 345–360 de `app.js`) genera un archivo `.xls` que en realidad es XML SpreadsheetML. Excel moderno lo abre con una advertencia de formato, y si el usuario lo re-guarda como `.xls` binario real, la reimportación falla. SheetJS permite generar un `.xlsx` binario verdadero con pocas líneas.

**Archivo:** `public/js/app.js`

**ANTES** (bloque `else` dentro de `exportData`, aproximadamente líneas 345–360):
```javascript
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
```

**DESPUÉS** (reemplazar el bloque `else` anterior por este):
```javascript
  } else {
    // Generar .xlsx real con SheetJS (binario, compatible con Excel, LibreOffice, Google Sheets)
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(allRows);

    // Ajustar ancho de columnas automáticamente según el contenido máximo
    ws['!cols'] = headers.map(function(h, i) {
      var maxLen = Math.max(
        h.length,
        Math.max.apply(null, rows.map(function(r) { return (r[i] || '').length; }))
      );
      return { wch: Math.min(maxLen + 2, 40) };
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Coleccion');

    // Escribir el workbook como ArrayBuffer y descargar como Blob
    var wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url   = URL.createObjectURL(blob);
    var a     = document.createElement('a');
    a.href = url;
    a.download = 'gamevault_coleccion.xlsx';
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  }
```

**Nota:** La función `download()` existente (líneas 362–368) no se modifica. El nuevo bloque `else` crea su propio Blob y anchor directamente, sin llamar a `download()`, porque el tipo de dato es un `ArrayBuffer` y no una cadena de texto.

---

### Paso 3.2 — Fix del BOM en `server.js`

El parser del archivo `.env` en `server.js` no hace strip del BOM UTF-8 (bytes `EF BB BF`). Si el usuario edita `.env` con Notepad y lo guarda como "UTF-8 con BOM", la primera variable de entorno queda con el prefijo invisible `﻿`, causando que la variable no se lea correctamente.

**Archivo:** `server.js`

**Línea:** 4

**ANTES:**
```javascript
  fs_env.readFileSync('.env','utf8').split('\n').forEach(line => {
```

**DESPUÉS:**
```javascript
  fs_env.readFileSync('.env','utf8').replace(/^﻿/, '').split('\n').forEach(line => {
```

**Nota:** `﻿` es el código Unicode del BOM (U+FEFF). Es más claro que la secuencia de escape literal `\xEF\xBB\xBF` y funciona igual porque Node.js lee el archivo como string Unicode.

---

### Paso 3.3 — Fix del backup restore en `app.js`

El handler de restauración de backup (línea 986 de `app.js`) usa `file.text()` que fuerza UTF-8. Si el archivo de backup fue guardado con BOM (por ejemplo, abierto y re-guardado desde Notepad), `JSON.parse()` lanza un error porque el BOM no es JSON válido. Se reemplaza por lectura con `ArrayBuffer` y strip explícito de BOM.

**Archivo:** `public/js/app.js`

**Línea:** 986

**ANTES:**
```javascript
    const text = await file.text();
    const data = JSON.parse(text);
```

**DESPUÉS:**
```javascript
    // Leer como ArrayBuffer para poder hacer strip del BOM UTF-8 si existe
    const buffer = await file.arrayBuffer();
    const text   = new TextDecoder('utf-8').decode(new Uint8Array(buffer)).replace(/^﻿/, '');
    const data   = JSON.parse(text);
```

---

### Paso 3.4 — Salvaguarda del literal `AÑO` — asegurar que `app.js` esté guardado en UTF-8

El literal `'AÑO'` en la línea 264 de `app.js` es vulnerable a corrupción si el archivo se re-edita y se guarda en cp1252 en lugar de UTF-8. Esto no requiere un cambio de código, sino una verificación y configuración del editor.

**Verificación:**
1. Abrir `public/js/app.js` en VS Code
2. Observar la esquina inferior derecha de VS Code: debe decir `UTF-8`
3. Si dice `Windows 1252` u otro encoding: hacer clic en el nombre del encoding > seleccionar "Reopen with Encoding" > UTF-8 > verificar que `AÑO` se ve correctamente > guardar

**Configuración preventiva para VS Code** (evita que futuros guardados cambien el encoding):

Verificar o crear el archivo `.vscode/settings.json` en la raíz del proyecto con:
```json
{
  "files.encoding": "utf8",
  "files.autoGuessEncoding": false
}
```

Esto garantiza que VS Code siempre guarde los archivos del proyecto en UTF-8, protegiéndose contra corrupción futura del literal `AÑO` y cualquier otro carácter especial en el código fuente.

**Verificación adicional desde terminal:**
```powershell
# Verificar que el archivo es UTF-8 buscando los bytes de 'Ñ' en UTF-8 (C3 91)
$bytes = [System.IO.File]::ReadAllBytes("C:\Users\HP\Desktop\gamevault\public\js\app.js")
$idx = 0
for ($i = 0; $i -lt $bytes.Length - 1; $i++) {
  if ($bytes[$i] -eq 0xC3 -and $bytes[$i+1] -eq 0x91) { $idx = $i; break }
}
if ($idx -gt 0) { "OK: AÑO encontrado en UTF-8 en byte $idx" } else { "ALERTA: Ñ no encontrada en UTF-8 — revisar encoding del archivo" }
```

---

### Verificación de Fase 3

**Prueba 3-A — Exportar XLSX y reimportar (ciclo completo):**
1. Desde GameVault, hacer clic en "Exportar Excel"
2. Verificar que se descarga un archivo llamado `gamevault_coleccion.xlsx` (no `.xls`)
3. Abrir el archivo en Excel: no debe aparecer ninguna advertencia de "El archivo está en un formato diferente al especificado"
4. Importar ese mismo `.xlsx` de vuelta en GameVault usando el nuevo pipeline de la Fase 2
5. Resultado esperado: todos los juegos importados correctamente, tildes y ñ intactos

**Prueba 3-B — Exportar CSV y reimportar:**
1. Exportar como CSV
2. Abrir el CSV en Excel: los caracteres especiales deben verse correctamente
3. Importar el CSV en GameVault
4. Resultado esperado: reimportación exitosa

**Prueba 3-C — Backup restore con BOM:**
1. Crear un backup desde GameVault (panel de Backup)
2. Abrir el archivo `.json` de backup con Notepad
3. Guardar desde Notepad con "Codificación: UTF-8 con BOM" (si Notepad lo permite) o simplemente restaurar el backup original
4. Importar el backup en GameVault
5. Resultado esperado: restauración exitosa, sin error de JSON.parse

**Prueba 3-D — .env con BOM:**
1. Abrir `.env` con Notepad > Guardar como > Codificación: UTF-8 con BOM (si Notepad ofrece esta opción)
2. Reiniciar el servidor: `node server.js`
3. Resultado esperado: el servidor arranca sin errores, las variables de entorno funcionan normalmente
4. Restaurar `.env` a UTF-8 sin BOM para producción

**Criterios de éxito de Fase 3:**
- El archivo exportado como "Excel" es un `.xlsx` real (se puede verificar renombrándolo a `.zip` y extrayendo — debe contener carpetas `xl/`, `_rels/`, etc.)
- Excel no muestra advertencia de formato al abrir el `.xlsx` exportado
- El ciclo exportar-importar preserva todos los datos
- El servidor arranca correctamente con un `.env` que tiene BOM

---

## Resumen de Cambios por Archivo

| Archivo | Fase | Líneas modificadas | Descripción del cambio |
|---------|------|--------------------|------------------------|
| `public/index.html` | 1 | ~final del `<body>` | Agregar `<script src="/js/xlsx.full.min.js"></script>` antes de `app.js` |
| `public/index.html` | 2 | 274 | Cambiar `accept=".csv,.xls,.xlsx"` a `accept=".csv,.xls,.xlsx,.ods"` |
| `public/js/app.js` | 2 | 637–695 | Reemplazar handler de importación completo por versión con SheetJS |
| `public/js/app.js` | 3 | 345–360 (bloque `else` en `exportData`) | Reemplazar generación de XML SpreadsheetML por `XLSX.write()` con bookType xlsx |
| `public/js/app.js` | 3 | 986–987 | Reemplazar `file.text()` + `JSON.parse` por ArrayBuffer + TextDecoder + strip BOM |
| `server.js` | 3 | 4 | Agregar `.replace(/^﻿/, '')` antes de `.split('\n')` |
| `public/js/xlsx.full.min.js` | 1 | archivo nuevo | Archivo de distribución de SheetJS 0.20.3 descargado localmente |

---

## Orden de Ejecución Recomendado

1. **[Fase 1] Paso 1.1** — Descargar `xlsx.full.min.js` a `public/js/`
2. **[Fase 1] Paso 1.2** — Agregar `<script>` de SheetJS en `index.html` antes de `app.js`
3. **[Fase 1] Verificación** — Confirmar `typeof XLSX === "object"` y `XLSX.version === "0.20.3"` en consola del navegador antes de continuar
4. **[Fase 2] Paso 2.3** — Actualizar el `accept` del input file en `index.html` (cambio trivial, hacerlo ahora)
5. **[Fase 2] Paso 2.1** — Reemplazar el handler de importación en `app.js` (cambio principal)
6. **[Fase 2] Verificación** — Ejecutar pruebas 2-A, 2-B, 2-C, 2-D antes de continuar
7. **[Fase 3] Paso 3.2** — Fix BOM en `server.js` (cambio de una línea, riesgo cero)
8. **[Fase 3] Paso 3.3** — Fix backup restore en `app.js` (cambio de dos líneas)
9. **[Fase 3] Paso 3.4** — Verificar encoding de `app.js` y configurar VS Code
10. **[Fase 3] Paso 3.1** — Reemplazar exportación XLS por XLSX real en `app.js`
11. **[Fase 3] Verificación** — Ejecutar pruebas 3-A, 3-B, 3-C, 3-D

**Pasos que pueden hacerse en paralelo:**
- Los pasos 4 y 5 de la Fase 2 son independientes entre sí (uno toca `index.html`, el otro `app.js`)
- Los pasos 7, 8 y 9 de la Fase 3 son independientes entre sí y pueden aplicarse en cualquier orden
- Los pasos 7, 8, 9 de Fase 3 son independientes del paso 10 (exportación)

---

## Rollback

### Si SheetJS no carga (error 404 o CORS)

**Síntoma:** `typeof XLSX === 'undefined'` en la consola del navegador.

**Pasos:**
1. Verificar que `public/js/xlsx.full.min.js` existe con tamaño ~700 KB
2. Si se está usando CDN, probar la URL directamente en el navegador: `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`
3. Si el CDN no responde, cambiar a la opción local (Paso 1.1)
4. Si nada funciona, comentar temporalmente el `<script>` de SheetJS — la app sigue funcionando con el pipeline antiguo mientras se resuelve

### Si la importación falla después de aplicar Fase 2

**Síntoma:** Error en la consola del navegador o el modal de importación no muestra preview.

**Pasos de diagnóstico:**
1. Abrir F12 > Console, intentar importar y capturar el error exacto
2. Si el error es `XLSX is not defined` — SheetJS no cargó (ver sección anterior)
3. Si el error es sobre `sheet_to_json` o `workbook.SheetNames` — el archivo puede estar corrupto o ser de un formato no soportado (ej. `.csv` con extensión `.xlsx` real)
4. Para revertir solo el handler de importación, restaurar el bloque ANTES del Paso 2.1 usando git:
   ```bash
   git diff public/js/app.js   # ver exactamente qué cambió
   git checkout -- public/js/app.js  # revertir solo app.js
   ```

### Si la exportación XLSX falla después de aplicar Fase 3 - Paso 3.1

**Síntoma:** Al hacer clic en "Exportar Excel" no se descarga nada o la consola muestra un error.

**Pasos:**
1. Verificar que SheetJS está cargado (`typeof XLSX !== 'undefined'`)
2. Verificar en consola si `XLSX.utils.book_new` y `XLSX.write` existen
3. Para revertir solo la exportación: restaurar el bloque `else` original (el XML SpreadsheetML) del Paso 3.1
4. El rollback es seguro — el bloque CSV no se toca, solo el bloque `else` de Excel

### Rollback completo (revertir todos los cambios)

```bash
# Ver todos los cambios aplicados
git diff

# Revertir archivos individuales
git checkout -- public/js/app.js
git checkout -- public/index.html
git checkout -- server.js

# El archivo xlsx.full.min.js agregado en Fase 1 no se revierte con esto
# Para eliminarlo:
# Remove-Item "public\js\xlsx.full.min.js"
```

### Si el servidor no arranca después de aplicar Paso 3.2

**Síntoma:** `node server.js` lanza un error de sintaxis.

**Causa probable:** Error tipográfico en la expresión de la línea 4.

**Verificar que la línea 4 quede exactamente así:**
```javascript
  fs_env.readFileSync('.env','utf8').replace(/^﻿/, '').split('\n').forEach(line => {
```

**Rollback:**
```bash
git checkout -- server.js
```

---

*Plan generado para GameVault — 2026-07-13*
*Implementa la Opción 3 descrita en PLAN_ENCODING.md*
*Archivos afectados: `public/js/app.js`, `public/index.html`, `server.js`, `public/js/xlsx.full.min.js` (nuevo)*
