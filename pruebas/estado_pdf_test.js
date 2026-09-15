// Bajar el estado de cuenta en PDF desde el panel.
//
// Lo único que hace útil a este botón es que baje EL MISMO documento que se adjunta al
// correo. Si el panel armara un PDF propio «para pantalla», revisarlo antes de mandarlo
// no probaría nada: lo revisado y lo enviado serían dos documentos distintos, y el error
// aparecería justo en el que ya no se puede recoger. Eso es lo que se afirma aquí.
//
// Y lo segundo: que bajarlo NO mande correo. Los envíos están apagados a propósito
// mientras se prueba el sistema; un botón que de paso escribiera a un propietario sería
// exactamente el accidente que ese interruptor existe para evitar.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

const RUTA = path.join(__dirname, '..', 'backend-aires') + path.sep;
const rd = f => fs.readFileSync(RUTA + f, 'utf8');

/* ─────────── el andamio ─────────── */

let HTMLS = [];          // cada HTML que se convirtió en PDF
let CORREOS = [];        // todo lo que intentó salir por Gmail

global.HtmlService = { createHtmlOutput: (h) => {
  HTMLS.push(String(h));
  // Bytes derivados del HTML: así, si dos PDF salen de HTML distintos, los bytes
  // también difieren y la comparación de más abajo significa algo.
  const bytes = Array.from(Buffer.from('%PDF-' + String(h)));
  return { getAs: () => ({ __n: '', getBytes: () => bytes,
                           getName() { return this.__n; },
                           setName(n) { this.__n = n; return this; } }) };
} };
global.Utilities = {
  base64Encode: b => Buffer.from(b).toString('base64'),
  formatDate: (d, tz, f) => (f === 'yyyy-MM' ? '2026-09' : '15/09/2026'),
  sleep: () => {}
};
global.Logger = { log: () => {} };
global.GmailApp = { sendEmail: (to, asunto, txt, opts) => { CORREOS.push({ to, asunto, opts }); } };
global.MailApp = { getRemainingDailyQuota: () => 100 };

global.CONFIG = { NEGOCIO: 'Aires de Chicá', TZ: 'America/Panama', ADMIN_EMAIL: 'admin@a.com',
                  REPLY_TO: 'admin@a.com', COMPROBANTES_EMAIL: 'pagos@a.com', UNIDAD: 'lote',
                  LOGO_URL: '', DIRECCION: '', WA_NUM: '' };
global.AC_MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                         'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
global._cfg = () => ({ enviosActivos: true, modoPrueba: false, correoPrueba: '' });
global._money = n => 'B/.' + (Number(n) || 0).toFixed(2);
global._ymKey = (y, m) => y + '-' + (m < 10 ? '0' + m : '' + m);
global.cuentaDeCobro = () => ({ banco: 'Global Bank', tipo: 'Ahorros', numero: '56333001422',
                                titular: 'Asociación Aires de Chicá' });
global._reg = () => 'R1';
global.buildDashboard = () => ({ cuentas: [] });
global.getPropietarios = () => [];

// La cuenta de prueba. Es la MISMA para los dos caminos: lo que se compara es el
// documento, no los números.
const EST = {
  clave: 'H-46', lote: '46/47', nombre: 'Carlos Bennett / Ana S.', residencial: 'El Higuerón',
  email: 'asaunders1466@gmail.com', cuota: 58.5, saldoNeto: 109.9, saldoConMora: 109.9,
  mora: 23.4, moraCargada: 23.4, diasVencido: 12, moraCondonAll: false, totalPagado: 440,
  mensual: [
    { label: 'Agosto 2026', ym: '2026-08', cuota: 58.5, mora: 5.85, pagado: 58, saldo: 51.4 },
    { label: 'Septiembre 2026', ym: '2026-09', cuota: 58.5, mora: 0, pagado: 0, saldo: 109.9 }
  ],
  buckets: [{ ym: '2026-08', saldo: 28, moraSaldo: 5.85 }],
  pagosHistorial: [{ fecha: '2026-08-31', monto: 58, origen: 'manual' }]
};
let PEDIDAS = [];
global.getEstadoCuentaByKey = (clave) => { PEDIDAS.push(clave); return EST; };

