/**
 * Balance de la asociación — el "stock" que el resto del sistema no lleva.
 *
 * El sistema ya produce, por construcción, el estado de RESULTADOS (Finanzas:
 * ingresos menos egresos, base caja) y ya conoce tres de las cinco líneas
 * grandes de un balance sin que nadie las teclee:
 *
 *   efectivo            fondoInicial + ingresos − egresos   (Finanzas)
 *   cuentas por cobrar  carteraVencida + moraAcumulada      (tablero)
 *   pagos adelantados   creditoAFavorTotal                  (tablero)
 *
 * Lo único que falta es lo que NO se mueve por cuotas ni por gastos: bienes,
 * préstamos, cuentas por pagar y compromisos. Eso vive en la hoja `Balance` y
 * es la única captura manual de este módulo.
 *
 * Criterio contable (acordado con el cliente): BALANCE DE CAJA + PATRIMONIO.
 * Todo lo pagado sigue siendo egreso del período, como hoy; los bienes se
 * registran al costo APARTE, con contrapartida en el patrimonio ("inversión en
 * bienes comunes"), sin tocar el resultado. Así el balance cuadra sin cambiar
 * ninguna cifra que los propietarios ya conocen. Contabilidad de acumulación
 * (capitalizar, sacar del gasto, devengar la cuota) queda para el CPA.
 *
 * Dos cosas se calculan solas, y son lo que evita que esto se vuelva trabajo
 * mensual:
 *   · la DEPRECIACIÓN, línea recta desde la fecha de compra y la vida útil;
 *   · el SALDO DE UN PRÉSTAMO, que se amortiza con los abonos ya registrados
 *     en Gastos (categoría de préstamo + proveedor). Sólo se teclea una vez el
 *     principal.
 *
 * `getBalance` a propósito NO lee Pagos ni Propietarios: lo derivado lo pone el
 * panel, que ya tiene el tablero y Finanzas en memoria. Así el tab abre al
 * instante en vez de pagar otra vez los ~30 s del tablero.
 */

var SH_BAL = 'Balance';
var COL_BAL = ['id', 'tipo', 'grupo', 'nombre', 'detalle', 'fecha', 'monto',
               'vidaUtil', 'vence', 'amortizaCon', 'activo', 'notas', 'creado'];

// Abonos que NO pasan por Gastos ni por Pagos: el caso típico es el préstamo a un
// colaborador, que se recupera descontándolo del honorario. Ese descuento no mueve
// el banco —se paga menos, y ya—, así que no puede registrarse como gasto ni como
// ingreso sin descuadrar el efectivo. Vive aquí y sólo baja el saldo de su partida.
var SH_BALABO = 'BalanceAbonos';
var COL_BALABO = ['id', 'partidaId', 'fecha', 'monto', 'nota', 'creado'];

// Categoría de Gastos con la que se amortizan los préstamos. Tiene que ser una
// de las del presupuesto (ver DEFAULT_GASTO_CATS). El acreedor puede recibir
// otros pagos —Doraida Castillo cobra además honorarios administrativos—, así
// que NO basta con cruzar por proveedor: sólo cuentan los de esta categoría.
var BAL_CAT_PRESTAMO = 'Línea de crédito / préstamo';

/**
 * Los ocho grupos del balance. Lista cerrada a propósito: el formato contable
 * de referencia tiene 96 renglones y 40 en cero, que es justo lo que vuelve
 * ilegible un balance.
 *   deprecia : admite vida útil y se deprecia línea recta
 *   amortiza : el saldo baja con los abonos registrados en Gastos
 *   descuenta: el saldo baja con abonos que se capturan a mano (hoja BalanceAbonos)
 *   vence    : lleva fecha de vencimiento y se marca en rojo si ya pasó
 */
