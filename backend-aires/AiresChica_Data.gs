/**
 * Capa de datos — pestañas del Google Sheet y carga inicial.
 *
 * Pestañas:
 *   Propietarios : maestro de cuentas (una fila por cuenta; clave única)
 *   Pagos        : libro de pagos recibidos (ledger, una fila por pago)
 *   ConciliacionLog : historial de estados de cuenta bancarios importados
 *
 * `clave` = identificador único de cuenta (residencial + lote), p.ej. "H-22".
 * Los números de lote se repiten entre residenciales (y sub-bloques de
 * Los Laureles), por eso la clave lleva el prefijo del residencial.
 */

var SH = {
  PROP:  'Propietarios',
  PAGOS: 'Pagos',
  LOG:   'ConciliacionLog',
  COMPROB: 'Comprobantes',
  GASTOS: 'Gastos',
  GRECUR: 'GastosRecurrentes',
  PRESUP: 'Presupuesto'
};

var COL_PROP  = ['clave','residencial','lote','loteNum','nombre','email','celular',
                 'lotes','cabanas','cuota','saldo2025','activo','notas','airbnb','cuotaMensual','inicioCobro','moraCondon'];
var COL_PAGOS = ['id','fecha','clave','lote','nombre','monto','referencia','origen',
                 'mesAplicado','notas','creado','comprobanteUrl'];
var COL_LOG   = ['fecha','archivo','filas','nuevos','duplicados','montoNuevo','usuario'];
var COL_COMPROB = ['id','fecha','remitente','asunto','clave','nombre','lote','monto',
                   'referencia','estado','adjuntoUrl','msgId','metodo','capturado','motivo',
                   'metodoPago','cuentaDestino','beneficiario','pagoId'];
// Gastos (egresos) — registro diario por categoría
var COL_GASTOS = ['id','fecha','mes','categoria','proveedor','detalle','monto','tipo',
                  'metodoPago','comprobanteUrl','notas','creado'];
// Plantillas de gastos recurrentes (fijos mensuales)
var COL_GRECUR = ['id','categoria','proveedor','detalle','monto','activo','notas'];
// Presupuesto anual por categoría
var COL_PRESUP = ['anio','categoria','monto'];

/* ─────────────── setup de pestañas ─────────────── */

function ensureSheets() {
  var ss = _ss();
  var created = [];
  [[SH.PROP, COL_PROP], [SH.PAGOS, COL_PAGOS], [SH.LOG, COL_LOG], [SH.COMPROB, COL_COMPROB],
   [SH.GASTOS, COL_GASTOS], [SH.GRECUR, COL_GRECUR], [SH.PRESUP, COL_PRESUP]].forEach(function (pair) {
    var name = pair[0], cols = pair[1];
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); created.push(name); }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
      sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
        .setBackground('#0E8FB0').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() <= 1) { try { ss.deleteSheet(s); } catch (e) {} }
  });
  // Migración: asegurar columnas nuevas en Propietarios (sheets ya creados).
  _ensureColumn(ss.getSheetByName(SH.PROP), 'airbnb');
  _ensureColumn(ss.getSheetByName(SH.PROP), 'cuotaMensual');
  _ensureColumn(ss.getSheetByName(SH.PROP), 'inicioCobro');
  _ensureColumn(ss.getSheetByName(SH.PROP), 'moraCondon');
  _ensureColumn(ss.getSheetByName(SH.COMPROB), 'motivo');
  _ensureColumn(ss.getSheetByName(SH.COMPROB), 'metodoPago');
  _ensureColumn(ss.getSheetByName(SH.COMPROB), 'cuentaDestino');
  _ensureColumn(ss.getSheetByName(SH.COMPROB), 'beneficiario');
  _ensureColumn(ss.getSheetByName(SH.COMPROB), 'pagoId');
  _ensureColumn(ss.getSheetByName(SH.PAGOS), 'comprobanteUrl');
  // Forzar formato TEXTO en columnas de lote/clave/inicio: evita que Sheets
  // convierta "6/7", "2026-05", etc. en fechas.
  _forceText(ss.getSheetByName(SH.PROP), ['clave', 'lote', 'loteNum', 'inicioCobro'], COL_PROP);
  _forceText(ss.getSheetByName(SH.PAGOS), ['clave', 'lote'], COL_PAGOS);
  return { created: created, sheets: ss.getSheets().map(function (s) { return s.getName(); }) };
}

