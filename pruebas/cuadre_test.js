// El cuadre de Global Bank contra el estado de cuenta.
//
// Es una función de un solo uso que toca dinero registrado. Lo que se comprueba no es
// que haga los tres cambios —eso se ve en el registro de ejecución— sino que NO se dé
// por buena si el saldo no termina en lo que imprime el banco, y que se pueda deshacer.
// Una migración que se marca como aplicada habiendo fallado a medias es peor que una
// que no corre.
// Antes que nada y antes de tocar ninguna fecha: Apps Script corre en América/Panamá
// (UTC−5) y el desfase que se comprueba abajo NO existe en UTC. Sin esto, la prueba
// pasaría en este contenedor y el fallo saldría en producción.
process.env.TZ = 'America/Panama';

const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

// ── un libro mayor de mentira, con lo justo para que los saldos se muevan ──
let PROPS, TRASPASOS, PAGOS, REGISTRO, SALIDA;

function reiniciar() {
  PROPS = {};
  REGISTRO = [];
  SALIDA = [];
  // Los saldos del 31/08 son los del estado de cuenta: 2,908.00 antes de los intereses.
  TRASPASOS = [
    { id: 'T1789229227743-582', fecha: F(2026, 9, 12), de: 'por-rendir', a: 'global-bank', monto: 154.80 }
  ];
  PAGOS = [
    { id: 'P1788816884487-984', fecha: F(2026, 9, 1), nombre: 'Thayra Marin', monto: 90.00, cuenta: 'banco-general' },
    { id: 'P1788816738412-39',  fecha: F(2026, 9, 1), nombre: 'Gilberto Berrío', monto: 45.00, cuenta: 'banco-general' },
    // el resto del mes, agregado, para que los cortes por fecha den los números del banco
    { id: 'BASE-AGO', fecha: F(2026, 8, 31), nombre: 'base agosto', monto: 2908.00, cuenta: 'global-bank' },
    { id: 'BASE-SEP', fecha: F(2026, 9, 9), nombre: 'base septiembre', monto: 4019.19, cuenta: 'global-bank' }
  ];
}

const _r2 = v => Math.round((Number(v) || 0) * 100) / 100;

// La hoja de Sheets guarda FECHAS, no texto. Si el libro falso usara cadenas ISO,
// new Date('2026-09-01') sería medianoche UTC —el 31 de agosto a las 19:00 en Panamá—
// y los cortes medirían algo que en producción no pasa.
const F = (a, m, d) => new Date(a, m - 1, d, 12, 0, 0);

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  setProperty: (k, v) => { PROPS[k] = v; },
  deleteProperty: k => { delete PROPS[k]; } }) };

global.ensureSheets = () => {};
global._round2 = _r2;
global._today = () => new Date(2026, 8, 12, 12, 0, 0);
global._fechaCorta = d => '12/09/2026';
global._reg = (accion, d) => { REGISTRO.push({ accion, ...d }); return 'R1'; };
global.SH = { PAGOS: 'Pagos' };
global._ss = () => ({ getSheetByName: () => ({
  getDataRange: () => ({ getValues: () => [['id','nombre'], ...PAGOS.map(p => [p.id, p.nombre])] }) }) });

global.eliminarTraspaso = (id) => {
  const i = TRASPASOS.findIndex(t => t.id === id);
  if (i < 0) throw new Error('Traspaso no encontrado: ' + id);
  TRASPASOS.splice(i, 1);
  return { ok: true };
};
global.registrarTraspaso = (t) => { TRASPASOS.push({ ...t, id: 'T-NUEVO' }); return { ok: true }; };

global.actualizarPago = (id, datos) => {
  const p = PAGOS.find(x => x.id === id);
  if (!p) throw new Error('Pago no encontrado: ' + id);
  if (datos.cuenta) p.cuenta = datos.cuenta;
  return { ok: true };
};
global.registrarOtroIngreso = (d) => {
  const id = 'OI-PRUEBA';
  // el real convierte 'AAAA-MM-DD' a Date local al mediodía (_asOfDate); aquí igual
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.fecha));
  PAGOS.push({ id, fecha: F(+m[1], +m[2], +m[3]), nombre: d.concepto, monto: d.monto, cuenta: '' });
  return { ok: true, id };
};
global.eliminarOtroIngreso = (id) => {
  const i = PAGOS.findIndex(x => x.id === id);
  if (i < 0) throw new Error('no existe');
  PAGOS.splice(i, 1);
  return { ok: true };
};

// El saldo se calcula de verdad sobre el libro falso: si la función no aplica un
// cambio, el saldo no se mueve y la comprobación falla. Eso es lo que la hace útil.
global.saldosPorCuenta = (hasta) => {
  const corte = hasta ? new Date(hasta) : null;
  if (corte) corte.setHours(23, 59, 59, 999);
  const dentro = f => !corte || new Date(f).getTime() <= corte.getTime();
  const acc = {};
  const b = id => (acc[id] = acc[id] || { id, saldo: 0 });
  PAGOS.forEach(p => { if (dentro(p.fecha)) b(p.cuenta || '(sin asignar)').saldo += p.monto; });
  TRASPASOS.forEach(t => { if (dentro(t.fecha)) { b(t.de).saldo -= t.monto; b(t.a).saldo += t.monto; } });
  return { cuentas: Object.keys(acc).map(k => ({ id: k, saldo: _r2(acc[k].saldo) })) };
};

