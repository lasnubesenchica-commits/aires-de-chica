// Las plantillas de WhatsApp: que cumplan las reglas de Meta ANTES de mandarlas, y que
// la subida haga lo que dice.
const fs = require('fs');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let PROPS = {}, SALIDAS = [], RUTAS = [];
let RESPUESTA = { code: 200, body: '{"id":"1","status":"PENDING"}' };

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => PROPS[k] || null, setProperty: (k, v) => { PROPS[k] = v; } }) };
global.UrlFetchApp = { fetch: (url, opt) => {
  opt = opt || {};
  SALIDAS.push({ url, opt, headers: opt.headers || {},
                 payload: (opt.payload && typeof opt.payload === 'string') ? JSON.parse(opt.payload) : opt.payload });
  const r = RUTAS.find(x => x.re.test(url)) || RESPUESTA;
  return { getResponseCode: () => r.code, getContentText: () => r.body };
} };
global.HtmlService = { createHtmlOutput: (h) => ({
  getAs: () => ({ getBytes: () => new Array(2048).fill(0), setName(n) { this.__n = n; return this; } }) }) };
global.Utilities = { sleep: () => {} };
global.Logger = { log: () => {} };

const path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', 'backend-aires', f), 'utf8');
// Del módulo de WhatsApp sólo hacen falta las constantes y los ayudantes de propiedades.
eval(rd('AiresChica_WhatsApp.gs').split('/* ─────────────── bitácora')[0]
       .replace(/function _whatsappHandle[\s\S]*$/, ''));
eval(rd('AiresChica_Plantillas.gs'));

const defs = _waPlantillas();

console.log('── LAS CINCO CUMPLEN LAS REGLAS DE META ──');
defs.forEach(d => {
  const males = _waValidarPlantilla(d);
  ok(males.length === 0, d.nombre + (males.length ? ' → ' + males.join('; ') : ''));
});
ok(defs.length === 5, 'son cinco: estado de cuenta, recordatorio, pago, comunicado y el aviso interno');
ok(defs.filter(d => d.categoria === 'UTILITY').length === 5, 'todas como UTILITY');

console.log('\n── EL VALIDADOR DETECTA DE VERDAD CADA REGLA ──');
const base = { nombre: 'x', categoria: 'UTILITY', idioma: 'es', cuerpo: 'Hola {{1}}, todo bien.',
               ejemplos: ['Ana'], pie: 'Aires de Chicá' };
const con = o => Object.assign({}, base, o);
const falla = (o, re, m) => {
  const males = _waValidarPlantilla(con(o));
  ok(males.some(x => re.test(x)), m + (males.length ? ' → ' + males.join('; ') : ' → no dijo nada'));
};
ok(_waValidarPlantilla(base).length === 0, 'la de control pasa limpia');
falla({ cuerpo: '{{1}} tiene un saldo pendiente.', ejemplos: ['Ana'] },
      /empieza por una variable/, 'una variable al principio del cuerpo');
falla({ cuerpo: 'Su saldo es de {{1}}', ejemplos: ['45.00'] },
      /termina en una variable/, 'una variable al final');
falla({ cuerpo: 'Hola {{1}} {{2}}, saludos.', ejemplos: ['Ana', 'Tejada'] },
      /pegadas/, 'dos variables pegadas');
falla({ cuerpo: 'Hola {{1}}, el lote {{3}} debe algo.', ejemplos: ['Ana', 'Q-9'] },
      /sin saltos/, 'una numeración con saltos');
falla({ cuerpo: 'Hola {{1}}, el lote {{2}} debe algo.', ejemplos: ['Ana'] },
      /2 variables y 1 ejemplos/, 'menos ejemplos que variables');
falla({ ejemplos: [''] }, /ejemplo de \{\{1\}\} está vacío/, 'un ejemplo en blanco');
falla({ nombre: 'Estado Cuenta' }, /minúsculas/, 'un nombre con mayúsculas y espacios');
falla({ cuerpo: 'Hola {{1}}, ' + 'x'.repeat(1100) + '.' }, /1024/, 'un cuerpo pasado de largo');
falla({ pie: 'x'.repeat(61) }, /pie de más de 60/, 'un pie pasado de largo');
falla({ encabezado: { tipo: 'TEXT', texto: 'Hola {{1}}' } },
      /encabezado lleva variables/, 'variables en el encabezado');

console.log('\n── LA FORMA QUE SE LE MANDA A META ──');
const est = defs.find(d => d.nombre === 'estado_cuenta_mensual');
let p = _waPlantillaPayload(est, '4::handle');
ok(p.name === 'estado_cuenta_mensual' && p.language === 'es' && p.category === 'UTILITY',
   'nombre, idioma y categoría');
