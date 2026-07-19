/**
 * Gastos (egresos) de la Asociación.
 *
 * Modelo:
 *   - Un solo registro de gastos (hoja Gastos). Cada gasto lleva una CATEGORÍA
 *     (las del presupuesto) y un TIPO ('recurrente' | 'puntual'). Así se suman
 *     juntos para comparar contra el presupuesto, pero se pueden filtrar.
 *   - Plantillas de gastos recurrentes (hoja GastosRecurrentes): los fijos
 *     mensuales se definen una vez y se registran cada mes con un clic.
 *   - Presupuesto anual por categoría (hoja Presupuesto): se ingresa a fin de
 *     año y se compara contra la ejecución (gastos reales) durante el año.
 *
 * Las categorías viven en una Script Property (independientes del config de
 * Opciones) para poder editarlas sin afectar otros parámetros.
 */

var GASTO_CATS_PROP = 'AC_GASTO_CATS';
var DEFAULT_GASTO_CATS = [
  'Acueducto',
  'Calles, senderos y áreas comunes',
  'Portón, luminarias y cámaras',
  'Cerca perimetral',
  'Baño comunal',
  'Gastos legales',
  'Administración',
  'Contabilidad (CPA)',
  'Banca en línea',
  'Línea de crédito / préstamo',
  'Gastos varios y previsiones'
];

function _gastoMes(fecha) {
  var d = fecha instanceof Date ? fecha : new Date(fecha);
  var m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m);
}

// Esquema del informe de la junta: 5 grupos originales del Excel.
var GRUPOS_INFORME = ['Serv. Prof. / Contratistas', 'Alq. Equipo Pesado', 'Acueducto',
                      'Legales, Imp., Munic., CxP', 'Otros'];

// Mapeo por defecto categoría (presupuesto) -> grupo del informe.
function _grupoDeCategoria(cat) {
  switch (String(cat || '').trim()) {
    case 'Acueducto': return 'Acueducto';
    case 'Gastos legales':
    case 'Línea de crédito / préstamo':
    case 'Contabilidad (CPA)': return 'Legales, Imp., Munic., CxP';
    case 'Portón, luminarias y cámaras':
    case 'Banca en línea':
    case 'Gastos varios y previsiones': return 'Otros';
    default: return 'Serv. Prof. / Contratistas'; // Calles, Baño, Administración, Cerca perimetral
  }
}

// Grupo del informe deducido de categoría + proveedor + detalle. Reproduce al
// centavo la clasificación de 5 columnas del Excel original (excepciones que
// no calzan con el mapeo por categoría: alquiler de equipo, luminarias/portón
// de Elías, y la concesión de agua del MiAmbiente).
function _grupoInformeDe(cat, prov, det) {
  var p = String(prov || ''), d = String(det || '').toLowerCase();
  if (/luis\s*molina/i.test(p) || /\bretro\b|equipo pesado/.test(d)) return 'Alq. Equipo Pesado';
  if (/ministerio de ambiente/i.test(p)) return 'Legales, Imp., Munic., CxP';
  if (/el[ií]as/i.test(p) && /port[oó]n/.test(d)) return 'Serv. Prof. / Contratistas';
  return _grupoDeCategoria(cat);
}

function getGastoCategorias() {
  var raw = PropertiesService.getScriptProperties().getProperty(GASTO_CATS_PROP);
  if (raw) { try { var a = JSON.parse(raw); if (Array.isArray(a) && a.length) return a; } catch (e) {} }
  return DEFAULT_GASTO_CATS.slice();
}

function guardarGastoCategorias(arr) {
  if (!Array.isArray(arr)) throw new Error('Formato de categorías inválido.');
  var seen = {}, clean = [];
  arr.forEach(function (c) {
    c = String(c || '').trim();
    if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; clean.push(c); }
  });
  if (!clean.length) throw new Error('Debe haber al menos una categoría.');
  PropertiesService.getScriptProperties().setProperty(GASTO_CATS_PROP, JSON.stringify(clean));
  return { ok: true, categorias: clean };
}

