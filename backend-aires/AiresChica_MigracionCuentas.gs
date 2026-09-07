/**
 * Migración a dos bancos + cuenta por rendir (septiembre 2026).
 *
 * Hace tres cosas, en este orden, porque cada una depende de la anterior:
 *
 *   1. CREA las cuentas que faltan: Global Bank y "Por rendir · administración".
 *      La del Banco General ya se sembró sola desde la configuración.
 *
 *   2. REPARTE el histórico: los 318 pagos y los 110 gastos que existen sin
 *      cuenta pasan a Banco General, porque hasta el 18/08 no había otra —CON
 *      DOS EXCEPCIONES que el estado de cuenta de Global desmintió: el contrato
 *      de Fernando López (400.00) y el abono a Cornelio Sánchez (250.00) salieron
 *      de Global, no del Banco General. Sin esas dos excepciones el saldo de
 *      Global quedaría 650.00 por encima del real.
 *
 *   3. CARGA lo que el estado de cuenta de Global reveló y el sistema no tenía:
 *      los dos traspasos que la fondearon, el pago de Ana Saunders, y la fecha
 *      correcta del abono a Cornelio (29/08, no 31/08 — se cargó al cierre de mes
 *      porque el Excel del cliente era un resumen sin fecha por partida).
 *
 * VERIFICACIÓN: al terminar, el saldo calculado de Global al 31/08 tiene que ser
 * EXACTAMENTE B/.2,908.00, que es el que imprime el banco:
 *
 *     0 + 500 + 3,000 + 58 (Ana) − 250 (Cornelio) − 400 (Fernando) = 2,908.00
 *
 * La función lo comprueba sola y lo devuelve en `cuadre`. Si no cuadra, algo se
 * cargó mal y hay que revisar antes de seguir.
 *
 * Uso: ejecutar `migrarACuentas()` una vez. Para deshacer: `rollbackMigracionCuentas()`.
 */

var MC_PROP = 'AC_MIGRACION_CUENTAS';
var MC_TAG  = 'MC26-';            // prefijo de los ids que inserta (traspasos y pago)

var MC_CUENTA_BG     = '';        // se resuelve en tiempo de ejecución (la sembrada del config)
var MC_ID_GLOBAL     = 'global-bank';
var MC_ID_PORRENDIR  = 'por-rendir';

/**
 * Los gastos que NO salieron del Banco General. Se identifican por id porque son
 * los que cargó `cargarAgosto2026()` y su id es estable; cruzarlos por proveedor
 * y monto sería frágil (Fernando López factura casi todos los meses).
 */
var MC_GASTOS_GLOBAL = [
  { id: 'CA26-G-1', cuenta: MC_ID_GLOBAL, quien: 'Fernando López',   monto: 400.00 },
  { id: 'CA26-G-5', cuenta: MC_ID_GLOBAL, quien: 'Cornelio Sánchez', monto: 250.00,
    fecha: new Date(2026, 7, 29) }   // el banco lo fecha el 29/08, no el 31
];

