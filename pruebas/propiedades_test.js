// Las propiedades del script, cuando el editor ya no las enseña.
//
// Pasado de 50 propiedades, la pantalla de Apps Script muestra sólo las primeras 50 por
// orden alfabético y se vuelve de sólo lectura. Con los AC_* ocupando el cupo, META_BOT
// queda invisible y no hay manera de tocarlo desde la interfaz. Estas dos funciones son
// la salida, y lo que se afirma aquí es lo único que las hace seguras de usar: que un
// token no acaba impreso en un registro que alguien va a copiar y pegar.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let PROPS = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperties: () => JSON.parse(JSON.stringify(PROPS)),
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  setProperty: (k, v) => { PROPS[k] = v; } }) };

// Sólo el bloque de estas dos funciones: el resto de Config.gs arrastra medio sistema.
const fuente = fs.readFileSync(
  path.join(__dirname, '..', 'backend-aires', 'AiresChica_Config.gs'), 'utf8');
eval(fuente.slice(fuente.indexOf('function verPropiedades')));

// La consola de Apps Script, capturada para poder mirar lo que se imprimió.
let salida = [];
const _log = console.log;
const fmt = (...a) => { let i = 1; return String(a[0]).replace(/%s/g, () => String(a[i++])); };
const capturar = () => { salida = []; console.log = (...a) => salida.push(a.length > 1 ? fmt(...a) : String(a[0])); };
const soltar = () => { console.log = _log; return salida.join('\n'); };

const TOKEN = 'EAAG' + 'x'.repeat(200);
PROPS = {
  AC_UNIDAD: 'lote',
  AC_SHEET_ID: '1S-mea6zy87PwYFuwtbb4hqHX8LaK7sHW4',
  META_BOT: 'prueba',
  META_WHATSAPP_TOKEN: TOKEN,
  ANTHROPIC_API_KEY: 'sk-ant-api03-secretisimo',
  GOOGLE_REFRESH_TOKEN: '1//04-refresh-secreto',
  AUTH_RESET_TOKEN: 'reset-secreto'
};

console.log('── LOS SECRETOS NO SE IMPRIMEN ──');
// Este registro se copia y se pega en un chat o en un correo. Un token pegado ahí es un
// token que hay que rotar, y ya nos pasó una vez con el de BalanceClip.
capturar();
verPropiedades();
let txt = soltar();
ok(txt.indexOf(TOKEN) < 0, 'el token de WhatsApp no aparece entero');
ok(txt.indexOf('sk-ant-api03-secretisimo') < 0, 'ni la clave de Anthropic');
ok(txt.indexOf('1//04-refresh-secreto') < 0, 'ni el refresh de Google');
ok(txt.indexOf('reset-secreto') < 0, 'ni el token de reseteo de contraseña');
ok(/META_WHATSAPP_TOKEN = \(puesta · 204 caracteres, oculta\)/.test(txt),
   'pero se ve que ESTÁ puesta y cuánto mide: distinguir «vacía» de «oculta» es el punto');

console.log('\n── LO DEMÁS SÍ SE VE ──');
ok(/META_BOT = prueba/.test(txt), 'el modo del bot, que es justo lo que el editor esconde');
ok(/AC_UNIDAD = lote/.test(txt), 'y la configuración normal');
ok(/7 PROPIEDADES/.test(txt), 'con el total, para saber si el editor se está quedando corto');

capturar();
verPropiedades('META');
txt = soltar();
ok(/META_BOT/.test(txt) && !/AC_UNIDAD/.test(txt),
   'el filtro deja sólo lo que se busca, que con 50+ propiedades es la única forma de mirar');

console.log('\n── EL MODO DEL BOT SE CAMBIA SIN LA INTERFAZ ──');
capturar(); ponerModoBot('activo'); soltar();
ok(PROPS.META_BOT === 'activo', 'activo se guarda: ' + PROPS.META_BOT);
capturar(); ponerModoBot('prueba'); soltar();
ok(PROPS.META_BOT === 'prueba', 'prueba también');
capturar(); ponerModoBot('apagado'); soltar();
ok(PROPS.META_BOT === '', 'y «apagado» se guarda como vacío, que es lo que el código lee');

let cortó = false;
try { capturar(); ponerModoBot('encendido'); } catch (e) { cortó = /no válido/.test(e.message); }
soltar();
ok(cortó, 'un modo inventado se rechaza en vez de dejar el bot mudo sin avisar');
ok(PROPS.META_BOT === '', 'y no se escribe nada cuando se rechaza');

console.log(mal ? '\n✗ ' + mal + ' fallos' : '\n✓ todo en orden');
process.exit(mal ? 1 : 0);