function _forceText(sh, names, cols) {
  if (!sh) return;
  names.forEach(function (n) {
    var c = cols.indexOf(n);
    if (c >= 0) sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

// Agrega una columna (por nombre) al final si no existe. Devuelve su índice 1-based.
function _ensureColumn(sh, name) {
  if (!sh) return -1;
  var lastCol = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var idx = header.indexOf(name);
  if (idx >= 0) return idx + 1;
  var col = lastCol + 1;
  sh.getRange(1, col).setValue(name).setFontWeight('bold').setBackground('#0E8FB0').setFontColor('#ffffff');
  return col;
}

/**
 * Repara los lotes que Sheets convirtió en fecha (p.ej. "6/7").
 * Reescribe clave/lote/loteNum como texto desde AC_SEED, sin tocar
 * correos ni otros campos. Corre una sola vez tras la primera carga.
 */
function repararLotes() {
  ensureSheets();
  var ss = _ss();
  var byClave = {};
  AC_SEED.forEach(function (s) { byClave[s.clave] = s; });

  var shP = ss.getSheetByName(SH.PROP);
  var pv = shP.getDataRange().getValues(), ph = pv[0];
  var ci = ph.indexOf('clave'), li = ph.indexOf('lote'), ni = ph.indexOf('loteNum');
  var arreglados = 0;
  for (var r = 1; r < pv.length; r++) {
    var s = byClave[String(pv[r][ci]).trim()];
    if (!s) continue;
    if (li >= 0) shP.getRange(r + 1, li + 1).setValue(s.lote);
    if (ni >= 0) shP.getRange(r + 1, ni + 1).setValue(s.loteNum);
    arreglados++;
  }

  var shG = ss.getSheetByName(SH.PAGOS), pagos = 0;
  if (shG && shG.getLastRow() > 1) {
    var gv = shG.getDataRange().getValues(), gh = gv[0];
    var gci = gh.indexOf('clave'), gli = gh.indexOf('lote');
    for (var g = 1; g < gv.length; g++) {
      var s2 = byClave[String(gv[g][gci]).trim()];
      if (s2 && gli >= 0) { shG.getRange(g + 1, gli + 1).setValue(s2.lote); pagos++; }
    }
  }
  return { propietarios: arreglados, pagos: pagos };
}

function _sheetRows(name) {
  var ss = _ss();
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    header.forEach(function (h, c) { obj[h] = row[c]; });
    out.push(obj);
  }
  return out;
}

/* ─────────────── getters ─────────────── */

function getPropietarios(incluirInactivos) {
  return _sheetRows(SH.PROP).map(function (p) {
    p.clave    = String(p.clave || '').trim();
    // si Sheets coervió el lote a fecha, cae al loteNum (defensa; repararLotes lo corrige de raíz)
    p.lote     = (p.lote instanceof Date) ? String(p.loteNum || '').trim() : String(p.lote).trim();
    p.loteNum  = (p.loteNum instanceof Date) ? '' : String(p.loteNum || p.lote).trim().toUpperCase().replace(/\s/g, '');
    p.lotes    = Number(p.lotes) || 1;
    p.cabanas  = Number(p.cabanas) || 0;
    p.airbnb   = (p.airbnb === true || String(p.airbnb).toLowerCase() === 'si' || p.airbnb === 'x');
    p.cuotaMensual = Number(p.cuotaMensual) || 0; // 0 = cuota calculada (base + cabañas)
    p.cuota    = cuotaDe(p); // cuota fija manual, o base + 30% por cabaña
    p.cuotaGlobal = !(p.cuotaMensual > 0); // true = cuota calculada automáticamente
    // inicio de cobro: 'YYYY-MM' del mes en que empieza a pagar (vacío = todo el año)
    p.inicioCobro = (p.inicioCobro instanceof Date)
      ? Utilities.formatDate(p.inicioCobro, CONFIG.TZ, 'yyyy-MM')
      : String(p.inicioCobro || '').trim();
    p.saldo2025 = Number(p.saldo2025) || 0;
    p.moraCondon = String(p.moraCondon || '').trim(); // 'ALL' | '2026-04,2026-05' | ''
    p.activo   = !(String(p.activo).toLowerCase() === 'no' || p.activo === false);
    p.email    = String(p.email || '').trim();
    return p;
  }).filter(function (p) { return p.clave && (incluirInactivos || p.activo); });
}

function getPagos() {
  return _sheetRows(SH.PAGOS).map(function (p) {
    p.clave = String(p.clave || '').trim();
    p.lote  = String(p.lote || '').trim();
    p.monto = Number(p.monto) || 0;
    p.fecha = p.fecha instanceof Date ? p.fecha : new Date(p.fecha);
    return p;
  });
}

function getPagosByClave(clave) {
  clave = String(clave).trim();
  return getPagos().filter(function (p) { return p.clave === clave; });
}

function _findProp(clave) {
  clave = String(clave).trim();
  var all = getPropietarios();
  for (var i = 0; i < all.length; i++) if (all[i].clave === clave) return all[i];
  return null;
}

// Fija el número de lotes de un propietario (informativo; no cambia la cuota).
function setPropLotes(clave, n) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), li = header.indexOf('lotes');
  if (ci < 0 || li < 0) throw new Error('No se encontró la columna clave/lotes.');
  var v = Math.max(1, Math.floor(Number(n) || 1));
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === String(clave).trim()) {
      sh.getRange(r + 1, li + 1).setValue(v);
      var prop = _findProp(clave);
      return { ok: true, clave: clave, lotes: v, cuota: prop ? prop.cuota : null };
    }
  }
  throw new Error('No existe la cuenta ' + clave);
}