const cab = p.components.find(c => c.type === 'HEADER');
ok(cab && cab.format === 'DOCUMENT' && cab.example.header_handle[0] === '4::handle',
   'el encabezado del estado de cuenta es un documento, con su ejemplo');
const cue = p.components.find(c => c.type === 'BODY');
ok(cue.example.body_text[0].length === 5,
   'el cuerpo lleva un ejemplo por variable, envueltos en la lista que Meta espera');
ok(!p.components.some(c => c.type === 'FOOTER'),
   'y no manda pie: no admite variables, y lo que se escriba ahí lo leen los propietarios de TODOS los PH');

console.log('\n── NINGUNA PLANTILLA NOMBRA A UNA COMUNIDAD ──');
// Las plantillas se aprueban una vez para toda la cuenta de WhatsApp, que comparten
// todas las comunidades. Una sola palabra de Aires de Chicá metida en un cuerpo se la
// come el propietario de otro PH, y no hay forma de arreglarlo sin volver a revisión.
const cuerpos = defs.map(d => d.cuerpo + ' ' + (d.encabezado && d.encabezado.texto || '')).join('\n');
ok(!/Aires de Chic|airesdechica|Asociaci\u00f3n de Propietarios/i.test(cuerpos),
   'ningún cuerpo ni encabezado nombra a Aires de Chicá');
ok(!/\blotes?\b/i.test(cuerpos),
   'ni dice «lote»: un edificio tiene apartamentos, y la palabra la compone quien llama');
ok(defs.every(d => !d.pie), 'ninguna lleva pie');

// El nombre del PH tiene que entrar por algún lado, y el único que queda es el cuerpo.
['estado_cuenta_mensual', 'recordatorio_saldo', 'pago_registrado', 'comunicado_aviso',
 'consulta_pendiente'].forEach(n => {
  const d = defs.find(x => x.nombre === n);
  ok((d.ejemplos || []).indexOf('Aires de Chicá') >= 0,
     n + ': la comunidad entra por variable, no escrita en el texto');
});

const com = defs.find(d => d.nombre === 'comunicado_aviso');
const cabCom = _waPlantillaPayload(com, null).components.find(c => c.type === 'HEADER');
ok(cabCom.format === 'TEXT' && !cabCom.example, 'el encabezado de texto va sin ejemplo');
const rec = defs.find(d => d.nombre === 'recordatorio_saldo');
ok(!_waPlantillaPayload(rec, null).components.some(c => c.type === 'HEADER'),
   'y la que no lleva encabezado no manda uno vacío');

console.log('\n── EL TOKEN NUNCA VIAJA EN LA URL ──');
PROPS.META_WABA_ID = '1580656143861626';
PROPS.META_WHATSAPP_TOKEN = 'TOK-SECRETO';
PROPS.META_APP_ID = '1091600336651498';
SALIDAS = [];
RUTAS = [
  { re: /message_templates\?/, code: 200, body: '{"data":[]}' },
  { re: /\/uploads/, code: 200, body: '{"id":"upload:SESION"}' },
  { re: /upload:SESION/, code: 200, body: '{"h":"4::EJEMPLO"}' },
  { re: /message_templates$/, code: 200, body: '{"id":"9","status":"PENDING","category":"UTILITY"}' }
];
let r = subirPlantillas();
ok(SALIDAS.every(s => s.url.indexOf('TOK-SECRETO') < 0),
   'ninguna de las ' + SALIDAS.length + ' llamadas lleva el token en la dirección');
ok(SALIDAS.every(s => !s.headers.Authorization || /TOK-SECRETO/.test(s.headers.Authorization)),
   'va siempre en la cabecera, que no se imprime al fallar');

console.log('\n── LA SUBIDA ──');
ok(r.ok === true && r.resultados.length === 5, 'sube las cinco: ' + r.resultados.length);
const creadas = SALIDAS.filter(s => /message_templates$/.test(s.url));
ok(creadas.length === 5, 'una llamada de creación por plantilla: ' + creadas.length);
ok(creadas.every(c => c.opt.method === 'post'), 'todas por POST');
const subidas = SALIDAS.filter(s => /uploads|upload:SESION/.test(s.url));
ok(subidas.length === 2,
   'el PDF de ejemplo se sube UNA vez y en dos pasos, no una vez por plantilla: ' + subidas.length);
