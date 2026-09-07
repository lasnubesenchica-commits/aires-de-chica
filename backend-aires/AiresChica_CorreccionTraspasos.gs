/**
 * Corrección de los dos traspasos de agosto 2026, contra el estado de cuenta.
 *
 * Los dos se cargaron con la información que había entonces —la glosa del
 * estado de cuenta de Global— y el del Banco General los desmintió:
 *
 *   MC26-T1 · 500.00 del 18/08 · ORIGEN EQUIVOCADO
 *     Se registró como salido del Banco General. En todo agosto esa cuenta sólo
 *     tuvo cuatro débitos —290.00, 4,000.00, 22.00 y 3,000.00—; ninguno de 500.
 *     Salió de la cuenta personal de la administración, que es lo que decía la
 *     glosa de Global ("TRANSFERENCIA DE 30102226924 DORAIDA CASTILLO").
 *     Pasa a: Por rendir → Global Bank.
 *
 *   MC26-T2 · 3,000.00 · FECHA CORRIDA
 *     Salió del Banco General el 29/08; Global lo acreditó el 31/08 y se cargó
 *     con esa segunda fecha. La que vale para el saldo de la cuenta que PAGA es
 *     la del banco de origen.
 *
 * Ninguna de las dos correcciones mueve el efectivo TOTAL: un traspaso suma en
 * una cuenta lo que resta en la otra. Lo que cambia es de qué cuenta salió el
 * dinero (T1) y en qué día (T2).
 *
 * Uso: ejecutar `corregirTraspasosAgosto()` una vez. Para deshacer:
 * `rollbackCorreccionTraspasos()`.
 */

var CT_PROP = 'AC_CORRECCION_TRASPASOS_AGO2026';

/**
 * Cada corrección declara lo que ESPERA encontrar además de lo que va a poner.
 * Si la fila ya no dice lo esperado —porque alguien la editó a mano, o porque
 * esto ya corrió— no se toca y se avisa. Es lo que hace que ejecutarlo dos veces
 * sea inofensivo sin depender sólo de la marca en Script Properties.
 */
var CT_CAMBIOS = [
  { id: 'MC26-T1', campo: 'de',
    esperado: 'banco-general', nuevo: 'por-rendir',
    porque: 'En agosto no hubo ningún débito de 500.00 en el Banco General: salió de la cuenta por rendir.' },
  { id: 'MC26-T2', campo: 'fecha',
    esperado: '2026-08-31', nuevo: '2026-08-29',
    porque: 'Salió del Banco General el 29/08; el 31/08 es la fecha en que Global lo acreditó.' }
];

function corregirTraspasosAgosto(force) {
  ensureSheets();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CT_PROP) && !force) {
    return { ok: false, yaAplicado: true,
      msg: 'Las correcciones YA se aplicaron. Para repetir: rollbackCorreccionTraspasos().' };
  }

  var antes = saldosPorCuenta(new Date(2026, 7, 31));
  var sh = _traspasosSheet();
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');

  var hechos = [], avisos = [];
  CT_CAMBIOS.forEach(function (c) {
    var col = h.indexOf(c.campo);
    if (col < 0) { avisos.push('La hoja Traspasos no tiene la columna ' + c.campo + '.'); return; }
    var fila = -1;
    for (var r = 1; r < vals.length; r++) if (String(vals[r][iId]).trim() === c.id) { fila = r; break; }
    if (fila < 0) { avisos.push('No se encontró el traspaso ' + c.id + '.'); return; }

    var actual = _ctValor(vals[fila][col], c.campo);
    if (actual === c.nuevo) { avisos.push(c.id + ' · ' + c.campo + ' ya estaba en "' + c.nuevo + '".'); return; }
    if (actual !== c.esperado) {
      avisos.push('ATENCIÓN: ' + c.id + ' · ' + c.campo + ' dice "' + actual + '" y se esperaba "' +
                  c.esperado + '". NO se tocó, revísalo a mano.');
      return;
    }
    sh.getRange(fila + 1, col + 1).setValue(c.campo === 'fecha' ? _ctFecha(c.nuevo) : c.nuevo);
    hechos.push({ id: c.id, campo: c.campo, antes: actual, ahora: c.nuevo, porque: c.porque });
    _reg('traspaso.edita', { entidad: 'traspaso', clave: c.id,
      monto: _round2(vals[fila][h.indexOf('monto')]),
      campo: c.campo, antes: actual, despues: c.nuevo, detalle: c.porque });
  });

  props.setProperty(CT_PROP, new Date().toISOString());
  var despues = saldosPorCuenta(new Date(2026, 7, 31));
  return { ok: true, correcciones: hechos, avisos: avisos,
    saldosAntes: _ctResumen(antes), saldosDespues: _ctResumen(despues),
    // un traspaso suma en una cuenta lo que resta en la otra: el total no puede moverse
    totalIgual: Math.abs(antes.total - despues.total) < 0.005,
    msg: hechos.length + ' corrección(es) aplicada(s). Para deshacer: rollbackCorreccionTraspasos().' };
}

function rollbackCorreccionTraspasos() {
  ensureSheets();
  var sh = _traspasosSheet();
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  var deshechos = [];
  CT_CAMBIOS.forEach(function (c) {
    var col = h.indexOf(c.campo);
    if (col < 0) return;
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][iId]).trim() !== c.id) continue;
      if (_ctValor(vals[r][col], c.campo) !== c.nuevo) return;   // ya no está corregido
      sh.getRange(r + 1, col + 1).setValue(c.campo === 'fecha' ? _ctFecha(c.esperado) : c.esperado);
      deshechos.push(c.id + '·' + c.campo);
      return;
    }
  });
  PropertiesService.getScriptProperties().deleteProperty(CT_PROP);
  return { ok: true, deshechos: deshechos,
    msg: deshechos.length ? 'Se revirtió: ' + deshechos.join(', ') : 'No había nada que revertir.' };
}

/** Estado, para verificar sin abrir la hoja. */
function estadoCorreccionTraspasos() {
  ensureSheets();
  var vals = _traspasosSheet().getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  return {
    aplicada: !!PropertiesService.getScriptProperties().getProperty(CT_PROP),
    traspasos: vals.slice(1).filter(function (r) { return r[iId]; }).map(function (r) {
      return { id: String(r[iId]), fecha: _ctValor(r[h.indexOf('fecha')], 'fecha'),
        de: String(r[h.indexOf('de')]), a: String(r[h.indexOf('a')]),
        monto: _round2(r[h.indexOf('monto')]) };
    }),
    saldosAl3108: _ctResumen(saldosPorCuenta(new Date(2026, 7, 31)))
  };
}

/** Normaliza a texto comparable: las fechas como AAAA-MM-DD, el resto tal cual. */
function _ctValor(v, campo) {
  if (campo !== 'fecha') return String(v || '').trim();
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v || '').trim() : _balISO(d);
}

/** Mediodía local, por lo mismo que los pagos: una fecha pelada se lee en UTC. */
function _ctFecha(iso) {
  var p = String(iso).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
}

function _ctResumen(s) {
  var o = { total: s.total };
  s.cuentas.forEach(function (c) { o[c.id] = c.saldo; });
  return o;
}