// Fija el número de cabañas de un propietario (recalcula la cuota: base + 30%/cabaña).
function setPropCabanas(clave, n) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), cbi = header.indexOf('cabanas');
  if (ci < 0 || cbi < 0) throw new Error('No se encontró la columna clave/cabanas.');
  var v = Math.max(0, Math.floor(Number(n) || 0));
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === String(clave).trim()) {
      sh.getRange(r + 1, cbi + 1).setValue(v);
      var prop = _findProp(clave);
      return { ok: true, clave: clave, cabanas: v, cuota: prop ? prop.cuota : null, cuotaGlobal: prop ? prop.cuotaGlobal : true };
    }
  }
  throw new Error('No existe la cuenta ' + clave);
}

// Fija el saldo inicial 2025 de un propietario. Positivo = deuda arrastrada;
// negativo = crédito a favor (se irá aplicando a las cuotas mes a mes).
function setPropSaldo2025(clave, valor) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), si = header.indexOf('saldo2025');
  if (ci < 0 || si < 0) throw new Error('No se encontró la columna clave/saldo2025.');
  var v = _round2(Number(valor) || 0); // puede ser negativo (crédito a favor)
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === String(clave).trim()) {
      sh.getRange(r + 1, si + 1).setValue(v);
      var prop = _findProp(clave);
      return { ok: true, clave: clave, saldo2025: v, cuota: prop ? prop.cuota : null };
    }
  }
  throw new Error('No existe la cuenta ' + clave);
}