eval(rd('AiresChica_Email.gs'));

/* ─────────── el mismo documento que va al correo ─────────── */

console.log('── LO QUE SE BAJA ES LO QUE SE MANDA ──');
HTMLS = []; CORREOS = []; PEDIDAS = [];

// El camino del correo: enviarEstadoCuenta() resuelve el estado y se lo pasa al PDF.
const pdfCorreo = estadoCuentaPDF(getEstadoCuentaByKey('H-46'));
const htmlCorreo = HTMLS[HTMLS.length - 1];

// El camino del panel: se le pasa la clave y él resuelve.
const bajada = descargarEstadoCuenta('H-46');
const htmlPanel = HTMLS[HTMLS.length - 1];

ok(htmlPanel === htmlCorreo,
   'el HTML del PDF que se baja es idéntico al del que se adjunta al correo');
ok(Buffer.from(bajada.base64, 'base64').equals(Buffer.from(pdfCorreo.getBytes())),
   'y los bytes también: es el mismo archivo, no una versión parecida');
ok(/Carlos Bennett/.test(htmlPanel) && /109\.90/.test(htmlPanel),
   'con el nombre y el saldo de la cuenta pedida');
ok(PEDIDAS.filter(c => c === 'H-46').length === 2,
   'y el estado sale de getEstadoCuentaByKey, no de lo que el panel tuviera en pantalla');

console.log('\n── BAJARLO NO ESCRIBE A NADIE ──');
CORREOS = [];
descargarEstadoCuenta('H-46');
ok(CORREOS.length === 0,
   'no sale ningún correo: los envíos están apagados y este botón no es una excepción');

console.log('\n── EL NOMBRE DEL ARCHIVO ──');
ok(/^EstadoCuenta_H46_2026-09\.pdf$/.test(bajada.filename),
   'lleva lote y mes, y ningún carácter que rompa una descarga: ' + bajada.filename);

/* ─────────── leer no exige firmar ─────────── */

console.log('\n── PARA LEER NO HAY QUE IDENTIFICARSE ──');
// requireAutor() de verdad, con su lista. Bajar un PDF no cambia nada, así que pedir el
// nombre de quien lo hace sólo sería un estorbo; escribir sí lo exige, y eso no cambia.
global.AC_AUTOR = '';
eval(rd('AiresChica_Registro.gs').slice(0, rd('AiresChica_Registro.gs').indexOf('// Etiquetas legibles')));
ok(requireAutor('descargarEstadoCuenta') === true,
   'bajar el estado de cuenta se puede sin firmar');
let cortó = false;
try { requireAutor('registrarPago'); } catch (e) { cortó = /sin-autor/.test(e.message); }
ok(cortó, 'pero registrar un pago sigue exigiendo saber quién lo hace');

/* ─────────── el cableado ─────────── */

console.log('\n── EL BOTÓN LLEGA AL SERVIDOR ──');
const code = rd('Code.js');
ok(/action === 'descargarEstadoCuenta'\)\s*out = \{ ok: true, data: descargarEstadoCuenta\(data\.clave\) \}/.test(code),
   'el router reparte la acción y le pasa la clave');

const esc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok(/onclick="bajarEstado\('\$\{e\.clave\}',this\)"/.test(esc), 'el panel tiene el botón');
ok(/post\('descargarEstadoCuenta',\s*\{\s*clave\s*\}\)/.test(esc), 'y llama a la acción');
ok(/'descargarEstadoCuenta'/.test(esc.slice(esc.indexOf('const SIN_AUTOR'), esc.indexOf('const SIN_AUTOR') + 500)),
   'sin pedir el nombre, igual que el servidor');

const mov = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
ok(/onclick="bajarEstado\(/.test(mov), 'el móvil también lo tiene');
ok(/_enviar\('descargarEstadoCuenta'/.test(mov),
   'y va por _enviar, que es el envío sin exigir autor');

console.log(mal ? '\n✗ ' + mal + ' fallos' : '\n✓ todo en orden');
process.exit(mal ? 1 : 0);
