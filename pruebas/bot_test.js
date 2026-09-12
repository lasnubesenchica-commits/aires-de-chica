// El bot: a quién le contesta, qué le contesta, y sobre todo qué NO hace.
//
// Las afirmaciones que más importan son las negativas: que una copia del sistema no
// suelte cifras a quien no debe, que no acredite un pago por su cuenta, y que se calle
// cuando hay una persona contestando.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let PROPS = {}, CACHE = {}, SALIDAS = [], DRIVE = [];
let CLAUDE = 'saldo', CLAUDE_CODE = 200, CLAUDE_LLAMADAS = 0;

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  getProperties: () => JSON.parse(JSON.stringify(PROPS)),
  setProperty: (k, v) => { PROPS[k] = v; } }) };
global.CacheService = { getScriptCache: () => ({
  get: k => CACHE[k] || null, put: (k, v) => { CACHE[k] = v; } }) };
global.ContentService = { MimeType: { JSON: 'json' },
  createTextOutput: t => ({ __texto: String(t), setMimeType() { return this; } }) };
global.Logger = { log: () => {} };
global.CONFIG = { NEGOCIO: 'Aires de Chicá', TZ: 'America/Panama',
                  COMPROBANTES_EMAIL: 'comprobantes@airesdechica.org', ANIO_ACTUAL: 2026 };
global.Utilities = { sleep: () => {}, formatDate: () => '20260910-1900', base64Encode: () => 'x' };
global.AC_MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
  'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// setName de verdad muta el blob y lo devuelve. Un falso que no lo haga esconde el
// fallo de guardar el archivo con el nombre equivocado — ya pasó una vez.
function _blob(n, t) {
  return { __n: n, getName() { return this.__n; }, getContentType: () => t,
           getBytes: () => [1, 2, 3], setName(x) { this.__n = x; return this; } };
}
global.HtmlService = { createHtmlOutput: () => ({ getAs: () => _blob('estado.pdf', 'application/pdf') }) };

const CARPETA = { createFile: b => { DRIVE.push(b.getName());
  return { getUrl: () => 'https://drive.google.com/file/ABC', setSharing: () => {} }; } };
global.DriveApp = { Access: { ANYONE_WITH_LINK: 'l' }, Permission: { VIEW: 'v' },
  getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => CARPETA };
global._carpetaComprobantes = () => CARPETA;

global.ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
global.ANTHROPIC_MODEL = 'claude-haiku-4-5';
global._anthropicKey = () => PROPS.ANTHROPIC_API_KEY || '';

global.UrlFetchApp = { fetch: (url, opt) => {
  opt = opt || {};
  if (/anthropic/.test(url)) {
    CLAUDE_LLAMADAS++;
    return { getResponseCode: () => CLAUDE_CODE,
             getContentText: () => JSON.stringify({ content: [{ type: 'text', text: CLAUDE }] }) };
  }
  let payload = opt.payload;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (e) {} }
  SALIDAS.push({ url, payload });
  if (/\/media$/.test(url)) return { getResponseCode: () => 200, getContentText: () => '{"id":"MEDIA1"}' };
  if (/\/MEDIA_ENTRA$/.test(url)) return { getResponseCode: () => 200,
    getContentText: () => '{"url":"https://lookaside.fb/x","mime_type":"image/jpeg"}' };
  if (/lookaside/.test(url)) return { getResponseCode: () => 200, getContentText: () => 'bytes',
    getBlob: () => _blob('x.jpg', 'image/jpeg') };
  return { getResponseCode: () => 200, getContentText: () => '{"messages":[{"id":"wamid.OUT"}]}' };
} };

const HOJA = {
  filas: [['id','fecha','direccion','telefono','clave','nombre','tipo','texto','estado','nota']],
  getLastColumn: () => 10,
  getDataRange() { return { getValues: () => HOJA.filas }; },
  getRange(r, c, nr, nc) { return { getValues: () => [HOJA.filas[r-1].slice(c-1, c-1+(nc||1))],
    setValue: v => { HOJA.filas[r-1][c-1] = v; }, setValues: () => {}, setFontWeight: () => {} }; },
  appendRow(f) { HOJA.filas.push(f.map(v => (typeof v === 'string' && v[0] === "'") ? v.slice(1) : v)); },
  setFrozenRows: () => {}
};
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