// Fija el mes de inicio de cobro ('YYYY-MM') de un propietario. Vacío = todo el
// año. El estado de cuenta sólo factura cuotas a partir de ese mes.
function setPropInicio(clave, inicio) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), ii = header.indexOf('inicioCobro');
  if (ci < 0 || ii < 0) throw new Error('No se encontró la columna clave/inicioCobro.');
  var v = /^\d{4}-\d{2}$/.test(String(inicio || '')) ? String(inicio) : '';
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === String(clave).trim()) {
      sh.getRange(r + 1, ii + 1).setValue(v);
      var prop = _findProp(clave);
      return { ok: true, clave: clave, inicioCobro: v, cuota: prop ? prop.cuota : null };
    }
  }
  throw new Error('No existe la cuenta ' + clave);
}

/**
 * Condona (o reactiva) la mora de un propietario.
 *   mes = 'ALL'  -> condona/reactiva TODA la mora del propietario.
 *   mes = 'YYYY-MM' -> condona/reactiva la mora de ese mes puntual.
 *   condonar = true (condonar) | false (reactivar).
 * Nota: si 'ALL' está activo, los meses puntuales no aplican (el panel lo maneja).
 */
function setMoraCondon(clave, mes, condonar) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var col = _ensureColumn(sh, 'moraCondon'); // 1-based
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave');
  mes = String(mes || '').trim();
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() !== String(clave).trim()) continue;
    var cur = String(vals[r][col - 1] || '').trim();
    var out;
    if (mes.toUpperCase() === 'ALL') {
      out = condonar ? 'ALL' : '';
    } else if (/^\d{4}-\d{2}$/.test(mes)) {
      if (cur.toUpperCase() === 'ALL') { out = cur; } // 'ALL' manda; el panel bloquea meses puntuales
      else {
        var list = cur ? cur.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
        var i = list.indexOf(mes);
        if (condonar && i < 0) list.push(mes);
        if (!condonar && i >= 0) list.splice(i, 1);
        out = list.join(',');
      }
    } else {
      throw new Error('Mes inválido para condonar: ' + mes);
    }
    sh.getRange(r + 1, col).setValue(out);
    return { ok: true, clave: clave, moraCondon: out };
  }
  throw new Error('No existe la cuenta ' + clave);
}

/**
 * Migración: convierte las cuotas fijas que sólo codificaban el recargo por
 * cabaña en cuotas calculadas (base + 30%/cabaña). Limpia cuotaMensual cuando
 * su valor coincide EXACTO con la fórmula, así el # de cabañas pasa a mandar.
 * Las cuotas realmente personalizadas (que no cuadran con la fórmula) se dejan.
 * Corre una sola vez en el editor.
 */
function migrarModeloCabanas() {
  ensureSheets();
  var c = _cfg();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), qi = header.indexOf('cuotaMensual'), cbi = header.indexOf('cabanas');
  if (ci < 0 || qi < 0 || cbi < 0) throw new Error('Faltan columnas clave/cuotaMensual/cabanas.');
  var limpiadas = [];
  for (var r = 1; r < vals.length; r++) {
    var q = Number(vals[r][qi]) || 0;
    if (q > 0) {
      var cab = Math.max(0, Number(vals[r][cbi]) || 0);
      var esperado = _round2(c.cuotaBase * (1 + cab * (Number(c.cabanaPct) || 0) / 100));
      if (Math.abs(q - esperado) < 0.01) {
        sh.getRange(r + 1, qi + 1).setValue('');
        limpiadas.push(String(vals[r][ci]).trim() + ' (' + q + ' → ' + cab + ' cabaña(s))');
      }
    }
  }
  return { limpiadas: limpiadas, total: limpiadas.length };
}

