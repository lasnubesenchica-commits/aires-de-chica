// El router: reparte los webhooks de Meta al Apps Script de cada comunidad.
//
// Dos cosas importan más que el reparto en sí. Una: que una comunidad NUNCA vea el
// tráfico de otra, ni de pasada — es lo que mantiene las copias aisladas de verdad.
// Otra: que Meta reciba 200 pase lo que pase, porque reintenta lo que no se acusa y un
// fallo nuestro se convertiría en el mismo mensaje llegando sin parar.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let PROPS = {}, ENVIOS = [], FILAS = [], RESP = 200, REVIENTA = false;

global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  setProperty: (k, v) => { PROPS[k] = v; } }) };
global.ContentService = { MimeType: { JSON: 'json' },
  createTextOutput: t => ({ __texto: String(t), setMimeType(m) { this.__mime = m; return this; } }) };
global.Logger = { log: () => {} };
global.UrlFetchApp = { fetch: (url, opt) => {
  if (REVIENTA) throw new Error('la red se cayó');
  ENVIOS.push({ url, cuerpo: JSON.parse(opt.payload) });
  return { getResponseCode: () => RESP };
} };

const HOJA = { filas: [], appendRow(f) { HOJA.filas.push(f); FILAS.push(f); },
  getRange: () => ({ setValues: () => {} }), setFrozenRows: () => {} };
global.SpreadsheetApp = { openById: () => ({
  getSheetByName: n => (n === 'Ruteo' ? HOJA : null), insertSheet: () => HOJA }) };

eval(fs.readFileSync(path.join(__dirname, '..', 'router', 'Router.gs'), 'utf8'));

const URL_A = 'https://script.google.com/macros/s/AAAA/exec';
const URL_B = 'https://script.google.com/macros/s/BBBB/exec';
PROPS.META_VERIFY_TOKEN = 'frase-del-router';
PROPS.ROUTER_SHEET_ID = 'HOJA1';   // con bitácora: es donde se ve lo que no se repartió
PROPS.RUTEO_JSON = JSON.stringify({
  '111': { url: URL_A, nombre: 'Aires de Chicá' },
  '222': { url: URL_B, nombre: 'PH Las Palmas' }
});

const post = cuerpo => { ENVIOS = []; FILAS = [];
  return doPost({ postData: { contents: JSON.stringify(cuerpo) } }); };
const entrada = (phoneId, texto) => ({
  id: 'WABA1', time: 1,
  changes: [{ value: { metadata: { phone_number_id: phoneId },
    messages: [{ id: 'w' + Math.random(), from: '50761112233', type: 'text', text: { body: texto } }] } }] });

console.log('── LA VERIFICACIÓN DE META ──');
let v = doGet({ parameter: { 'hub.mode':'subscribe', 'hub.verify_token':'frase-del-router', 'hub.challenge':'9988' } });
ok(v.__texto === '9988', 'devuelve el reto tal cual: ' + v.__texto);
ok(v.__mime === undefined, 'en texto plano: envuelto en JSON, Meta rechaza la URL');
ok(doGet({ parameter: { 'hub.mode':'subscribe', 'hub.verify_token':'otra', 'hub.challenge':'9988' } }).__texto !== '9988',
   'con la frase equivocada no devuelve el reto');
ok(doGet({ parameter: {} }).__texto === 'ok',
   'y quien abra la URL a secas no averigua qué es esto ni a quién sirve');

console.log('\n── CADA MENSAJE A SU COMUNIDAD ──');
post({ object: 'whatsapp_business_account', entry: [entrada('111', 'hola Aires')] });
ok(ENVIOS.length === 1 && ENVIOS[0].url === URL_A, 'el del número 111 va a Aires: ' + ENVIOS.length);
post({ object: 'whatsapp_business_account', entry: [entrada('222', 'hola Palmas')] });
ok(ENVIOS.length === 1 && ENVIOS[0].url === URL_B, 'y el del 222 a Las Palmas');

console.log('\n── UNA COMUNIDAD NO VE EL TRÁFICO DE OTRA ──');
post({ object: 'whatsapp_business_account',
       entry: [entrada('111', 'soy de Aires'), entrada('222', 'soy de Palmas')] });
ok(ENVIOS.length === 2, 'un webhook con dos comunidades se parte en dos envíos');
const aAires = ENVIOS.find(e => e.url === URL_A);
const aPalmas = ENVIOS.find(e => e.url === URL_B);
ok(JSON.stringify(aAires.cuerpo).indexOf('soy de Palmas') < 0,
   'a Aires NO le llega el mensaje de Las Palmas, ni de pasada');
ok(JSON.stringify(aPalmas.cuerpo).indexOf('soy de Aires') < 0, 'ni al revés');
ok(aAires.cuerpo.object === 'whatsapp_business_account' && aAires.cuerpo.entry.length === 1,
   'y lo que recibe tiene la misma forma que le manda Meta: su doPost no nota la diferencia');

