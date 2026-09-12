// El receptor de WhatsApp: qué contesta a Meta, qué anota, y a quién avisa.
//
// El bot NO se carga a propósito. Así se prueba la puerta de entrada por sí sola: sin
// bot, todo mensaje que entra tiene que acabar en la hoja y en un aviso a una persona.
// Ese es el suelo del que no puede bajar el sistema aunque el bot falle o esté apagado.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let PROPS = {}, CACHE = {}, SALIDAS = [], RUTAS = [];
let RESPUESTA = { code: 200, body: '{"messages":[{"id":"wamid.OUT1"}]}' };

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  getProperties: () => JSON.parse(JSON.stringify(PROPS)),
  setProperty: (k, v) => { PROPS[k] = v; } }) };
global.CacheService = { getScriptCache: () => ({
  get: k => CACHE[k] || null, put: (k, v) => { CACHE[k] = v; } }) };
global.ContentService = { MimeType: { JSON: 'json' },
  createTextOutput: t => ({ __texto: String(t), setMimeType(m) { this.__mime = m; return this; } }) };
global.Logger = { log: () => {} };
global.Utilities = { sleep: () => {}, formatDate: () => '10/09 16:10' };
global.CONFIG = { NEGOCIO: 'Aires de Chicá', TZ: 'America/Panama' };
global.HtmlService = { createHtmlOutput: () => ({ getAs: () => ({
  getBytes: () => [], getName: () => 'x.pdf', setName(n) { return this; } }) }) };

global.UrlFetchApp = { fetch: (url, opt) => {
  opt = opt || {};
  let payload = opt.payload;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (e) {} }
  SALIDAS.push({ url, payload, headers: opt.headers || {} });
  const r = RUTAS.find(x => x.re.test(url)) || RESPUESTA;
  return { getResponseCode: () => r.code, getContentText: () => r.body };
} };

// La hoja imita a Sheets en lo que importa: el apóstrofo de delante marca «texto» y no
// se guarda; sin él, lo que empieza por = + - @ se evalúa como fórmula.
const HOJA = {
  filas: [['id','fecha','direccion','telefono','clave','nombre','tipo','texto','estado','nota']],
  getLastColumn: () => 10,
  getDataRange() { return { getValues: () => HOJA.filas }; },
  getRange(r, c, nr, nc) {
    return { getValues: () => [HOJA.filas[r - 1].slice(c - 1, c - 1 + (nc || 1))],
             setValues: v => { HOJA.filas[r - 1] = v[0]; },
             setValue: v => { HOJA.filas[r - 1][c - 1] = v; },
             setFontWeight: () => {} };
  },
  appendRow(f) {
    const g = f.map(v => {
      if (typeof v !== 'string') return v;
      if (v[0] === "'") return v.slice(1);
      return /^[=+\-@]/.test(v) ? (Number(v) || '#ERROR!') : v;
    });
    HOJA.filas.push(g); FILAS.push(g);
  },
  setFrozenRows: () => {}
};
let FILAS = [];
global._ss = () => ({ getSheetByName: n => (n === 'WhatsApp' ? HOJA : null), insertSheet: () => HOJA });

const PADRON = [
  { clave:'Q-9',  nombre:'Ana Rosa Tejada',  lote:'9',   celular:'6111-2233' },
  { clave:'Q-18', nombre:'Cecibel Agudo',    lote:'18',  celular:'6030-0008' },
  { clave:'H-6',  nombre:'Cecibel Agudo',    lote:'6/7', celular:'6030-0008' },
  { clave:'L-6',  nombre:'Alicia Castillo',  lote:'6',   celular:'6243-8455' },
  { clave:'H-35', nombre:'Alfonso Castillo', lote:'35',  celular:'6243-8455' },
  { clave:'L-5',  nombre:'Joslyn Lopez',     lote:'5',   celular:'6981-2266' },
];
global.getPropietarios = () => PADRON;

const GS = path.join(__dirname, '..', 'backend-aires');
const rd = f => fs.readFileSync(path.join(GS, f), 'utf8');
eval(rd('AiresChica_Celulares.gs'));
eval(rd('AiresChica_WhatsApp.gs'));
eval(rd('AiresChica_Plantillas.gs'));   // para el respaldo por plantilla del aviso

PROPS.META_VERIFY_TOKEN = 'frase-secreta';
PROPS.META_WHATSAPP_TOKEN = 'TOK123';
PROPS.META_PHONE_ID = '55501';