const ESTADOS = {
  'Q-9':  { clave:'Q-9', lote:'9', nombre:'Ana Rosa Tejada', saldoConMora:245, mora:20, creditoAFavor:0,
            cuota:45, moraPct:5, moraBase:'cuota', email:'ana@correo.com', celular:'6111-2233',
            fechaVencimiento:new Date(2026, 8, 30),
            pagosHistorial:[ { fecha:new Date(2026,5,3),  monto:45, referencia:'111' },
                             { fecha:new Date(2026,6,5),  monto:45, referencia:'' },
                             { fecha:new Date(2026,7,4),  monto:45, referencia:'333' },
                             { fecha:new Date(2026,8,2),  monto:90, referencia:'444' } ] },
  'Q-18': { clave:'Q-18', lote:'18', nombre:'Cecibel Agudo', saldoConMora:0, mora:0, creditoAFavor:0,
            cuota:45, email:'ceci@correo.com', celular:'6030-0008', pagosHistorial:[] },
  'H-6':  { clave:'H-6', lote:'6/7', nombre:'Cecibel Agudo', saldoConMora:0, mora:0, creditoAFavor:15,
            cuota:45, email:'ceci@correo.com', celular:'6030-0008', pagosHistorial:[] },
  'L-5':  { clave:'L-5', lote:'5', nombre:'Joslyn Lopez', saldoConMora:45, mora:0, creditoAFavor:0,
            cuota:45, email:'josh@correo.com', celular:'6981-2266', pagosHistorial:[] },
};
global.getEstadoCuentaByKey = k => {
  if (!ESTADOS[k]) throw new Error('no existe ' + k);
  return JSON.parse(JSON.stringify(ESTADOS[k]), (kk, v) =>
    (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) ? new Date(v) : v);
};
global.estadoCuentaPDF = est => _blob('EstadoCuenta_' + est.clave + '.pdf', 'application/pdf');
global._ctaCobro = () => ({ banco:'Global Bank', tipo:'Ahorros', numero:'56333001422',
                            titular:'Asociación de Propietarios de Aires de Chicá' });

const COMUNICADOS = [
  { id:'C1', estado:'enviado',  enviadoEn:'2026-08-01 09:00', titulo:'Jornada de limpieza',
    cuerpo:'<b>Sábado</b> a las 8.', segmento:'todos', alcance:'' },
  { id:'C2', estado:'enviado',  enviadoEn:'2026-09-02 10:00', titulo:'Corte de agua el jueves',
    cuerpo:'El IDAAN suspende el servicio.', segmento:'todos', alcance:'' },
  { id:'C3', estado:'borrador', enviadoEn:'', titulo:'Borrador sin mandar',
    cuerpo:'nada', segmento:'todos', alcance:'' },
  { id:'C4', estado:'enviado',  enviadoEn:'2026-09-09 10:00', titulo:'Solo para El Quirá',
    cuerpo:'Asunto del residencial.', segmento:'manual', alcance:'Q-18' },
];
global.getComunicados = () => COMUNICADOS;
global._comDestinatarios = c => (c.segmento === 'todos' ? PADRON
  : PADRON.filter(p => String(c.alcance).toUpperCase().split(',').indexOf(p.clave) >= 0));
global._comLink = (a, q) => 'https://gas/exec?action=' + a + '&id=' + q.id + '&t=' + q.t;
global._acTokenDe = k => 'tok-' + k;

const GS = path.join(__dirname, '..', 'backend-aires');
const rd = f => fs.readFileSync(path.join(GS, f), 'utf8');
eval(rd('AiresChica_Celulares.gs'));
eval(rd('AiresChica_WhatsApp.gs'));
eval(rd('AiresChica_Plantillas.gs'));
eval(rd('AiresChica_Cliente.gs'));   // la verja de módulos vive aquí
eval(rd('AiresChica_Bot.gs'));

PROPS.META_WHATSAPP_TOKEN = 'TOK'; PROPS.META_PHONE_ID = '55501';
// Aires de Chicá llama «lote» a lo suyo. La palabra viene de la configuración de la
// copia, no del código: al final del archivo se comprueba con otras dos.
PROPS.AC_UNIDAD = 'lote';
PROPS.META_ADMIN_WHATSAPP = '6981-2266';