console.log('\n── UN NÚMERO SIN COMUNIDAD NO SE REPARTE ──');
post({ object: 'whatsapp_business_account', entry: [entrada('999', 'de quién es esto')] });
ok(ENVIOS.length === 0, 'no se manda a nadie, en vez de a la primera de la lista');
ok(FILAS.some(f => String(f).indexOf('sin-ruta') >= 0), 'y queda anotado para poder verlo');

console.log('\n── META SIEMPRE RECIBE 200 ──');
let r = post({ object: 'whatsapp_business_account', entry: [entrada('111', 'x')] });
ok(r.__texto === '{"ok":true}', 'en el caso normal');
RESP = 500;
r = post({ object: 'whatsapp_business_account', entry: [entrada('111', 'x')] });
ok(r.__texto === '{"ok":true}', 'aunque el Apps Script de la comunidad devuelva error');
ok(FILAS.some(f => String(f).indexOf('fallo') >= 0), 'que se anota como fallo, para enterarse');
RESP = 200;
REVIENTA = true;
r = post({ object: 'whatsapp_business_account', entry: [entrada('111', 'x')] });
REVIENTA = false;
ok(r.__texto === '{"ok":true}', 'y aunque la red se caiga a mitad del reenvío');
r = post({ object: 'whatsapp_business_account', entry: [] });
ok(r.__texto === '{"ok":true}', 'un webhook vacío tampoco lo tumba');
r = doPost({ postData: { contents: 'esto no es json' } });
ok(r.__texto === '{"ok":true}', 'ni un cuerpo que no es JSON');

console.log('\n── LO QUE NO ES DE WHATSAPP NO SE TOCA ──');
post({ object: 'page', entry: [entrada('111', 'x')] });
ok(ENVIOS.length === 0, 'un webhook de otro producto de Meta no se reparte');

console.log('\n── UN RUTEO ROTO NO TUMBA EL ROUTER ──');
PROPS.RUTEO_JSON = '{esto no cierra';
r = post({ object: 'whatsapp_business_account', entry: [entrada('111', 'x')] });
ok(r.__texto === '{"ok":true}' && ENVIOS.length === 0,
   'con el JSON mal escrito se deja de repartir, pero se sigue acusando a Meta');
PROPS.RUTEO_JSON = JSON.stringify({ '111': { url: URL_A, nombre: 'Aires de Chicá' } });

console.log('\n── DAR DE ALTA UNA COMUNIDAD ──');
const _log = console.log; let salida = [];
const capturar = () => { salida = []; console.log = (...a) => {
  let i = 1; salida.push(String(a[0]).replace(/%s/g, () => String(a[i++]))); }; };
const soltar = () => { console.log = _log; return salida.join('\n'); };

capturar();
let res = registrarPH('333', 'https://script.google.com/macros/s/CCCC/exec', 'PH Los Robles');
soltar();
ok(res.ok === true && JSON.parse(PROPS.RUTEO_JSON)['333'].nombre === 'PH Los Robles', 'queda registrada');
post({ object: 'whatsapp_business_account', entry: [entrada('333', 'hola')] });
ok(ENVIOS.length === 1 && /CCCC/.test(ENVIOS[0].url), 'y sus mensajes ya se reparten');

capturar();
res = registrarPH('444', 'https://mi-servidor.com/webhook', 'PH Falso');
let txt = soltar();
ok(res.ok === false && /Apps Script/.test(txt),
   'una URL que no es de un despliegue de Apps Script se rechaza: ' + (/✗[^\n]*/.exec(txt) || [''])[0]);
ok(!JSON.parse(PROPS.RUTEO_JSON)['444'], 'y no se guarda');

capturar();
res = registrarPH('333', 'https://script.google.com/macros/s/DDDD/exec', 'PH Los Robles');
txt = soltar();
ok(JSON.parse(PROPS.RUTEO_JSON)['333'].url.indexOf('DDDD') >= 0, 'volver a registrarla actualiza la URL');
ok(/CCCC/.test(txt), 'y dice cuál era la anterior, por si el cambio fue un error: ' +
   (/La URL anterior[^\n]*/.exec(txt) || [''])[0]);

capturar(); res = quitarPH('333'); soltar();
ok(res.ok === true && !JSON.parse(PROPS.RUTEO_JSON)['333'], 'y se puede quitar');
post({ object: 'whatsapp_business_account', entry: [entrada('333', 'hola')] });
ok(ENVIOS.length === 0, 'sus mensajes dejan de repartirse');

console.log('\n── SIN HOJA CONFIGURADA NO SE CAE ──');
delete PROPS.ROUTER_SHEET_ID;
r = post({ object: 'whatsapp_business_account', entry: [entrada('111', 'x')] });
ok(r.__texto === '{"ok":true}' && ENVIOS.length === 1,
   'la bitácora es opcional: sin ella se reparte igual y queda el registro de ejecución');
PROPS.ROUTER_SHEET_ID = 'HOJA1';

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