/* ─────────────── lectura combinada para el tab ─────────────── */

function getGastosData(anio) {
  ensureSheets();
  var hoy = new Date();
  anio = Number(anio) || hoy.getFullYear();
  var cats = getGastoCategorias();

  var todos = _sheetRows(SH.GASTOS).map(function (g) {
    g.monto = Number(g.monto) || 0;
    g.fecha = g.fecha instanceof Date ? g.fecha : new Date(g.fecha);
    // grupo del informe: usa el guardado o lo deduce (para filas ya cargadas sin el campo)
    g.grupoInforme = String(g.grupoInforme || '').trim() || _grupoInformeDe(g.categoria, g.proveedor, g.detalle);
    return g;
  });
  var gastos = todos.filter(function (g) { return g.fecha.getFullYear() === anio; })
    .sort(function (a, b) { return b.fecha.getTime() - a.fecha.getTime(); });

  var presup = {};
  var presupRows = _sheetRows(SH.PRESUP);
  presupRows.forEach(function (p) { if (Number(p.anio) === anio) presup[String(p.categoria).trim()] = Number(p.monto) || 0; });

  var recur = _sheetRows(SH.GRECUR).map(function (r) {
    r.monto = Number(r.monto) || 0;
    r.activo = (r.activo === '' || r.activo === undefined) ? true : (r.activo === true || String(r.activo).toLowerCase() === 'si' || String(r.activo) === 'true' || r.activo === 1 || String(r.activo) === '1');
    return r;
  });

  // totales por categoría (incluye todas las categorías, aunque no tengan gasto)
  var porCat = {};
  cats.forEach(function (c) { porCat[c] = { categoria: c, ejecutado: 0, presupuestado: _round2(presup[c] || 0) }; });
  var ejecutadoTotal = 0;
  gastos.forEach(function (g) {
    var c = String(g.categoria || '').trim() || '(sin categoría)';
    if (!porCat[c]) porCat[c] = { categoria: c, ejecutado: 0, presupuestado: _round2(presup[c] || 0) };
    porCat[c].ejecutado = _round2(porCat[c].ejecutado + g.monto);
    ejecutadoTotal = _round2(ejecutadoTotal + g.monto);
  });
  var porCategoria = Object.keys(porCat).map(function (k) {
    var t = porCat[k];
    t.disponible = _round2(t.presupuestado - t.ejecutado);
    t.pct = t.presupuestado > 0 ? _round2(t.ejecutado / t.presupuestado * 100) : (t.ejecutado > 0 ? 100 : 0);
    return t;
  });
  var presupuestadoTotal = _round2(porCategoria.reduce(function (s, t) { return s + t.presupuestado; }, 0));

  // ejecución (egresos) por mes (Ene..Dic)
  var porMes = [0,0,0,0,0,0,0,0,0,0,0,0];
  gastos.forEach(function (g) { var m = g.fecha.getMonth(); porMes[m] = _round2(porMes[m] + g.monto); });

  // ingresos (cobros de cuotas — base caja) del año, por mes; para el Estado de Resultados
  var pagos = getPagos();
  var ingresosPorMes = [0,0,0,0,0,0,0,0,0,0,0,0], ingresosTotal = 0;
  var ysetPag = {};
  pagos.forEach(function (p) {
    var fp = p.fecha instanceof Date ? p.fecha : new Date(p.fecha);
    if (isNaN(fp.getTime())) return;
    ysetPag[fp.getFullYear()] = 1;
    if (fp.getFullYear() === anio) {
      ingresosPorMes[fp.getMonth()] = _round2(ingresosPorMes[fp.getMonth()] + (Number(p.monto) || 0));
      ingresosTotal = _round2(ingresosTotal + (Number(p.monto) || 0));
    }
  });

  // años disponibles (para el selector)
  var yset = {}; yset[anio] = 1; yset[hoy.getFullYear()] = 1;
  todos.forEach(function (g) { yset[g.fecha.getFullYear()] = 1; });
  presupRows.forEach(function (p) { if (p.anio) yset[Number(p.anio)] = 1; });
  Object.keys(ysetPag).forEach(function (y) { yset[Number(y)] = 1; });
  var anios = Object.keys(yset).map(Number).sort(function (a, b) { return b - a; });

  return {
    anio: anio, moneda: CONFIG.MONEDA,
    categorias: cats,
    gastos: gastos,
    recurrentes: recur,
    presupuesto: presup,
    porCategoria: porCategoria,
    ejecutadoTotal: ejecutadoTotal,
    presupuestadoTotal: presupuestadoTotal,
    disponibleTotal: _round2(presupuestadoTotal - ejecutadoTotal),
    porMes: porMes,
    ingresosPorMes: ingresosPorMes,
    ingresosTotal: ingresosTotal,
    resultadoTotal: _round2(ingresosTotal - ejecutadoTotal),
    aniosDisponibles: anios
  };
}