const webhook = (msgs, statuses) => ({ object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { metadata: { phone_number_id: '55501' },
    messages: msgs || undefined, statuses: statuses || undefined } }] }] });
let n = 0;
const texto = (de, t) => ({ id: 'w' + (++n), from: de, type: 'text', text: { body: t } });
const correr = m => { SALIDAS = []; FILAS = []; _whatsappHandleWebhook(webhook([m])); };
const col = c => HOJA.filas[0].indexOf(c);
const cuerpos = () => SALIDAS.map(s => (s.payload && s.payload.text && s.payload.text.body) || '').join('\n');

console.log('── LA VERIFICACIÓN DE META ──');
let v = _whatsappHandleVerify({ 'hub.mode':'subscribe', 'hub.verify_token':'frase-secreta', 'hub.challenge':'1234567' });
ok(v && v.__texto === '1234567', 'devuelve el reto tal cual: ' + (v && v.__texto));
ok(v && v.__mime === undefined,
   'en texto plano: envuelto en JSON, Meta rechaza la URL y no dice por qué');
ok(_whatsappHandleVerify({ 'hub.mode':'subscribe', 'hub.verify_token':'otra', 'hub.challenge':'X' }).__texto !== 'X',
   'con la frase equivocada no devuelve el reto');
ok(_whatsappHandleVerify({ action:'ping' }) === null,
   'y una petición normal del panel pasa de largo: doGet sigue su camino');
PROPS.META_VERIFY_TOKEN = '';
ok(_whatsappHandleVerify({ 'hub.mode':'subscribe', 'hub.verify_token':'', 'hub.challenge':'X' }).__texto !== 'X',
   'sin frase configurada no verifica: dos vacíos no pueden casar');
PROPS.META_VERIFY_TOKEN = 'frase-secreta';

console.log('\n── EL WEBHOOK NO SE QUEDA CON LO QUE NO ES SUYO ──');
ok(_whatsappHandleWebhook({ action:'registrarPago', clave:'Q-9' }) === null, 'una escritura del panel pasa de largo');
ok(_whatsappHandleWebhook({}) === null, 'un cuerpo vacío también');
ok(_whatsappHandleWebhook(null) === null, 'y null no lo revienta');

console.log('\n── UN MENSAJE ENTRANTE SE RECONOCE Y SE ANOTA ──');
PROPS.META_ADMIN_WHATSAPP = '';
correr(texto('50761112233', '¿Cuánto debo?'));
const f = FILAS[0];
ok(FILAS.length === 1, 'anota una fila');
ok(f[col('clave')] === 'Q-9' && f[col('nombre')] === 'Ana Rosa Tejada',
   'con el propietario reconocido por su número: ' + f[col('clave')]);
ok(f[col('telefono')] === '+50761112233',
   'el teléfono en E.164, con el + que Sheets se comía: ' + f[col('telefono')]);
ok(f[col('texto')] === '¿Cuánto debo?' && f[col('direccion')] === 'entra', 'lo que escribió, marcado como entrante');

console.log('\n── SIN BOT, TODO MENSAJE ACABA EN UNA PERSONA ──');
PROPS.META_ADMIN_WHATSAPP = '6981-2266';
CACHE = {};
correr(texto('50761112233', 'hola'));
ok(SALIDAS.length === 1 && SALIDAS[0].payload.to === '50769812266',
   'se avisa a la administración: es el suelo del sistema');
ok(/Q-9/.test(cuerpos()) && /Ana Rosa Tejada/.test(cuerpos()), 'con el lote y el nombre');
ok(/wa\.me\/50761112233/.test(cuerpos()), 'y el enlace para contestarle desde el WhatsApp de uno');

console.log('\n── META REINTENTA; EL MISMO MENSAJE NO SE ANOTA DOS VECES ──');
const repetido = texto('50761112233', 'otra vez');
correr(repetido); const primera = FILAS.length;
correr(repetido);
ok(primera === 1 && FILAS.length === 0, 'el reintento se ignora por el id del mensaje');

console.log('\n── QUÉ ESCRIBIÓ, EN ALGO LEGIBLE ──');
const td = _waTextoDe;
ok(td({ type:'text', text:{ body:'hola' } }) === 'hola', 'un texto, tal cual');
ok(td({ type:'interactive', interactive:{ button_reply:{ id:'bot_saldo', title:'Mi saldo' } } }) === '[botón] Mi saldo',
   'un botón como «[botón] Mi saldo», no como el JSON crudo de Meta');