let n = 0;
const texto = (de, t) => ({ id:'w'+(++n), from:de, type:'text', text:{ body:t } });
const boton = (de, id) => ({ id:'w'+(++n), from:de, type:'interactive',
  interactive:{ type:'button_reply', button_reply:{ id, title:id } } });
const imagen = de => ({ id:'w'+(++n), from:de, type:'image', image:{ id:'MEDIA_ENTRA' } });
const correr = m => { SALIDAS = []; DRIVE = [];
  _whatsappHandleWebhook({ object:'whatsapp_business_account',
    entry:[{ changes:[{ value:{ metadata:{}, messages:[m] } }] }] }); };
const cuerpos = () => SALIDAS.map(s =>
  (s.payload && s.payload.text && s.payload.text.body) ||
  (s.payload && s.payload.interactive && s.payload.interactive.body.text) || '').join('\n');
const alPropietario = () => SALIDAS.filter(s => s.payload && s.payload.to === '50761112233');
const menu = () => SALIDAS[0].payload.interactive;

console.log('── APAGADO POR DEFECTO ──');
PROPS.META_BOT = ''; CACHE = {};
correr(texto('50761112233', '¿cuánto debo?'));
ok(SALIDAS.length === 1 && SALIDAS[0].payload.to === '50769812266',
   'sin META_BOT no le contesta al propietario: sólo avisa a la administración');
ok(!/245/.test(cuerpos()), 'y en ese aviso no va ninguna cifra de saldo');

console.log('\n── MODO PRUEBA: SÓLO A QUIEN ADMINISTRA ──');
PROPS.META_BOT = 'prueba'; CACHE = {};
correr(texto('50761112233', '¿cuánto debo?'));
ok(alPropietario().length === 0, 'a un propietario cualquiera sigue sin contestarle');
CACHE = {};
correr(texto('50769812266', '¿cuánto debo?'));
ok(SALIDAS.some(s => s.payload.to === '50769812266' && s.payload.type === 'interactive'),
   'pero a quien está probando, sí');

console.log('\n── EL SALDO ──');
PROPS.META_BOT = 'activo'; CACHE = {}; CLAUDE = 'saldo';
correr(texto('50761112233', 'buenas, cuanto debo?'));
let c = cuerpos();
ok(SALIDAS[0].payload.to === '50761112233', 'le contesta a quien preguntó');
ok(/B\/\. 245\.00/.test(c), 'con el saldo real de la hoja');
ok(/20\.00 de recargo/.test(c), 'desglosando la mora, que es la parte que la gente discute');
ok(/Global Bank/.test(c) && /56333001422/.test(c), 'y la cuenta de cobro vigente, no una escrita a mano');
ok(SALIDAS.length === 1, 'y NO avisa a la administración: ya quedó contestado');

console.log('\n── AL DÍA Y CON CRÉDITO SE DICEN DISTINTO ──');
CACHE = {};
correr(boton('50760300008', 'bot_saldo'));
c = cuerpos();
ok(/Está al día/.test(c), 'a quien no debe no se le habla de saldo pendiente');
ok(/15\.00 a favor/.test(c), 'y un crédito a favor se dice');
ok(/Lote 18/.test(c) && /Lote 6\/7/.test(c), 'Cecibel tiene dos lotes y recibe los dos, no uno al azar');

console.log('\n── EL MENÚ ──');
CACHE = {}; CLAUDE = 'saludo';
correr(texto('50761112233', 'buenas noches'));
const filas = [].concat.apply([], menu().action.sections.map(x => x.rows));
ok(menu().type === 'list',
   'es una LISTA: su botón abre el menú de una, mientras que un botón de respuesta ' +
   'sólo manda un mensaje y obliga a un toque más');
ok(filas.map(f => f.id).join() ===
   'bot_saldo,bot_pagos,bot_detalle,bot_cuota,bot_comunicado,bot_comopago,bot_datos,bot_humano',
   'con las ocho opciones en orden: ' + filas.map(f => f.title).join(' · '));
ok(filas.length <= 10, 'sin pasar de las 10 que admite WhatsApp');
ok(filas.every(f => f.title.length <= 24 && (!f.description || f.description.length <= 72)),
   'y sin títulos ni descripciones que WhatsApp corte por largos');
ok(menu().action.button.length <= 20, 'el botón que abre la lista cabe: «' + menu().action.button + '»');
ok(!filas.some(f => f.id === 'bot_comprobante'), 'enviar comprobante no se ofrece');

