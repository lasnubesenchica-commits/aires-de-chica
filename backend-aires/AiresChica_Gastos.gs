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

  // ejecución por mes (Ene..Dic)
  var porMes = [0,0,0,0,0,0,0,0,0,0,0,0];
  gastos.forEach(function (g) { var m = g.fecha.getMonth(); porMes[m] = _round2(porMes[m] + g.monto); });

  // años disponibles (para el selector)
  var yset = {}; yset[anio] = 1; yset[hoy.getFullYear()] = 1;
  todos.forEach(function (g) { yset[g.fecha.getFullYear()] = 1; });
  presupRows.forEach(function (p) { if (p.anio) yset[Number(p.anio)] = 1; });
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
    aniosDisponibles: anios
  };
}

/* ─────────────── gastos ─────────────── */

function _appendGasto(g) {
  var sh = _ss().getSheetByName(SH.GASTOS);
  var fecha = g.fecha instanceof Date ? g.fecha : new Date(g.fecha || _today());
  var id = g.id || ('G' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000));
  sh.appendRow([
    id, fecha, _gastoMes(fecha), String(g.categoria || '').trim(), g.proveedor || '', g.detalle || '',
    _round2(g.monto), (g.tipo === 'recurrente' ? 'recurrente' : 'puntual'),
    g.metodoPago || '', g.comprobanteUrl || '', g.notas || '', new Date()
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