ok(td({ type:'interactive', interactive:{ list_reply:{ id:'bot_cuota', title:'Mi cuota' } } }) === '[botón] Mi cuota',
   'una opción de la lista, igual');
ok(td({ type:'image', image:{ id:'M1' } }) === '[imagen]',
   'una foto como «[imagen]»: en blanco parecería un mensaje vacío');
ok(td({ type:'image', image:{ id:'M1', caption:'mi pago' } }) === '[imagen] mi pago', 'con su pie si lo trae');
ok(td({ type:'document', document:{ filename:'recibo.pdf' } }) === '[archivo] recibo.pdf', 'un archivo, con su nombre');
ok(td({ type:'audio', audio:{ id:'A1' } }) === '[nota de voz]', 'una nota de voz');
ok(td({ type:'location', location:{} }) === '[ubicación]', 'una ubicación');
ok(td({ type:'sticker', sticker:{} }) === '[sticker]', 'y un sticker');

console.log('\n── QUIÉN ESCRIBE, EN LOS CASOS RAROS ──');
CACHE = {};
correr(texto('50760300008', 'hola'));
ok(FILAS[0][col('clave')] === 'Q-18' && /varios lotes/.test(FILAS[0][col('nota')]),
   'Cecibel se identifica, y se anota que tiene varios lotes: ' + FILAS[0][col('nota')]);
CACHE = {};
correr(texto('50762438455', 'hola'));
ok(FILAS[0][col('clave')] === '' && FILAS[0][col('nota')] === 'varios-duenos',
   'los Castillo no se atribuyen a ninguno: son personas distintas con el mismo número');
CACHE = {};
correr(texto('50769999999', 'hola'));
ok(FILAS[0][col('clave')] === '' && FILAS[0][col('nota')] === 'no-esta-en-el-padron',
   'un desconocido queda registrado, no descartado');

console.log('\n── LA HOJA NO CONVIERTE EN FÓRMULA LO QUE LE LLEGA ──');
CACHE = {};
correr(texto('50761112233', '=IMPORTRANGE("otra","A1")'));
ok(FILAS[0][col('texto')] === '=IMPORTRANGE("otra","A1")',
   'un mensaje que empieza por «=» se guarda como texto, no como fórmula viva en la hoja');
CACHE = {};
correr(texto('50761112233', '-1 mes de atraso'));
ok(FILAS[0][col('texto')] === '-1 mes de atraso', 'y uno que empieza por «-» tampoco se evalúa');

console.log('\n── LOS ACUSES DE ENTREGA SE APUNTAN EN SU FILA ──');
HOJA.filas.push(['wamid.OUT9', new Date(), 'sale', '+50761112233', 'Q-9', 'Ana', 'text', 'hola', 'enviado', '']);
_whatsappHandleWebhook(webhook(null, [{ id:'wamid.OUT9', status:'delivered' }]));
ok(HOJA.filas[HOJA.filas.length - 1][col('estado')] === 'delivered', 'el estado pasa a delivered');
_whatsappHandleWebhook(webhook(null, [{ id:'wamid.OUT9', status:'failed',
  errors:[{ title:'Re-engagement message' }] }]));
ok(/Re-engagement/.test(HOJA.filas[HOJA.filas.length - 1][col('nota')]),
   'y un fallo deja el motivo, que es lo accionable: ' + HOJA.filas[HOJA.filas.length - 1][col('nota')]);

console.log('\n── ENVIAR ──');
SALIDAS = []; FILAS = [];
let s = enviarWhatsAppTexto('6111-2233', 'Hola Ana');
ok(s.ok === true && s.id === 'wamid.OUT1', 'devuelve el id del mensaje: ' + s.id);
ok(/\/55501\/messages$/.test(SALIDAS[0].url), 'llama al phone_number_id, no al número');
ok(SALIDAS[0].headers.Authorization === 'Bearer TOK123',
   'con el token en la cabecera, que no se imprime al fallar');
ok(SALIDAS[0].payload.to === '50761112233',
   'y el destino sin el +: con él, un 6111-2233 se convierte en un número de otro país');
ok(FILAS.length === 1 && FILAS[0][col('direccion')] === 'sale', 'queda anotado como saliente');

console.log('\n── SIN CREDENCIALES NO INTENTA NADA ──');
PROPS.META_WHATSAPP_TOKEN = ''; SALIDAS = [];
s = enviarWhatsAppTexto('6111-2233', 'x');
ok(s.ok === false && /META_WHATSAPP_TOKEN/.test(s.error), 'dice qué falta: ' + s.error);
ok(SALIDAS.length === 0, 'y no llama a Meta');
PROPS.META_WHATSAPP_TOKEN = 'TOK123';