// Fija (o limpia) la cuota mensual de un propietario. valor vacío/0 => usa la global.
function setPropCuota(clave, valor) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), qi = header.indexOf('cuotaMensual');
  if (ci < 0 || qi < 0) throw new Error('No se encontró la columna clave/cuotaMensual.');
  var v = Number(valor) > 0 ? _round2(Number(valor)) : '';
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === String(clave).trim()) {
      sh.getRange(r + 1, qi + 1).setValue(v);
      var prop = _findProp(clave);
      return { ok: true, clave: clave, cuotaMensual: v || 0, cuota: prop ? prop.cuota : null, cuotaGlobal: !(v) };
    }
  }
  throw new Error('No existe la cuenta ' + clave);
}

/**
 * Agrega un nuevo propietario. Genera una clave única (prefijo del residencial +
 * lote; sufijo numérico si ya existe). Requiere nombre, residencial y lote.
 * data: { nombre, residencial, lote, email, celular, lotes, cabanas, cuotaMensual, inicioCobro, saldo2025, notas }
 */
function addPropietario(data) {
  ensureSheets();
  data = data || {};
  var nombre = String(data.nombre || '').trim();
  var residencial = String(data.residencial || '').trim();
  var lote = String(data.lote || '').trim();
  if (!nombre) throw new Error('Falta el nombre del propietario.');
  if (!residencial) throw new Error('Falta el residencial.');
  if (!lote) throw new Error('Falta el lote.');

  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave');
  var used = {};
  for (var r = 1; r < vals.length; r++) used[String(vals[r][ci]).trim().toUpperCase()] = true;

  var prefMap = { 'LOS LAURELES': 'L', 'EL QUIRA': 'Q', 'EL HIGUERON': 'H' };
  var pref = prefMap[_normTxt(residencial)] || (residencial.charAt(0).toUpperCase() || 'X');
  var loteKey = lote.toUpperCase().replace(/\s+/g, '');
  var base = pref + '-' + loteKey;
  var clave = base, n = 2;
  while (used[clave.toUpperCase()]) { clave = base + '-' + n; n++; }

  var loteNumM = loteKey.match(/[0-9]+[A-Z]?/);
  var loteNum = loteNumM ? loteNumM[0] : loteKey;
  var lotes = Math.max(1, Math.floor(Number(data.lotes) || 1));
  var cabanas = Math.max(0, Math.floor(Number(data.cabanas) || 0));
  var cuotaMensual = Number(data.cuotaMensual) > 0 ? _round2(Number(data.cuotaMensual)) : '';
  var inicioCobro = /^\d{4}-\d{2}$/.test(String(data.inicioCobro || '')) ? String(data.inicioCobro) : '';
  var saldo2025 = _round2(Number(data.saldo2025) || 0);
  var cuota = cuotaDe({ cabanas: cabanas, cuotaMensual: cuotaMensual });

  // fila alineada con COL_PROP
  var row = [clave, residencial, lote, loteNum, nombre,
    String(data.email || '').trim(), String(data.celular || '').trim(),
    lotes, cabanas, cuota, saldo2025, 'si', String(data.notas || ''), '',
    cuotaMensual, inicioCobro, ''];
  sh.appendRow(row);
  return { ok: true, clave: clave, nombre: nombre, residencial: residencial, lote: lote, cuota: cuota };
}

/** Activa o desactiva un propietario (reversible; conserva su historial). */
function setPropActivo(clave, activo) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var ci = h.indexOf('clave'), ai = h.indexOf('activo');
  if (ci < 0 || ai < 0) throw new Error('No se encontró la columna clave/activo.');
  var v = activo ? 'si' : 'no';
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === String(clave).trim()) {
      sh.getRange(r + 1, ai + 1).setValue(v);
      return { ok: true, clave: clave, activo: !!activo };
    }
  }
  throw new Error('No existe la cuenta ' + clave);
}

/**
 * Elimina físicamente un propietario. SOLO si no tiene pagos registrados (para
 * no dejar registros huérfanos). Si tiene pagos, obliga a desactivar.
 */