console.log('\n── MIS PAGOS DEL AÑO ──');
CACHE = {};
correr(boton('50761112233', 'bot_pagos'));
c = cuerpos();
ok(/Pagos del 2026/.test(c) && /Lote 9/.test(c), 'encabeza con el año y el lote');
ok((c.match(/✅/g) || []).length === 4, 'los cuatro del año, no sólo los últimos tres');
ok(c.indexOf('2 sep') < c.indexOf('3 jun'), 'el más reciente primero');
ok(/2 sep {2}— {2}B\/\. 90\.00 {2}· {2}ref\. 444/.test(c), 'fecha corta, monto y referencia');
ok(!/ref\. *\n/.test(c), 'sin «ref.» vacío cuando el pago no la trae');
ok(/Total 2026: B\/\. 225\.00/.test(c), 'con el total del año, que es lo que la gente suma a mano');
ok(/sep/.test(c) && !/Sep/.test(c), 'meses en minúscula, como se escriben en español');

console.log('\n── UN PAGO DE OTRO AÑO NO SE CUELA ──');
ESTADOS['Q-9'].pagosHistorial.push({ fecha:new Date(2025,11,20), monto:500, referencia:'VIEJO' });
CACHE = {};
correr(boton('50761112233', 'bot_pagos'));
c = cuerpos();
ok(!/VIEJO/.test(c) && /Total 2026: B\/\. 225\.00/.test(c),
   'ni en la lista ni en el total: filtrar mal por fecha es el error clásico');

console.log('\n── SIN PAGOS ESTE AÑO, PERO CON HISTORIA ──');
const guardado = ESTADOS['Q-9'].pagosHistorial;
ESTADOS['Q-9'].pagosHistorial = [{ fecha:new Date(2025,10,3), monto:45, referencia:'' }];
CACHE = {};
correr(boton('50761112233', 'bot_pagos'));
c = cuerpos();
ok(/Sin pagos registrados este año/.test(c), 'lo dice en vez de mandar una lista vacía');
ok(/3 de noviembre de 2025/.test(c), 'y rescata el último que consta, que es lo que esa persona busca');

console.log('\n── UN HISTORIAL LARGO NO REVIENTA EL MENSAJE ──');
ESTADOS['Q-9'].pagosHistorial = [];
for (let i = 0; i < 40; i++) ESTADOS['Q-9'].pagosHistorial.push(
  { fecha:new Date(2026, i % 9, 1 + (i % 27)), monto:58.5, referencia:'#1478474' + i });
CACHE = {};
correr(boton('50761112233', 'bot_pagos'));
c = cuerpos();
ok(c.length <= 1024, 'cabe en los 1024 que admite WhatsApp: ' + c.length);
ok(/y \d+ pago\(s\) más/.test(c), 'y dice cuántos quedaron fuera');
ok(/Total 2026/.test(c), 'sin perder el total, que es lo que se cortaría primero');
ESTADOS['Q-9'].pagosHistorial = guardado.filter(p => p.referencia !== 'VIEJO');

console.log('\n── MI CUOTA Y VENCIMIENTO ──');
CACHE = {};
correr(boton('50761112233', 'bot_cuota'));
c = cuerpos();
ok(/B\/\. 45\.00 al mes/.test(c), 'la cuota sale de la ficha, no escrita a mano');
ok(/vence el 30 de septiembre de 2026/.test(c), 'con la fecha real de vencimiento');
ok(/recargo por mora del 5%/.test(c) && /sobre la cuota del mes/.test(c),
   'y la regla del recargo: casi todo reclamo empieza en que nunca se dijo');

console.log('\n── CÓMO PAGO ──');
CACHE = {};
correr(boton('50761112233', 'bot_comopago'));
c = cuerpos();
ok(/\*La cuenta\*/.test(c) && /\*Los pasos\*/.test(c), 'los datos arriba, separados de los pasos');
ok(/```56333001422```/.test(c),
   'la cuenta en monoespaciado: suelta, WhatsApp ve once dígitos y la subraya como teléfono');
