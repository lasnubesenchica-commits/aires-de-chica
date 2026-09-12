// La configuración por copia: que CONFIG obedezca a las propiedades y que nadie pueda
// dejar una copia apuntando a la cuenta bancaria de otra comunidad.
const fs = require('fs');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let PROPS = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperties: () => JSON.parse(JSON.stringify(PROPS)),
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  setProperties: (o) => { Object.keys(o).forEach(k => { PROPS[k] = o[k]; }); }
}) };

const RUTA = '/home/user/aires-de-chica/backend-aires/';
const fuente = fs.readFileSync(RUTA + 'Code.js', 'utf8');
// Sólo el bloque de CONFIG: el resto de Code.js es el router y arrastraría medio sistema.
const bloque = fuente.slice(fuente.indexOf('var CONFIG = (function'),
                            fuente.indexOf('\n})();\n') + 7);
const cliente = fs.readFileSync(RUTA + 'AiresChica_Cliente.gs', 'utf8');

// El console.log de Apps Script, imitado con exactitud: sustituye «%s» a secas y NADA
// más. Un «%-18s» sale impreso literal y los argumentos sobrantes se pegan al final.
// El falso anterior aceptaba el relleno y por eso dejó pasar un informe ilegible.
const fmt = (...a) => {
  if (a.length < 2) return a.map(String).join(' ');
  let i = 1;
  const txt = String(a[0]).replace(/%s/g, () => (i < a.length ? String(a[i++]) : '%s'));
  const sobran = a.slice(i).map(String);
  return sobran.length ? txt + ' ' + sobran.join(' ') : txt;
};
let salida = [];
const _log = console.log;
const capturar = () => { salida = []; console.log = (...a) => salida.push(fmt(...a)); };
const soltar = () => { console.log = _log; return salida.join('\n'); };

// Sin declarar CONFIG fuera: el bloque real lo declara con var y chocarían.
const cargar = () => eval(bloque + '\n' + cliente +
  '\n({ CONFIG: CONFIG, verConfiguracionCliente: verConfiguracionCliente,' +
  '   configurarCliente: configurarCliente,' +
  '   sembrarConfiguracionDesdeCodigo: sembrarConfiguracionDesdeCodigo,' +
  '   AC_CLAVES_CLIENTE: AC_CLAVES_CLIENTE })');

console.log('── SIN PROPIEDADES, EL CÓDIGO ES EL RESPALDO ──');
PROPS = {};
let m = cargar();
ok(m.CONFIG.NEGOCIO === 'Aires de Chicá', 'usa lo que hay en el código: ' + m.CONFIG.NEGOCIO);
ok(m.CONFIG.CUOTA_BASE === 45, 'incluidos los números: ' + m.CONFIG.CUOTA_BASE);

console.log('\n── UNA PROPIEDAD MANDA SOBRE EL CÓDIGO ──');
PROPS = { AC_NEGOCIO: 'PH Las Palmas', AC_CUENTA_NUM: '99-88-77',
          AC_CUOTA_BASE: '85.5', AC_ANIO_ACTUAL: '2027' };
m = cargar();
ok(m.CONFIG.NEGOCIO === 'PH Las Palmas', 'el nombre viene de la propiedad: ' + m.CONFIG.NEGOCIO);
ok(m.CONFIG.CUENTA_NUM === '99-88-77',
   'y la cuenta de cobro también — es lo que impide que una copia cobre a la cuenta de otra');
ok(m.CONFIG.CUOTA_BASE === 85.5 && typeof m.CONFIG.CUOTA_BASE === 'number',
   'los números llegan como número, no como texto: ' + JSON.stringify(m.CONFIG.CUOTA_BASE));
ok(m.CONFIG.ANIO_ACTUAL === 2027, 'el año también: ' + m.CONFIG.ANIO_ACTUAL);
ok(m.CONFIG.ADMIN_EMAIL === 'admin@airesdechica.org',
   'lo que no tiene propiedad sigue saliendo del código');

console.log('\n── UNA PROPIEDAD ROTA NO PISA EL RESPALDO ──');
PROPS = { AC_CUOTA_BASE: 'cuarenta y cinco', AC_NEGOCIO: '   ' };
m = cargar();
ok(m.CONFIG.CUOTA_BASE === 45,
   'un número ilegible se ignora en vez de dejar la cuota en 0: ' + m.CONFIG.CUOTA_BASE);
ok(m.CONFIG.NEGOCIO === 'Aires de Chicá', 'y una propiedad vacía tampoco borra el nombre');

console.log('\n── SIN PERMISO PARA LEER PROPIEDADES, EL SISTEMA NO SE CAE ──');
const guardado = global.PropertiesService;
global.PropertiesService = { getScriptProperties: () => { throw new Error('sin autorizar'); } };
m = cargar();
global.PropertiesService = guardado;
ok(m.CONFIG.NEGOCIO === 'Aires de Chicá',
   'sigue con el respaldo: una página pública no puede reventar por esto');