function eliminarPropietario(clave) {
  ensureSheets();
  clave = String(clave).trim();
  var pagos = getPagosByClave(clave);
  if (pagos.length) throw new Error('Este propietario tiene ' + pagos.length + ' pago(s) registrado(s). Desactívalo en vez de eliminarlo (así conservas el historial).');
  var sh = _ss().getSheetByName(SH.PROP);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var ci = h.indexOf('clave');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][ci]).trim() === clave) { sh.deleteRow(r + 1); return { ok: true, clave: clave, eliminado: true }; }
  }
  throw new Error('No existe la cuenta ' + clave);
}

// Carga inicial de las cuotas fijas inferidas del Excel (los propietarios con
// cabaña). Corre una vez sobre el Sheet ya sembrado; no toca a los demás.
function aplicarCuotasInferidas() {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.PROP);
  var byClave = {};
  AC_SEED.forEach(function (s) { if (Number(s.cuotaMensual) > 0) byClave[s.clave] = _round2(s.cuotaMensual); });
  var vals = sh.getDataRange().getValues(), header = vals[0].map(function (h) { return String(h).trim(); });
  var ci = header.indexOf('clave'), qi = header.indexOf('cuotaMensual');
  var aplicadas = [];
  for (var r = 1; r < vals.length; r++) {
    var k = String(vals[r][ci]).trim();
    if (byClave[k] !== undefined) {
      sh.getRange(r + 1, qi + 1).setValue(byClave[k]);
      aplicadas.push(k + '=' + byClave[k]);
    }
  }
  return { aplicadas: aplicadas };
}

/* ─────────────── escritura ─────────────── */

function appendPago(pago) {
  var ss = _ss();
  var sh = ss.getSheetByName(SH.PAGOS);
  if (!sh) { ensureSheets(); sh = ss.getSheetByName(SH.PAGOS); }
  var prop = pago.clave ? _findProp(pago.clave) : null;
  var id = pago.id || ('P' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000));
  sh.appendRow([
    id,
    pago.fecha instanceof Date ? pago.fecha : new Date(pago.fecha || _today()),
    String(pago.clave || '').trim(),
    pago.lote || (prop ? prop.lote : ''),
    pago.nombre || (prop ? prop.nombre : ''),
    _round2(pago.monto),
    pago.referencia || '',
    pago.origen || 'manual',
    pago.mesAplicado || '',
    pago.notas || '',
    new Date(),
    pago.comprobanteUrl || ''
  ]);
  return id;
}

// Elimina una fila de PAGOS por su id. Devuelve true si eliminó algo.
function _eliminarPagoById(id) {
  if (!id) return false;
  var sh = _ss().getSheetByName(SH.PAGOS);
  if (!sh) return false;
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  if (iId < 0) return false;
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]) === String(id)) { sh.deleteRow(r + 1); return true; }
  }
  return false;
}

// Respaldo para comprobantes aplicados antes de que existiera pagoId:
// elimina el pago de origen 'comprobante' que coincide por clave + monto
// (y URL de comprobante si está disponible). Devuelve nº de filas eliminadas (0/1).
function _eliminarPagoDeComprobante(clave, monto, comprobanteUrl) {
  var sh = _ss().getSheetByName(SH.PAGOS);
  if (!sh) return 0;
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iCl = h.indexOf('clave'), iMo = h.indexOf('monto'), iOr = h.indexOf('origen'), iUrl = h.indexOf('comprobanteUrl');
  clave = String(clave || '').trim(); monto = _round2(monto);
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iOr]) !== 'comprobante') continue;
    if (String(vals[r][iCl]).trim() !== clave) continue;
    if (_round2(vals[r][iMo]) !== monto) continue;
    if (comprobanteUrl && iUrl >= 0 && String(vals[r][iUrl] || '') && String(vals[r][iUrl]) !== String(comprobanteUrl)) continue;
    sh.deleteRow(r + 1); return 1;
  }
  return 0;
}

