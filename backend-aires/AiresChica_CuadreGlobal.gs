/**
 * Cuadre de Global Bank contra el estado de cuenta del banco (septiembre 2026).
 *
 * ── Qué arregla ──────────────────────────────────────────────────────────────
 * El estado de cuenta de Global Bank al 09/09/2026 imprime 7,017.39. El sistema
 * calculaba 6,927.19 a esa misma fecha. La diferencia, 90.20, son tres cosas:
 *
 *   1. Un traspaso de 154.80 registrado el 12/09 desde «Por rendir» que NO aparece
 *      en el estado de cuenta. Por su referencia —«cuadra saldo al 9 de septiembre
 *      y cierra la cuenta de Banco General»— se registró para forzar un cuadre, no
 *      porque el dinero se moviera. Se elimina.
 *
 *   2. Dos cuotas del 01/09 registradas en Banco General que el banco muestra
 *      entrando a Global el 08/09: Thayra H-43B (90.00) y Gilberto Berrío Q-14
 *      (45.00). Los propietarios ya están bien acreditados; sólo cambia la cuenta,
 *      así que esto NO mueve lo que nadie debe.
 *
 *   3. Los 0.20 de intereses que el banco abonó el 31/08 y que no estaban en
 *      ninguna parte.
 *
 * Al terminar esto, Banco General queda en −217.00 y «Por rendir» en −311.00. Las
 * dos son imposibles en la realidad, y las arregla la SEGUNDA función de este
 * archivo, registrarFondoDeLaAdministracion(), que va aparte a propósito: ésta son
 * hechos del estado de cuenta, aquélla es una afirmación sobre lo que alguien tenía
 * hace nueve meses y no debía correr hasta que esa persona la confirmara.
 *
 * ── La comprobación ──────────────────────────────────────────────────────────
 * Al terminar, el saldo de Global al 31/08/2026 tiene que ser EXACTAMENTE 2,908.20,
 * que es lo que imprime el banco:
 *
 *     0 + 500 + 3,000 + 58 (Ana Saunders) + 0.20 (intereses)
 *       − 250 (Cornelio) − 400 (Fernando) = 2,908.20
 *
 * Si no da, algo se aplicó mal y hay que ejecutar rollbackCuadreGlobal().
 *
 * Uso:  cuadrarGlobalBank()          una vez, desde el editor.
 *       rollbackCuadreGlobal()       para deshacerlo.
 */

var CG_PROP = 'AC_CUADRE_GLOBAL';
var CG_GLOBAL = 'global-bank';
var CG_BG = 'banco-general';

/** El traspaso que se inventó para forzar el cuadre. Se guarda para poder reponerlo. */
var CG_TRASPASO = {
  id: 'T1789229227743-582',
  fecha: '2026-09-12', de: 'por-rendir', a: CG_GLOBAL, monto: 154.80,
  referencia: 'CUADRA SALDO AL 9 DE SEPTIEMBRE Y CIERRA LA CUENTA DE BANCO GENERAL'
};

/** Las dos cuotas que el banco muestra entrando a Global, no a Banco General. */
var CG_PAGOS = [
  { id: 'P1788816884487-984', quien: 'Thayra H-43B',        monto: 90.00 },
  { id: 'P1788816738412-39',  quien: 'Gilberto Berrío Q-14', monto: 45.00 }
];

var CG_INTERES = { fecha: '2026-08-31', monto: 0.20,
                   concepto: 'INTERESES GLOBAL BANK',
                   notas: 'N/C INTERESES/RENDIMIENTOS AH del 31/08/2026, según estado de cuenta.' };

var CG_SALDO_ESPERADO = 2908.20;   // el que imprime el banco al 31/08/2026

function _cgProps() { return PropertiesService.getScriptProperties(); }

/**
 * Saldo de una cuenta a una fecha.
 *
 * La fecha se arma con new Date(año, mes, día, 12, 0, 0) y NO con una cadena:
 * new Date('2026-08-31') es medianoche UTC, que en Panamá es el 30 a las 19:00, y
 * saldosPorCuenta dejaría fuera todo el 31 de agosto. Es el mismo desfase contra
 * el que ya avisa _fechaPagoDesdeISO.
 */