var BAL_GRUPOS = [
  { id: 'bienes',     tipo: 'activo', nombre: 'Bienes de la comunidad',    deprecia: true,
    ayuda: 'Portón, luminarias, cámaras, cerca perimetral, pozo, equipos.' },
  { id: 'terreno',    tipo: 'activo', nombre: 'Terrenos y áreas comunes',
    ayuda: 'No se deprecian.' },
  { id: 'prestamoCol', tipo: 'activo', nombre: 'Préstamos a colaboradores', descuenta: true,
    ayuda: 'Adelantos que se recuperan descontándolos de los honorarios.' },
  { id: 'garantia',   tipo: 'activo', nombre: 'Depósitos en garantía',
    ayuda: 'Depósitos entregados a terceros que la asociación recuperará.' },
  { id: 'porCobrar',  tipo: 'activo', nombre: 'Otros por cobrar',
    ayuda: 'Cobros que no vienen de la cuota de mantenimiento.' },
  { id: 'prestamo',   tipo: 'pasivo', nombre: 'Préstamos por pagar',       amortiza: true,
    ayuda: 'Se teclea el principal una vez; los abonos registrados en Gastos lo van bajando.' },
  { id: 'cxp',        tipo: 'pasivo', nombre: 'Cuentas por pagar',         vence: true,
    ayuda: 'Facturas de proveedores pendientes de pago.' },
  { id: 'compromiso', tipo: 'pasivo', nombre: 'Compromisos y provisiones',
    ayuda: 'Obligaciones asumidas que todavía no tienen factura.' }
];

function _balGrupo(id) {
  for (var i = 0; i < BAL_GRUPOS.length; i++) if (BAL_GRUPOS[i].id === id) return BAL_GRUPOS[i];
  return null;
}

/* ─────────────── lectura ─────────────── */

function _balFecha(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v || '').trim();
  if (!s) return null;
  var d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
  return isNaN(d.getTime()) ? null : d;
}

function _balISO(d) {
  return d ? Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd') : '';
}

// Meses completos transcurridos entre dos fechas (para la depreciación).
function _balMeses(desde, hasta) {
  if (!desde || !hasta) return 0;
  var m = (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
  if (hasta.getDate() < desde.getDate()) m--;
  return Math.max(0, m);
}

function _balRows() {
  ensureSheets();
  return _sheetRows(SH_BAL).map(function (r) {
    var g = _balGrupo(String(r.grupo || '').trim());
    return {
      id: String(r.id || '').trim(),
      tipo: String(r.tipo || '').trim() === 'pasivo' ? 'pasivo' : 'activo',
      grupo: g ? g.id : 'bienes',
      nombre: String(r.nombre || '').trim(),
      detalle: String(r.detalle || '').trim(),
      fecha: _balFecha(r.fecha),
      monto: _round2(r.monto),
      vidaUtil: Math.max(0, Math.min(60, Number(r.vidaUtil) || 0)),
      vence: _balFecha(r.vence),
      amortizaCon: String(r.amortizaCon || '').trim(),
      activo: !(String(r.activo).toLowerCase() === 'no' || r.activo === false),
      notas: String(r.notas || '').trim()
    };
  }).filter(function (r) { return r.id && r.nombre; });
}

/**
 * Abonos de préstamo ya registrados en Gastos, por proveedor normalizado.
 * Se lee la hoja Gastos directa (es pequeña) en vez de getGastosData, que
 * arrastra Pagos y Propietarios.
 */
function _balAbonos(hasta) {
  var out = {};
  var corte = hasta ? hasta.getTime() + 86399999 : Infinity;
  _sheetRows(SH.GASTOS).forEach(function (g) {
    if (String(g.categoria || '').trim() !== BAL_CAT_PRESTAMO) return;
    var f = _balFecha(g.fecha);
    if (!f || f.getTime() > corte) return;
    var k = _normTxt(g.proveedor || '');
    if (!k) return;
    (out[k] = out[k] || []).push({
      id: String(g.id || ''), fecha: _balISO(f), monto: _round2(g.monto),
      detalle: String(g.detalle || '')
    });
  });
  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  });
  return out;
}

// Abonos capturados a mano, por partida (hoja BalanceAbonos).
function _balAbonosManual(hasta) {
  var out = {};
  var corte = hasta ? hasta.getTime() + 86399999 : Infinity;
  _sheetRows(SH_BALABO).forEach(function (a) {
    var pid = String(a.partidaId || '').trim();
    var f = _balFecha(a.fecha);
    if (!pid || !f || f.getTime() > corte) return;
    (out[pid] = out[pid] || []).push({
      id: String(a.id || ''), fecha: _balISO(f), monto: _round2(a.monto),
      detalle: String(a.nota || ''), manual: true
    });
  });
  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  });
  return out;
}

/**
 * Partidas del balance a una fecha de corte, ya resueltas: depreciación
 * acumulada de los bienes y saldo vivo de los préstamos.
 *
 * asOf: 'YYYY-MM-DD' o vacío (hoy).
 */