console.log('\n── ESCRIBIR LA CONFIGURACIÓN DE UNA COPIA ──');
PROPS = {}; m = cargar();
capturar();
let r = m.configurarCliente({ NEGOCIO: 'PH Las Palmas', CUENTA_NUM: '99-88-77', CUOTA_BASE: 85.5 });
soltar();
ok(r.ok === true && r.escritas === 3, 'escribe las tres: ' + r.escritas);
ok(PROPS.AC_NEGOCIO === 'PH Las Palmas' && PROPS.AC_CUENTA_NUM === '99-88-77',
   'con el prefijo AC_, para no chocar con las de Meta ni las de Anthropic');
ok(PROPS.AC_CUOTA_BASE === '85.5', 'y los números guardados como texto, que es lo único que admite');

console.log('\n── UNA CLAVE MAL ESCRITA NO SE GUARDA EN SILENCIO ──');
PROPS = {}; m = cargar();
capturar();
r = m.configurarCliente({ NEGOCIO: 'PH Las Palmas', CUENTA_NUMERO: '99-88-77' });
let txt = soltar();
ok(r.ok === false && /CUENTA_NUMERO/.test(txt), 'dice cuál no existe: ' + /✗[^\n]*/.exec(txt));
ok(Object.keys(PROPS).length === 0,
   'y NO escribe la mitad: una copia a medio configurar es peor que una sin configurar');

console.log('\n── UN NÚMERO QUE NO ES NÚMERO SE RECHAZA ──');
PROPS = {}; m = cargar();
capturar();
r = m.configurarCliente({ CUOTA_BASE: 'ochenta' });
txt = soltar();
ok(r.ok === false && /tienen que ser números/.test(txt), 'lo dice antes de guardarlo');
ok(Object.keys(PROPS).length === 0, 'y no escribe nada');

console.log('\n── SEMBRAR DESDE EL CÓDIGO ──');
PROPS = {}; m = cargar();
capturar(); r = m.sembrarConfiguracionDesdeCodigo(); soltar();
ok(r.escritas > 10, 'copia la configuración actual a propiedades: ' + r.escritas + ' claves');
ok(PROPS.AC_SHEET_ID && PROPS.AC_CUENTA_NUM === '04-02-98-706290-3',
   'con los valores que hoy están en el código, sin cambiar ninguno');
m = cargar();
ok(m.CONFIG.NEGOCIO === 'Aires de Chicá' && m.CONFIG.CUOTA_BASE === 45,
   'y el sistema sigue viendo exactamente lo mismo que antes: la migración no cambia nada');

console.log('\n── SEMBRAR DOS VECES NO PISA LO QUE YA ESTABA ──');
PROPS.AC_NEGOCIO = 'PH Las Palmas';
capturar(); r = m.sembrarConfiguracionDesdeCodigo(); txt = soltar();
ok(PROPS.AC_NEGOCIO === 'PH Las Palmas',
   'una copia ya configurada no vuelve a llamarse como la comunidad original');
ok(/no se tocan/.test(txt) && /NEGOCIO/.test(txt), 'y se dice cuáles se respetaron');

console.log('\n── EL INFORME DICE DE DÓNDE SALE CADA VALOR ──');
PROPS = { AC_NEGOCIO: 'PH Las Palmas' }; m = cargar();
capturar(); r = m.verConfiguracionCliente(); txt = soltar();
ok(/✓ NEGOCIO/.test(txt) && /PH Las Palmas/.test(txt), 'marca con ✓ lo que viene de propiedades');
ok(/· SHEET_ID/.test(txt) && /CÓDIGO/.test(txt), 'y señala lo que todavía sale del código');
ok(!/%-?\d*s/.test(txt),
   'y ningún marcador de formato sale impreso: Apps Script sólo entiende «%s» a secas');
// La clave ocupa 18 caracteres desde la posición 2, así que el valor empieza siempre
// en la 21 — da igual que la clave se llame NEGOCIO o COMPROBANTES_EMAIL.
const filas = txt.split('\n').filter(l => /^[✓·] /.test(l));
ok(filas.length === 19 && filas.every(l => l[20] === ' ' && l[21] && l[21] !== ' '),
   'los valores arrancan todos en la misma columna, con clave corta o larga');
ok(r.faltan.indexOf('SHEET_ID') >= 0, 'y enumera lo obligatorio que falta: ' + r.faltan.length + ' claves');

console.log('\n── LAS OBLIGATORIAS SON LAS QUE ROMPEN COBROS O ENVÍOS ──');
const req = m.AC_CLAVES_CLIENTE.filter(c => c.req).map(c => c.k);
['NEGOCIO','SHEET_ID','CUENTA_NUM','CUENTA_NOMBRE','BANCO','ADMIN_EMAIL','WEBAPP_URL','CUOTA_BASE']
  .forEach(k => ok(req.indexOf(k) >= 0, k + ' es obligatoria'));
ok(m.AC_CLAVES_CLIENTE.every(c => ['MONEDA','TZ'].indexOf(c.k) < 0),
   'moneda y zona horaria no son por cliente: son de Panamá y no cambian entre comunidades');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