ok(/1\. .*Transferencias/.test(c) && /5\. Revise y confirme/.test(c), 'cinco pasos, uno por renglón');
ok(/escriba \*lote 9\*/.test(c), 'con SU lote y en negrita, que es lo que hay que teclear');
ok(/comprobantes@airesdechica\.org/.test(c), 'y el buzón que registra el pago solo');
ok(/⚠️ El paso 4/.test(c) && /podría no reflejarse a tiempo/.test(c), 'con la advertencia al final');
ok(c.length < 600, 'y cabe sin que Android lo corte con «Leer más»: ' + c.length + ' caracteres');
CACHE = {};
correr(boton('50760300008', 'bot_comopago'));
ok(/\*lote 18\* o \*lote 6\/7\*/.test(cuerpos()), 'a quien tiene dos lotes se le nombran los dos');

console.log('\n── EL PDF SÓLO SI LO PIDEN ──');
CACHE = {};
correr(boton('50761112233', 'bot_detalle'));
const doc = SALIDAS.find(s => s.payload && s.payload.type === 'document');
ok(!!doc, 'manda el estado de cuenta como archivo');
ok(doc.payload.document.id === 'MEDIA1',
   'subido a Meta, no enlazado: el saldo no sale a ninguna URL pública');
ok(/EstadoCuenta_Q-9\.pdf/.test(doc.payload.document.filename), 'con su nombre');

console.log('\n── ÚLTIMO COMUNICADO ──');
CACHE = {};
correr(boton('50761112233', 'bot_comunicado'));
c = cuerpos();
ok(/Corte de agua el jueves/.test(c), 'el más reciente de los enviados, no el primero de la hoja');
ok(!/Borrador/.test(c), 'un borrador sin enviar no se enseña');
ok(!/Solo para El Quirá/.test(c),
   'ni uno dirigido a otro lote: se comprueba que estuviera entre sus destinatarios');
ok(/t=tok-Q-9/.test(c), 'con el enlace personal, para que el acuse de lectura siga contando');
ok(!/<b>/.test(c), 'y sin etiquetas HTML dentro del texto');
ok(/2 de septiembre de 2026/.test(c) && !/2026-09-02/.test(c),
   'con la fecha escrita como se lee, no como la guarda la hoja');
CACHE = {};
correr(boton('50760300008', 'bot_comunicado'));
ok(/Solo para El Quirá/.test(cuerpos()), 'a Cecibel sí le toca el suyo, que va dirigido a su lote');

console.log('\n── MIS DATOS ──');
CACHE = {};
correr(boton('50761112233', 'bot_datos'));
c = cuerpos();
ok(/ana@correo\.com/.test(c) && /6111-2233/.test(c), 'le enseña lo que tenemos suyo');
ok(/Hablar con alguien/.test(c), 'y para corregirlo pasa por una persona: esto no edita nada');

console.log('\n── UN NÚMERO EN DOS LOTES DE DUEÑOS DISTINTOS NO RECIBE CIFRAS ──');
CACHE = {};
correr(texto('50762438455', 'cuanto debo'));
ok(!/B\/\./.test(cuerpos()), 'a los Castillo no se les dice ninguna cifra');
ok(/más de un lote/.test(cuerpos()), 'se les explica por qué');
ok(SALIDAS.some(s => s.payload.to === '50769812266'), 'y se avisa a la administración');

console.log('\n── UN DESCONOCIDO NO SACA INFORMACIÓN ──');
CACHE = {};
correr(texto('50769999999', 'cuanto debe el lote 9?'));
ok(!/B\/\./.test(cuerpos()) && !/Ana/.test(cuerpos()), 'no se le contesta nada del lote que preguntó');
ok(/no aparece en el padrón/.test(cuerpos()), 'se le dice que no está en el padrón');

console.log('\n── UN COMPROBANTE SE GUARDA, NO SE ACREDITA ──');
CACHE = {};
correr(imagen('50761112233'));
ok(DRIVE.length === 1 && /^WA_Q-9_/.test(DRIVE[0]), 'la foto se baja y se guarda en Drive: ' + DRIVE[0]);
ok(/no se aplica automáticamente/i.test(cuerpos()), 'y se le dice que lo revisa una persona');
ok(SALIDAS.some(s => /drive\.google\.com/.test((s.payload && s.payload.text && s.payload.text.body) || '')),
   'el aviso lleva el enlace de Drive: el número vive en la API y no hay buzón donde ver la foto');