/* ─────────────── gastos ─────────────── */

function _appendGasto(g) {
  var sh = _ss().getSheetByName(SH.GASTOS);
  var fecha = g.fecha instanceof Date ? g.fecha : new Date(g.fecha || _today());
  var id = g.id || ('G' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000));
  var grupo = String(g.grupoInforme || '').trim() || _grupoInformeDe(g.categoria, g.proveedor, g.detalle);
  sh.appendRow([
    id, fecha, _gastoMes(fecha), String(g.categoria || '').trim(), g.proveedor || '', g.detalle || '',
    _round2(g.monto), (g.tipo === 'recurrente' ? 'recurrente' : 'puntual'),
    g.metodoPago || '', g.comprobanteUrl || '', g.notas || '', new Date(), grupo
  ]);
  return id;
}

function registrarGasto(g) {
  ensureSheets();
  if (!g || !(Number(g.monto) > 0)) throw new Error('Indica un monto válido.');
  if (!String(g.categoria || '').trim()) throw new Error('Selecciona una categoría.');
  return { ok: true, id: _appendGasto(g) };
}

function registrarGastosBatch(arr) {
  ensureSheets();
  if (!Array.isArray(arr) || !arr.length) throw new Error('No hay gastos para registrar.');
  var ids = [];
  arr.forEach(function (g) {
    if (g && Number(g.monto) > 0 && String(g.categoria || '').trim()) ids.push(_appendGasto(g));
  });
  return { ok: true, registrados: ids.length, ids: ids };
}

function actualizarGasto(id, data) {
  ensureSheets();
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id del gasto.');
  var sh = _ss().getSheetByName(SH.GASTOS);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]) === id) {
      var set = function (col, v) { var c = h.indexOf(col); if (c >= 0) sh.getRange(r + 1, c + 1).setValue(v); };
      if (data.fecha) { var f = data.fecha instanceof Date ? data.fecha : new Date(data.fecha); set('fecha', f); set('mes', _gastoMes(f)); }
      if (data.categoria !== undefined) set('categoria', String(data.categoria).trim());
      if (data.proveedor !== undefined) set('proveedor', data.proveedor);
      if (data.detalle !== undefined) set('detalle', data.detalle);
      if (data.monto !== undefined) set('monto', _round2(data.monto));
      if (data.tipo !== undefined) set('tipo', data.tipo === 'recurrente' ? 'recurrente' : 'puntual');
      if (data.metodoPago !== undefined) set('metodoPago', data.metodoPago);
      if (data.notas !== undefined) set('notas', data.notas);
      if (data.grupoInforme !== undefined) set('grupoInforme', String(data.grupoInforme).trim());
      return { ok: true, id: id };
    }
  }
  throw new Error('Gasto no encontrado: ' + id);
}