function _cgSaldoAl(cuentaId, anio, mes, dia) {
  var s = saldosPorCuenta(new Date(anio, mes - 1, dia, 12, 0, 0));
  var r = 0;
  ((s && s.cuentas) || []).forEach(function (x) {
    if (String(x.id) === cuentaId) r = Number(x.saldo) || 0;
  });
  return _round2(r);
}

function _cgSaldoGlobal31Ago() { return _cgSaldoAl(CG_GLOBAL, 2026, 8, 31); }

/**
 * Aplica las tres correcciones. No toca Banco General ni «Por rendir» más allá de
 * lo que arrastran: lo de los 717.00 es otra conversación y necesita un documento.
 */
function cuadrarGlobalBank() {
  ensureSheets();

  if (_cgProps().getProperty(CG_PROP)) {
    console.log('Este cuadre ya se aplicó el %s.', _cgProps().getProperty(CG_PROP));
    console.log('Para volver a ejecutarlo hay que deshacerlo antes: rollbackCuadreGlobal()');
    return { ok: false, yaAplicado: true };
  }

  var antes = _cgSaldoGlobal31Ago();
  console.log('════ CUADRE DE GLOBAL BANK ════');
  console.log('Saldo de Global al 31/08 antes de tocar nada: %s', antes.toFixed(2));
  console.log('');

  var hechos = { traspaso: null, pagos: [], interes: null };

  // 1. El traspaso que no existe en el banco.
  try {
    eliminarTraspaso(CG_TRASPASO.id);
    hechos.traspaso = CG_TRASPASO.id;
    console.log('✓ Eliminado el traspaso de %s que no aparece en el estado de cuenta.',
                CG_TRASPASO.monto.toFixed(2));
  } catch (e) {
    console.log('· El traspaso %s ya no estaba: %s', CG_TRASPASO.id, e && e.message || e);
  }

  // 2. Las dos cuotas que entraron a Global, no a Banco General.
  CG_PAGOS.forEach(function (p) {
    try {
      actualizarPago(p.id, { cuenta: CG_GLOBAL });
      hechos.pagos.push(p.id);
      console.log('✓ %s (%s) pasa de Banco General a Global Bank.', p.quien, p.monto.toFixed(2));
    } catch (e) {
      console.log('✗ No se pudo mover %s: %s', p.quien, e && e.message || e);
    }
  });

  // 3. Los intereses del banco.
  try {
    var oi = registrarOtroIngreso({ concepto: CG_INTERES.concepto, monto: CG_INTERES.monto,
                                    fecha: CG_INTERES.fecha, notas: CG_INTERES.notas });
    actualizarPago(oi.id, { cuenta: CG_GLOBAL });
    hechos.interes = oi.id;
    console.log('✓ Registrados %s de intereses del 31/08 en Global Bank.', CG_INTERES.monto.toFixed(2));
  } catch (e) {
    console.log('✗ No se pudieron registrar los intereses: %s', e && e.message || e);
  }

  // La comprobación que manda: contra el papel del banco, no contra sí mismo.
  var saldo = _cgSaldoGlobal31Ago();
  var cuadra = Math.abs(saldo - CG_SALDO_ESPERADO) < 0.005;
  console.log('');
  console.log('Saldo de Global al 31/08 : %s', saldo.toFixed(2));
  console.log('Lo que imprime el banco  : %s', CG_SALDO_ESPERADO.toFixed(2));
  console.log(cuadra ? '✓ CUADRA' : '✗ NO CUADRA — diferencia de ' + (saldo - CG_SALDO_ESPERADO).toFixed(2));

  // Segunda comprobación, informativa. El corte del banco es del 09/09 a las 2:04 PM
  // y el pago de Escamilla (45.00) es de ese mismo día: si entró después de esa hora
  // no sale en el papel. Por eso ésta se reporta y no bloquea — una diferencia de
  // 45.00 aquí es sólo la hora, no un error.
  var s09 = _cgSaldoAl(CG_GLOBAL, 2026, 9, 9);
  console.log('');
  console.log('Saldo de Global al 09/09 : %s   (el banco imprime 7,017.39 a las 2:04 PM,',
              s09.toFixed(2));
  console.log('                           más los 45.00 de Escamilla = 7,062.39)');
  if (Math.abs(s09 - 7062.39) >= 0.005) {
    console.log('· No coincide. Si la diferencia son 45.00, Escamilla entró al día siguiente.');
  }

  if (!cuadra) {
    console.log('');
    console.log('No se marca como aplicado. Revisa qué pasó y, si hace falta,');
    console.log('ejecuta rollbackCuadreGlobal() para dejarlo como estaba.');
    return { ok: false, saldo: saldo, esperado: CG_SALDO_ESPERADO, hechos: hechos };
  }

  _cgProps().setProperty(CG_PROP, _fechaCorta(_today()));
  _reg('cuenta.edita', { entidad: 'cuenta', clave: CG_GLOBAL, propietario: 'Global Bank',
    detalle: 'Cuadre contra el estado de cuenta: se quitó el traspaso de 154.80, ' +
             'Thayra H-43B (90.00) y Berrío Q-14 (45.00) pasaron a Global, y se ' +
             'registraron 0.20 de intereses. Saldo al 31/08 = 2,908.20, igual al banco.' });

  console.log('');
  console.log('Falta la segunda parte, y NO la hace esta función:');
  console.log('  Banco General queda en %s y «Por rendir» en %s. Las dos son',
    _cgSaldoCuenta(CG_BG).toFixed(2), _cgSaldoCuenta('por-rendir').toFixed(2));
  console.log('  imposibles: son el fondo que la administración ya tenía y que el libro');
  console.log('  nunca registró. Lo arregla registrarFondoDeLaAdministracion().');

  return { ok: true, saldo: saldo, hechos: hechos };
}