function getBalance(asOf) {
  var corte = _balFecha(asOf) || new Date();
  var rows = _balRows();
  var abonos = _balAbonos(corte);
  var manuales = _balAbonosManual(corte);
  var cfg = _cfg();

  var partidas = rows.map(function (r) {
    var p = {
      id: r.id, tipo: r.tipo, grupo: r.grupo, nombre: r.nombre, detalle: r.detalle,
      fecha: _balISO(r.fecha), monto: r.monto, vidaUtil: r.vidaUtil,
      vence: _balISO(r.vence), amortizaCon: r.amortizaCon, activo: r.activo, notas: r.notas,
      // valores resueltos
      deprAcum: 0, neto: r.monto, abonado: 0, saldo: r.monto, abonos: [], vencida: false
    };
    var g = _balGrupo(r.grupo) || {};

    // Bienes: depreciación línea recta desde la fecha de compra.
    if (g.deprecia && r.vidaUtil > 0 && r.fecha) {
      var meses = _balMeses(r.fecha, corte);
      var vida = r.vidaUtil * 12;
      p.deprAcum = _round2(Math.min(r.monto, r.monto * Math.min(meses, vida) / vida));
      p.neto = _round2(r.monto - p.deprAcum);
      p.mesesDepr = meses;
      p.mesesVida = vida;
    }

    // Préstamos: el saldo lo bajan los abonos ya registrados en Gastos.
    if (g.amortiza && r.amortizaCon) {
      var lista = (abonos[_normTxt(r.amortizaCon)] || []).filter(function (a) {
        return !r.fecha || a.fecha >= _balISO(r.fecha);
      });
      p.abonos = lista;
      p.abonado = _round2(lista.reduce(function (s, a) { return s + a.monto; }, 0));
      p.saldo = _round2(Math.max(0, r.monto - p.abonado));
      // cuota y meses restantes, estimados con el último abono
      var ult = lista.length ? lista[lista.length - 1].monto : 0;
      p.cuota = ult;
      p.mesesRest = ult > 0 ? Math.ceil(p.saldo / ult) : 0;
    }

    // Préstamos a colaboradores: el saldo lo bajan los descuentos de honorarios,
    // que se capturan a mano porque no dejan rastro en el banco.
    if (g.descuenta) {
      var desc = manuales[r.id] || [];
      p.abonos = desc;
      p.abonado = _round2(desc.reduce(function (s, a) { return s + a.monto; }, 0));
      p.saldo = _round2(Math.max(0, r.monto - p.abonado));
      var ud = desc.length ? desc[desc.length - 1].monto : 0;
      p.cuota = ud;
      p.mesesRest = ud > 0 ? Math.ceil(p.saldo / ud) : 0;
    }

    if (g.vence && r.vence) p.vencida = r.vence.getTime() < corte.getTime();
    return p;
  });

  // Lo que cuenta para los totales: sólo las partidas vigentes.
  var vig = partidas.filter(function (p) { return p.activo; });
  function suma(fn) { return _round2(vig.reduce(function (s, p) { return s + (fn(p) || 0); }, 0)); }

  var bienesCosto = suma(function (p) { return p.grupo === 'bienes' ? p.monto : 0; });
  var bienesDepr  = suma(function (p) { return p.grupo === 'bienes' ? p.deprAcum : 0; });
  var totales = {
    bienesCosto: bienesCosto,
    bienesDepr: bienesDepr,
    bienesNeto: _round2(bienesCosto - bienesDepr),
    terreno:    suma(function (p) { return p.grupo === 'terreno' ? p.monto : 0; }),
    // por SALDO, no por principal: lo ya descontado del honorario no se cobra dos veces
    prestamosCol: suma(function (p) { return p.grupo === 'prestamoCol' ? p.saldo : 0; }),
    prestadoCol:  suma(function (p) { return p.grupo === 'prestamoCol' ? p.monto : 0; }),
    garantia:   suma(function (p) { return p.grupo === 'garantia' ? p.monto : 0; }),
    porCobrar:  suma(function (p) { return p.grupo === 'porCobrar' ? p.monto : 0; }),
    prestamos:  suma(function (p) { return p.grupo === 'prestamo' ? p.saldo : 0; }),
    cxp:        suma(function (p) { return p.grupo === 'cxp' ? p.monto : 0; }),
    cxpVencida: suma(function (p) { return (p.grupo === 'cxp' && p.vencida) ? p.monto : 0; }),
    compromisos: suma(function (p) { return p.grupo === 'compromiso' ? p.monto : 0; })
  };
  totales.otrosActivos = _round2(totales.terreno + totales.prestamosCol +
                                 totales.garantia + totales.porCobrar);
  // Activos registrados a mano (sin efectivo ni cartera): la contrapartida en
  // el patrimonio bajo "inversión en bienes comunes".
  totales.activosPropios = _round2(totales.bienesNeto + totales.otrosActivos);
  totales.pasivoManual = _round2(totales.prestamos + totales.cxp + totales.compromisos);

  return {
    asOf: _balISO(corte),
    grupos: BAL_GRUPOS,
    partidas: partidas,
    totales: totales,
    // % del saldo con más de 90 días que se considera incobrable. Lo define
    // Opciones una sola vez; el panel lo aplica sobre el aging del tablero.
    provisionPct: _round2(cfg.provisionIncobrablesPct || 0),
    catPrestamo: BAL_CAT_PRESTAMO,
    // Cuánto de los egresos del año fue DEVOLUCIÓN DE CAPITAL y no gasto de
    // operación. En base caja el abono se registra como gasto (así lo presupuestó
    // la Junta y así lo lee), pero quien mire el resultado merece saberlo.
    capitalDevueltoAnio: _balCapitalAnio(corte)
  };
}