console.log('\n── LA VENTANA DE 24 HORAS SE REPORTA, NO SE TRAGA ──');
RESPUESTA = { code: 400, body: JSON.stringify({ error: { code: 131047,
  message: 'Message failed to send because more than 24 hours have passed' } }) };
SALIDAS = []; FILAS = [];
s = enviarWhatsAppTexto('6111-2233', 'x');
ok(s.ok === false && String(s.codigo) === '131047', 'devuelve el código de Meta: ' + s.codigo);
ok(/24 hours/.test(s.error), 'y su mensaje, que es lo que explica el caso');
ok(FILAS.length === 1 && FILAS[0][col('estado')] === 'error', 'el intento fallido también queda anotado');
RESPUESTA = { code: 200, body: '{"messages":[{"id":"wamid.OUT1"}]}' };

console.log('\n── UN NÚMERO INSERVIBLE NI SE INTENTA ──');
SALIDAS = [];
s = enviarWhatsAppTexto('264-1234', 'x');
ok(s.ok === false && /fijo/.test(s.error), 'un fijo se rechaza antes de gastar la llamada');
ok(SALIDAS.length === 0, 'sin tocar a Meta');

console.log('\n── LA LISTA DE LA ADMINISTRACIÓN ADMITE CÓMO SE ESCRIBE DE VERDAD ──');
const admins = x => { PROPS.META_ADMIN_WHATSAPP = x; return _waAdmins(); };
ok(admins('6981-2266').join() === '+50769812266', 'a la panameña, con guion');
ok(admins('69812266').join() === '+50769812266', 'seguido');
ok(admins('+507 6981-2266').join() === '+50769812266', 'con el + y el país');
ok(admins('507 6981 2266').join() === '+50769812266', 'con el país y espacios');
ok(admins('6981-2266, 6555-0000').join() === '+50769812266,+50765550000', 'dos, con coma');
ok(admins('6981-2266 y 6555-0000').join() === '+50769812266,+50765550000',
   'dos, con «y» — que es como lo escribiría cualquiera');
ok(admins('6981-2266; 6555-0000').join() === '+50769812266,+50765550000', 'dos, con punto y coma');
ok(admins('').length === 0, 'vacío no da ningún destino');
ok(admins('264-1234').length === 0, 'un fijo se descarta: WhatsApp no le llega');
PROPS.META_ADMIN_WHATSAPP = '6981-2266, 264-1234';
const det = _waAdminsDetalle();
ok(det.length === 2 && det[1].ok === false && /fijo/.test(det[1].por),
   'y el detalle dice por qué se descartó: sin eso el fallo sería mudo — ' + det[1].por);

console.log('\n── EL AVISO A LA ADMINISTRACIÓN ──');
PROPS.META_ADMIN_WHATSAPP = '6981-2266, 6555-0000';
CACHE = {};
correr(texto('50761112233', '¿Cuánto debo?'));
ok(SALIDAS.length === 2, 'avisa a los dos números: ' + SALIDAS.length);
ok(SALIDAS[0].payload.to === '50769812266' && SALIDAS[1].payload.to === '50765550000',
   'a los que dice META_ADMIN_WHATSAPP, no a otros');

console.log('\n── NO SE AVISA CINCO VECES DE LA MISMA PERSONA ──');
SALIDAS = [];
correr(texto('50761112233', 'me urge'));
ok(SALIDAS.length === 0, 'el segundo mensaje en la misma hora no genera otro aviso');
correr(texto('50760300008', 'hola'));
ok(SALIDAS.length === 2, 'pero otra persona sí: el silencio es por propietario, no general');

console.log('\n── QUIEN ADMINISTRA NO SE AVISA A SÍ MISMO ──');
CACHE = {};
correr(texto('50769812266', 'probando'));
ok(SALIDAS.length === 1 && SALIDAS[0].payload.to === '50765550000',
   'Josh escribe y sólo se entera la socia: sin esto el sistema se escribe a sí mismo');

