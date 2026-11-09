// Lector mínimo de .xlsx (sin dependencias). Usa DecompressionStream y DOMParser del navegador.
// readXlsx(ArrayBuffer) -> Promise<[{ name, rows: [[valor|null,...], ...] }]>
(function () {
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const dec = new TextDecoder('utf-8');

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const bytes = new Uint8Array(buf), view = new DataView(buf);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('El archivo no es un .xlsx válido.');
    const count = u16(view, eocd + 10);
    let p = u32(view, eocd + 16);
    const entries = {};
    for (let n = 0; n < count; n++) {
      if (u32(view, p) !== 0x02014b50) throw new Error('El archivo .xlsx está dañado.');
      const method = u16(view, p + 10), csize = u32(view, p + 20);
      const nlen = u16(view, p + 28), elen = u16(view, p + 30), clen = u16(view, p + 32);
      const lho = u32(view, p + 42);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method, csize, lho };
      p += 46 + nlen + elen + clen;
    }
    async function read(name) {
      const e = entries[name];
      if (!e) return null;
      const lnlen = u16(view, e.lho + 26), lelen = u16(view, e.lho + 28);
      const start = e.lho + 30 + lnlen + lelen;
      const raw = bytes.subarray(start, start + e.csize);
      if (e.method === 0) return dec.decode(raw);
      if (e.method === 8) return dec.decode(await inflateRaw(raw));
      throw new Error('Compresión no soportada en el .xlsx');
    }
    return { read, has: n => !!entries[n] };
  }

  const xml = s => {
    const d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('XML inválido dentro del .xlsx');
    return d;
  };
  const textOf = el => Array.from(el.getElementsByTagName('t')).map(t => t.textContent).join('');
  const colIndex = ref => {
    const m = /^([A-Z]+)/i.exec(ref || ''); if (!m) return 0;
    let n = 0; for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  async function readXlsx(buf) {
    const zip = await unzip(buf);
    const wbText = await zip.read('xl/workbook.xml');
    if (!wbText) throw new Error('No se encontró el libro de Excel dentro del archivo.');
    const wb = xml(wbText);
    const rels = xml(await zip.read('xl/_rels/workbook.xml.rels'));
    const target = {};
    Array.from(rels.getElementsByTagName('Relationship')).forEach(r => {
      let t = r.getAttribute('Target') || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
      target[r.getAttribute('Id')] = t;
    });
    let shared = [];
    const ssText = await zip.read('xl/sharedStrings.xml');
    if (ssText) shared = Array.from(xml(ssText).getElementsByTagName('si')).map(textOf);

    const sheets = [];
    for (const sh of Array.from(wb.getElementsByTagName('sheet'))) {
      const name = sh.getAttribute('name');
      const path = target[sh.getAttribute('r:id')];
      const txt = path && await zip.read(path);
      if (!txt) continue;
      const rows = [];
      for (const row of Array.from(xml(txt).getElementsByTagName('row'))) {
        const r = Number(row.getAttribute('r')) - 1;
        const arr = [];
        for (const c of Array.from(row.getElementsByTagName('c'))) {
          const t = c.getAttribute('t');
          const vEl = c.getElementsByTagName('v')[0];
          let val = null;
          if (t === 'inlineStr') val = textOf(c);
          else if (vEl && vEl.textContent !== '') {
            const raw = vEl.textContent;
            if (t === 's') val = shared[parseInt(raw, 10)] ?? null;
            else if (t === 'b') val = raw === '1';
            else if (t === 'str' || t === 'e') val = raw;
            else { const n = Number(raw); val = Number.isFinite(n) ? n : raw; }
          }
          arr[colIndex(c.getAttribute('r'))] = val;
        }
        rows[Number.isFinite(r) ? r : rows.length] = Array.from(arr, v => (v === undefined ? null : v));
      }
      sheets.push({ name, rows: Array.from(rows, r => r || []) });
    }
    return sheets;
  }
  window.readXlsx = readXlsx;
})();