function eliminarGasto(id) {
  ensureSheets();
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id del gasto.');
  var sh = _ss().getSheetByName(SH.GASTOS);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]) === id) { sh.deleteRow(r + 1); return { ok: true, id: id }; }
  }
  throw new Error('Gasto no encontrado: ' + id);
}

/* ─────────────── plantillas recurrentes ─────────────── */

function guardarGastoRecurrente(data) {
  ensureSheets();
  if (!data || !String(data.categoria || '').trim()) throw new Error('Selecciona una categoría.');
  var sh = _ss().getSheetByName(SH.GRECUR);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  var id = String(data.id || '').trim();
  var fila = [
    id || ('R' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000)),
    String(data.categoria).trim(), data.proveedor || '', data.detalle || '',
    _round2(data.monto), (data.activo === false ? 'no' : 'si'), data.notas || ''
  ];
  if (id) {
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][iId]) === id) { sh.getRange(r + 1, 1, 1, COL_GRECUR.length).setValues([fila]); return { ok: true, id: id }; }
    }
  }
  sh.appendRow(fila);
  return { ok: true, id: fila[0] };
}

function eliminarGastoRecurrente(id) {
  ensureSheets();
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id de la plantilla.');
  var sh = _ss().getSheetByName(SH.GRECUR);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]) === id) { sh.deleteRow(r + 1); return { ok: true, id: id }; }
  }
  throw new Error('Plantilla no encontrada: ' + id);
}

/* ─────────────── presupuesto ─────────────── */