console.log('\n── SI SE CERRÓ LA VENTANA DE 24 H, EL AVISO VA POR PLANTILLA ──');
CACHE = {}; PROPS.META_ADMIN_WHATSAPP = '6555-0000'; SALIDAS = [];
let intento = 0;
const _fetch = global.UrlFetchApp.fetch;
global.UrlFetchApp.fetch = (url, opt) => {
  intento++;
  SALIDAS.push({ url, payload: JSON.parse(opt.payload), headers: opt.headers || {} });
  const falla = intento === 1;   // el texto libre falla; la plantilla pasa
  return { getResponseCode: () => (falla ? 400 : 200),
           getContentText: () => (falla
             ? JSON.stringify({ error: { code: 131047, message: 'more than 24 hours' } })
             : '{"messages":[{"id":"wamid.TPL"}]}') };
};
correr(texto('50761112233', 'hola?'));
global.UrlFetchApp.fetch = _fetch;
ok(SALIDAS.length === 2, 'reintenta una sola vez: ' + SALIDAS.length);
ok(SALIDAS[0].payload.type === 'text' && SALIDAS[1].payload.type === 'template',
   'primero texto libre, que dentro de la ventana es gratis y llega completo');
ok(SALIDAS[1].payload.template.name === 'consulta_pendiente',
   'y la plantilla es la del aviso: ' + SALIDAS[1].payload.template.name);
const par = SALIDAS[1].payload.template.components[0].parameters.map(x => x.text);
ok(par.length === 5, 'con sus cinco valores: ' + par.length);
ok(par[0] === 'Aires de Chicá',
   'y el primero es la comunidad, que en la plantilla genérica ya no está escrita: ' + par[0]);

console.log('\n── SIN LISTA DE ADMINISTRACIÓN NO LE ESCRIBE A NADIE ──');
CACHE = {}; PROPS.META_ADMIN_WHATSAPP = '';
correr(texto('50761112233', 'hola'));
ok(SALIDAS.length === 0, 'no manda nada, en vez de improvisar un destino');
PROPS.META_ADMIN_WHATSAPP = '6981-2266';

console.log('\n── UN ERROR PROCESANDO NO ROMPE EL ACUSE A META ──');
const _id = identificarPorCelular;
identificarPorCelular = () => { throw new Error('boom'); };
const r = _whatsappHandleWebhook(webhook([texto('50761112233', 'x')]));
identificarPorCelular = _id;
ok(r && r.__texto === '{"ok":true}',
   'sigue devolviendo 200: si no, Meta reintentaría el mismo mensaje sin parar');

console.log('\n── EL INTERRUPTOR QUE MÁS SE OLVIDA: LA SUSCRIPCIÓN ──');
PROPS.META_WABA_ID = '';
let sus = _waComprobarSuscripcion();
ok(sus.sinWaba === true, 'sin META_WABA_ID lo dice, no inventa un veredicto');
PROPS.META_WABA_ID = '1580656143861626';
SALIDAS = [];
RUTAS = [{ re: /subscribed_apps/, code: 200, body: JSON.stringify({ data: [
  { whatsapp_business_api_data: { subscribed_fields: ['messages'] } } ] }) }];
sus = _waComprobarSuscripcion();
ok(/\/1580656143861626\/subscribed_apps$/.test(SALIDAS[0].url),
   'pregunta por la cuenta de WhatsApp, no por el número');
ok(sus.ok && sus.suscrita === true && sus.campos.indexOf('messages') >= 0, 'con una app suscrita dice que sí');
RUTAS = [{ re: /subscribed_apps/, code: 200, body: '{"data":[]}' }];
sus = _waComprobarSuscripcion();
ok(sus.ok === true && sus.suscrita === false,
   'una lista vacía es el interruptor apagado, y se distingue de un error');
RUTAS = [{ re: /subscribed_apps/, code: 400, body: '{"error":{"message":"Unsupported get request"}}' }];
sus = _waComprobarSuscripcion();
ok(sus.ok === false && /Unsupported/.test(sus.error),
   'un error de Meta se reporta como error, no como «no suscrita»');
RUTAS = [];

console.log('\n── LA BITÁCORA SE PUEDE LEER DESDE EL EDITOR ──');
const _log = console.log; let salida = [];
console.log = (...a) => { salida.push(a.map(String).join(' ')); };
let filas = ultimosWhatsApp(3);
console.log = _log;
ok(filas.length > 0 && filas.length <= 3, 'devuelve como mucho las que le pides: ' + filas.length);
HOJA.filas = [COL_WA.slice()];
salida = []; console.log = (...a) => { salida.push(a.map(String).join(' ')); };
filas = ultimosWhatsApp();
console.log = _log;
ok(filas.length === 0 && /vacía/.test(salida.join(' ')),
   'con la hoja vacía explica qué hacer en vez de reventar');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
