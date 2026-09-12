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
let PROPS, TRASPASOS, PAGOS, GASTOS, REGISTRO, SALIDA, CUENTAS;

// El libro falso reproduce los números REALES de septiembre de 2026. Con cifras
// inventadas las comprobaciones pasarían sin decir nada: lo que hay que poder
// afirmar es que Banco General cierra en cero EXACTO, y eso sólo se ve con los
// importes de verdad.
function reiniciar() {
  PROPS = {}; REGISTRO = []; SALIDA = [];

  CUENTAS = {
    'banco-general': { id: 'banco-general', nombre: 'Banco General', banco: 'Banco General',
                       tipo: 'Ahorros', numero: '04-02-98-706290-3', titular: 'AC', clase: 'banco',
                       activa: true, esCobro: false, fondoInicial: 2852.01, orden: 0,
                       notas: 'la de siempre', alias: [] },
    'global-bank':   { id: 'global-bank', nombre: 'Global Bank', banco: 'Global Bank',
                       tipo: 'Ahorros', numero: '56333001422', titular: 'AC', clase: 'banco',
                       activa: true, esCobro: true, fondoInicial: 0, orden: 20,
                       notas: 'Abierta el 18/08/2026.', alias: ['1422'] },
    'por-rendir':    { id: 'por-rendir', nombre: 'Por rendir · administración', banco: 'Administración',
                       tipo: '', numero: '', titular: '', clase: 'porRendir',
                       activa: true, esCobro: false, fondoInicial: 0, orden: 30,
                       notas: 'dinero de la asociación en manos de una persona', alias: [] }
  };

  TRASPASOS = [
    { id: 'MC26-T1',            fecha: F(2026, 8, 18), de: 'por-rendir',    a: 'global-bank', monto: 500.00 },
    { id: 'MC26-T2',            fecha: F(2026, 8, 29), de: 'banco-general', a: 'global-bank', monto: 3000.00 },
    { id: 'T1789229047131-925', fecha: F(2026, 9,  8), de: 'banco-general', a: 'global-bank', monto: 3233.69 },
    { id: 'T1789229227743-582', fecha: F(2026, 9, 12), de: 'por-rendir',    a: 'global-bank', monto: 154.80 }
  ];

  PAGOS = [
    { id: 'AGREGADO-BG',        fecha: F(2026, 7, 31), nombre: 'cuotas ene-ago',    monto: 27901.95, cuenta: 'banco-general' },
    { id: 'P1788816884487-984', fecha: F(2026, 9,  1), nombre: 'Thayra Marin',      monto: 90.00,    cuenta: 'banco-general' },
    { id: 'P1788816738412-39',  fecha: F(2026, 9,  1), nombre: 'Gilberto Berrío',   monto: 45.00,    cuenta: 'banco-general' },
    { id: 'ANA',                fecha: F(2026, 8, 31), nombre: 'Ana Saunders',      monto: 58.00,    cuenta: 'global-bank' },
    { id: 'AGREGADO-GB-SEP',    fecha: F(2026, 9,  9), nombre: 'cuotas septiembre', monto: 1075.50,  cuenta: 'global-bank' },
    { id: 'AGREGADO-PR',        fecha: F(2026, 8, 31), nombre: 'cobros en sus cuentas', monto: 189.00, cuenta: 'por-rendir' }
  ];

  GASTOS = [
    { id: 'AGREGADO-G',  fecha: F(2026, 7, 31), monto: 24737.27, cuenta: 'banco-general' },
    { id: 'CORNELIO',    fecha: F(2026, 8, 29), monto: 250.00,   cuenta: 'global-bank' },
    { id: 'FERNANDO',    fecha: F(2026, 8, 31), monto: 400.00,   cuenta: 'global-bank' },
    { id: 'JOSLYN',      fecha: F(2026, 9,  5), monto: 290.00,   cuenta: 'global-bank' }
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

global.cuentaPorId = (id) => (CUENTAS[id] ? JSON.parse(JSON.stringify(CUENTAS[id])) : null);
global.guardarCuenta = (d) => {
  const c = CUENTAS[d.id];
  if (!c) throw new Error('no existe');
  // guardarCuenta real reescribe la fila entera: si quien llama olvida un campo,
  // se pierde. El falso hace lo mismo para que eso se note aquí y no en producción.
  CUENTAS[d.id] = { id: d.id, nombre: d.nombre, banco: d.banco, tipo: d.tipo,
    numero: d.numero, titular: d.titular, clase: d.clase, activa: d.activa,
    esCobro: d.esCobro, fondoInicial: _r2(d.fondoInicial), orden: d.orden,
    notas: d.notas, alias: String(d.alias || '').split(',').map(x => x.trim()).filter(Boolean) };
  return { ok: true, id: d.id };
};

global.eliminarTraspaso = (id) => {
  const i = TRASPASOS.findIndex(t => t.id === id);
  if (i < 0) throw new Error('Traspaso no encontrado: ' + id);
  TRASPASOS.splice(i, 1);
  return { ok: true };
};
global.registrarTraspaso = (t) => {
  // el real respeta t.id si se lo pasan, y sólo inventa uno cuando falta
  const id = String(t.id || '').trim() || ('T' + Date.now());
  TRASPASOS.push({ ...t, id });
  return { ok: true, id };
};

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
  Object.keys(CUENTAS).forEach(k => { b(k).saldo += CUENTAS[k].fondoInicial; });
  PAGOS.forEach(p => { if (dentro(p.fecha)) b(p.cuenta || '(sin asignar)').saldo += p.monto; });
  GASTOS.forEach(g => { if (dentro(g.fecha)) b(g.cuenta || '(sin asignar)').saldo -= g.monto; });
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
ok(/registrarFondoDeLaAdministracion/.test(txt) && /Banco General/.test(txt),
   'y remite a la segunda parte, en vez de dejar los dos negativos sin explicar');

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
ok(conFecha === 2908.00, 'la buena incluye el 31 de agosto entero: ' + conFecha);

console.log('\n── EL FONDO DE LA ADMINISTRACIÓN ──');
reiniciar();
capturar(); let rf = registrarFondoDeLaAdministracion(); let tf = soltar();
ok(rf.ok === false && /cuadrarGlobalBank/.test(tf),
   'no corre antes del cuadre: sin él las comprobaciones no pueden dar');

reiniciar();
capturar(); cuadrarGlobalBank(); rf = registrarFondoDeLaAdministracion(); tf = soltar();
ok(rf.ok === true, 'con el cuadre hecho, se aplica');
ok(saldo('banco-general') === 0, 'Banco General cierra en CERO exacto: ' + saldo('banco-general'));
ok(saldo('por-rendir') === 64.00, 'y a la administración le quedan 64.00: ' + saldo('por-rendir'));
ok(CUENTAS['por-rendir'].fondoInicial === 592.00, 'el fondo inicial queda en 592.00');
ok(CUENTAS['por-rendir'].nombre === 'Por rendir · administración' &&
   CUENTAS['por-rendir'].notas === 'dinero de la asociación en manos de una persona' &&
   CUENTAS['por-rendir'].clase === 'porRendir',
   'y guardar el fondo NO borra el resto de la cuenta, que es lo que haría pasarle sólo el id');
const t925 = TRASPASOS.find(t => t.id === 'T1789229047131-925');
ok(t925 && t925.monto === 3016.69, 'el traspaso del 08/09 baja a 3,016.69: ' + (t925 && t925.monto));
ok(TRASPASOS.some(t => t.id === 'FA26-T1' && t.de === 'por-rendir' && t.monto === 217.00),
   'y aparece el de 217.00 desde la administración, que es lo que ella completó');

console.log('\n── TAMPOCO SE DA POR BUENA SI NO CUADRA ──');
// El cero de Banco General es el que manda: no se ajustó para que diera, cae solo
// al partir el traspaso. Si no da, la historia es otra.
reiniciar();
PAGOS.push({ id: 'RUIDO2', fecha: F(2026, 7, 15), nombre: 'un cobro de más',
             monto: 120.00, cuenta: 'banco-general' });
capturar(); cuadrarGlobalBank(); rf = registrarFondoDeLaAdministracion(); tf = soltar();
ok(rf.ok === false, 'con Banco General fuera de cero, devuelve error');
ok(!PROPS.AC_FONDO_ADMIN, 'y NO se marca como aplicada');
ok(/NO CUADRA/.test(tf), 'lo dice');

console.log('\n── Y SE PUEDE DESHACER ──');
reiniciar();
capturar(); cuadrarGlobalBank(); registrarFondoDeLaAdministracion();
rf = rollbackFondoDeLaAdministracion(); soltar();
ok(rf.ok === true && CUENTAS['por-rendir'].fondoInicial === 0, 'el fondo vuelve a 0.00');
ok(!TRASPASOS.some(t => t.id === 'FA26-T1'), 'el traspaso de 217.00 se quita');
ok((TRASPASOS.find(t => t.id === 'T1789229047131-925') || {}).monto === 3233.69,
   'y el del 08/09 vuelve a ser uno solo de 3,233.69');
ok(!PROPS.AC_FONDO_ADMIN, 'la marca se borra');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