function guardarPresupuesto(anio, mapa) {
  ensureSheets();
  anio = Number(anio) || (new Date()).getFullYear();
  var sh = _ss().getSheetByName(SH.PRESUP);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iAnio = h.indexOf('anio');
  for (var r = vals.length - 1; r >= 1; r--) { if (Number(vals[r][iAnio]) === anio) sh.deleteRow(r + 1); }
  var rows = [];
  Object.keys(mapa || {}).forEach(function (cat) {
    var m = _round2(mapa[cat]);
    if (m > 0) rows.push([anio, String(cat).trim(), m]);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, COL_PRESUP.length).setValues(rows);
  return { ok: true, anio: anio, lineas: rows.length };
}

/* ─────────────── carga inicial 2026 (desde el Excel) ───────────────
 * Inserta el presupuesto 2026 y los gastos ya registrados (ene–jun).
 * Total de gastos = B/.21,373.64 (cuadra con el GRAN TOTAL del Excel).
 * Idempotente: si ya hay gastos de 2026 exige force (que primero los borra).
 */
function seedGastos2026(force) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.GASTOS);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iF = h.indexOf('fecha');
  var yaHay = false;
  for (var r = 1; r < vals.length; r++) { var d = new Date(vals[r][iF]); if (d.getFullYear() === 2026) { yaHay = true; break; } }
  if (yaHay && !force) throw new Error('Ya hay gastos de 2026 registrados. Usa force=true para recargar (borra primero los de 2026).');
  if (yaHay && force) { for (var rr = vals.length - 1; rr >= 1; rr--) { if (new Date(vals[rr][iF]).getFullYear() === 2026) sh.deleteRow(rr + 1); } }

  // categorías + presupuesto 2026 (total 37,917.00)
  guardarGastoCategorias(DEFAULT_GASTO_CATS);
  var PRESUP = {
    'Acueducto': 9317, 'Calles, senderos y áreas comunes': 13250, 'Portón, luminarias y cámaras': 4320,
    'Cerca perimetral': 200, 'Baño comunal': 540, 'Gastos legales': 800, 'Administración': 3000,
    'Contabilidad (CPA)': 1926, 'Banca en línea': 64, 'Línea de crédito / préstamo': 2400, 'Gastos varios y previsiones': 2100
  };
  guardarPresupuesto(2026, PRESUP);

  // gastos ene–jun 2026 — [mes, categoría, proveedor, detalle, monto, tipo]
  var AC = 'Acueducto', CA = 'Calles, senderos y áreas comunes', PO = 'Portón, luminarias y cámaras',
      BA = 'Baño comunal', LE = 'Gastos legales', AD = 'Administración', CP = 'Contabilidad (CPA)',
      BL = 'Banca en línea', LC = 'Línea de crédito / préstamo', VA = 'Gastos varios y previsiones';
  var R = 'recurrente', P = 'puntual';
  var G = [
    // ENERO
    [1, CA, 'Rodrigo Valdéz', 'contr. mant. general', 400, R],
    [1, CA, 'Cornelio Sánchez', 'abono contrato limpieza maleza', 250, R],
    [1, BA, 'Zoila Castrejón', 'limpieza baño común', 45, R],
    [1, AD, 'Doraida Castillo', 'honorarios administrativos', 250, R],
    [1, LC, 'Doraida Castillo', 'abono a préstamo', 200, R],
    [1, AC, 'Elías Martínez', 'Fact. 573 - 2da adecuación tanque 1 (pozo)', 396, P],
    [1, LE, 'Dalis de Vasconez', 'saldo 1ra fase honorarios legales (Resolución Asoc. de Prop.)', 250, P],
    [1, PO, 'Starlink', 'portón', 40, R],
    [1, PO, 'Más Móvil', 'portón', 10.7, R],
    [1, PO, 'Javier Della Cella', 'Nube portón', 11.99, R],
    [1, BL, 'Banco General', 'banca en línea', 5.35, R],
    [1, VA, 'Max Impresiones S.A.', 'Fact. 51966 - acrílico con nombre A. de Ch.', 139.1, P],
    [1, VA, 'Aristides Guzmán', 'alq. sillas + transporte', 40, P],
    [1, AC, 'Cochez', 'pvc para existencias', 39, P],
    [1, AC, 'Do It Center', 'pvc para existencias', 45.9, P],
    [1, CA, 'Luis Molina', 'alq. retro calle Paraíso 29/ene', 50, P],
    // FEBRERO
    [2, CA, 'Rodrigo Valdéz', 'contr. mant. general + despeje calles 4/feb', 430, R],
    [2, CA, 'Cornelio Sánchez', 'saldo contrato limpieza maleza', 1000, R],
    [2, BA, 'Zoila Castrejón', 'limpieza baño común', 45, R],
    [2, AD, 'Doraida Castillo', 'honorarios administrativos', 250, R],
    [2, LC, 'Doraida Castillo', 'abono a préstamo', 200, R],
    [2, PO, 'Starlink', 'portón', 40, R],
    [2, PO, 'Más Móvil', 'portón', 10.7, R],
    [2, PO, 'Javier Della Cella', 'Nube portón', 11.99, R],
    [2, BL, 'Banco General', 'banca en línea', 5.35, R],
    [2, PO, 'Jerlis Anchico', 'tapa breakers portón', 45, P],
    [2, CA, 'Jerlis Anchico', 'parrilla canal Cl. Paraíso', 350, P],
    [2, PO, 'Cochez', 'candadito tapa breakers portón', 4, P],
    [2, CA, 'Alexis Sánchez', 'mano de obra y material canal Cl. Paraíso', 880, P],
    [2, LE, 'Notaría Segunda Panamá Oeste', 'protocolo escritura Asoc. Prop.', 225, P],
    [2, LE, 'Dalis de Vasconez', 'abono 2da fase honorarios legales', 500, P],
    [2, PO, 'Elías Martínez', 'Fact. 588 - correctivos luminarias portón', 32, P],
    [2, AC, 'Elías Martínez', 'Fact. 592 - cableado y tubería captación 2', 93.25, P],
    [2, PO, 'Cochez', 'candadito tapa breakers portón', 4, P],
    // MARZO
    [3, CA, 'Rodrigo Valdéz', 'contr. mant. general', 400, R],
    [3, BA, 'Zoila Castrejón', 'limpieza baño común', 45, R],
    [3, CA, 'Cornelio Sánchez', 'remoción de hierba Vereda calle Vía Los Sueños', 50, P],
    [3, AD, 'Doraida Castillo', 'honorarios administrativos', 250, R],
    [3, LC, 'Doraida Castillo', 'abono a préstamo', 200, R],
    [3, PO, 'Starlink', 'portón', 40, R],
    [3, PO, 'Más Móvil', 'portón', 10.7, R],
    [3, PO, 'Javier Della Cella', 'Nube portón', 11.99, R],
    [3, BL, 'Banco General', 'banca en línea', 5.35, R],
    [3, LE, 'Registro Público', 'inscripción escritura Asoc. Prop.', 108, P],
    [3, LE, 'Notaría Segunda Panamá Oeste', 'protocolo escritura Reglamento de Propietarios', 157, P],
    [3, AC, 'Elías Martínez', 'Fact. 594 - mant. sistema pozo', 820, P],
    [3, AC, 'Acueducto (obra)', '2 captaciones con filtro, 4 tanques 570 gal, extensión tubería El Higuerón', 3796, P],
    // ABRIL
    [4, CA, 'Rodrigo Valdés', 'contr. mant. general + trabajos captaciones acueducto', 500, R],
    [4, AC, 'Rodrigo Valdés', 'soterrar tubos con cables acued.; desviar tramo tubería', 150, P],
    [4, BA, 'Zoila Castrejón', 'limpieza baño común', 45, R],
    [4, AD, 'Doraida Castillo', 'honorarios administrativos', 250, R],
    [4, LC, 'Doraida Castillo', 'abono a préstamo', 200, R],
    [4, PO, 'Starlink', 'portón', 40, R],
    [4, PO, 'Más Móvil', 'portón', 10.7, R],
    [4, PO, 'Javier Della Cella', 'Nube portón', 11.99, R],
    [4, BL, 'Banco General', 'banca en línea', 5.35, R],
    [4, AC, 'Casa Alex', 'tubos pvc para cubrir cables acueducto (captación 1 a tanques 4)', 407.62, P],
    [4, AC, 'Elías Martínez', 'revisión instalación tanques 4', 20, P],
    [4, AC, 'Elías Martínez', 'Fact. 600 - adecuación cables para soterramiento', 670, P],
    [4, AC, 'Elías Martínez', 'Fact. 602 y 604 - mant. bombas captaciones 1 y 2', 310, P],
    [4, LE, 'Registro Público', 'inscripción escritura Asoc. Prop. (3er reingreso)', 50, P],
    [4, LE, 'Dalys de Vasconez', 'honorarios legales finales', 335, P],
    // MAYO
    [5, CA, 'Rodrigo Valdés', 'mant. general 400 + limpieza cunetas/senderos 500', 900, R],
    [5, CA, 'Cornelio Sánchez', 'abono contrato mayo', 300, R],
    [5, BA, 'Zoila Castrejón', 'limpieza baño común', 45, R],
    [5, AD, 'Doraida Castillo', 'honorarios administrativos', 250, R],
    [5, LC, 'Doraida Castillo', 'abono a préstamo', 200, R],
    [5, PO, 'Starlink', 'portón', 40, R],
    [5, PO, 'Más Móvil', 'portón', 10.7, R],
    [5, PO, 'Javier Della Cella', 'Nube portón', 11.99, R],
    [5, BL, 'Banco General', 'banca en línea', 5.35, R],
    [5, LE, 'Dalys de Vasconez', 'reembolso envío escritura (Uno Express)', 6.5, P],
    [5, AC, 'Ministerio de Ambiente', 'concesión de agua 2026', 77.03, P],
    // JUNIO
    [6, CA, 'Rodrigo Valdés', 'contr. mant.', 400, R],
    [6, CA, 'Cornelio Sánchez', 'saldo contrato mayo', 950, R],
    [6, CA, 'Cornelio Sánchez', 'abono inicial contrato julio', 250, R],
    [6, CA, 'Fernando López', 'fumigación vereda calle (producto y m/o)', 50, P],
    [6, BA, 'Zoila Castrejón', 'limpieza baño común', 45, R],
    [6, PO, 'Elías Martínez', 'Fact. 612 - mant. portón', 165, P],
    [6, AC, 'Elías Martínez', 'Fact. 618 - nueva bomba pozo', 1850, P],
    [6, AD, 'Doraida Castillo', 'honorarios administrativos', 250, R],
    [6, LC, 'Doraida Castillo', 'abono a préstamo', 200, R],
    [6, CP, 'CPA Alex Núñez', 'certificación gastos e ingresos proyectados (Global Bank)', 100, P],
    [6, PO, 'Starlink', 'portón', 40, R],
    [6, PO, 'Más Móvil', 'portón', 10.7, R],
    [6, PO, 'Javier Della Cella', 'Nube portón', 11.99, R],
    [6, BL, 'Banco General', 'banca en línea', 5.35, R]
  ];
  var rows = G.map(function (e, i) {
    var fecha = new Date(2026, e[0] - 1, 15, 12, 0, 0);
    return ['SEED-G26-' + (i + 1), fecha, _gastoMes(fecha), e[1], e[2], e[3], _round2(e[4]),
            (e[5] === 'recurrente' ? 'recurrente' : 'puntual'), '', '', 'Carga inicial 2026 (Excel)', new Date(),
            _grupoInformeDe(e[1], e[2], e[3])];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, COL_GASTOS.length).setValues(rows);
  var total = _round2(rows.reduce(function (s, r) { return s + Number(r[6]); }, 0));
  return { ok: true, gastos: rows.length, presupuesto: Object.keys(PRESUP).length, total: total };
}