const _log = console.log;
const capturar = () => { SALIDA = []; console.log = (...a) => {
  let i = 1; SALIDA.push(String(a[0]).replace(/%s/g, () => String(a[i++]))); }; };
const soltar = () => { console.log = _log; return SALIDA.join('\n'); };

eval(fs.readFileSync(path.join(__dirname, '..', 'backend-aires', 'AiresChica_CuadreGlobal.gs'), 'utf8'));

const saldo = (id, s) => ((s || saldosPorCuenta()).cuentas.find(c => c.id === id) || {}).saldo;

console.log('── EL CASO NORMAL ──');
reiniciar();
capturar(); let r = cuadrarGlobalBank(); let txt = soltar();
ok(r.ok === true, 'se aplica');
ok(saldo('global-bank', saldosPorCuenta(new Date(2026, 7, 31, 12, 0, 0))) === 2908.20,
   'el saldo al 31/08 queda en 2,908.20, que es lo que imprime el banco');
ok(PAGOS.find(p => p.id === 'P1788816884487-984').cuenta === 'global-bank' &&
   PAGOS.find(p => p.id === 'P1788816738412-39').cuenta === 'global-bank',
   'las dos cuotas del 01/09 pasan a Global Bank');
ok(!TRASPASOS.some(t => t.id === 'T1789229227743-582'),
   'el traspaso de 154.80 que no está en el banco se elimina');
ok(PAGOS.some(p => p.id === 'OI-PRUEBA' && p.cuenta === 'global-bank'),
   'los intereses quedan EN Global Bank, no sueltos sin cuenta');
ok(/717\.00/.test(txt) && /Banco General/.test(txt),
   'y avisa de lo que NO arregla, en vez de dejarlo callado');

console.log('\n── NO SE DA POR BUENA SI NO CUADRA CONTRA EL BANCO ──');
// Ésta es la afirmación que importa. Si el libro no termina donde dice el papel del
// banco, la función no puede marcarse como aplicada: quedaría un cuadre a medias que
// nadie vuelve a mirar.
reiniciar();
PAGOS.push({ id: 'RUIDO', fecha: F(2026, 8, 20), nombre: 'algo que no debería estar',
             monto: 33.00, cuenta: 'global-bank' });
capturar(); r = cuadrarGlobalBank(); txt = soltar();
ok(r.ok === false, 'con el saldo descuadrado devuelve error');
ok(!PROPS.AC_CUADRE_GLOBAL, 'y NO se marca como aplicada');
ok(/NO CUADRA/.test(txt) && /33\.00/.test(txt),
   'dice cuánto sobra, no sólo que falló: ' + (/✗ NO CUADRA[^\n]*/.exec(txt) || [''])[0]);
ok(/rollbackCuadreGlobal/.test(txt), 'y dice cómo dejarlo como estaba');

console.log('\n── NO SE APLICA DOS VECES ──');
reiniciar();
capturar(); cuadrarGlobalBank(); soltar();
const trasPrimera = saldo('global-bank', saldosPorCuenta(new Date(2026, 7, 31, 12, 0, 0)));
capturar(); r = cuadrarGlobalBank(); txt = soltar();
ok(r.yaAplicado === true, 'la segunda vez se planta');
ok(saldo('global-bank', saldosPorCuenta(new Date(2026, 7, 31, 12, 0, 0))) === trasPrimera,
   'y no vuelve a registrar los intereses: el saldo no se mueve');
ok(/ya se aplicó/.test(txt), 'y lo dice: ' + SALIDA[0]);

console.log('\n── SE PUEDE DESHACER ──');
reiniciar();
capturar(); cuadrarGlobalBank(); r = rollbackCuadreGlobal(); soltar();
ok(r.ok === true, 'el rollback corre');
ok(PAGOS.find(p => p.id === 'P1788816884487-984').cuenta === 'banco-general',
   'las cuotas vuelven a Banco General');
ok(!PAGOS.some(p => p.id === 'OI-PRUEBA'), 'los intereses se quitan');
ok(TRASPASOS.some(t => t.monto === 154.80), 'y el traspaso vuelve');
ok(!PROPS.AC_CUADRE_GLOBAL, 'la marca se borra, así que se puede volver a intentar');
capturar(); r = rollbackCuadreGlobal(); soltar();
ok(r.ok === false, 'deshacer algo no aplicado no revienta ni rompe nada');

console.log('\n── LA FECHA DE CORTE NO SE VA AL DÍA ANTERIOR ──');
// new Date('2026-08-31') es medianoche UTC, que en Panamá es el día 30 a las 19:00.
// Con esa fecha, el corte dejaría fuera todo el 31 de agosto y la comprobación
// compararía contra un saldo que no incluye ni los intereses ni el pago de Ana.
reiniciar();
const conCadena = saldo('global-bank', saldosPorCuenta(new Date('2026-08-31')));
const conFecha  = saldo('global-bank', saldosPorCuenta(new Date(2026, 7, 31, 12, 0, 0)));
ok(conCadena !== conFecha,
   'las dos formas de armar el corte NO dan lo mismo: ' + conCadena + ' vs ' + conFecha);
ok(conFecha === 2908.00, 'la buena incluye el 31 de agosto entero');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