ok(/file_length=2048/.test(subidas[0].url), 'la sesión declara el tamaño real del archivo');
ok(subidas[1].headers.file_offset === '0' && /^OAuth /.test(subidas[1].headers.Authorization),
   'y los bytes van con file_offset y cabecera OAuth, como pide Meta');

console.log('\n── NO SE PISAN LAS QUE YA EXISTEN ──');
SALIDAS = [];
RUTAS[0] = { re: /message_templates\?/, code: 200,
  body: JSON.stringify({ data: [{ name: 'pago_registrado', status: 'APPROVED' }] }) };
r = subirPlantillas();
ok(SALIDAS.filter(s => /message_templates$/.test(s.url)).length === 4,
   'la que ya está aprobada no se vuelve a crear: se crean 4');
ok(r.resultados.some(x => x.nombre === 'pago_registrado' && x.saltada),
   'y se dice que se saltó, en vez de callarlo');

console.log('\n── SI EL PDF DE EJEMPLO FALLA, LAS DEMÁS SIGUEN ──');
SALIDAS = [];
RUTAS[0] = { re: /message_templates\?/, code: 200, body: '{"data":[]}' };
RUTAS[1] = { re: /\/uploads/, code: 400, body: '{"error":{"message":"Invalid app id"}}' };
r = subirPlantillas();
ok(SALIDAS.filter(s => /message_templates$/.test(s.url)).length === 4,
   'las que no llevan documento se suben igual');
ok(r.resultados.some(x => x.nombre === 'estado_cuenta_mensual' && x.ok === false && /Invalid app id/.test(x.error)),
   'y la del estado de cuenta dice por qué no: ' +
   (r.resultados.find(x => x.nombre === 'estado_cuenta_mensual') || {}).error);
RUTAS[1] = { re: /\/uploads/, code: 200, body: '{"id":"upload:SESION"}' };

console.log('\n── UNA PLANTILLA INVÁLIDA DETIENE TODO ANTES DE LLAMAR A META ──');
// El eval deja _waPlantillas como enlace del módulo, no en global: se sustituye
// reasignando el propio nombre.
const _defs = _waPlantillas;
_waPlantillas = () => [con({ nombre: 'rota', cuerpo: '{{1}} arriba', ejemplos: ['x'] })];
SALIDAS = [];
r = subirPlantillas();
_waPlantillas = _defs;
ok(r.ok === false && SALIDAS.length === 0,
   'no se gasta ni una petición si el texto no cumple las reglas');

console.log('\n── SIN CREDENCIALES NO INTENTA NADA ──');
PROPS.META_WABA_ID = ''; SALIDAS = [];
r = subirPlantillas();
ok(r.ok === false && SALIDAS.length === 0, 'sin META_WABA_ID se planta y lo dice');
PROPS.META_WABA_ID = '1580656143861626';

console.log('\n── EL ESTADO DE LAS PLANTILLAS SE LEE ENTERO ──');
RUTAS[0] = { re: /message_templates\?/, code: 200, body: JSON.stringify({ data: [
  { name: 'estado_cuenta_mensual', language: 'es', status: 'APPROVED', category: 'UTILITY' },
  { name: 'comunicado_aviso', language: 'es', status: 'REJECTED', category: 'MARKETING',
    rejected_reason: 'INVALID_FORMAT' } ] }) };
const _log = console.log; let salida = [];
const fmt = (...a) => {
  let i = 1;
  return a.length > 1 && /%s/.test(String(a[0]))
    ? String(a[0]).replace(/%s/g, () => String(a[i++]))
    : a.map(String).join(' ');
};
console.log = (...a) => { salida.push(fmt(...a)); };
verPlantillas();
console.log = _log;
const txt = salida.join('\n');
ok(/APPROVED/.test(txt) && /REJECTED/.test(txt), 'muestra las dos');
ok(/INVALID_FORMAT/.test(txt), 'y el motivo del rechazo, que es lo accionable');
ok(/1 de 2 aprobadas/.test(txt), 'con la cuenta clara: ' + salida[salida.length - 1]);

console.log('\n── EL PDF DE MUESTRA NO LLEVA DATOS DE NADIE ──');
const html = HtmlService.createHtmlOutput.toString();
const fuente = rd('AiresChica_Plantillas.gs');
const muestra = fuente.split('_waPdfDeMuestra')[1].split('function ')[0];
ok(/EJEMPLO · DATOS FICTICIOS|DATOS FICTICIOS/.test(muestra),
   'el PDF que ve el revisor de Meta se anuncia como ejemplo');
ok(!/@/.test(muestra), 'y no lleva ningún correo dentro');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