// Abonos a préstamos hechos en el año del corte, hasta la fecha de corte.
function _balCapitalAnio(corte) {
  var anio = corte.getFullYear(), tope = corte.getTime() + 86399999, t = 0;
  _sheetRows(SH.GASTOS).forEach(function (g) {
    if (String(g.categoria || '').trim() !== BAL_CAT_PRESTAMO) return;
    var f = _balFecha(g.fecha);
    if (!f || f.getFullYear() !== anio || f.getTime() > tope) return;
    t = _round2(t + (Number(g.monto) || 0));
  });
  return t;
}

/* ─────────────── escritura ─────────────── */

function _balValida(p) {
  var g = _balGrupo(String(p.grupo || '').trim());
  if (!g) throw new Error('Grupo de balance no válido: ' + p.grupo);
  if (!String(p.nombre || '').trim()) throw new Error('Ponle un nombre a la partida.');
  if (!(Number(p.monto) > 0)) throw new Error('Indica un monto mayor que cero.');
  if (g.deprecia && Number(p.vidaUtil) > 0 && !_balFecha(p.fecha)) {
    throw new Error('Para depreciar un bien hace falta la fecha de compra.');
  }
  return g;
}

/**
 * Alta o edición de una partida. Sin id crea; con id actualiza.
 * p: { id, grupo, nombre, detalle, fecha, monto, vidaUtil, vence, amortizaCon, activo, notas }
 */
function guardarPartidaBalance(p) {
  ensureSheets();
  p = p || {};
  var g = _balValida(p);
  var sh = _ss().getSheetByName(SH_BAL);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var id = String(p.id || '').trim();

  var fila = {
    tipo: g.tipo,
    grupo: g.id,
    nombre: String(p.nombre || '').trim(),
    detalle: String(p.detalle || '').trim(),
    fecha: _balFecha(p.fecha) || '',
    monto: _round2(p.monto),
    vidaUtil: g.deprecia ? Math.max(0, Math.min(60, Number(p.vidaUtil) || 0)) : '',
    vence: g.vence ? (_balFecha(p.vence) || '') : '',
    amortizaCon: g.amortiza ? String(p.amortizaCon || '').trim() : '',
    activo: (p.activo === false || String(p.activo).toLowerCase() === 'no') ? 'no' : 'si',
    notas: String(p.notas || '').trim()
  };

  if (id) {
    var iId = h.indexOf('id');
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][iId]).trim() !== id) continue;
      var cambios = [];
      Object.keys(fila).forEach(function (c) {
        var ci = h.indexOf(c); if (ci < 0) return;
        var antes = vals[r][ci], desp = fila[c];
        var aTxt = (antes instanceof Date) ? _balISO(antes) : String(antes === null || antes === undefined ? '' : antes);
        var dTxt = (desp instanceof Date) ? _balISO(desp) : String(desp);
        if (aTxt === dTxt) return;
        sh.getRange(r + 1, ci + 1).setValue(desp);
        cambios.push({ accion: 'balance.edita', entidad: 'balance', clave: id,
          propietario: fila.nombre, campo: c, antes: aTxt, despues: dTxt,
          monto: (c === 'monto' ? fila.monto : ''), detalle: g.nombre });
      });
      _regBatch(cambios);
      return { ok: true, id: id, cambios: cambios.length };
    }
    throw new Error('Partida no encontrada: ' + id);
  }

  id = 'B' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  sh.appendRow([id, fila.tipo, fila.grupo, fila.nombre, fila.detalle, fila.fecha, fila.monto,
                fila.vidaUtil, fila.vence, fila.amortizaCon, fila.activo, fila.notas, new Date()]);
  _reg('balance.alta', { entidad: 'balance', clave: id, propietario: fila.nombre,
    monto: fila.monto, detalle: g.nombre + (fila.detalle ? ' · ' + fila.detalle : '') });
  return { ok: true, id: id };
}