function migrarACuentas(force) {
  ensureSheets(true);            // hay columnas nuevas: hay que forzar la revisión
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(MC_PROP) && !force) {
    return { ok: false, yaAplicado: true,
      msg: 'La migración a cuentas YA se aplicó. Para repetir: rollbackMigracionCuentas().' };
  }

  var avisos = [];
  var bg = cuentaDeCobro();      // la sembrada desde la configuración
  if (!bg || !bg.id) throw new Error('No se pudo resolver la cuenta del Banco General. Abre ⚙ Opciones una vez y reintenta.');
  MC_CUENTA_BG = bg.id;

  // ── 1) cuentas nuevas ──────────────────────────────────────────────────────
  var creadas = [];
  if (!cuentaPorId(MC_ID_GLOBAL)) {
    guardarCuenta({ id: MC_ID_GLOBAL, nombre: 'Global Bank', banco: 'Global Bank',
      tipo: 'Ahorros', numero: '56333001422',
      titular: 'Asociación Privada de Propietarios de la Comunidad de Aires de Chicá',
      clase: 'banco', activa: true, esCobro: false, fondoInicial: 0, orden: 20,
      notas: 'Abierta el 18/08/2026.' });
    creadas.push(MC_ID_GLOBAL);
  } else avisos.push('La cuenta Global Bank ya existía.');

  if (!cuentaPorId(MC_ID_PORRENDIR)) {
    guardarCuenta({ id: MC_ID_PORRENDIR, nombre: 'Por rendir · administración',
      banco: 'Administración', tipo: '', numero: '', titular: '',
      clase: 'porRendir', activa: true, esCobro: false, fondoInicial: 0, orden: 30,
      notas: 'Dinero de la asociación en manos de la administración: cuotas depositadas ' +
             'en cuentas personales y gastos pagados con tarjeta personal. Se salda con un traspaso.' });
    creadas.push(MC_ID_PORRENDIR);
  } else avisos.push('La cuenta por rendir ya existía.');

  // ── 2) reparto del histórico ───────────────────────────────────────────────
  var reparto = rellenarCuentaHistorica(MC_CUENTA_BG);

  // excepciones: lo que salió de Global
  var excepciones = [];
  MC_GASTOS_GLOBAL.forEach(function (g) {
    var r = _mcFijarGasto(g);
    if (r.encontrado) excepciones.push(r);
    else avisos.push('No se encontró el gasto ' + g.id + ' (' + g.quien + '): no se reasignó a Global.');
  });

  // ── 3) lo que el estado de cuenta reveló ───────────────────────────────────
  var traspasos = [], pagos = [];
  var yaT = getTraspasos().map(function (t) { return t.id; });

  [{ id: MC_TAG + 'T1', fecha: new Date(2026, 7, 18), monto: 500.00,
     referencia: 'Apertura de cuenta',
     notas: 'Glosa del banco: "TRANSFERENCIA DE 30102226924 DORAIDA CASTILLO apertura de". ' +
            'Registrado como salido del Banco General por indicación de la administración.' },
   { id: MC_TAG + 'T2', fecha: new Date(2026, 7, 31), monto: 3000.00,
     referencia: 'Transfiriendo fondos',
     notas: 'Glosa del banco: "AIRES DE CHICA Transfiriendo fondos".' }
  ].forEach(function (t) {
    if (yaT.indexOf(t.id) >= 0) { avisos.push('El traspaso ' + t.id + ' ya estaba registrado.'); return; }
    registrarTraspaso({ id: t.id, fecha: t.fecha, de: MC_CUENTA_BG, a: MC_ID_GLOBAL,
      monto: t.monto, referencia: t.referencia, notas: t.notas });
    traspasos.push({ id: t.id, monto: t.monto });
  });

  // pago de Ana Saunders (H-46), que sólo aparecía en el estado de cuenta de Global
  var idAna = MC_TAG + 'P-H46';
  if (_mcExistePago(idAna)) avisos.push('El pago de Ana Saunders ya estaba registrado.');
  else if (!_findProp('H-46')) avisos.push('ATENCIÓN: no existe la cuenta H-46. El pago de B/.58.00 NO se registró.');
  else {
    appendPago({ id: idAna, clave: 'H-46', monto: 58.00, fecha: new Date(2026, 7, 31),
      origen: 'manual', mesAplicado: '2026-08', cuenta: MC_ID_GLOBAL,
      referencia: '00000000015735300409009',
      notas: 'ANA SAUNDERS · glosa "CUO" · estado de cuenta Global Bank al 31/08/2026' });
    _reg('pago.alta', { entidad: 'pago', clave: 'H-46', monto: 58.00,
      detalle: 'Estado de cuenta Global Bank 31/08 · abono parcial' });
    pagos.push({ id: idAna, clave: 'H-46', monto: 58.00 });
  }

  // ── verificación contra el saldo que imprime el banco ──────────────────────
  var s = saldosPorCuenta(new Date(2026, 7, 31));
  var gb = s.cuentas.filter(function (c) { return c.id === MC_ID_GLOBAL; })[0];
  var calc = gb ? gb.saldo : 0;
  var cuadre = { esperado: 2908.00, calculado: calc, cuadra: Math.abs(calc - 2908.00) < 0.005 };
  if (!cuadre.cuadra) {
    avisos.push('EL SALDO DE GLOBAL NO CUADRA: calculado B/.' + calc.toFixed(2) +
                ', el banco dice B/.2,908.00. Revisa antes de seguir.');
  }
  if (s.sinAsignar) avisos.push('Quedaron movimientos sin cuenta asignada. Revísalos.');

  props.setProperty(MC_PROP, new Date().toISOString());
  return { ok: true, cuentasCreadas: creadas, reparto: reparto, excepciones: excepciones,
    traspasos: traspasos, pagos: pagos, cuadre: cuadre, saldos: s.cuentas, avisos: avisos,
    msg: 'Migración aplicada. Global al 31/08: B/.' + calc.toFixed(2) +
         (cuadre.cuadra ? ' ✓ cuadra con el banco.' : ' ✗ NO cuadra.') };
}

/**
 * Asigna una cuenta a todo pago y gasto que no tenga ninguna. Se escribe columna
 * completa de una sola vez (setValues), no fila por fila: son 428 renglones y
 * una escritura por fila tardaría minutos y podría chocar con el límite de
 * ejecución de Apps Script.
 */