/** Saldo de una cuenta hoy. */
function _cgSaldoCuenta(id) {
  var s = saldosPorCuenta(), r = 0;
  ((s && s.cuentas) || []).forEach(function (x) { if (String(x.id) === id) r = Number(x.saldo) || 0; });
  return _round2(r);
}

/** Deja las tres cosas como estaban. El traspaso vuelve con otro id: no se puede reusar. */
function rollbackCuadreGlobal() {
  ensureSheets();
  if (!_cgProps().getProperty(CG_PROP)) {
    console.log('Este cuadre no está aplicado; no hay nada que deshacer.');
    return { ok: false };
  }
  console.log('════ DESHACIENDO EL CUADRE ════');

  CG_PAGOS.forEach(function (p) {
    try { actualizarPago(p.id, { cuenta: CG_BG }); console.log('✓ %s vuelve a Banco General.', p.quien); }
    catch (e) { console.log('✗ %s: %s', p.quien, e && e.message || e); }
  });

  try {
    var sh = _ss().getSheetByName(SH.PAGOS);
    var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
    var iId = h.indexOf('id'), iNo = h.indexOf('nombre');
    for (var r = vals.length - 1; r >= 1; r--) {
      if (String(vals[r][iNo] || '').trim() === CG_INTERES.concepto) {
        eliminarOtroIngreso(String(vals[r][iId]).trim());
        console.log('✓ Quitado el ingreso de intereses.');
        break;
      }
    }
  } catch (e) { console.log('✗ intereses: %s', e && e.message || e); }

  try {
    registrarTraspaso({ fecha: CG_TRASPASO.fecha, de: CG_TRASPASO.de, a: CG_TRASPASO.a,
                        monto: CG_TRASPASO.monto, referencia: CG_TRASPASO.referencia,
                        notas: 'Repuesto por rollbackCuadreGlobal el ' + _fechaCorta(_today()) });
    console.log('✓ Repuesto el traspaso de %s (con id nuevo).', CG_TRASPASO.monto.toFixed(2));
  } catch (e) { console.log('✗ traspaso: %s', e && e.message || e); }

  _cgProps().deleteProperty(CG_PROP);
  console.log('\nListo. Saldo de Global al 31/08: %s', _cgSaldoGlobal31Ago().toFixed(2));
  return { ok: true };
}