/**
 * Registra un descuento contra una partida que se salda a mano (hoy, los
 * préstamos a colaboradores).
 *
 * NO mueve caja ni resultado, y eso es lo correcto: el descuento no es un
 * movimiento del banco. Al colaborador se le paga menos, y ese pago menor ya
 * quedó en Gastos por lo que efectivamente salió. Registrarlo además como
 * ingreso o como gasto descuadraría el efectivo contra el estado bancario.
 */
function registrarAbonoBalance(partidaId, abono) {
  ensureSheets();
  partidaId = String(partidaId || '').trim();
  abono = abono || {};
  var p = null, rows = _balRows();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === partidaId) p = rows[i];
  if (!p) throw new Error('Partida no encontrada: ' + partidaId);
  var g = _balGrupo(p.grupo) || {};
  if (!g.descuenta) throw new Error('Esta partida no se salda con descuentos: ' + g.nombre);
  var monto = _round2(abono.monto);
  if (!(monto > 0)) throw new Error('Indica un monto mayor que cero.');
  var fecha = _balFecha(abono.fecha) || new Date();

  var id = 'A' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  _ss().getSheetByName(SH_BALABO).appendRow(
    [id, partidaId, fecha, monto, String(abono.nota || '').trim(), new Date()]);
  _reg('balance.abono', { entidad: 'balance', clave: partidaId, propietario: p.nombre,
    monto: monto, detalle: g.nombre + ' · descuento del ' + _balISO(fecha) });
  return { ok: true, id: id };
}

function eliminarAbonoBalance(id) {
  ensureSheets();
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id del descuento.');
  var sh = _ss().getSheetByName(SH_BALABO);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iP = h.indexOf('partidaId'), iM = h.indexOf('monto');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== id) continue;
    _reg('balance.abonoBaja', { entidad: 'balance', clave: String(vals[r][iP] || ''),
      monto: _round2(vals[r][iM]), detalle: 'Descuento eliminado' });
    sh.deleteRow(r + 1);
    return { ok: true, id: id };
  }
  throw new Error('Descuento no encontrado: ' + id);
}

function eliminarPartidaBalance(id) {
  ensureSheets();
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id de la partida.');
  var sh = _ss().getSheetByName(SH_BAL);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iN = h.indexOf('nombre'), iM = h.indexOf('monto'), iG = h.indexOf('grupo');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== id) continue;
    var g = _balGrupo(String(vals[r][iG] || '').trim());
    _reg('balance.baja', { entidad: 'balance', clave: id, propietario: String(vals[r][iN] || ''),
      monto: _round2(vals[r][iM]), detalle: (g ? g.nombre : '') });
    sh.deleteRow(r + 1);
    _balBorrarAbonosDe(id);   // sus descuentos no deben quedar huérfanos
    return { ok: true, id: id };
  }
  throw new Error('Partida no encontrada: ' + id);
}

// Borra de atrás hacia adelante: eliminar filas corriendo hacia abajo desplaza
// las siguientes y se saltaría una.
function _balBorrarAbonosDe(partidaId) {
  var sh = _ss().getSheetByName(SH_BALABO);
  if (!sh) return 0;
  var vals = sh.getDataRange().getValues();
  var iP = vals[0].map(function (x) { return String(x).trim(); }).indexOf('partidaId');
  if (iP < 0) return 0;
  var n = 0;
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iP]).trim() === partidaId) { sh.deleteRow(r + 1); n++; }
  }
  return n;
}