function rellenarCuentaHistorica(cuentaId) {
  ensureSheets();
  cuentaId = String(cuentaId || '').trim() || (cuentaDeCobro().id || '');
  if (!cuentaId) throw new Error('No hay cuenta a la que asignar el histórico.');
  if (!cuentaPorId(cuentaId)) throw new Error('No existe la cuenta ' + cuentaId + '.');

  var out = {};
  [[SH.PAGOS, 'pagos'], [SH.GASTOS, 'gastos']].forEach(function (par) {
    var sh = _ss().getSheetByName(par[0]);
    if (!sh) { out[par[1]] = 0; return; }
    var vals = sh.getDataRange().getValues();
    var i = vals[0].map(function (x) { return String(x).trim(); }).indexOf('cuenta');
    if (i < 0) { out[par[1]] = 0; return; }
    var col = [], n = 0;
    for (var r = 1; r < vals.length; r++) {
      var v = String(vals[r][i] || '').trim();
      if (!v) { col.push([cuentaId]); n++; } else col.push([v]);
    }
    if (col.length) sh.getRange(2, i + 1, col.length, 1).setValues(col);
    out[par[1]] = n;
  });

  _reg('cuenta.rellena', { entidad: 'cuenta', clave: cuentaId,
    detalle: out.pagos + ' pago(s) y ' + out.gastos + ' gasto(s) sin cuenta asignados a ' + cuentaId });
  return out;
}

/** Reasigna un gasto a otra cuenta y, si hace falta, le corrige la fecha. */
function _mcFijarGasto(g) {
  var sh = _ss().getSheetByName(SH.GASTOS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iCta = h.indexOf('cuenta'), iFecha = h.indexOf('fecha'), iMes = h.indexOf('mes');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== g.id) continue;
    var antes = String(vals[r][iCta] || '');
    sh.getRange(r + 1, iCta + 1).setValue(g.cuenta);
    var fechaCambiada = false;
    if (g.fecha) {
      sh.getRange(r + 1, iFecha + 1).setValue(g.fecha);
      if (iMes >= 0) sh.getRange(r + 1, iMes + 1).setValue(_gastoMes(g.fecha));
      fechaCambiada = true;
    }
    _reg('gasto.edita', { entidad: 'gasto', clave: g.id, propietario: g.quien, monto: g.monto,
      antes: antes, despues: g.cuenta,
      detalle: 'Salió de Global Bank, no del Banco General' +
               (fechaCambiada ? ' · fecha corregida al ' + Utilities.formatDate(g.fecha, CONFIG.TZ, 'dd/MM/yyyy') : '') });
    return { encontrado: true, id: g.id, quien: g.quien, monto: g.monto,
      cuenta: g.cuenta, fechaCorregida: fechaCambiada };
  }
  return { encontrado: false, id: g.id };
}

function _mcExistePago(id) {
  var sh = _ss().getSheetByName(SH.PAGOS);
  if (!sh) return false;
  var vals = sh.getDataRange().getValues();
  for (var r = 1; r < vals.length; r++) if (String(vals[r][0]).trim() === id) return true;
  return false;
}

/**
 * Deshace la migración: borra el pago y los traspasos que insertó y vacía la
 * columna `cuenta`. NO borra las cuentas creadas —pueden tener movimientos
 * posteriores— ni revierte la fecha de Cornelio, porque el 29/08 es la fecha
 * correcta según el banco y volver al 31/08 sería reintroducir el error.
 */
function rollbackMigracionCuentas() {
  ensureSheets();
  var borrados = { pagos: 0, traspasos: 0 };

  var shP = _ss().getSheetByName(SH.PAGOS);
  var vp = shP.getDataRange().getValues();
  for (var r = vp.length - 1; r >= 1; r--) {
    if (String(vp[r][0] || '').indexOf(MC_TAG) === 0) { shP.deleteRow(r + 1); borrados.pagos++; }
  }
  var shT = _traspasosSheet();
  var vt = shT.getDataRange().getValues();
  for (var k = vt.length - 1; k >= 1; k--) {
    if (String(vt[k][0] || '').indexOf(MC_TAG) === 0) { shT.deleteRow(k + 1); borrados.traspasos++; }
  }
  // vaciar la columna cuenta en ambas hojas
  [SH.PAGOS, SH.GASTOS].forEach(function (n) {
    var sh = _ss().getSheetByName(n);
    if (!sh) return;
    var vals = sh.getDataRange().getValues();
    var i = vals[0].map(function (x) { return String(x).trim(); }).indexOf('cuenta');
    if (i < 0 || vals.length < 2) return;
    sh.getRange(2, i + 1, vals.length - 1, 1).setValues(vals.slice(1).map(function () { return ['']; }));
  });

  PropertiesService.getScriptProperties().deleteProperty(MC_PROP);
  return { ok: true, borrados: borrados,
    msg: 'Se borraron ' + borrados.pagos + ' pago(s) y ' + borrados.traspasos +
         ' traspaso(s), y se vació la columna de cuenta. Las cuentas creadas y la fecha ' +
         'corregida de Cornelio (29/08, la del banco) se conservan.' };
}

/** Estado de la migración, para verificar sin abrir la hoja. */
function estadoMigracionCuentas() {
  ensureSheets();
  var s = saldosPorCuenta(new Date(2026, 7, 31));
  return {
    aplicada: !!PropertiesService.getScriptProperties().getProperty(MC_PROP),
    cuentas: getCuentas(true).map(function (c) { return { id: c.id, nombre: c.nombre, esCobro: c.esCobro }; }),
    saldosAl3108: s.cuentas, total: s.total, sinAsignar: s.sinAsignar
  };
}