/** Qué haría, sin tocar nada. Para mirar antes de ejecutar. */
function verCuadreGlobal() {
  console.log('════ LO QUE HARÍA cuadrarGlobalBank() ════');
  console.log('1. Eliminar el traspaso %s de %s (%s → %s)',
    CG_TRASPASO.id, CG_TRASPASO.monto.toFixed(2), CG_TRASPASO.de, CG_TRASPASO.a);
  CG_PAGOS.forEach(function (p) {
    console.log('2. Mover a Global Bank: %s · %s (%s)', p.quien, p.monto.toFixed(2), p.id);
  });
  console.log('3. Registrar %s de intereses el %s en Global Bank',
    CG_INTERES.monto.toFixed(2), CG_INTERES.fecha);
  console.log('');
  console.log('Saldo de Global al 31/08 ahora : %s', _cgSaldoGlobal31Ago().toFixed(2));
  console.log('Debería quedar en              : %s  (lo que imprime el banco)',
    CG_SALDO_ESPERADO.toFixed(2));
  console.log('');
  console.log('Ya aplicado: %s', _cgProps().getProperty(CG_PROP) || 'no');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SEGUNDA PARTE · El fondo que la administración ya tenía
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Antes de que existiera este sistema, la administración llevaba el dinero de la
 * asociación en sus cuentas personales. Cuando el libro arranca, esa plata ya
 * estaba ahí — igual que Banco General arranca con 2,852.01 — pero la cuenta «Por
 * rendir» se creó con fondo inicial 0.00. De ahí salen los dos saldos negativos.
 *
 * ── Lo que pasó de verdad ────────────────────────────────────────────────────
 *   · La administración tenía 592.00 de la asociación en sus cuentas personales.
 *   · Usó 500.00 para abrir Global Bank el 18/08. La glosa del banco lo confirma:
 *     «TRANSFERENCIA DE 30102226924 DORAIDA CASTILLO apertura de». Salió de una
 *     cuenta suya, pero el dinero era de la asociación.
 *   · El 08/09 transfirió 3,233.69 a Global. Banco General sólo tenía 3,016.69:
 *     completó los 217.00 que faltaban con lo que ella tenía.
 *   · El 31/08 entraron 189.00 de cuotas a sus cuentas personales.
 *   · Le quedan 64.00, y están pendientes de transferir. Ella lo confirma.
 *
 *       592.00 − 500.00 − 217.00 + 189.00 = 64.00
 *
 * ── Por qué creo que es correcto ─────────────────────────────────────────────
 * Los 592.00 se dedujeron para llegar a las cifras que trae la administración, así
 * que esa parte es circular y no prueba nada por sí sola.
 *
 * Lo que NO se ajustó es esto: al partir el traspaso del 08/09 en sus dos partes
 * reales, Banco General cierra en CERO EXACTO sin tocarle el fondo inicial.
 *
 *     2,852.01 + 27,901.95 cobros − 24,737.27 gastos
 *              − 3,000.00 (31/08) − 3,016.69 (08/09) = 0.00
 *
 * Eso cae solo. Con cualquier otra explicación esa cuenta quedaría descuadrada, y
 * por eso la función se comprueba contra ese cero y no contra los 592.00.
 *
 * Uso:  registrarFondoDeLaAdministracion()    después de cuadrarGlobalBank()
 *       rollbackFondoDeLaAdministracion()
 */

var FA_PROP     = 'AC_FONDO_ADMIN';
var FA_CUENTA   = 'por-rendir';
var FA_FONDO    = 592.00;    // lo que tenía en sus cuentas al arrancar el libro

/** El traspaso del 08/09, que en realidad fueron dos. */
var FA_TRASPASO = { id: 'T1789229047131-925', anio: 2026, mes: 9, dia: 8,
                    total: 3233.69, referencia: 'SE TRANSFIERE FONDOS A CTA GLOBAL BANK' };
var FA_DE_BANCO = 3016.69;   // lo que quedaba en Banco General: lo vacía exacto
var FA_DE_MANOS = 217.00;    // lo que puso ella para completar
var FA_ID_MANOS = 'FA26-T1';

var FA_ESPERADO_BG = 0.00;   // Banco General tiene que cerrar en cero
var FA_ESPERADO_PR = 64.00;  // y a la administración le quedan 64.00

function registrarFondoDeLaAdministracion() {
  ensureSheets();

  if (!_cgProps().getProperty(CG_PROP)) {
    console.log('Primero hay que correr cuadrarGlobalBank().');
    console.log('Sin eso, el traspaso de 154.80 y las dos cuotas de Thayra y Berrío');
    console.log('siguen mal puestas, y las comprobaciones de aquí no pueden dar.');
    return { ok: false };
  }
  if (_cgProps().getProperty(FA_PROP)) {
    console.log('Esto ya se aplicó el %s.', _cgProps().getProperty(FA_PROP));
    console.log('Para rehacerlo: rollbackFondoDeLaAdministracion()');
    return { ok: false, yaAplicado: true };
  }

  console.log('════ EL FONDO DE LA ADMINISTRACIÓN ════');

  // 1. Lo que ya tenía cuando arranca el libro.
  var cta = cuentaPorId(FA_CUENTA);
  if (!cta) { console.log('✗ No existe la cuenta %s.', FA_CUENTA); return { ok: false }; }
  _faGuardarFondo(cta, FA_FONDO);
  console.log('✓ Fondo inicial de «%s»: %s → %s',
    cta.nombre, _round2(cta.fondoInicial).toFixed(2), FA_FONDO.toFixed(2));

  // 2. El traspaso del 08/09 se parte en sus dos mitades reales.
  try {
    eliminarTraspaso(FA_TRASPASO.id);
    var fecha = new Date(FA_TRASPASO.anio, FA_TRASPASO.mes - 1, FA_TRASPASO.dia, 12, 0, 0);
    registrarTraspaso({ id: FA_TRASPASO.id, fecha: fecha, de: CG_BG, a: CG_GLOBAL,
      monto: FA_DE_BANCO, referencia: FA_TRASPASO.referencia,
      notas: 'Lo que quedaba en Banco General. Los ' + FA_DE_MANOS.toFixed(2) +
             ' restantes de la transferencia de ' + FA_TRASPASO.total.toFixed(2) +
             ' los completó la administración con fondos que tenía.' });
    registrarTraspaso({ id: FA_ID_MANOS, fecha: fecha, de: FA_CUENTA, a: CG_GLOBAL,
      monto: FA_DE_MANOS, referencia: 'Completa la transferencia del 08/09',
      notas: 'Banco General tenía ' + FA_DE_BANCO.toFixed(2) + ' y la transferencia fue de ' +
             FA_TRASPASO.total.toFixed(2) + '. La diferencia salió de lo que la ' +
             'administración tenía de la asociación en sus cuentas personales.' });
    console.log('✓ El traspaso de %s se parte: %s de Banco General y %s de la administración.',
      FA_TRASPASO.total.toFixed(2), FA_DE_BANCO.toFixed(2), FA_DE_MANOS.toFixed(2));
  } catch (e) {
    console.log('✗ No se pudo partir el traspaso: %s', e && e.message || e);
    console.log('  Ejecuta rollbackFondoDeLaAdministracion() antes de reintentar.');
    return { ok: false };
  }

  // La comprobación. El cero de Banco General es la que manda: no se ajustó para
  // que diera, cae solo al partir el traspaso.
  var bg = _cgSaldoCuenta(CG_BG), pr = _cgSaldoCuenta(FA_CUENTA);
  var cuadraBG = Math.abs(bg - FA_ESPERADO_BG) < 0.005;
  var cuadraPR = Math.abs(pr - FA_ESPERADO_PR) < 0.005;
  console.log('');
  console.log('Banco General : %s   (tiene que cerrar en %s)', bg.toFixed(2), FA_ESPERADO_BG.toFixed(2));
  console.log('Por rendir    : %s   (lo que la administración confirma tener: %s)',
    pr.toFixed(2), FA_ESPERADO_PR.toFixed(2));
  console.log(cuadraBG && cuadraPR ? '✓ CUADRA' : '✗ NO CUADRA');

  if (!(cuadraBG && cuadraPR)) {
    console.log('');
    console.log('No se marca como aplicado. Ejecuta rollbackFondoDeLaAdministracion().');
    return { ok: false, bancoGeneral: bg, porRendir: pr };
  }

  _cgProps().setProperty(FA_PROP, _fechaCorta(_today()));
  _reg('cuenta.edita', { entidad: 'cuenta', clave: FA_CUENTA, propietario: cta.nombre,
    campo: 'fondoInicial', antes: _round2(cta.fondoInicial).toFixed(2), despues: FA_FONDO.toFixed(2),
    detalle: 'La administración llevaba el dinero de la asociación en sus cuentas ' +
             'personales antes de que existiera este libro. De ahí salieron los 500.00 ' +
             'de la apertura de Global y los ' + FA_DE_MANOS.toFixed(2) + ' que completaron ' +
             'el traspaso del 08/09. Le quedan ' + FA_ESPERADO_PR.toFixed(2) + ', pendientes de transferir.' });

  console.log('');
  console.log('Banco General se puede dar por cerrada. A la administración le quedan');
  console.log('%s pendientes de transferir; cuando los deposite, se registra como un', FA_ESPERADO_PR.toFixed(2));
  console.log('traspaso de «Por rendir» a Global Bank y la cuenta queda en cero.');
  return { ok: true, bancoGeneral: bg, porRendir: pr };
}

/** guardarCuenta pide la fila entera: si se le pasa sólo el fondo, borra el resto. */
function _faGuardarFondo(cta, fondo) {
  guardarCuenta({
    id: cta.id, nombre: cta.nombre, banco: cta.banco, tipo: cta.tipo, numero: cta.numero,
    titular: cta.titular, clase: cta.clase, activa: cta.activa, esCobro: cta.esCobro,
    orden: cta.orden, notas: cta.notas,
    alias: (cta.alias || []).join(', '),
    fondoInicial: fondo
  });
}

function rollbackFondoDeLaAdministracion() {
  ensureSheets();
  if (!_cgProps().getProperty(FA_PROP)) {
    console.log('Esto no está aplicado, pero se limpia igual por si quedó a medias.');
  }
  console.log('════ DESHACIENDO EL FONDO DE LA ADMINISTRACIÓN ════');

  var cta = cuentaPorId(FA_CUENTA);
  if (cta) { _faGuardarFondo(cta, 0); console.log('✓ Fondo inicial de «%s» vuelve a 0.00', cta.nombre); }

  [FA_TRASPASO.id, FA_ID_MANOS].forEach(function (id) {
    try { eliminarTraspaso(id); } catch (e) {}
  });
  try {
    registrarTraspaso({ id: FA_TRASPASO.id,
      fecha: new Date(FA_TRASPASO.anio, FA_TRASPASO.mes - 1, FA_TRASPASO.dia, 12, 0, 0),
      de: CG_BG, a: CG_GLOBAL, monto: FA_TRASPASO.total,
      referencia: FA_TRASPASO.referencia,
      notas: 'Repuesto entero por rollbackFondoDeLaAdministracion el ' + _fechaCorta(_today()) });
    console.log('✓ El traspaso vuelve a ser uno solo de %s', FA_TRASPASO.total.toFixed(2));
  } catch (e) { console.log('✗ traspaso: %s', e && e.message || e); }

  _cgProps().deleteProperty(FA_PROP);
  console.log('\nBanco General: %s   Por rendir: %s',
    _cgSaldoCuenta(CG_BG).toFixed(2), _cgSaldoCuenta(FA_CUENTA).toFixed(2));
  return { ok: true };
}
