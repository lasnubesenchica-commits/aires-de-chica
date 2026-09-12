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

const path = require('path');
const RUTA = path.join(__dirname, '..', 'backend-aires') + path.sep;
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
  '   AC_CLAVES_CLIENTE: AC_CLAVES_CLIENTE })');

console.log('── UNA COPIA SIN CONFIGURAR NO HEREDA A NADIE ──');
PROPS = {};
let m = cargar();
ok(m.CONFIG.NEGOCIO === '' && m.CONFIG.RAZON_SOCIAL === '',
   'no se llama como la comunidad original');
ok(m.CONFIG.CUENTA_NUM === '' && m.CONFIG.BANCO === '' && m.CONFIG.CUENTA_NOMBRE === '',
   'y sobre todo NO trae su cuenta bancaria: ese era el riesgo de dejarla en el código');
ok(m.CONFIG.SHEET_ID === '', 'ni su hoja de cálculo');
ok(m.CONFIG.CUOTA_BASE === 0 && m.CONFIG.MORA_PCT === 0,
   'la cuota y la mora quedan en 0: sin configurar no cobra, en vez de cobrar de más');
ok(m.CONFIG.ANIO_ACTUAL === new Date().getFullYear(),
   'el año es el de hoy, no 0, que rompería todo cálculo: ' + m.CONFIG.ANIO_ACTUAL);
ok(m.CONFIG.MONEDA === 'B/.' && m.CONFIG.TZ === 'America/Panama',
   'moneda y zona horaria sí quedan: son de Panamá y no cambian entre copias');

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
ok(m.CONFIG.ADMIN_EMAIL === '', 'y lo que no tiene propiedad queda vacío, no heredado');

console.log('\n── UNA PROPIEDAD ROTA NO SE TRAGA ──');
PROPS = { AC_CUOTA_BASE: '45', AC_CABANA_FEE: 'trece con cincuenta' };
m = cargar();
ok(m.CONFIG.CUOTA_BASE === 45, 'la buena entra: ' + m.CONFIG.CUOTA_BASE);
ok(m.CONFIG.CABANA_FEE === 0,
   'y un número ilegible se ignora en vez de meter NaN en los cálculos de cobro');

console.log('\n── SIN PERMISO PARA LEER PROPIEDADES, EL SISTEMA NO SE CAE ──');
const guardado = global.PropertiesService;
global.PropertiesService = { getScriptProperties: () => { throw new Error('sin autorizar'); } };
m = cargar();
global.PropertiesService = guardado;
ok(m.CONFIG.TZ === 'America/Panama' && m.CONFIG.NEGOCIO === '',
   'no revienta: una página pública de comunicados no puede caerse por esto');

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

console.log('\n── CONFIGURAR UNA COPIA LA DEJA INDEPENDIENTE ──');
PROPS = {}; m = cargar();
capturar();
m.configurarCliente({ NEGOCIO: 'PH Las Palmas', RAZON_SOCIAL: 'PH Las Palmas',
  SHEET_ID: 'HOJA-PALMAS', ADMIN_EMAIL: 'admin@palmas.com', REPLY_TO: 'admin@palmas.com',
  COMPROBANTES_EMAIL: 'pagos@palmas.com', WEBAPP_URL: 'https://script.google.com/x/exec',
  BANCO: 'Banistmo', CUENTA_TIPO: 'Cuenta corriente', CUENTA_NUM: '01-234-567890',
  CUENTA_NOMBRE: 'PH Las Palmas', CUOTA_BASE: 85, ANIO_ACTUAL: 2026 });
soltar();
m = cargar();
capturar(); r = m.verConfiguracionCliente(); txt = soltar();
ok(r.faltan.length === 0, 'no le falta nada obligatorio');
ok(/Lo obligatorio está puesto/.test(txt), 'y el informe lo confirma');
ok(/Opcionales sin poner: .*LOGO_URL/.test(txt),
   'distinguiendo lo que falta de verdad de lo que simplemente no se puso');
ok(m.CONFIG.CUENTA_NUM === '01-234-567890' && m.CONFIG.CUOTA_BASE === 85,
   'con su cuenta y su cuota, sin rastro de ninguna otra comunidad');

console.log('\n── EL INFORME DICE DE DÓNDE SALE CADA VALOR ──');
PROPS = { AC_NEGOCIO: 'PH Las Palmas' }; m = cargar();
capturar(); r = m.verConfiguracionCliente(); txt = soltar();
ok(/✓ NEGOCIO/.test(txt) && /PH Las Palmas/.test(txt), 'marca con ✓ lo que está puesto');
ok(/✗ SHEET_ID +— FALTA —/.test(txt),
   'y con ✗ lo obligatorio que falta, que es lo que hay que ir a arreglar');
ok(/· LOGO_URL +\(sin poner\)/.test(txt),
   'lo opcional se distingue de lo que falta: ' + (/· LOGO_URL[^\n]*/.exec(txt)||[''])[0]);
ok(!/%-?\d*s/.test(txt),
   'y ningún marcador de formato sale impreso: Apps Script sólo entiende «%s» a secas');
// La clave ocupa 18 caracteres desde la posición 2, así que el valor empieza siempre
// en la 21 — da igual que la clave se llame NEGOCIO o COMPROBANTES_EMAIL.
// Sólo las filas de claves: el resumen de abajo también empieza por ✗ y colaba.
const filas = txt.split('\n').filter(l => /^[✓·✗] [A-Z_]+ /.test(l));
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