// Elimina un pago por id (acción de administrador). Si el pago provenía de un
// comprobante, devuelve ese comprobante a 'pendiente' para no dejarlo huérfano.
function eliminarPago(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id del pago.');
  var sh = _ss().getSheetByName(SH.PAGOS);
  if (!sh) throw new Error('No existe la hoja de pagos.');
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  if (iId < 0) throw new Error('No se encontró la columna id.');
  var row = -1;
  for (var r = vals.length - 1; r >= 1; r--) { if (String(vals[r][iId]) === id) { row = r; break; } }
  if (row < 0) throw new Error('Pago no encontrado: ' + id);
  sh.deleteRow(row + 1);
  var revert = _revertComprobantePorPago(id);
  return { ok: true, id: id, comprobanteRevertido: revert };
}

// Devuelve a 'pendiente' el comprobante ligado a un pagoId (si lo hay).
function _revertComprobantePorPago(pagoId) {
  var sh = _ss().getSheetByName(SH.COMPROB);
  if (!sh) return false;
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iPid = h.indexOf('pagoId'), iEst = h.indexOf('estado');
  if (iPid < 0 || iEst < 0) return false;
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iPid]) === String(pagoId) && String(vals[r][iEst]) === 'aplicado') {
      sh.getRange(r + 1, iEst + 1).setValue('pendiente');
      sh.getRange(r + 1, iPid + 1).setValue('');
      return true;
    }
  }
  return false;
}

function registrarPago(pago) {
  if (!pago || !pago.clave || !(Number(pago.monto) > 0)) {
    throw new Error('Pago inválido (falta clave de cuenta o monto).');
  }
  var id = appendPago(pago);
  var prop = _findProp(pago.clave);
  var resultado = { id: id, clave: pago.clave };
  if (pago.enviarCorreo && prop && prop.email) {
    try { resultado.correo = enviarEstadoCuenta(pago.clave); }
    catch (e) { resultado.correoError = String(e); }
  }
  return resultado;
}

/* ─────────────── carga inicial (seed) ─────────────── */

function seedInicial(force) {
  ensureSheets();
  var ss = _ss();
  var shP = ss.getSheetByName(SH.PROP);
  var shPagos = ss.getSheetByName(SH.PAGOS);

  if (shP.getLastRow() > 1 && !force) {
    return { skipped: true, motivo: 'Ya existen propietarios. Usa force:true para recargar.' };
  }
  if (force) {
    if (shP.getLastRow() > 1) shP.deleteRows(2, shP.getLastRow() - 1);
    if (shPagos.getLastRow() > 1) shPagos.deleteRows(2, shPagos.getLastRow() - 1);
  }

  var filasProp = AC_SEED.map(function (s) {
    return [s.clave, s.residencial, s.lote, s.loteNum, s.nombre, s.email, s.celular,
            s.lotes, s.cabanas, _round2(s.cuota), _round2(s.saldo2025), 'si', s.notas || '', '',
            (Number(s.cuotaMensual) > 0 ? _round2(s.cuotaMensual) : ''), (s.inicioCobro || ''), ''];
  });
  shP.getRange(2, 1, filasProp.length, COL_PROP.length).setValues(filasProp);

  // Pagos: expande el histórico mensual 2026 (una fila por mes con monto>0)
  var filasPago = [], year = CONFIG.ANIO_ACTUAL;
  AC_SEED.forEach(function (s) {
    (s.pagos || []).forEach(function (monto, idx) {
      if (Number(monto) > 0) {
        filasPago.push(['SEED-' + s.clave + '-' + AC_MESES[idx], new Date(year, idx, 15),
          s.clave, s.lote, s.nombre, _round2(monto), '', 'carga-inicial',
          AC_MESES[idx] + ' ' + year, 'Histórico ' + AC_MESES[idx], new Date(), '']);
      }
    });
  });
  if (filasPago.length) {
    shPagos.getRange(2, 1, filasPago.length, COL_PAGOS.length).setValues(filasPago);
  }
  return { propietarios: filasProp.length, pagos: filasPago.length };
}