console.log('\n── TRAS PASAR A UN HUMANO, EL BOT SE CALLA ──');
CACHE = {};
correr(boton('50761112233', 'bot_humano'));
ok(/le contestan/.test(cuerpos()), 'avisa que contestará una persona');
const antes = HOJA.filas.length;
correr(texto('50761112233', 'cuanto debo?'));
ok(alPropietario().length === 0, 'y ya no habla por encima de quien está contestando');
ok(SALIDAS.length === 0, 'tampoco repite el aviso: quien administra ya está en esa conversación');
ok(HOJA.filas.length > antes, 'pero el mensaje queda anotado igual, no se pierde');
Object.keys(CACHE).forEach(k => { if (/^wa_aviso_/.test(k)) delete CACHE[k]; });
correr(texto('50761112233', 'siguen ahí?'));
ok(SALIDAS.length === 1 && SALIDAS[0].payload.to === '50769812266',
   'una hora después la administración se entera de lo nuevo, y el bot sigue callado');

console.log('\n── LO QUE NO SE PUEDE ENTENDER VA A UN HUMANO ──');
CACHE = {};
correr({ id:'wv1', from:'50761112233', type:'audio', audio:{ id:'A1' } });
ok(!/B\/\./.test(cuerpos()), 'una nota de voz no se adivina');
ok(SALIDAS.some(s => s.payload.to === '50769812266'), 'se pasa a una persona');

console.log('\n── LA CLASIFICACIÓN ──');
PROPS.ANTHROPIC_API_KEY = 'sk-x';
CLAUDE = 'humano'; CACHE = {};
correr(texto('50761112233', 'no estoy de acuerdo con el recargo de mora'));
ok(!/B\/\./.test(cuerpos()) && SALIDAS.some(s => s.payload.to === '50769812266'),
   'un reclamo no se contesta con cifras: va a una persona');
CLAUDE = 'pagos'; CACHE = {};
correr(texto('50761112233', 'ya les mandé la plata ayer, les llegó?'));
ok(/Pagos del 2026/.test(cuerpos()), 'y una pregunta por un pago llega a los pagos');

console.log('\n── SI CLAUDE FALLA, EL BOT SIGUE ──');
CLAUDE_CODE = 500; CACHE = {};
correr(texto('50761112233', 'cuanto debo?'));
ok(/B\/\. 245\.00/.test(cuerpos()), 'las palabras clave cubren lo esencial cuando la API cae');
CLAUDE_CODE = 200;
delete PROPS.ANTHROPIC_API_KEY;
CLAUDE_LLAMADAS = 0; CACHE = {};
correr(texto('50761112233', 'cuanto debo?'));
ok(CLAUDE_LLAMADAS === 0 && /B\/\. 245\.00/.test(cuerpos()), 'y sin clave ni se intenta llamar');
PROPS.ANTHROPIC_API_KEY = 'sk-x';

console.log('\n── LO QUE NO NECESITA INTERPRETARSE NO GASTA UNA LLAMADA ──');
CLAUDE_LLAMADAS = 0; CACHE = {};
correr(boton('50761112233', 'bot_saldo'));
ok(CLAUDE_LLAMADAS === 0, 'un botón trae su identificador: no hay nada que adivinar');
CLAUDE_LLAMADAS = 0; CACHE = {};
correr(texto('50761112233', 'menu'));
ok(SALIDAS[0].payload.interactive.type === 'list' && CLAUDE_LLAMADAS === 0,
   '«menú» es una orden, no una frase: abre la lista sin pasar por el modelo');

console.log('\n── EL MENÚ SE ARMA CON LOS MÓDULOS CONTRATADOS ──');
PROPS.AC_MODULOS = 'financiero'; CACHE = {}; CLAUDE = 'saludo';
correr(texto('50761112233', 'buenas'));
let ids = [].concat.apply([], menu().action.sections.map(x => x.rows)).map(f => f.id);
ok(ids.indexOf('bot_comunicado') < 0,
   'sin el módulo de comunicaciones no aparece «Último comunicado»: ' + ids.join(' '));
ok(ids.indexOf('bot_saldo') >= 0 && ids.indexOf('bot_humano') >= 0,
   'y lo del módulo que sí tiene, más lo que no depende de ninguno, se queda');
ok(menu().action.sections.every(s => s.rows.length),
   'sin secciones vacías: «La comunidad» desaparece entera si se queda sin filas');