/* ─────────────── plantillas recurrentes sugeridas (una vez) ───────────────
 * Precarga las plantillas de gastos fijos mensuales de Aires de Chicá.
 * Los fijos llevan monto; los variables (Rodrigo, Cornelio, Naturgy) van con
 * monto 0 para ajustarlo al registrar cada mes. Exige force si ya hay plantillas.
 */
function seedRecurrentes(force) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.GRECUR);
  if (sh.getLastRow() > 1 && !force) throw new Error('Ya hay plantillas recurrentes. Usa force=true para reemplazarlas.');
  if (sh.getLastRow() > 1 && force) sh.deleteRows(2, sh.getLastRow() - 1);
  guardarGastoCategorias(DEFAULT_GASTO_CATS);
  var AC = 'Acueducto', CA = 'Calles, senderos y áreas comunes', PO = 'Portón, luminarias y cámaras',
      BA = 'Baño comunal', AD = 'Administración', CP = 'Contabilidad (CPA)',
      BL = 'Banca en línea', LC = 'Línea de crédito / préstamo';
  var T = [
    [BA, 'Zoila Castrejón', 'limpieza baño común', 45],
    [AD, 'Doraida Castillo', 'honorarios administrativos', 250],
    [LC, 'Doraida Castillo', 'abono a préstamo', 200],
    [PO, 'Starlink', 'portón (internet)', 40],
    [PO, 'Más Móvil', 'portón (datos)', 10.7],
    [PO, 'Javier Della Cella', 'Nube portón (cámaras)', 11.99],
    [BL, 'Banco General', 'banca en línea', 5.35],
    [CP, 'CPA', 'honorarios contables (150 + ITBMS)', 160.5],
    [CA, 'Rodrigo Valdés', 'contr. mant. general (variable)', 0],
    [CA, 'Cornelio Sánchez', 'contrato limpieza maleza (variable)', 0],
    [PO, 'Naturgy', 'electricidad portón (variable)', 0]
  ];
  var rows = T.map(function (e, i) {
    return ['SEED-R26-' + (i + 1), e[0], e[1], e[2], _round2(e[3]), 'si', ''];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, COL_GRECUR.length).setValues(rows);
  return { ok: true, plantillas: rows.length };
}

