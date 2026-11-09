// Convierte las hojas de un Excel de colección (una hoja por consola) en juegos normalizados.
(function () {
  const PLAT = { nes:'NES', snes:'SNES', n64:'N64', gamecube:'GameCube', wii:'Wii', wiiu:'Wii U', switch:'Switch',
    gameboy:'Game Boy', gb_advance:'Game Boy Advance', gba:'Game Boy Advance', ds:'DS', '3ds':'3DS', psx:'PSX', ps1:'PSX',
    ps2:'PS2', ps3:'PS3', ps4:'PS4', ps5:'PS5', psp:'PSP', vita:'PS Vita', genesis:'Genesis', dc:'Dreamcast',
    dreamcast:'Dreamcast', pc:'PC', saturn:'Saturn', xbox:'Xbox', xbox360:'Xbox 360' };
  const REG = { usa:'NTSC-U','ntsc-u':'NTSC-U','1':'NTSC-U', nes:'NTSC-U', snes:'NTSC-U', sres:'NTSC-U', saes:'NTSC-U', spes:'NTSC-U',
    famicom:'NTSC-J','super famicom':'NTSC-J', japon:'NTSC-J','japón':'NTSC-J','ntsc-j':'NTSC-J', europa:'PAL', pal:'PAL', eur:'PAL' };
  const GEN = { figthing:'Fighting', carrera:'Carreras', deporte:'Deportes', 'beat em up':"Beat-'em-up" };
  const lc = v => String(v == null ? '' : v).trim().toLowerCase();

  function contenido(raw) {
    const r = String(raw == null ? '' : raw).trim(), l = r.toLowerCase();
    if (!r) return null;
    if (l === 'cartucho' || l === 'disco') return 'Disco/Cartucho';
    if (l === 'cb' || l === 'cib') return 'CIB';
    if (l === 'ci' || l.startsWith('ci/')) return 'CI';
    if (l.startsWith('cib/')) return 'CIB/Extra';
    return null;
  }
  function clasif(v) {
    if (v == null || String(v).trim() === '' || String(v).trim() === '-') return null;
    const s = String(v).trim();
    const m = { KA:'K-A', 'K-A':'K-A' };
    if (m[s.toUpperCase()]) return m[s.toUpperCase()];
    if (s === '7') return 'PEGI 7';
    if (s === 'C') return 'CERO C';
    return s;
  }
  const siNo = v => { const s = lc(v); return (s === 'si' || s === 'sí') ? 'Si' : s === 'no' ? 'No' : null; };

  const COLS = {
    nombre: ['nombre', 'titulo', 'título'], jug: ['n°', 'nº', 'n ', 'num', 'jugadores'], emp: ['empresa', 'desarrolladora'],
    tipo: ['tipo', 'genero', 'género'], cont: ['estado', 'contenido'], cla: ['clasific'],
    prog: ['progreso', 'terminado'], pila: ['pila'], reg: ['region', 'región'], exc: ['exclusividad', 'exlusividad'],
    nota: ['nota'], anio: ['año', 'anio']
  };

  // sheets: [{name, rows}] -> { juegos, hojas:[{name,count}], omitidas:[name], avisos:[...] }
  function fromSheets(sheets) {
    const juegos = [], hojas = [], omitidas = [], avisos = [];
    for (const sh of sheets) {
      const head = (sh.rows[0] || []).map(lc);
      const col = key => head.findIndex(h => h && COLS[key].some(p => h.startsWith(p)));
      const ix = {}; Object.keys(COLS).forEach(k => ix[k] = col(k));
      if (ix.nombre < 0) { omitidas.push(sh.name); continue; }
      const plat = PLAT[lc(sh.name)] || String(sh.name).replace(/_/g, ' ').trim();
      let n = 0;
      for (const r of sh.rows.slice(1)) {
        const g = k => (ix[k] >= 0 ? r[ix[k]] : null);
        if (!g('nombre') || !String(g('nombre')).trim()) continue;
        const regRaw = g('reg'), reg = regRaw == null || regRaw === '' ? null : (REG[lc(regRaw)] || null);
        if (regRaw != null && regRaw !== '' && !reg) avisos.push(`${plat} · ${g('nombre')}: región "${regRaw}" no reconocida`);
        const cRaw = g('cont'), cont = contenido(cRaw);
        if (cRaw != null && cRaw !== '' && !cont) avisos.push(`${plat} · ${g('nombre')}: contenido "${cRaw}" no reconocido`);
        const prog = lc(g('prog'));
        const nota = typeof g('nota') === 'number' ? g('nota') : null;
        const tipo = g('tipo') ? (GEN[lc(g('tipo'))] || String(g('tipo')).trim()) : null;
        const nj = g('jug');
        const anio = typeof g('anio') === 'number' ? g('anio') : null;
        juegos.push({
          nombre: String(g('nombre')).trim(), plataforma: plat,
          desarrolladora: g('emp') != null && g('emp') !== '' ? String(g('emp')).trim() : null,
          anio, genero: tipo, clasificacion: clasif(g('cla')),
          num_jugadores: nj != null && nj !== '' ? String(nj) : null,
          estado: prog === 'terminado' ? 'Completado' : 'Pendiente', posesion: 'coleccion',
          region: reg, contenido: cont, exclusividad: siNo(g('exc')),
          pila: ix.pila >= 0 ? siNo(g('pila')) : null,       // "Pila" solo existe en hojas de cartuchos
          nota
        });
        n++;
      }
      hojas.push({ name: plat, count: n });
    }
    return { juegos, hojas, omitidas, avisos };
  }
  window.GVNormalize = { fromSheets };
})();