PROPS.AC_MODULOS = 'comunicaciones'; CACHE = {};
correr(texto('50761112233', 'buenas'));
ids = [].concat.apply([], menu().action.sections.map(x => x.rows)).map(f => f.id);
ok(ids.indexOf('bot_saldo') < 0 && ids.indexOf('bot_pagos') < 0,
   'al revés, sin el financiero no se ofrecen saldo ni pagos');
ok(ids.indexOf('bot_comunicado') >= 0, 'y el comunicado sí');

console.log('\n── ESCRIBIR NO SALTA LA VERJA ──');
PROPS.AC_MODULOS = 'comunicaciones'; CACHE = {}; CLAUDE = 'saldo';
correr(texto('50761112233', 'cuanto debo?'));
ok(!/B\/\. 245/.test(cuerpos()),
   'pedir el saldo por escrito en un PH sin módulo financiero no lo entrega');
ok(SALIDAS.some(s => s.payload.to === '50769812266'), 'se pasa a una persona');
delete PROPS.AC_MODULOS;
CACHE = {}; CLAUDE = 'saldo';
correr(texto('50761112233', 'cuanto debo?'));
ok(/B\/\. 245/.test(cuerpos()), 'y sin la propiedad puesta, todo sigue funcionando como antes');

console.log('\n── UN FALLO DEL BOT NO DEJA EL MENSAJE SIN ATENDER ──');
CACHE = {};
const _at = _botAtender;
_botAtender = () => { throw new Error('boom'); };
correr(texto('50761112233', 'cuanto debo'));
_botAtender = _at;
ok(SALIDAS.some(s => s.payload.to === '50769812266'),
   'si el bot revienta, la administración se entera igual');

console.log('\n── LA PALABRA DE LA UNIDAD SALE DE LA CONFIGURACIÓN ──');
// Es lo que separa una copia vendible de la copia de Aires de Chicá con otro logo. A un
// propietario de una torre que le hablen de «su lote» le dice, sin que nadie se lo
// explique, que el sistema es de otro.
PROPS.AC_UNIDAD = 'apartamento'; CACHE = {};
correr(boton('50761112233', 'bot_saldo'));
c = cuerpos();
ok(/Apartamento 9/.test(c) && !/[Ll]ote/.test(c),
   'en un edificio dice «Apartamento 9», y «lote» no aparece por ningún lado');

// «casa» es femenina: si los artículos no concuerdan, el texto delata la plantilla.
PROPS.AC_UNIDAD = 'casa'; CACHE = {};
correr(texto('50762438455', 'cuanto debo'));
c = cuerpos();
ok(/más de una casa/.test(c), 'y concuerda el artículo: «más de una casa», no «más de un casa»');

CACHE = {};
correr(boton('50761112233', 'bot_comopago'));
ok(/escriba \*casa 9\*/.test(cuerpos()), 'el paso del banco también la usa');

// Sin la propiedad puesta, «unidad»: fea, pero no es falsa en ninguna comunidad, y
// sobre todo no es el nombre de otro PH.
delete PROPS.AC_UNIDAD; CACHE = {};
correr(boton('50761112233', 'bot_saldo'));
ok(/Unidad 9/.test(cuerpos()), 'y una copia sin configurar dice «Unidad 9», no «Lote 9»');
PROPS.AC_UNIDAD = 'lote';

console.log('\n── UNA COPIA SIN CORREO NO MANDA A NADIE AL BUZÓN DE OTRO PH ──');
// Este correo estuvo escrito a mano en el código: admin@airesdechica.org.
const _neg = CONFIG.REPLY_TO;
CONFIG.REPLY_TO = ''; CONFIG.ADMIN_EMAIL = ''; CACHE = {};
correr(texto('50769999999', 'hola'));
c = cuerpos();
ok(!/airesdechica/.test(c), 'a un desconocido no se le da el correo de Aires de Chicá: ' + c.slice(0, 90));
ok(/la administración le contestará/.test(c), 'se le dice que le contestarán, que es lo que va a pasar');
CONFIG.REPLY_TO = 'admin@ejemplo.org'; CACHE = {};
correr(texto('50769999999', 'hola'));
ok(/admin@ejemplo\.org/.test(cuerpos()), 'y con el correo puesto, se le da ese');
CONFIG.REPLY_TO = _neg;

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
