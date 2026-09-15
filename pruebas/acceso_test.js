// El módulo de control de acceso: el núcleo.
//
// Tres cosas importan más que las demás. Una: que a una visita se le pregunte a quien
// de verdad está en la casa, y no al número de cobro del padrón. Otra: que el tope de
// cinco contactos se cumpla en el dato y no en el panel. Y la tercera: que la foto de
// la cédula de un tercero se borre sola a los 90 días, que es lo que exige la Ley 81
// y lo único de todo el sistema que guarda datos de alguien que nunca firmó nada.
process.env.TZ = 'America/Panama';

const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let HOJAS, PADRON, REGISTRO, DRIVE, TRIGGERS, SALIDA;
// La carpeta de Drive de mentira. Hace falta de verdad porque la purga ya NO recorre
// las filas: barre la carpeta, que es lo único que encuentra las fotos huérfanas —las
// de una lectura que falló y nunca llegó a escribirse en ninguna visita.
let ARCHIVOS, CARPETA_CREADA;

function reiniciar() {
  HOJAS = {};
  REGISTRO = [];
  DRIVE = {};
  ARCHIVOS = [];
  CARPETA_CREADA = false;
  TRIGGERS = [];
  PADRON = [
    { clave: 'Q-9',  nombre: 'Ana Rosa Tejada', celular: '+50769812266' },
    // Caso real del padrón: la dueña del lote 14 tiene un número de Estados Unidos.
    { clave: 'L-14', nombre: 'Judith Araúz',    celular: '+14086077860' },
    { clave: 'Q-30', nombre: 'Sin Celular',     celular: '' }
  ];
}

// ── una hoja de cálculo de mentira, con lo justo ──────────────────────────────
function hoja(nombre) {
  if (!HOJAS[nombre]) return null;
  const H = HOJAS[nombre];
  return {
    getLastRow: () => H.length,
    getMaxRows: () => Math.max(H.length + 50, 100),
    getDataRange: () => ({ getValues: () => H.map(f => f.slice()) }),
    appendRow: f => { H.push(f.slice()); },
    deleteRow: n => { H.splice(n - 1, 1); },
    setFrozenRows: () => {},
    getRange: (fila, col, nf, nc) => ({
      setValues: vs => { vs.forEach((v, i) => { H[fila - 1 + i] = v.slice(); }); },
      setValue: v => { H[fila - 1][col - 1] = v; },
      setFontWeight() { return this; }, setBackground() { return this; },
      setFontColor() { return this; }, setNumberFormat() { return this; }
    })
  };
}
global._ss = () => ({
  getSheetByName: n => hoja(n),
  insertSheet: n => { HOJAS[n] = []; return hoja(n); }
});
global._sheetRows = (nombre) => {
  const H = HOJAS[nombre];
  if (!H || H.length < 2) return [];
  const hdr = H[0].map(x => String(x).trim());
  return H.slice(1).filter(f => f.join('') !== '')
          .map(f => Object.fromEntries(hdr.map((h, i) => [h, f[i]])));
};
global._reg = (accion, d) => { REGISTRO.push({ accion, ...d }); return 'R1'; };
global._fechaCorta = d => new Date(d).toISOString().slice(0, 10);
global._findProp = clave => PADRON.find(p => p.clave === String(clave).trim()) || null;
global.Logger = { log: () => {} };

// normalizarCelular de verdad hace mucho más; aquí basta con que deje los números
// en la misma forma, porque lo que se comprueba es que el guardia se reconozca
// venga escrito «6981-2266» o «50769812266».
global.normalizarCelular = (raw) => {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { ok: false, e164: '', por: 'está vacío' };
  const d = s.replace(/\D/g, '');
  if (d.length < 7) return { ok: false, e164: '', por: 'tiene muy pocos dígitos' };
  if (d.length === 8) return { ok: true, e164: '+507' + d };
  return { ok: true, e164: '+' + d };
};

/** Mete un archivo en la carpeta de mentira, con su fecha de creación. */
function ponerArchivo(id, creado) {
  DRIVE[id] = true;
  ARCHIVOS.push({ id: id, nombre: 'doc-' + id + '.jpg', creado: creado });
  CARPETA_CREADA = true;
  return 'https://drive.google.com/file/d/' + id + '/view';
}
const CARPETA = {
  createFile: b => {
    // Un id del largo real. Con ids cortos, _accIdDeDrive no los reconoce y la prueba
    // pasa por el camino equivocado: es la misma trampa anotada más abajo.
    const id = 'FILE' + String(ARCHIVOS.length + 1).padStart(2, '0') +
               'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123'.slice(0, 29);
    ponerArchivo(id, new Date());
    return { getUrl: () => 'https://drive.google.com/file/d/' + id + '/view', getId: () => id };
  },
  // Sólo los vivos: un archivo en la papelera ya no sale del iterador, igual que en Drive.
  getFiles: () => {
    const vivos = ARCHIVOS.filter(a => DRIVE[a.id]);
    let i = 0;
    return { hasNext: () => i < vivos.length,
             next: () => { const a = vivos[i++];
               return { getId: () => a.id, getName: () => a.nombre,
                        getDateCreated: () => a.creado }; } };
  }
};
global.DriveApp = {
  getFileById: id => {
    if (!(id in DRIVE)) throw new Error('archivo no encontrado');
    return { setTrashed: v => { DRIVE[id] = !v; } };
  },
  getFoldersByName: () => ({ hasNext: () => CARPETA_CREADA, next: () => CARPETA }),
  createFolder: () => { CARPETA_CREADA = true; return CARPETA; }
};
global.ScriptApp = {
  getProjectTriggers: () => TRIGGERS.slice(),
  newTrigger: (fn) => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({
    create: () => { TRIGGERS.push({ getHandlerFunction: () => fn }); } }) }) }) })
};
global.moduloActivo = () => true;
global.CONFIG = { TZ: 'America/Panama' };
// Sólo los dos formatos que el módulo pide. Con la TZ fijada arriba a Panamá, formatear
// con las funciones locales de Date da lo mismo que Utilities en el Apps Script real.
global.Utilities = { formatDate: (d, tz, fmt) => {
  const p = n => (n < 10 ? '0' : '') + n;
  const base = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  return fmt.indexOf('HH:mm') >= 0 ? base + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : base;
} };
// La palabra de la unidad vive en AiresChica_Cliente.gs; aquí basta con que exista.
global._acUnidad = () => 'lote';
global._acPlural = p => (/[aeiou]$/i.test(p) ? p + 's' : p + 'es');
global.getPropietarios = () => PADRON.slice();

// ── el WhatsApp de mentira: se guarda lo que se le habría mandado al guardia ──
let ENVIADO, CLAUDE, PLANTILLAS = [];
const reiniciarWA = () => { ENVIADO = []; MODELOS = []; PLANTILLAS = []; };
global.enviarWhatsAppTexto = (tel, texto) => { ENVIADO.push({ tel, texto, botones: null }); return { ok: true }; };
global._waEnviarBotones = (tel, texto, botones) => { ENVIADO.push({ tel, texto, botones }); return { ok: true }; };
global._botBoton = (id, titulo) => ({ type: 'reply', reply: { id, title: titulo } });
global._waEnviarLista = (tel, texto, btn, secciones) => {
  ENVIADO.push({ tel, texto, botones: null, lista: secciones }); return { ok: true };
};
global._waBajarMedia = () => ({ ok: true, tipo: 'image/jpeg', blob: {
  getBytes: () => [1, 2, 3], getContentType: () => 'image/jpeg', setName() { return this; } } });
global._acUn = () => 'un';
global._acEl = () => 'el';
global._acNingun = () => 'ningún';

// Claude de mentira. CLAUDE es lo que se quiere que «devuelva» el modelo; poniéndolo a
// null se prueba el camino sin clave de API, que es el que corre si Anthropic falla.
global.ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
global.ANTHROPIC_MODEL = 'claude-haiku-4-5';
global._anthropicKey = () => (CLAUDE === null ? '' : 'sk-prueba');
global._parseJsonLoose = t => { try { return JSON.parse(t); } catch (e) { return null; } };
// CLAUDE puede ser un objeto —el modelo contesta siempre lo mismo— o una lista, y
// entonces cada llamada se lleva el siguiente: así se prueba el reintento con el modelo
// bueno, que es lo que distingue una lectura mala de una lectura mala DETECTADA.
let MODELOS = [];
global.UrlFetchApp = { fetch: (url, opt) => {
  let p = {}; try { p = JSON.parse((opt || {}).payload || '{}'); } catch (e) {}
  MODELOS.push(p.model);
  const r = Array.isArray(CLAUDE) ? (CLAUDE[MODELOS.length - 1] || CLAUDE[CLAUDE.length - 1]) : CLAUDE;
  return { getResponseCode: () => 200,
           getContentText: () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(r) }] }) };
} };

let PROPS = {}, CACHE = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (PROPS[k] === undefined ? null : PROPS[k]),
  setProperty: (k, v) => { PROPS[k] = v; } }) };
global.CacheService = { getScriptCache: () => ({
  get: k => (CACHE[k] === undefined ? null : CACHE[k]),
  put: (k, v) => { CACHE[k] = v; },
  remove: k => { delete CACHE[k]; } }) };
const apuntes = () => String(PROPS.ACC_LECTURA_APUNTES || '');
global.Utilities.base64Encode = () => 'AAAA';

const _log = console.log;
const capturar = () => { SALIDA = []; console.log = (...a) => {
  let i = 1; SALIDA.push(String(a[0]).replace(/%s/g, () => String(a[i++]))); }; };
const soltar = () => { console.log = _log; return SALIDA.join('\n'); };

reiniciar();
eval(fs.readFileSync(path.join(__dirname, '..', 'backend-aires', 'AiresChica_Acceso.gs'), 'utf8'));

const falla = (fn, re, msg) => {
  let e = '';
  try { fn(); } catch (x) { e = x.message; }
  ok(re.test(e), msg + ' → ' + (e || '(no falló, y debía)'));
};

console.log('── LAS HOJAS SE CREAN SOLAS, Y SÓLO SI SE USAN ──');
reiniciar();
ok(Object.keys(HOJAS).length === 0, 'un PH que no contrató acceso no tiene ninguna hoja del módulo');
_accHojas();
ok(['Visitas', 'Autorizaciones', 'Garita', 'Contactos'].every(n => HOJAS[n]),
   'al usarlo aparecen las cuatro');
ok(HOJAS.Contactos[0].join(',') === ACC_COL_CONTAC.join(','), 'con su encabezado');

console.log('\n── A QUIÉN SE LE PREGUNTA ──');
reiniciar();
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266',
                  rol: 'propietario', autoriza: 'si', orden: 2 });
guardarContacto({ clave: 'Q-9', nombre: 'Carlos, el inquilino', celular: '6000-1111',
                  rol: 'inquilino', autoriza: 'si', orden: 1 });
let r = contactosQueAutorizan('Q-9');
ok(r.ok && r.contactos.length === 2, 'se devuelven los dos');
ok(r.contactos[0].nombre.indexOf('Carlos') === 0,
   'en el orden que puso la administración, no en el que se cargaron: ' + r.contactos[0].nombre);
ok(r.deRespaldo === false, 'y no se marca como respaldo, porque hay contactos de verdad');

console.log('\n── UNA UNIDAD SIN CONTACTOS NO SE QUEDA MUDA ──');
// Una copia recién vendida no tiene contactos cargados. Que el módulo no sirva el
// primer día sería peor que servir a medias.
r = contactosQueAutorizan('L-14');
ok(r.ok && r.contactos.length === 1 && r.deRespaldo === true,
   'cae al celular del padrón, y se marca como respaldo para que el panel lo avise');
ok(r.contactos[0].celular === '+14086077860',
   'aunque sea un número de Estados Unidos: el sistema no puede inventarse otro');
r = contactosQueAutorizan('Q-30');
ok(r.ok === false && /no tiene ningún contacto/.test(r.error),
   'y si tampoco hay celular en el padrón, lo dice claro en vez de devolver una lista vacía');

console.log('\n── EL TOPE DE CINCO SE CUMPLE EN EL DATO ──');
reiniciar();
for (let i = 1; i <= 5; i++) {
  guardarContacto({ clave: 'Q-9', nombre: 'Contacto ' + i, celular: '600011' + (10 + i),
                    autoriza: 'si', orden: i });
}
ok(contactosQueAutorizan('Q-9').contactos.length === 5, 'caben cinco');
falla(() => guardarContacto({ clave: 'Q-9', nombre: 'El sexto', celular: '6000-9999', autoriza: 'si' }),
      /tope/, 'el sexto se rechaza');
// Que no autorice sí se admite: hay gente a la que se le avisa sin darle el botón.
guardarContacto({ clave: 'Q-9', nombre: 'La abuela', celular: '6000-8888', autoriza: 'no' });
ok(getContactos('Q-9').length === 6 && contactosQueAutorizan('Q-9').contactos.length === 5,
   'pero uno que sólo recibe aviso no cuenta contra el tope');
// Y editar uno de los cinco no puede chocar consigo mismo.
const uno = getContactos('Q-9')[0];
guardarContacto({ id: uno.id, clave: 'Q-9', nombre: 'Contacto 1 corregido',
                  celular: uno.celular, autoriza: 'si', orden: 1 });
ok(getContactos('Q-9').filter(c => c.nombre === 'Contacto 1 corregido').length === 1,
   'editar uno de los cinco no lo cuenta dos veces');

console.log('\n── UN CONTACTO QUE AUTORIZA SIN CELULAR NO SIRVE ──');
reiniciar();
falla(() => guardarContacto({ clave: 'Q-9', nombre: 'Sin teléfono', autoriza: 'si' }),
      /necesita celular/, 'se rechaza');
falla(() => guardarContacto({ clave: 'Q-9', nombre: 'Mal número', celular: '123', autoriza: 'si' }),
      /no se puede usar/, 'y un número que no se entiende, también');

console.log('\n── EL GUARDIA SE RECONOCE VENGA COMO VENGA ESCRITO ──');
reiniciar();
guardarGarita({ nombre: 'Garita principal', celular: '6555-0101', turno: '24h' });
ok(esGuardia('50765550101') !== null, 'Meta manda 50765550101 y en la hoja dice 6555-0101');
ok(esGuardia('6555-0101') !== null, 'y también escrito como lo escribió la administración');
ok(esGuardia('+50765550101').nombre === 'Garita principal', 'devuelve el puesto, no sólo que sí');
ok(esGuardia('6981-2266') === null, 'un residente NO es guardia');
ok(esGuardia('') === null, 'y un número vacío tampoco');

// El caso que de verdad exige normalizar al LEER: una fila escrita a mano en la
// hoja, sin pasar por guardarGarita. La administración edita el Sheet directamente,
// y ahí el número queda como lo teclearon.
HOJAS.Garita.push(['GA-MANO', 'Garita trasera', '6555-0202', 'noche', 'si', 'escrita a mano', new Date()]);
ok(esGuardia('50765550202') !== null,
   'una garita tecleada a mano en la hoja también se reconoce cuando Meta manda el número largo');
ok(esGuardia('6555-0202').nombre === 'Garita trasera', 'y devuelve el puesto correcto');

const g = getGarita()[0];
guardarGarita({ id: g.id, nombre: g.nombre, celular: g.celular, activo: 'no' });
ok(esGuardia('6555-0101') === null,
   'una garita dada de baja deja de reconocerse: el turno se cierra y el número se reasigna');

console.log('\n── LEY 81: LA FOTO DE LA CÉDULA NO SE QUEDA ──');
reiniciar();
_accHojas();
const haceH = h => new Date(new Date().getTime() - h * 3600 * 1000);
// Ids de Drive del largo real (33 caracteres). Con ids cortos la prueba pasaba
// por el camino equivocado y no se veía que la foto seguía en Drive.
const ID_VIEJA = '1F62Z1LPLqrz0Efkq1diNhWrPMGdP9QsO';
const ID_NUEVA = '1n943waWOiseWJgKJbQLos5qv1hkTn5zJ';
const ID_HUERF = '1zzQ8kLmNvRt4YpXs2WdEc7BaHgJfKu1L';
const urlVieja = ponerArchivo(ID_VIEJA, haceH(100));
const urlNueva = ponerArchivo(ID_NUEVA, haceH(10));
// La huérfana: una lectura que falló. Se guardó antes de leerse y nunca llegó a
// escribirse en ninguna fila. La purga vieja recorría las filas, así que ésta no la
// encontraba NUNCA — justo la que más falta hacía borrar.
ponerArchivo(ID_HUERF, haceH(100));

HOJAS.Visitas.push(['V1', haceH(100), 'Q-9', '9', 'Luis Mendoza', '8-123-456', 'visita', '',
  'Garita principal', 'autorizada', 'Ana Rosa', haceH(100), urlVieja, '', '', '', haceH(100)]);
HOJAS.Visitas.push(['V2', haceH(10), 'Q-9', '9', 'Marta Ruiz', '8-999-111', 'visita', '',
  'Garita principal', 'autorizada', 'Ana Rosa', haceH(10), urlNueva, '', '', '', haceH(10)]);

capturar(); r = borrarFotosVencidas(); let txt = soltar();
ok(r.seBorrarian === 2 && DRIVE[ID_VIEJA] === true,
   'sin confirmar dice cuántas borraría y no borra ninguna: ' + r.seBorrarian);
ok(/irreversible/.test(txt), 'y avisa de que no tiene vuelta atrás');
ok(/72 horas/.test(txt), 'y dice el plazo en horas, no en meses: ' + (/Se guardan[^\n]*/.exec(txt) || [''])[0]);
// Lo que se le ofrece tiene que poder ejecutarse. El botón «Ejecutar» del editor no
// pasa argumentos —regla 1 de docs/apps-script-despliegue.md—, así que ofrecer
// «borrarFotosVencidas(true)» dejaba la función convertida en un mirador.
ok(/borrarFotosVencidasDeVerdad/.test(txt) && !/borrarFotosVencidas\(true\)/.test(txt),
   'y ofrece una función sin argumentos, no algo que en el editor no hay dónde escribir');
ok(typeof borrarFotosVencidasDeVerdad === 'function' && borrarFotosVencidasDeVerdad.length === 0,
   'que existe y no pide nada');

capturar(); r = borrarFotosVencidas(true); soltar();
ok(r.borradas === 2, 'confirmando borra las dos vencidas: ' + r.borradas);
ok(DRIVE[ID_VIEJA] === false, 'la de 100 horas se va a la papelera');
ok(DRIVE[ID_NUEVA] === true, 'y la de 10 horas se queda: el plazo son 72');
ok(DRIVE[ID_HUERF] === false && r.huerfanas === 1,
   'y la HUÉRFANA también, que es la que la purga por filas no encontraba nunca');
ok(HOJAS.Visitas.length === 3, 'la VISITA no se borra: quién entró y cuándo es un registro legítimo');
ok(String(HOJAS.Visitas[1][12]) === '' && HOJAS.Visitas[1][13] instanceof Date,
   'a la que sí tenía fila se le quita la URL y queda anotada la fecha de borrado');
capturar(); r = borrarFotosVencidas(true); soltar();
ok(r.borradas === 0, 'volver a correrlo no intenta borrar lo ya borrado');

console.log('\n── UNA LECTURA LIMPIA NO DEJA FOTO QUE BORRAR ──');
// El cambio de fondo: la imagen se lee y se borra en el acto. Lo que queda es el texto,
// que el guardia confirma con la cédula física en la mano. La purga es sólo para lo
// dudoso. Un competidor ataca por escrito a quien guarda la imagen del documento.
ok(_accFotoSeQueda({ visitante: 'Luis Mendoza', cedula: '8-123-456' }) === false,
   'una lectura buena no se queda');
ok(_accFotoSeQueda({ visitante: 'Luis', cedula: '8-1', floja: true }) === true,
   'una lectura floja sí: el texto no es de fiar y la imagen es el único respaldo');
ok(_accFotoSeQueda({ visitante: 'Luis', cedula: '8-123-456', discrepan: true }) === true,
   'y cuando los dos modelos no coincidieron en el número, también');
ok(_accFotoSeQueda(null) === true, 'y si no se pudo leer nada, con más razón');

console.log('\n── SI DRIVE FALLA, LA FILA NO MIENTE ──');
// Marcar la fila sin haber borrado el archivo sería decir que la foto ya no está cuando
// sigue en Drive. Es peor que no hacer nada: nadie vuelve a mirar una fila que dice
// «borrada», y el dato del tercero se queda ahí para siempre.
const ID_TERCA = '1QQw3eRt5YuI7oPaS9dFgH2jKlZxCvBnM';
const urlTerca = ponerArchivo(ID_TERCA, haceH(100));
HOJAS.Visitas.push(['V3', haceH(100), 'Q-9', '9', 'Pedro Solís', '8-777-222', 'visita', '',
  'Garita principal', 'autorizada', 'Ana Rosa', haceH(100), urlTerca, '', '', '', haceH(100)]);
const trashOriginal = global.DriveApp.getFileById;
global.DriveApp.getFileById = id => {
  if (id === ID_TERCA) return { setTrashed: () => { throw new Error('sin permiso'); } };
  return trashOriginal(id);
};
capturar(); r = borrarFotosVencidas(true); txt = soltar();
global.DriveApp.getFileById = trashOriginal;
ok(r.borradas === 0 && r.sinBorrar === 1,
   'un archivo que Drive no deja borrar no se cuenta como borrado');
ok(String(HOJAS.Visitas[3][13]) === '' && String(HOJAS.Visitas[3][12]) !== '',
   'su fila queda SIN marcar y con la URL puesta, para que el próximo intento vuelva por ella');
ok(/siguen en Drive/.test(txt), 'y lo dice en voz alta: ' + (/✗[^\n]*/.exec(txt) || [''])[0]);

console.log('\n── Y SE PUEDE DEJAR CORRIENDO SOLO ──');
reiniciar();
capturar(); instalarBorradoDeFotos(); soltar();
ok(TRIGGERS.length === 1 && TRIGGERS[0].getHandlerFunction() === 'purgaDiariaDeFotos',
   'queda un disparador diario');
capturar(); r = instalarBorradoDeFotos(); soltar();
ok(r.yaEstaba === true && TRIGGERS.length === 1,
   'instalarlo dos veces no crea dos: si no, borraría dos veces cada madrugada');

console.log('\n── EL DIAGNÓSTICO DICE QUÉ FALTA ──');
reiniciar();
capturar(); r = diagnosticarAcceso(); txt = soltar();
ok(/Sin garita registrada/.test(txt), 'sin garita, lo dice');
ok(/Sin contactos/.test(txt), 'sin contactos, también');
ok(/instalarBorradoDeFotos/.test(txt), 'y recuerda el borrado de fotos, que es el que nadie pide');
ok(r.purgaInstalada === false, 'y lo devuelve para que el panel pueda avisarlo');

global.moduloActivo = () => false;
capturar(); r = diagnosticarAcceso(); txt = soltar();
ok(r.activo === false && /NO contratado/.test(txt),
   'y si la comunidad no contrató el módulo, no finge que funciona');
global.moduloActivo = () => true;

console.log('\n── EL PRE-REGISTRO ──');
reiniciar();
const hoy  = new Date();
const masD = n => { const f = new Date(hoy); f.setDate(f.getDate() + n); return f; };
const iso  = f => f.getFullYear() + '-' + ('0'+(f.getMonth()+1)).slice(-2) + '-' + ('0'+f.getDate()).slice(-2);

guardarAutorizacion({ clave: 'Q-9', visitante: 'Luis Mendoza', cedula: '8-123-456',
                      desde: iso(hoy), hasta: iso(masD(3)), creadoPor: 'Ana Rosa' });
ok(getAutorizaciones('Q-9').length === 1, 'queda registrada');
falla(() => guardarAutorizacion({ clave: 'Q-9' }), /nombre del visitante/, 'sin visitante no se guarda');
falla(() => guardarAutorizacion({ visitante: 'X' }), /unidad/, 'sin unidad tampoco');
falla(() => guardarAutorizacion({ clave: 'Q-9', visitante: 'X', desde: iso(masD(5)), hasta: iso(hoy) }),
      /antes de empezar/, 'una vigencia al revés se rechaza');
falla(() => guardarAutorizacion({ clave: 'Q-9', visitante: 'Jardinero', recurrente: 'si' }),
      /necesita días/, 'una recurrente sin días, también');

console.log('\n── LA CÉDULA MANDA SOBRE EL NOMBRE ──');
let v = autorizacionVigente('Q-9', { cedula: '8-123-456', visitante: 'Luis Mendoza' });
ok(v && v.coincidencia === 'cedula' && v.firme === true, 'con la cédula correcta, coincidencia firme');
ok(autorizacionVigente('Q-9', { cedula: '8 123 456' }).coincidencia === 'cedula',
   'escrita con espacios en vez de guiones es la misma cédula');
ok(autorizacionVigente('Q-9', { cedula: '08-0123-0456' }) === null,
   'pero una cédula distinta no entra, aunque se parezca');
// Lo importante no es que el nombre no encuentre nada, es que no ABRA. Antes esto
// devolvía null y el guardia veía «sin permiso previo» aunque el permiso estuviera ahí:
// una respuesta falsa. Ahora lo encuentra y se lo enseña, pero sin firmar nada.
let soloNombre = autorizacionVigente('Q-9', { visitante: 'Luis Mendoza' });
ok(soloNombre && soloNombre.coincidencia === 'nombre',
   'el nombre solo SÍ encuentra el permiso: decirle al guardia que no hay ninguno era mentira');
ok(soloNombre && soloNombre.firme === false,
   'pero NO abre la puerta: firme=false, o sea «usted tiene el documento, decida»');
// Y el caso que de verdad hay que impedir: otra cédula no se salva con el nombre.
ok(autorizacionVigente('Q-9', { cedula: '8-999-999', visitante: 'Luis Mendoza' }) === null,
   'con una cédula DISTINTA el nombre no vale: por ahí es por donde alguien se colaría');

console.log('\n── CUANDO EL RESIDENTE SÓLO DEJÓ EL NOMBRE ──');
// Es el caso normal: casi nadie sabe la cédula de quien va a visitarlo.
guardarAutorizacion({ clave: 'Q-9', visitante: 'María Núñez', desde: iso(hoy), hasta: iso(masD(1)) });
v = autorizacionVigente('Q-9', { visitante: 'maria nunez' });
ok(v && v.coincidencia === 'nombre' && v.firme === false,
   'coincide por nombre sin tildes ni mayúsculas, y se marca como NO firme');
ok(v.firme === false, 'para que el guardia sepa que la coincidencia fue floja');

console.log('\n── LA VIGENCIA SE RESPETA ──');
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Luis Mendoza', cedula: '8-123-456',
                      desde: iso(hoy), hasta: iso(masD(2)) });
ok(autorizacionVigente('Q-9', { cedula: '8-123-456' }, masD(1)) !== null, 'dentro del plazo, entra');
ok(autorizacionVigente('Q-9', { cedula: '8-123-456' }, masD(5)) === null, 'pasado el plazo, no');
ok(autorizacionVigente('Q-9', { cedula: '8-123-456' }, masD(-1)) === null, 'y antes de empezar, tampoco');

console.log('\n── EL JARDINERO DE LOS MARTES ──');
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Jardinero', cedula: '4-777-888',
                      recurrente: 'si', dias: 'M', desde: iso(masD(-30)) });
// M = martes en ACC_DIAS_SEMANA (D L M X J V S). Se busca el próximo de cada día.
const proximo = n => { const f = new Date(hoy); f.setDate(f.getDate() + ((n - f.getDay() + 7) % 7)); return f; };
ok(autorizacionVigente('Q-9', { cedula: '4-777-888' }, proximo(2)) !== null, 'el martes entra');
ok(autorizacionVigente('Q-9', { cedula: '4-777-888' }, proximo(4)) === null, 'el jueves no');
ok(getAutorizaciones('Q-9')[0].hasta === null, 'y es un permiso sin vencimiento, que es lo que hace falta');

console.log('\n── EL GUARDIA NO SABE A QUÉ CASA VA ──');
// Tiene la cédula en la mano pero no la unidad. Sin clave, se busca en todas.
reiniciar();
guardarAutorizacion({ clave: 'Q-9',  visitante: 'Luis Mendoza', cedula: '8-123-456', desde: iso(hoy) });
guardarAutorizacion({ clave: 'L-14', visitante: 'Otro Señor',   cedula: '9-000-111', desde: iso(hoy) });
v = autorizacionVigente('', { cedula: '9-000-111' });
ok(v && v.autorizacion.clave === 'L-14', 'la encuentra y dice a qué unidad va: ' + (v && v.autorizacion.clave));
ok(autorizacionVigente('Q-9', { cedula: '9-000-111' }) === null,
   'pero preguntando por la unidad equivocada NO aparece');

console.log('\n── UNA AUTORIZACIÓN RETIRADA DEJA DE VALER ──');
const au = getAutorizaciones('Q-9')[0];
guardarAutorizacion({ id: au.id, clave: 'Q-9', visitante: au.visitante, cedula: au.cedula,
                      desde: iso(hoy), activo: 'no' });
ok(autorizacionVigente('Q-9', { cedula: '8-123-456' }) === null, 'desactivada, no abre');
eliminarAutorizacion(getAutorizaciones('L-14')[0].id);
ok(getAutorizaciones('L-14').length === 0, 'y se puede eliminar del todo');

console.log('\n── SIN NADA QUE COMPARAR NO SE INVENTA UNA COINCIDENCIA ──');
ok(autorizacionVigente('Q-9', {}) === null, 'sin cédula ni nombre, null');
ok(autorizacionVigente('Q-9', { cedula: '', visitante: '  ' }) === null, 'y con los dos en blanco, igual');

/* ═══════════════════════════════════════════════════════════════════════════
 * Lo que se lleva el panel
 * ═══════════════════════════════════════════════════════════════════════════ */

console.log('\n── LAS DOS FECHAS NO SON LA MISMA CLASE DE DATO ──');
// La de una autorización vuelve al formulario para editarse: tiene que ser AAAA-MM-DD,
// que es lo único que un <input type="date"> entiende. La de una visita es una etiqueta
// que lee una persona, y necesita la HORA: saber que alguien entró «el 12/09» y no a qué
// hora no sirve para nada la noche que haya que reconstruir qué pasó.
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Luis Mendoza', cedula: '8-123-456',
                      desde: '2026-09-12', hasta: '2026-12-31' });
let d = getAccesoData('');
ok(d.autorizaciones[0].desde === '2026-09-12',
   'la autorización viaja en ISO, lista para volver al formulario: ' + d.autorizaciones[0].desde);
ok(d.autorizaciones[0].hasta === '2026-12-31', 'las dos fechas igual');

_accHojas();
HOJAS.Visitas.push(['V1', new Date(2026, 8, 11, 21, 35, 0), 'Q-9', '9', 'Pedro Ruiz',
                    '8-999-111', 'Visita', '', '+50760000000', 'autorizada', 'Ana Rosa',
                    new Date(2026, 8, 11, 21, 36, 0), 'https://drive/x', '', '', '', new Date()]);
d = getAccesoData('');
ok(d.visitas[0].fecha === '11/09/2026 21:35',
   'la visita trae fecha Y hora, en el formato que se lee aquí: ' + d.visitas[0].fecha);
ok(d.visitas[0].salida === '', 'y lo que no hay viene vacío, no como «—»: el panel decide cómo pintarlo');
ok(d.visitas[0].tieneFoto === true && d.visitas[0].fotoUrl === undefined,
   'la foto se anuncia, pero su enlace NO sale del servidor: es la cédula de un tercero');

console.log('\n── UNA AUTORIZACIÓN SIN FECHA NO SE INVENTA UNA ──');
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Jardinero', recurrente: 'si', dias: 'M' });
d = getAccesoData('');
ok(d.autorizaciones[0].hasta === '',
   'sin vencimiento devuelve cadena vacía, no un guion: un «—» en un campo de fecha es una ' +
   'fecha inválida que el navegador descarta en silencio → ' + JSON.stringify(d.autorizaciones[0].hasta));

console.log('\n── LA BITÁCORA VIENE DE LA MÁS RECIENTE A LA MÁS VIEJA, Y ACOTADA ──');
reiniciar();
_accHojas();
for (let i = 1; i <= 130; i++) {
  HOJAS.Visitas.push(['V' + i, new Date(2026, 0, 1, 8, 0, 0), 'Q-9', '9', 'Visita ' + i,
                      '', '', '', '', 'autorizada', '', '', '', '', '', '', new Date()]);
}
d = getAccesoData('');
ok(d.visitas.length === 100,
   'con 130 visitas se devuelven cien: la hoja entera serían cientos de kilobytes en cada ' +
   'apertura de la pestaña → ' + d.visitas.length);
ok(d.visitas[0].id === 'V130', 'y la primera es la última que entró: ' + d.visitas[0].id);
ok(d.visitas[99].id === 'V31', 'la última de la lista es la más vieja de las cien: ' + d.visitas[99].id);

console.log('\n── EL PANEL SE ENTERA DE LO QUE FALTA, NO LO DESCUBRE EL GUARDIA ──');
reiniciar();
d = getAccesoData('');
const textos = d.avisos.map(a => a.texto).join(' | ');
ok(d.avisos.some(a => a.tipo === 'error' && /garita/i.test(a.texto)),
   'sin garita registrada es un ERROR, no un aviso: sin eso ningún guardia puede usar el sistema');
ok(d.avisos.some(a => a.tipo === 'error' && /Ley 81/.test(a.texto)),
   'y que el borrado de fotos no esté instalado, también: la ley no es opcional');
ok(d.sinContactos.length === 3 && d.avisos.some(a => /sin contactos de acceso/.test(a.texto)),
   'las tres unidades del padrón salen sin contactos, con su aviso: ' + d.sinContactos.length);
ok(/lotes/.test(textos),
   'el aviso habla en la palabra de ESTA comunidad, en plural: un PH de apartamentos no ' +
   'tiene «lotes» → ' + textos.slice(0, 60));

console.log('\n── UN PERMISO QUE NADIE RECUERDA HABER DADO SE CUENTA APARTE ──');
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
instalarBorradoDeFotos();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Jardinero', recurrente: 'si', dias: 'M' });
d = getAccesoData('');
ok(d.avisos.some(a => /sin fecha de vencimiento/.test(a.texto)),
   'una autorización sin «hasta» se avisa aunque todo lo demás esté en orden');
ok(!d.avisos.some(a => /garita/i.test(a.texto)) && !d.avisos.some(a => /Ley 81/.test(a.texto)),
   'y los dos errores desaparecen cuando se resuelven, en vez de quedarse pegados');
ok(d.sinContactos.length === 2 && d.sinContactos.every(s => s.clave !== 'Q-9'),
   'Q-9 sale de la lista de pendientes al cargarle un contacto que autoriza');
ok(d.purgaInstalada === true, 'y el panel sabe que la purga quedó instalada');
// El padrón ENTERO, no sólo las unidades pendientes: el formulario de un contacto o de
// un permiso tiene que poder escoger cualquiera. El panel lo sacaba de getPropietarios,
// que es del módulo FINANCIERO — así que una comunidad que sólo contrató el acceso se
// quedaba con un desplegable vacío y claves en bruto donde debería leer nombres.
ok(d.unidades.length === 3 && d.unidades.some(u => u.clave === 'Q-9'),
   'las tres unidades del padrón viajan en getAcceso, incluida la que ya tiene contacto: ' + d.unidades.length);
ok(d.unidades.every(u => u.nombre), 'cada una con su nombre, que es lo que se lee en el desplegable');

console.log('\n── UN NÚMERO QUE ES GARITA Y RESIDENTE A LA VEZ SE DICE ──');
// El caso del piloto: el administrador pone su propio número como garita para probar,
// y ese número ya está en el padrón. Es legítimo mientras se prueba —no se bloquea—
// pero tiene una consecuencia que nadie relacionaría solo: esGuardia() gana, y a ese
// número el bot deja de contestarle su estado de cuenta.
reiniciar();
guardarGarita({ nombre: 'Garita principal', celular: '6981-2266' });   // = celular de Q-9
d = getAccesoData('');
ok(d.avisos.some(a => /también el de/.test(a.texto) && /Ana Rosa Tejada/.test(a.texto)),
   'el panel dice de quién es el número y qué va a pasar: ' +
   (d.avisos.filter(a => /también el de/.test(a.texto))[0] || {}).texto);
ok(esGuardia('+50769812266') !== null,
   'y no se bloquea: sigue siendo garita, porque probar así es legítimo');

reiniciar();
guardarGarita({ nombre: 'Garita principal', celular: '6000-9999' });
ok(!getAccesoData('').avisos.some(a => /también el de/.test(a.texto)),
   'con un número que no es de nadie más, no se avisa nada');

reiniciar();
guardarContacto({ clave: 'L-14', nombre: 'El cuidador', celular: '6555-4444', autoriza: 'si' });
guardarGarita({ nombre: 'Garita trasera', celular: '6555-4444' });
ok(getAccesoData('').avisos.some(a => /El cuidador/.test(a.texto)),
   'el choque también se busca contra los contactos de acceso, no sólo contra el padrón');

// Escrito distinto en cada sitio, que es como llega de verdad. guardarGarita normaliza
// lo que pasa por él, pero la administración teclea filas DIRECTAMENTE en la hoja —el
// módulo cuenta con ello en esGuardia()— y ahí el número queda como lo escribieron. Si
// el choque se comparara en crudo, esa fila lo escondería.
reiniciar();
_accHojas();
HOJAS.Garita.push(['GA9', 'Garita tecleada a mano', '6981-2266', '', 'si', '', new Date()]);
ok(getAccesoData('').avisos.some(a => /Ana Rosa Tejada/.test(a.texto)),
   'un «6981-2266» tecleado a mano choca igual con el «+50769812266» del padrón');

/* ═══════════════════════════════════════════════════════════════════════════
 * La llegada: el guardia anuncia a alguien
 * ═══════════════════════════════════════════════════════════════════════════ */

const hablo = () => ENVIADO[ENVIADO.length - 1] || { texto: '', botones: null };
const lista = () => (hablo().lista || []).reduce((a, s) => a.concat(s.rows), []);
const anuncia = (texto) => { reiniciarWA(); return _botGuardia('+50760000000',
  { nombre: 'Garita principal' }, { type: 'text', text: { body: texto } }); };

console.log('\n── DE LO QUE DEVUELVE EL MODELO, SÓLO SE USA LO QUE ESTABA EN EL MENSAJE ──');
// El candado que más importa de todo el módulo. Una cédula inventada en una garita es
// alguien entrando con el permiso de otro, y a esa hora nadie lo va a verificar.
reiniciar(); reiniciarWA();
CLAUDE = { visitante: 'Juan Pérez', cedula: '9-999-999', lote: '' };   // ← esa cédula NO se escribió
let leido = _accLeerVisitaTexto('viene juan perez con cedula 8-123-456');
ok(leido.cedula === '8-123-456',
   'una cédula que el modelo se inventó se descarta y manda la que está escrita: ' + leido.cedula);
ok(leido.visitante === 'Juan Pérez', 'el nombre, que sí estaba, se acepta');

CLAUDE = { visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '14' };
leido = _accLeerVisitaTexto('viene juan perez con cedula 8-123-456');
ok(leido.visitante === '',
   'y un NOMBRE inventado también se descarta, no sólo la cédula: ' + JSON.stringify(leido.visitante));
ok(leido.lote === '', 'y un lote que nadie mencionó tampoco pasa');

CLAUDE = null;   // sin clave de API, o Anthropic caído
leido = _accLeerVisitaTexto('juan perez 8-123-456 va a la 14');
ok(leido.cedula === '8-123-456',
   'sin Claude la garita sigue funcionando: la cédula sale por expresión regular');

console.log('\n── UNA CÉDULA QUE CASA ABRE; UN NOMBRE QUE CASA, NO ──');
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Luis Mendoza', cedula: '8-123-456' });
CLAUDE = { visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '' };
anuncia('Luis Mendoza 8-123-456');
ok(/PUEDE PASAR/.test(hablo().texto), 'con la cédula anotada y coincidiendo, puede pasar');
// Un permiso firme no le pregunta nada: no hay nada que decidir. Pero SÍ le deja
// desmentirlo. El módulo se niega a dar por dentro una visita pendiente «porque nadie
// lo confirmó», y a ésta tampoco la confirmó nadie: se da por entrada porque casi
// siempre acierta, no porque conste. Sin botón, el que daba media vuelta se quedaba
// dentro para siempre.
ok(hablo().botones && hablo().botones.length === 1,
   'un solo botón, no tres: no hay que decidir, sólo poder desmentirlo');
ok(/No lo dejé pasar/.test(hablo().botones[0].reply.title),
   'y es el de desmentir: ' + hablo().botones[0].reply.title);
ok(!/Corregir/.test(JSON.stringify(hablo().botones)),
   'sin «Corregir los datos»: la cédula casó sola, el dato está bien');
ok(_sheetRows('Visitas')[0].estado === 'preautorizada', 'la visita queda como preautorizada');

reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Luis Mendoza' });   // sin cédula
CLAUDE = { visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '' };
anuncia('Luis Mendoza 8-123-456');
ok(/COINCIDE EL NOMBRE, NO LA CÉDULA/.test(hablo().texto),
   'con permiso sólo por nombre, el sistema NO abre solo: ' + hablo().texto.split('\n')[0]);
ok(hablo().botones && hablo().botones.length === 3 &&
   hablo().botones.map(b => b.reply.title).some(x => /Corregir/.test(x)),
   'le deja la decisión al guardia, que tiene el documento en la mano — y como el dato ' +
   'lo tecleó él, puede corregirlo: ' + hablo().botones.map(b => b.reply.title).join(' | '));
ok(_sheetRows('Visitas')[0].estado === 'pendiente',
   'y la visita NO se marca autorizada mientras él no conteste: ' + _sheetRows('Visitas')[0].estado);

console.log('\n── EL NOMBRE CORTO ENCUENTRA EL PERMISO ──');
// El caso real: el permiso se creó desde la foto de la cédula, así que quedó con el
// nombre completo del documento. El guardia anunció «Iris Albelo» y el bot contestó
// «SIN PERMISO PREVIO». Falso: el permiso estaba ahí. En Panamá la cédula trae cuatro
// nombres y nadie dice cuatro.
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Iris Edilsa Albelo Hoo', cedula: '8-517-1400' });
CLAUDE = { visitante: 'Iris Albelo', cedula: '', lote: '' };
anuncia('Iris Albelo');
ok(!/SIN PERMISO PREVIO/.test(hablo().texto),
   'ya no dice que no hay permiso cuando sí lo hay: ' + hablo().texto.split('\n')[0]);
ok(/COMPARE LA CÉDULA/.test(hablo().texto),
   'le pide comparar, que es lo único que falta para salir de dudas');
ok(/8-517-1400/.test(hablo().texto),
   'y le enseña la cédula del permiso, para que la coteje con el documento');
ok(_sheetRows('Visitas')[0].estado === 'pendiente',
   'pero NO abre sola: sigue decidiendo el guardia — ' + _sheetRows('Visitas')[0].estado);

// El parecido tiene que SEPARAR, no sólo juntar. Si el umbral se abriera, cualquier
// visitante arrastraría media lista de permisos y el guardia dejaría de mirarla.
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Iris Edilsa Albelo Hoo', cedula: '8-517-1400' });
ok(autorizacionVigente('Q-9', { visitante: 'Juan Pérez' }) === null,
   'un nombre que no se parece en nada no saca ningún permiso');
ok(autorizacionVigente('Q-9', { visitante: 'Iris' }) === null,
   'y un nombre de pila suelto tampoco: «Iris» no identifica a nadie');
ok(autorizacionVigente('Q-9', { visitante: 'Iris Albelo' }) !== null,
   'pero dos palabras que sí encajan, sí');

console.log('\n── DOS PERMISOS PARECIDOS SE LE ENSEÑAN AL GUARDIA ──');
// «Iris Albelo» e «Iris Alveo» son dos personas distintas y las dos encajan con lo
// escrito. El sistema no puede elegir; el guardia sí, que tiene el documento delante.
reiniciar();
guardarAutorizacion({ clave: 'Q-9', visitante: 'Iris Albelo Hoo', cedula: '8-517-1400' });
guardarAutorizacion({ clave: 'Q-9', visitante: 'Iris Alveo Ruiz', cedula: '8-900-111' });
CLAUDE = { visitante: 'Iris Albelo', cedula: '', lote: '' };
anuncia('Iris Albelo');
const filasPar = lista();
ok(/HAY 2 PERMISOS PARECIDOS/.test(hablo().texto),
   'se le dice que hay varios: ' + hablo().texto.split('\n')[0]);
ok(filasPar.length === 3, 'salen los dos permisos y un «ninguno»: ' + filasPar.length);
ok(filasPar.map(f => f.title).join(' | ').indexOf('Iris Albelo Hoo') >= 0 &&
   filasPar.map(f => f.title).join(' | ').indexOf('Iris Alveo Ruiz') >= 0,
   'los dos por su nombre: ' + filasPar.map(f => f.title).join(' | '));
ok(filasPar.some(f => /8-517-1400/.test(f.description || '')),
   'con su cédula, que es lo que el guardia va a comparar');
ok(/Ninguno/.test(filasPar[2].title), 'y la salida de «ninguno es»: ' + filasPar[2].title);
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'nada se decide solo');

// El guardia elige uno, con el documento delante.
const idVisPar = _sheetRows('Visitas')[0].id;
const idAutPar = getAutorizaciones('Q-9').filter(a => /Albelo/.test(a.visitante))[0].id;
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { list_reply: { id: ACC_BOT_PERM + idVisPar + '|' + idAutPar } } });
ok(/ANOTADO/.test(hablo().texto), 'queda anotado al tocarlo: ' + hablo().texto.split('\n')[0]);
const trasElegirPar = _sheetRows('Visitas')[0];
ok(trasElegirPar.estado === 'autorizada',
   'como AUTORIZADA, no preautorizada: preautorizada quiere decir que la cédula casó sola — ' +
   trasElegirPar.estado);
ok(/Garita principal/.test(String(trasElegirPar.autorizadoPor)),
   'y consta que lo identificó el guardia: ' + trasElegirPar.autorizadoPor);

console.log('\n── SIN PERMISO Y SIN SABER A QUÉ UNIDAD VA ──');
// Con la plantilla aprobada, lo normal es preguntarle a la casa. Pero si el guardia no
// dijo a qué unidad va el visitante, no hay casa a la que preguntar: eso se dice tal
// cual, en vez de fingir una consulta que no se está haciendo.
reiniciar();
CLAUDE = { visitante: 'Un Desconocido', cedula: '7-111-222', lote: '' };
anuncia('Un Desconocido 7-111-222');
ok(/SIN PERMISO PREVIO/.test(hablo().texto), 'se dice claro que no hay autorización');
ok(/no sé a quién preguntarle/.test(hablo().texto),
   'y por qué no se puede preguntar: falta la unidad, no es que el sistema no sepa hacerlo');
ok(!/PREGUNTÁNDOLE A LA CASA/.test(hablo().texto),
   'sobre todo, NO se dice que se está preguntando cuando no se preguntó nada');
ok(_sheetRows('Visitas').length === 1,
   'la visita sin permiso queda anotada IGUAL: la que no entró es justo la que después ' +
   'hace falta poder mirar');

console.log('\n── LA BITÁCORA ANOTA LO QUE PASÓ, NO LO QUE EL SISTEMA RECOMENDÓ ──');
let vid = _sheetRows('Visitas')[0].id;
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { button_reply: { id: 'acc_si_' + vid, title: 'Lo dejé pasar' } } });
let v0 = _sheetRows('Visitas')[0];
ok(v0.estado === 'autorizada',
   'el guardia dejó entrar a alguien sin permiso y eso es lo que queda escrito: ' + v0.estado);
ok(/Guardia · Garita principal/.test(String(v0.autorizadoPor)),
   'con su nombre, no el de una autorización que no existía: ' + v0.autorizadoPor);
ok(/bitácora/i.test(hablo().texto), 'y se le confirma que quedó anotado');

console.log('\n── UN LOTE CON VARIOS DUEÑOS NO SE RESUELVE A DEDO ──');
// El lote 14 de este padrón tiene cuatro propietarios. Colgarle la visita a uno al azar
// sería inventarse un dato.
reiniciar();
PADRON.push({ clave: 'L-14b', nombre: 'Otro Dueño del 14', celular: '', lote: '14' });
PADRON[1].lote = '14';
ok(_accClavePorLote('14') === '', 'con cuatro dueños devuelve vacío y se busca en todas las unidades');
PADRON[0].lote = '9';
ok(_accClavePorLote('9') === 'Q-9', 'un lote de un solo dueño sí resuelve: ' + _accClavePorLote('9'));

console.log('\n── LA FOTO DE LA CÉDULA SE LEE, Y SE DICE QUE SE LEYÓ ──');
// Aquí no hay con qué contrastar: el modelo es el que lee. Por eso la respuesta repite
// lo leído y avisa de dónde salió — el guardia tiene el documento y le cuesta un segundo
// desmentirlo.
reiniciar(); reiniciarWA();
CLAUDE = { esCedula: true, visitante: 'Pedro Ruiz', cedula: '8-777-888', confianza: 0.9 };
_botGuardia('+50760000000', { nombre: 'Garita principal' }, { type: 'image', image: { id: 'M1' } });
ok(/Pedro Ruiz/.test(hablo().texto) && /8-777-888/.test(hablo().texto),
   'se le repite al guardia lo que se leyó');
ok(/Leído de la foto/.test(hablo().texto), 'y se le dice que salió de la foto, para que lo confirme');
ok(_sheetRows('Visitas')[0].visitante === 'Pedro Ruiz', 'la visita queda anotada con ese nombre');

reiniciar(); reiniciarWA();
CLAUDE = { esCedula: false };
_botGuardia('+50760000000', { nombre: 'Garita principal' }, { type: 'image', image: { id: 'M1' } });
ok(/No pude leer esa foto/.test(hablo().texto),
   'y si la foto no es una cédula, se pide el dato escrito en vez de inventarse una lectura');
ok(_sheetRows('Visitas').length === 0, 'sin poder leer nada, no se anota una visita en blanco');

/* ═══════════════════════════════════════════════════════════════════════════
 * El caso Georgina: una lectura mala tiene que salir marcada como mala
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pasó de verdad en la primera prueba en la garita. La foto era un carné de
 * PERMANENCIA PROVISIONAL de una nicaragüense —no una cédula del Tribunal Electoral—
 * y encima estaba girada 90°. El modelo devolvió «PERLA PERLA» y el número 104531,
 * cuando el impreso decía 1045031. Se comió un cero y se inventó el nombre, y el
 * sistema lo presentó como un dato.
 */
const foto = () => { reiniciarWA(); return _botGuardia('+50760000000',
  { nombre: 'Garita principal' }, { type: 'image', image: { id: 'M1' } }); };

console.log('\n── UNA LECTURA CON FORMA DE DISPARATE NO SE DA POR BUENA ──');
ok(_accLecturaFloja({ esCedula: true, visitante: 'PERLA PERLA', cedula: '104531', confianza: 0.95 }),
   'repetir la misma palabra no es un nombre, por muy seguro que diga estar el modelo');
ok(_accLecturaFloja({ esCedula: true, visitante: 'Joslyn Alonso Lopez', cedula: '8-743-456', confianza: 0.4 }),
   'y una confianza baja también basta, aunque el nombre tenga buena pinta');
ok(!_accLecturaFloja({ esCedula: true, visitante: 'Joslyn Alonso Lopez Albelo', cedula: '8-743-456', confianza: 0.95 }),
   'la lectura buena de verdad pasa sin ruido');
ok(_accLecturaFloja({ esCedula: true, visitante: 'Georgina Vanesa Martinez', cedula: 'ILEGIBLE', confianza: 0.9 }),
   'un número sin un solo dígito no es un número de documento');

console.log('\n── EL CASO GEORGINA, TAL COMO SALIÓ EN EL REGISTRO DE LA GARITA ──');
// Copiado literal de lo que devolvieron los dos modelos con la foto de verdad. Haiku
// leyó el TÍTULO del carné como si fuera el nombre —está girado 90°— pero acertó el
// número; sonnet leyó el nombre perfecto y se inventó un dígito de más.
//
// La versión anterior se quedaba con la de haiku porque la de sonnet venía con 0.72 de
// confianza, por debajo del umbral, y la descartaba entera. Resultado: «No pude leer esa
// foto», que no le sirve a nadie. Tirar la lectura buena por no ser perfecta y quedarse
// con la mala es exactamente al revés.
reiniciar(); reiniciarWA(); PROPS = {};
CLAUDE = [ { esCedula: false, tipoDoc: 'permanencia', visitante: 'PERLA MANCANELA PROVISONAL',
             cedula: '1045031', confianza: 0.65 },
           { esCedula: true, tipoDoc: 'permanencia', visitante: 'GEORGINA VANESA MARTINEZ CALERO',
             cedula: '10445031', confianza: 0.72 } ];
foto();
ok(!/No pude leer esa foto/.test(hablo().texto),
   'ya no se tira todo a la basura: ' + hablo().texto.split('\n')[0]);
ok(/GEORGINA VANESA MARTINEZ CALERO/.test(hablo().texto),
   'se queda la MEJOR de las dos, aunque su confianza no llegue al umbral');
ok(/NO ME FÍO DE ESTA LECTURA/.test(hablo().texto),
   'y como los dos lectores no coinciden en el número, se le avisa de que lo teclee');
ok(/no coincidieron en el número/.test(_sheetRows('Visitas')[0].notas),
   'la bitácora guarda POR QUÉ se dudó: ' + _sheetRows('Visitas')[0].notas);

ok(!_accNombrePlausible('PERLA MANCANELA PROVISONAL'),
   '«PERLA MANCANELA PROVISONAL» no es un nombre: son las palabras del cartón');
ok(!_accNombrePlausible('PERMANENCIA PROVISIONAL'), 'ni el título del carné');
ok(_accNombrePlausible('GEORGINA VANESA MARTINEZ CALERO'), 'y el de ella sí lo es');
ok(_accNombrePlausible('Joslyn Alonso Lopez Albelo'), 'igual que el de una cédula normal');

console.log('\n── DOS LECTORES QUE COINCIDEN VALEN MÁS QUE UNA CONFIANZA ALTA ──');
// Dos lecturas independientes de la misma imagen que dan el mismo número dígito a
// dígito es mejor evidencia que un modelo diciendo de sí mismo que está seguro.
reiniciar(); reiniciarWA();
CLAUDE = [ { esCedula: true, tipoDoc: 'cedula', visitante: 'Luis Mendoza Ruiz',
             cedula: '8-123-456', confianza: 0.55 },
           { esCedula: true, tipoDoc: 'cedula', visitante: 'Luis Mendoza Ruiz',
             cedula: '8123456', confianza: 0.6 } ];
foto();
ok(!/NO ME FÍO/.test(hablo().texto),
   'coincidiendo los dos, la lectura pasa aunque ninguno llegara al umbral por su cuenta');
ok(/Leído de la foto/.test(hablo().texto),
   'pero se le sigue diciendo que salió de una foto, que eso no cambia');

console.log('\n── UNA LECTURA FLOJA SE REINTENTA CON UN MODELO MEJOR ──');
reiniciar();
CLAUDE = [ { esCedula: true, visitante: 'PERLA PERLA', cedula: '104531', confianza: 0.9 },
           { esCedula: true, tipoDoc: 'permanencia', visitante: 'Georgina Vanesa Martinez Calero',
             cedula: '1045031', confianza: 0.92 } ];
foto();
ok(MODELOS.length === 2 && MODELOS[0] !== MODELOS[1],
   'se pregunta dos veces, y la segunda a otro modelo: ' + MODELOS.join(' → '));
ok(/Georgina Vanesa Martinez Calero/.test(hablo().texto),
   'y gana la segunda lectura, que es la buena');
ok(/1045031/.test(hablo().texto) && !/\b104531\b/.test(hablo().texto),
   'con el número completo, sin el cero que se comió la primera');
ok(/Carné de permanencia/.test(hablo().texto),
   'y se le llama por lo que es: un carné de permanencia no es una cédula');
ok(/NO ME FÍO/.test(hablo().texto),
   'y se le avisa igual, porque los dos números no coinciden: 104531 contra 1045031. ' +
   'Que la segunda lectura sea mejor no la vuelve segura');

// La misma segunda lectura, pero con una primera que ni siquiera sacó número: entonces
// no hay discrepancia que señalar, sólo una lectura buena que se cree.
reiniciar(); reiniciarWA();
CLAUDE = [ { esCedula: false, visitante: '', cedula: '', confianza: 0.2 },
           { esCedula: true, tipoDoc: 'permanencia', visitante: 'Georgina Vanesa Martinez Calero',
             cedula: '1045031', confianza: 0.92 } ];
foto();
ok(/Georgina Vanesa Martinez Calero/.test(hablo().texto) && !/NO ME FÍO/.test(hablo().texto),
   'sin nada con qué discrepar, una segunda lectura firme se da por buena');

console.log('\n── SI NI ASÍ SE LEE BIEN, SE DICE QUE NO SE CONFÍE ──');
// Es el caso que de verdad importa: leer mal en silencio, en una garita, es peor que
// no leer. La advertencia va ARRIBA: un guardia lee la primera línea y actúa.
reiniciar();
CLAUDE = { esCedula: true, visitante: 'PERLA PERLA', cedula: '104531', confianza: 0.9 };
foto();
ok(/NO ME FÍO DE ESTA LECTURA/.test(hablo().texto),
   'se avisa de que la lectura no es de fiar: ' + hablo().texto.split('\n')[0]);
ok(hablo().texto.indexOf('NO ME FÍO') < hablo().texto.indexOf('PERLA'),
   'y el aviso va ANTES del dato, no escondido al final del mensaje');
ok(/Corregir los datos/.test(hablo().texto) && /tecl/i.test(hablo().texto),
   'con qué hacer, y señalando el botón que lo arregla sin duplicar la visita');
ok(_sheetRows('Visitas').length === 1 && /LECTURA DUDOSA/.test(_sheetRows('Visitas')[0].notas),
   'y la bitácora guarda que ese dato entró sin confirmar: ' + _sheetRows('Visitas')[0].notas);

console.log('\n── UNA LECTURA BUENA NO DEJA LA IMAGEN EN NINGÚN LADO ──');
// El cambio de fondo. La imagen se lee y se borra en el acto: lo que queda es el texto,
// que el guardia confirma con la cédula física delante. Un competidor ataca por escrito
// a quien guarda el documento de un tercero, y tenía razón.
reiniciar();
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Joslyn Alonso Lopez Albelo',
           cedula: '8-743-456', confianza: 0.95 };
foto();
ok(_sheetRows('Visitas')[0].fotoUrl === '',
   'la visita queda SIN foto: ' + JSON.stringify(_sheetRows('Visitas')[0].fotoUrl));
ok(ARCHIVOS.length === 1 && DRIVE[ARCHIVOS[0].id] === false,
   'y el archivo ya está en la papelera, sin esperar a ninguna purga');
ok(_sheetRows('Visitas')[0].visitante === 'Joslyn Alonso Lopez Albelo' &&
   _sheetRows('Visitas')[0].cedula === '8-743-456',
   'el TEXTO sí queda, que es lo que da fe');
ok(ACC_CARPETA_FOTOS !== '' && !/comprobante|voucher/i.test(ACC_CARPETA_FOTOS),
   'y lo poco que se guarda va en su propia carpeta, no en la de los comprobantes: ' + ACC_CARPETA_FOTOS);

console.log('\n── UNA DUDOSA SÍ SE QUEDA, QUE ES PARA LO QUE SIRVE ──');
reiniciar(); reiniciarWA();
// Dos lectores que no coinciden en el número: el texto no es de fiar y la imagen es el
// único respaldo para saber después qué decía de verdad el documento.
CLAUDE = [{ esCedula: true, tipoDoc: 'cedula', visitante: 'Georgina Perla', cedula: '8-111-111', confianza: 0.4 },
          { esCedula: true, tipoDoc: 'cedula', visitante: 'Georgina Perla', cedula: '8-222-222', confianza: 0.6 }];
foto();
ok(String(_sheetRows('Visitas')[0].fotoUrl || '') !== '',
   'cuando la lectura es dudosa la foto se queda: es el único respaldo que hay');
ok(ARCHIVOS.length === 1 && DRIVE[ARCHIVOS[0].id] === true,
   'y sigue viva en Drive hasta que la purga la alcance');

console.log('\n── UN FALLO AL LEER TIENE QUE DEJAR RASTRO ──');
// El fallo de verdad en la garita no se pudo diagnosticar porque la lectura devolvía
// null en cuatro sitios distintos y ninguno decía nada. «No pude leer esa foto» no
// distingue entre que Anthropic contestara un error, que contestara algo que no era
// JSON, o que dijera que la foto no es un documento — y son tres arreglos distintos.
reiniciar(); reiniciarWA(); PROPS = {};
CLAUDE = { esCedula: false, visitante: '', cedula: '' };
foto();
ok(/no se sacó ni nombre ni número/.test(apuntes()),
   'cuando de la foto no sale nada, queda apuntado con lo que contestó el modelo: ' +
   apuntes().split('\n').pop().slice(11, 75));

PROPS = {}; reiniciarWA();
const _fetch = global.UrlFetchApp.fetch;
global.UrlFetchApp.fetch = () => ({ getResponseCode: () => 400,
  getContentText: () => '{"error":{"message":"model not found"}}' });
foto();
ok(/HTTP 400/.test(apuntes()) && /model not found/.test(apuntes()),
   'y si Anthropic contesta un error, se guarda el código Y lo que dijo: ' + apuntes().slice(12, 80));
ok(apuntes().indexOf(_accModelo1()) >= 0 && apuntes().indexOf(ACC_MODELO_CEDULA_2) >= 0,
   'y cada modelo deja su propio apunte, para saber si falló uno o los dos');
ok(/ninguna de las pasadas/.test(apuntes()),
   'con una línea final que lo resume, que es la que explica el «no pude leer esa foto»');

PROPS = {}; reiniciarWA();
global.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200,
  getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'Claro, aquí tienes:' }] }) });
foto();
ok(/no devolvió JSON/.test(apuntes()),
   'y si contesta prosa en vez de JSON, también se distingue: ' + apuntes().slice(12, 70));
global.UrlFetchApp.fetch = _fetch;

PROPS = {}; reiniciarWA();
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Joslyn Alonso Lopez Albelo',
           cedula: '8-743-456', confianza: 0.95 };
foto();
ok(String(PROPS.ACC_ULTIMA_FOTO || '') !== '',
   'la foto se apunta para poder reintentarla: la URL de WhatsApp caduca en minutos');
ok(_sheetRows('Visitas')[0].fotoUrl === '',
   'pero la lectura salió limpia, así que la imagen ya no está: sólo se apuntó por dónde estuvo');

console.log('\n── CORREGIR UNA LECTURA MALA NO PUEDE DUPLICAR LA VISITA ──');
// Decirle al guardia «tecléelo usted» sin esto era pedirle que rompiera la bitácora: su
// texto se tomaba como un anuncio NUEVO y quedaban dos filas para la misma persona, una
// con los datos malos y otra con los buenos y nada que las relacione. Tres meses
// después, eso son dos visitas distintas.
const boton = (id) => { reiniciarWA(); return _botGuardia('+50760000000',
  { nombre: 'Garita principal' }, { type: 'interactive', interactive: { button_reply: { id: id } } }); };

reiniciar(); reiniciarWA(); PROPS = {}; CACHE = {};
CLAUDE = [ { esCedula: false, tipoDoc: 'permanencia', visitante: 'PERLA MANCANELA PROVISONAL',
             cedula: '1045031', confianza: 0.65 },
           { esCedula: true, tipoDoc: 'permanencia', visitante: 'GEORGINA VANESA MARTINEZ CALERO',
             cedula: '10445031', confianza: 0.72 } ];
foto();
const bots = (hablo().botones || []).map(b => b.reply.id);
ok(bots.length === 3 && bots.some(x => x.indexOf('acc_fix_') === 0),
   'con la lectura en duda aparece el tercer botón, «Corregir los datos»: ' + bots.length);
const vid2 = _sheetRows('Visitas')[0].id;

boton('acc_fix_' + vid2);
ok(/Mándeme el nombre y el número/.test(hablo().texto), 'al tocarlo, se le pide el dato escrito');
ok(/no se crea otra/.test(hablo().texto), 'y se le dice que corrige la que ya está, no que crea otra');

CLAUDE = { visitante: 'Georgina Martínez', cedula: '1045031', lote: '' };
anuncia('Georgina Martínez 1045031');
ok(_sheetRows('Visitas').length === 1,
   'sigue habiendo UNA visita, no dos: ' + _sheetRows('Visitas').length);
let vc = _sheetRows('Visitas')[0];
ok(vc.cedula === '1045031' && /Georgina Martínez/.test(String(vc.visitante)),
   'con el dato bueno ya puesto: ' + vc.visitante + ' / ' + vc.cedula);
ok(/tecleados por el guardia/.test(String(vc.notas)) && /10445031/.test(String(vc.notas)),
   'y queda constancia de que lo tecleó él Y de lo que había puesto el lector: ' + vc.notas);

console.log('\n── SI AL CORREGIRLO APARECE UN PERMISO, SE DICE ──');
// La cédula mal leída puede ser justo la razón de que no casara ninguna autorización.
reiniciar(); reiniciarWA(); CACHE = {};
guardarAutorizacion({ clave: 'Q-9', visitante: 'Georgina Martínez', cedula: '1045031' });
CLAUDE = [ { esCedula: false, visitante: 'PERLA PERLA', cedula: '10445031', confianza: 0.6 },
           { esCedula: true, visitante: 'Georgina Martinez Calero', cedula: '10445031', confianza: 0.7 } ];
foto();
const vid3 = _sheetRows('Visitas')[0].id;
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'con la cédula mal leída no casa ningún permiso');
boton('acc_fix_' + vid3);
CLAUDE = { visitante: 'Georgina Martínez', cedula: '1045031', lote: '' };
anuncia('Georgina Martínez 1045031');
ok(/ASÍ SÍ TIENE PERMISO/.test(hablo().texto),
   'corregida la cédula, la autorización aparece y se le dice: ' + hablo().texto.split('\n')[0]);
ok(_sheetRows('Visitas')[0].estado === 'preautorizada',
   'y la MISMA visita pasa a preautorizada: ' + _sheetRows('Visitas')[0].estado);

console.log('\n── UN ANUNCIO NORMAL NO SE COME LA VISITA ANTERIOR ──');
// Un guardia puede anunciar a otra persona treinta segundos después. Por eso la
// corrección la declara él con un botón y no se adivina comparando parecidos.
reiniciar(); reiniciarWA(); CACHE = {};
CLAUDE = { visitante: 'Primero Uno', cedula: '8-111-111', lote: '' };
anuncia('Primero Uno 8-111-111');
CLAUDE = { visitante: 'Segundo Dos', cedula: '8-222-222', lote: '' };
anuncia('Segundo Dos 8-222-222');
ok(_sheetRows('Visitas').length === 2,
   'sin tocar «Corregir», dos anuncios son dos visitas: ' + _sheetRows('Visitas').length);

console.log('\n── DECIDIDA LA VISITA, YA NO SE CORRIGE ──');
reiniciar(); reiniciarWA(); CACHE = {};
CLAUDE = [ { esCedula: false, visitante: 'PERLA PERLA', cedula: '111', confianza: 0.5 },
           { esCedula: true, visitante: 'Alguien Dudoso', cedula: '222', confianza: 0.6 } ];
foto();
const vid4 = _sheetRows('Visitas')[0].id;
boton('acc_fix_' + vid4);
boton('acc_si_' + vid4);          // se arrepiente y decide
CLAUDE = { visitante: 'Otro Distinto', cedula: '9-999-999', lote: '' };
anuncia('Otro Distinto 9-999-999');
ok(_sheetRows('Visitas').length === 2,
   'tras decidir, lo siguiente que escriba es un anuncio nuevo, no una corrección: ' +
   _sheetRows('Visitas').length);
ok(_sheetRows('Visitas')[0].estado === 'autorizada',
   'y la decisión que tomó no se pierde: ' + _sheetRows('Visitas')[0].estado);

/* ═══════════════════════════════════════════════════════════════════════════
 * Fase 4: preguntarle a la casa en vivo
 * ═══════════════════════════════════════════════════════════════════════════ */

global.enviarPlantillaWhatsApp = (tel, nombre, params, opts) => {
  PLANTILLAS.push({ tel, nombre, params, opts });
  return { ok: true, id: 'wamid.' + PLANTILLAS.length };
};
// Fiel al contrato de la función real: devuelve `prop`, `motivo` y `claves`, y
// distingue «varias unidades de la MISMA persona» de «unidades de dueños distintos».
// Un doble que devolviera sólo el nombre dejaría sin probar justo la verja que
// impide que alguien gestione el acceso de una casa que no es suya.
global.identificarPorCelular = tel => {
  const hits = PADRON.filter(x => _accTel(x.celular) === _accTel(tel));
  if (!hits.length) return { prop: null, motivo: 'no-esta-en-el-padron', claves: [] };
  const nombres = [...new Set(hits.map(h => h.nombre.trim().toLowerCase()))];
  if (nombres.length > 1) {
    return { prop: null, motivo: 'varios-duenos', claves: hits.map(h => h.clave) };
  }
  return { prop: hits[0], motivo: '', nombre: hits[0].nombre, claves: hits.map(h => h.clave) };
};
const reiniciarF4 = () => { PLANTILLAS = []; reiniciarWA(); };

console.log('\n── «NINGUNO DE ÉSTOS» NO AUTORIZA NADA ──');
// Y «ninguno de éstos» sigue por donde se habría seguido sin permiso.
reiniciar();
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarAutorizacion({ clave: 'Q-9', visitante: 'Iris Albelo Hoo', cedula: '8-517-1400' });
guardarAutorizacion({ clave: 'Q-9', visitante: 'Iris Alveo Ruiz', cedula: '8-900-111' });
CLAUDE = { visitante: 'Iris Albelo', cedula: '', lote: '9' };
anuncia('Iris Albelo va al 9');
const idVisPar2 = _sheetRows('Visitas')[0].id;
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { list_reply: { id: ACC_BOT_PERM + idVisPar2 + '|' } } });
ok(!/ANOTADO/.test(hablo().texto),
   '«ninguno es» no autoriza nada: ' + hablo().texto.split('\n')[0]);
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'la visita sigue pendiente');


console.log('\n── SIN PERMISO PREVIO, AHORA SE LE PREGUNTA A LA CASA ──');
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si', orden: 1 });
guardarContacto({ clave: 'Q-9', nombre: 'Carlos el inquilino', celular: '6000-1111', autoriza: 'si', orden: 2 });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '9' };
anuncia('Luis Mendoza 8-123-456 va al 9');
ok(PLANTILLAS.length === 2,
   'se le escribe a LOS DOS que autorizan, no al primero: a esa hora contesta quien ' +
   'tiene el teléfono a mano → ' + PLANTILLAS.length);
ok(PLANTILLAS[0].nombre === 'lobby_autorizacion_visita', 'con la plantilla aprobada');
ok(PLANTILLAS[0].params.length === 5, 'con sus cinco valores: ' + PLANTILLAS[0].params.length);
ok(PLANTILLAS[0].params.indexOf('8-123-456') < 0 && PLANTILLAS[0].params.join(' ').indexOf('8-123') < 0,
   'y la CÉDULA no viaja: es el documento de un tercero y el residente no la necesita ' +
   'para decidir → ' + JSON.stringify(PLANTILLAS[0].params));
ok(/PREGUNTÁNDOLE A LA CASA/.test(hablo().texto),
   'al guardia se le dice que está preguntando: ' + hablo().texto.split('\n')[0]);
ok(/Ana Rosa Tejada/.test(hablo().texto) && /Carlos/.test(hablo().texto),
   'y a quién, para que sepa a quién reclamarle');
ok(!/Todavía no puedo preguntarle/.test(hablo().texto), 'ya no se le dice que no se puede');

console.log('\n── LA CASA CONTESTA Y LA GARITA SE ENTERA ──');
reiniciarF4();
let resF4 = _botRespuestaDeAcceso('+50769812266',
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_si' } } });
ok(resF4 && resF4.contesto, 'un «Autorizo» de un residente se atiende');
const v4 = _sheetRows('Visitas')[0];
ok(v4.estado === 'autorizada' && /Residente · Ana Rosa Tejada/.test(String(v4.autorizadoPor)),
   'la visita queda autorizada POR LA CASA, no por el guardia: ' + v4.autorizadoPor);
ok(ENVIADO.some(e => /Autorizado/.test(e.texto) && /Luis Mendoza/.test(e.texto)),
   'al residente se le repite el nombre del visitante, por si contestó por la que no era');
ok(ENVIADO.some(e => e.tel === '+50760000000' && /AUTORIZADA por Ana Rosa Tejada/.test(e.texto)),
   'y a la garita se le avisa quién lo autorizó');

console.log('\n── UN «NO AUTORIZO» NO DEJA AL GUARDIA DISCUTIENDO ──');
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Un Desconocido', cedula: '', lote: '9' };
anuncia('Un Desconocido va al 9');
reiniciarF4();
_botRespuestaDeAcceso('+50769812266',
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_no' } } });
ok(_sheetRows('Visitas')[0].estado === 'rechazada', 'queda rechazada');
ok(ENVIADO.some(e => e.tel === '+50760000000' && /es cosa de la administración, no suya/.test(e.texto)),
   'y al guardia se le quita el problema de encima: no tiene que discutirlo él');

console.log('\n── UNA RESPUESTA QUE LLEGA TARDE NO CAMBIA NADA ──');
// Y se le dice, en vez de dejarle creer que autorizó algo.
reiniciarF4();
resF4 = _botRespuestaDeAcceso('+50769812266',
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_si' } } });
ok(resF4 && /ya está resuelta/.test(hablo().texto),
   'se le dice que ya estaba decidida: ' + hablo().texto.slice(0, 60));
ok(_sheetRows('Visitas')[0].estado === 'rechazada', 'y la decisión anterior NO se toca');

console.log('\n── UN BOTÓN DE ACCESO DE ALGUIEN QUE NO ES NADIE NO HACE NADA ──');
reiniciarF4();
resF4 = _botRespuestaDeAcceso('+50799999999',
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_si' } } });
ok(resF4 && resF4.contesto && _sheetRows('Visitas')[0].estado === 'rechazada',
   'un número que no autoriza en ninguna unidad no puede abrir nada');
ok(_botRespuestaDeAcceso('+50769812266', { type: 'text', text: { body: 'hola' } }) === null,
   'y un mensaje que no es uno de esos botones devuelve null, para que el bot siga su camino');

console.log('\n── UN VECINO NO PUEDE AUTORIZAR LA VISITA DE OTRA CASA ──');
// Es el agujero serio de este flujo: los botones de una plantilla llevan un
// identificador FIJO, así que un «acceso_si» no dice a qué visita se refiere. Si la
// búsqueda no se limitara a las unidades que esa persona autoriza, cualquier vecino que
// hubiera recibido alguna vez la plantilla podría abrirle la puerta a la casa de al lado.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9',  nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si' });
guardarContacto({ clave: 'L-14', nombre: 'El del 14',       celular: '6555-7777', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Visita del nueve', cedula: '', lote: '9' };
anuncia('Visita del nueve va al 9');
ok(_sheetRows('Visitas')[0].clave === 'Q-9', 'la visita es para Q-9');

reiniciarF4();
_botRespuestaDeAcceso('+50765557777',    // el del 14, que no tiene nada que ver
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_si' } } });
ok(_sheetRows('Visitas')[0].estado === 'pendiente',
   'el vecino del 14 NO puede autorizarla: sigue pendiente → ' + _sheetRows('Visitas')[0].estado);
ok(!ENVIADO.some(e => /Autorizado/.test(e.texto)), 'y no se le dice que autorizó nada');

reiniciarF4();
_botRespuestaDeAcceso('+50769812266',    // la de Q-9, que sí
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_si' } } });
ok(_sheetRows('Visitas')[0].estado === 'autorizada',
   'y la de Q-9 sí, con el mismo botón: lo que decide es de quién es el número');

console.log('\n── PASADO EL PLAZO, EL BOTÓN YA NO ABRE ──');
// La plantilla dice «si no responde en X minutos, la garita no la deja pasar». Si a los
// veinte minutos el botón siguiera abriendo, esa frase sería mentira y el visitante ya
// se habría ido hace rato — o peor, estaría entrando con permiso de una hora antes.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Llega Tarde', cedula: '', lote: '9' };
anuncia('Llega Tarde va al 9');
HOJAS.Visitas[1][1] = new Date(Date.now() - (ACC_MINUTOS_RESPUESTA + 2) * 60000);
reiniciarF4();
_botRespuestaDeAcceso('+50769812266',
  { type: 'interactive', interactive: { button_reply: { id: 'acceso_si' } } });
ok(_sheetRows('Visitas')[0].estado === 'pendiente',
   'un «Autorizo» fuera de plazo no la abre: ' + _sheetRows('Visitas')[0].estado);
ok(/ya está resuelta|se pasó el plazo/.test(hablo().texto),
   'y se le dice, en vez de dejarle creer que autorizó: ' + hablo().texto.slice(0, 50));

console.log('\n── SI NADIE CONTESTA, SE CIERRA Y SE AVISA ──');
// La plantilla PROMETE el plazo. Dejar la visita en «pendiente» para siempre es tener
// al guardia esperando una respuesta que ya no va a llegar.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Nadie Contesta', cedula: '', lote: '9' };
anuncia('Nadie Contesta va al 9');
reiniciarF4();
ok(cerrarVisitasSinRespuesta().cerradas === 0, 'recién llegada no se cierra nada');

// Se retrasa la fila a mano: el plazo es de minutos y la prueba no va a esperarlos.
HOJAS.Visitas[1][1] = new Date(Date.now() - (ACC_MINUTOS_RESPUESTA + 2) * 60000);
ok(cerrarVisitasSinRespuesta().cerradas === 1, 'pasado el plazo, se cierra');
ok(_sheetRows('Visitas')[0].estado === 'sin-respuesta',
   'como «sin-respuesta», que no es lo mismo que rechazada: ' + _sheetRows('Visitas')[0].estado);
ok(ENVIADO.some(e => e.tel === '+50760000000' && /NADIE CONTESTÓ/.test(e.texto)),
   'y la garita se entera, en vez de seguir esperando');

console.log('\n── UNA VISITA QUE NUNCA SE PREGUNTÓ NO SE MARCA «SIN RESPUESTA» ──');
// Sin unidad no se le preguntó a nadie. Decir que no contestaron sería culpar a un
// residente que jamás recibió el mensaje.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
CLAUDE = { visitante: 'Sin Unidad', cedula: '', lote: '' };
anuncia('Sin Unidad');
ok(/no sé a quién preguntarle/.test(hablo().texto),
   'al guardia se le dice que falta el ' + 'lote' + ': ' + hablo().texto.split('\n')[2]);
HOJAS.Visitas[1][1] = new Date(Date.now() - (ACC_MINUTOS_RESPUESTA + 2) * 60000);
ok(cerrarVisitasSinRespuesta().cerradas === 0,
   'y nunca se marca «sin respuesta»: nadie dejó de contestar, es que no se preguntó');

/* ═══════════════════════════════════════════════════════════════════════════
 * El propietario se gestiona lo suyo desde WhatsApp
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es lo PRIMERO que el bot escribe, y encima datos de seguridad. Las afirmaciones que
 * más importan aquí son las negativas.
 */
global._botDice = (tel, texto) => { ENVIADO.push({ tel, texto, botones: null }); return { ok: true }; };

const toca = (tel, id) => { reiniciarWA(); return _botGestionAcceso(tel,
  { type: 'interactive', interactive: { button_reply: { id } } }, id); };
const escribe = (tel, t) => { reiniciarWA(); return _botGestionAcceso(tel,
  { type: 'text', text: { body: t } }, ''); };

console.log('\n── UN PROPIETARIO CARGA SU PROPIO CONTACTO ──');
reiniciar(); reiniciarF4(); CACHE = {}; PROPS = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_quien');
ok(/Quién puede autorizar/.test(hablo().texto), 'se le enseña quién autoriza hoy');
ok(/todavía ninguno/.test(hablo().texto), 'y que hoy no hay nadie, que es el caso de los 71 lotes');

CLAUDE = { visitante: 'Carlos Pérez', cedula: '', lote: '' };
escribe('+50769812266', 'Carlos Pérez 6000-1111');
ok(/¿Guardo esto\?/.test(hablo().texto) && /Carlos Pérez/.test(hablo().texto),
   'se le repite lo que va a guardarse antes de escribir nada');
ok(getContactos('Q-9').length === 0, 'y todavía NO se ha escrito: primero confirma');

toca('+50769812266', 'bot_acc_si');
ok(getContactos('Q-9').length === 1 && getContactos('Q-9')[0].celular === '+50760001111',
   'al confirmar se guarda, con el celular normalizado: ' + JSON.stringify(getContactos('Q-9')[0].celular));
ok(getContactos('Q-9')[0].autoriza === true, 'y puede autorizar visitas, que es para lo que se carga');
ok(REGISTRO.some(r => r.accion === 'contacto.alta'), 'queda en el registro, como todo lo que cambia');

console.log('\n── «NO» NO ESCRIBE NADA ──');
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_quien');
CLAUDE = { visitante: 'Otro Más', cedula: '', lote: '' };
escribe('+50769812266', 'Otro Más 6000-2222');
toca('+50769812266', 'bot_acc_no');
ok(getContactos('Q-9').length === 0, 'no se guardó nada');
ok(/No se guardó nada/.test(hablo().texto), 'y se le dice');

console.log('\n── UN PERMISO DEJADO POR WHATSAPP CADUCA ──');
// Un permiso sin vencimiento es la forma más común de perder el control de quién entra.
// Darlo por un mensaje de dos líneas es pedirlo: eso se queda en el panel.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_permiso');
CLAUDE = { visitante: 'Juan Pérez', cedula: '8-123-456', lote: '' };
escribe('+50769812266', 'Juan Pérez 8-123-456');
ok(/Vale hasta el/.test(hablo().texto), 'se le dice hasta cuándo vale antes de dejarlo');
toca('+50769812266', 'bot_acc_si');
const permWA = getAutorizaciones('Q-9')[0];
ok(permWA && permWA.hasta instanceof Date, 'el permiso se guarda CON fecha de vencimiento');
const dias = Math.round((permWA.hasta - new Date()) / 86400000);
ok(dias > 85 && dias < 95, 'de unos 90 días: ' + dias);
ok(permWA.cedula === '8-123-456', 'con la cédula, que es lo que hace firme la coincidencia');

console.log('\n── Y ESE PERMISO SIRVE DE VERDAD EN LA GARITA ──');
// La prueba de que el círculo se cierra: lo que el dueño dejó por WhatsApp es lo que
// el guardia se encuentra cuando el visitante llega.
reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
CLAUDE = { visitante: 'Juan Pérez', cedula: '8-123-456', lote: '' };
anuncia('Juan Pérez 8-123-456');
ok(/PUEDE PASAR/.test(hablo().texto),
   'el visitante que el dueño autorizó por WhatsApp entra sin molestar a nadie');

console.log('\n── LA CÉDULA QUE EL RESIDENTE REENVÍA ──');
// Lo que hace la gente de verdad: se le pide «nombre y cédula» y reenvía la foto que le
// mandaron a él. Esto no estaba cubierto, y no estarlo costó caro: la imagen se escapaba
// del módulo y la recogía el clasificador general, que a TODA imagen le contesta
// «recibimos su comprobante» y la archiva en la carpeta de PAGOS, con enlace público y
// sin purga. La cédula de un tercero terminaba en la contabilidad.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_permiso');
const antesDrive = ARCHIVOS.length;
reiniciarWA();
CLAUDE = { esCedula: true, visitante: 'Ana Gómez', cedula: '8-777-999', confianza: 0.95 };
const rFoto = _botGestionAcceso('+50769812266', { type: 'image', image: { id: 'M1' } }, '');
ok(rFoto !== null, 'la foto NO se le escapa al módulo de acceso');
ok(/Ana Gómez/.test(hablo().texto) && /8-777-999/.test(hablo().texto),
   'se leen de ella el nombre y la cédula: ' + hablo().texto.replace(/\n/g, ' ').slice(0, 58));
ok(/permiso/i.test(hablo().texto) && (hablo().botones || []).length === 2,
   'y se PROPONE el permiso con sus dos botones, no se guarda solo');
ok(ARCHIVOS.length === antesDrive,
   'y la imagen no se guardó en ninguna carpeta: ' + (ARCHIVOS.length - antesDrive) + ' archivos nuevos');
toca('+50769812266', 'bot_acc_si');
const permFoto = getAutorizaciones('Q-9')[0];
ok(permFoto && permFoto.cedula === '8-777-999',
   'el permiso queda con la cédula que salió de la foto');

reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_permiso');
reiniciarWA();
CLAUDE = { esCedula: false };
_botGestionAcceso('+50769812266', { type: 'image', image: { id: 'M1' } }, '');
ok(/No pude leer esa foto/.test(hablo().texto),
   'si no se deja leer, se pide escrita — no se inventa un permiso');
ok(getAutorizaciones('Q-9').length === 0, 'y no queda ningún permiso a medio hacer');

// Una lectura que devuelve el objeto pero sin nada dentro no puede acabar en un permiso
// con el nombre en blanco: eso sería peor que no leerla.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_permiso');
reiniciarWA();
CLAUDE = { esCedula: true, visitante: '', cedula: '', confianza: 0.9 };
_botGestionAcceso('+50769812266', { type: 'image', image: { id: 'M1' } }, '');
ok(/No pude leer esa foto/.test(hablo().texto),
   'una lectura vacía tampoco propone nada: ' + hablo().texto.replace(/\n/g, ' ').slice(0, 46));
ok(getAutorizaciones('Q-9').length === 0, 'y sigue sin haber permiso');

// Sólo cuenta como cédula cuando lo que se pidió ERA una cédula. Cargando un contacto
// se pide un CELULAR, y ahí una foto no es un documento de nadie.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_quien');
reiniciarWA();
CLAUDE = { esCedula: true, visitante: 'Ana Gómez', cedula: '8-777-999', confianza: 0.95 };
ok(_botGestionAcceso('+50769812266', { type: 'image', image: { id: 'M1' } }, '') === null,
   'cargando un contacto, una imagen no se lee como cédula: no era lo que se pidió');

console.log('\n── PERO UNA FOTO SUELTA SIGUE SIENDO UN COMPROBANTE ──');
// El caso común de una imagen de un propietario es el recibo de un pago. Sólo cambia
// cuando hay un permiso a medias, que es cuando se le acaba de pedir una cédula.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
ok(_botGestionAcceso('+50769812266', { type: 'image', image: { id: 'M1' } }, '') === null,
   'sin conversación viva la imagen sigue su camino: los pagos por foto no se rompen');

console.log('\n── UN NÚMERO COMPARTIDO POR DOS DUEÑOS NO GESTIONA ──');
// Para las cifras ya se le negaba —vería el saldo de otro—. Aquí sería peor: podría
// nombrarse a sí mismo autorizante de una casa que no es suya.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON.push({ clave: 'Q-40', nombre: 'Otro Dueño Distinto', celular: '+50769812266', lote: '40' });
let res = toca('+50769812266', 'bot_acc_quien');
ok(res && res.contesto, 'se le contesta');
ok(/personas distintas/.test(hablo().texto), 'y se le dice por qué no: ' + hablo().texto.slice(0, 60));
ok(getContactos('Q-9').length === 0, 'no se le deja tocar nada');

console.log('\n── UN CONTACTO NO NOMBRA AUTORIZANTES, PERO SÍ DEJA PERMISOS ──');
// Las dos mitades de la misma regla. Nombrar a quien autoriza es estructural y es del
// dueño. Dejar un permiso es lo que el contacto YA hace a las nueve de la noche cuando
// la garita le pregunta, sólo que por adelantado: negárselo sería decirle «puede
// abrirle la puerta ahora, pero no puede avisar de que viene».
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
guardarContacto({ clave: 'Q-9', nombre: 'El inquilino', celular: '6555-8888', autoriza: 'si' });

res = toca('+50765558888', 'bot_acc_quien');
ok(/sólo lo hace el propietario/.test(hablo().texto),
   'nombrar autorizantes, no: ' + hablo().texto.slice(0, 55));
ok(/Dejar un permiso/.test(hablo().texto),
   'pero se le dice lo que sí puede hacer, en vez de dejarlo en «no»');
ok(getContactos('Q-9').length === 1, 'y no se agregó a nadie');

res = toca('+50765558888', 'bot_acc_permiso');
ok(/Permisos dejados/.test(hablo().texto), 'dejar un permiso, sí');
CLAUDE = { visitante: 'Su Visita', cedula: '8-555-666', lote: '' };
escribe('+50765558888', 'Su Visita 8-555-666');
toca('+50765558888', 'bot_acc_si');
ok(getAutorizaciones('Q-9').length === 1,
   'y el permiso queda dejado por él: ' + getAutorizaciones('Q-9').length);

console.log('\n── EL ATAJO: MANDAR LA CÉDULA Y YA ──');
// Es como se usa de verdad. A un residente le escriben «mañana va Juan, cédula
// 8-123-456», lo reenvía al bot y listo.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Juan Pérez', cedula: '8-123-456', lote: '' };
let at = _botAtajoPermiso('+50769812266', { type: 'text', text: { body: 'mañana va Juan Pérez, cédula 8-123-456' } });
ok(at && /¿Le dejo permiso de entrada\?/.test(hablo().texto),
   'sin pasar por el menú, propone el permiso');
ok(/Juan Pérez/.test(hablo().texto) && /8-123-456/.test(hablo().texto), 'con lo que leyó');
ok(getAutorizaciones('Q-9').length === 0, 'pero NO lo escribe: propone, no hace');
ok(/toque No/.test(hablo().texto), 'y dice cómo salirse, por si mandó eso con otra intención');
toca('+50769812266', 'bot_acc_si');
ok(getAutorizaciones('Q-9').length === 1, 'al confirmar, queda');

console.log('\n── EL ATAJO PIDE EL NOMBRE SI SÓLO LLEGA EL NÚMERO ──');
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
CLAUDE = { visitante: '', cedula: '8-123-456', lote: '' };
_botAtajoPermiso('+50769812266', { type: 'text', text: { body: '8-123-456' } });
ok(/¿Cómo se llama quien viene\?/.test(hablo().texto),
   'una cédula sola no basta para un permiso: falta el nombre');
CLAUDE = { visitante: 'Juan Pérez', cedula: '', lote: '' };
escribe('+50769812266', 'Juan Pérez');
toca('+50769812266', 'bot_acc_si');
ok(getAutorizaciones('Q-9')[0] && getAutorizaciones('Q-9')[0].cedula === '8-123-456',
   'y la cédula del primer mensaje no se pierde por el camino');

console.log('\n── EL ATAJO NO ES DE CUALQUIERA ──');
reiniciar(); reiniciarWA(); CACHE = {};
ok(_botAtajoPermiso('+50799999999', { type: 'text', text: { body: 'Juan Pérez 8-123-456' } }) === null,
   'quien no autoriza en ninguna unidad no propone nada, y el bot sigue su camino');
CACHE['acc_res_50769812266'] = JSON.stringify({ que: 'contacto', clave: 'Q-9', paso: 'espera-contacto' });
ok(_botAtajoPermiso('+50769812266', { type: 'text', text: { body: 'Carlos 8-123-456' } }) === null,
   'y con una conversación viva no se cuela: ese texto era para el formulario abierto');

console.log('\n── NO SE PUEDE GESTIONAR UNA UNIDAD AJENA ──');
// La charla vive en una caché de diez minutos y lo que escribe es de seguridad: se
// vuelve a comprobar de quién es la unidad en el momento de escribir.
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
CACHE['acc_res_50769812266'] = JSON.stringify(
  { que: 'contacto', clave: 'L-14', paso: 'confirma-contacto', nombre: 'Colado', celular: '+50760009999' });
toca('+50769812266', 'bot_acc_si');
ok(getContactos('L-14').length === 0,
   'una unidad que no es suya no se toca, aunque la charla dijera que sí');
ok(/no figura a su nombre/.test(hablo().texto), 'y se le dice');

console.log('\n── «MENÚ» SIEMPRE SACA DE UN FORMULARIO ──');
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_quien');
escribe('+50769812266', 'menu');
ok(!CACHE['acc_res_50769812266'], 'la conversación a medias se borra');
ok(getContactos('Q-9').length === 0, 'sin escribir nada');

console.log('\n── UN TEXTO SIN CONVERSACIÓN VIVA NO ES PARA AQUÍ ──');
reiniciar(); reiniciarWA(); CACHE = {};
PADRON[0].lote = '9';
ok(_botGestionAcceso('+50769812266', { type: 'text', text: { body: 'cuanto debo?' } }, '') === null,
   'devuelve null y el bot sigue su camino normal');

console.log('\n── EL MENSAJE QUE EL RESIDENTE LE REENVÍA AL VISITANTE ──');
// Mandárselo el sistema directamente parecía lo obvio y es lo que NO se hace: no
// tenemos su número, es un tercero que no dio su consentimiento, y Meta exige opt-in
// para las plantillas — con un WABA compartido por todas las comunidades, un número
// bloqueado las afecta a todas. Reenviado, el consentimiento es del residente.
reiniciar(); reiniciarWA(); CACHE = {};
CONFIG.NEGOCIO = 'Aires de Chicá';
CONFIG.DIRECCION = 'Entrando por la vía, después del puente, a mano derecha';
CONFIG.MAPS_URL = 'https://maps.app.goo.gl/ejemplo';
CONFIG.WAZE_URL = 'https://waze.com/ul/ejemplo';
// Escrito como lo escribe una persona, con guion. wa.me no admite guiones.
CONFIG.WA_NUMERO = '6981-2266';
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_permiso');
CLAUDE = { visitante: 'Juan Pérez', cedula: '8-123-456', lote: '' };
escribe('+50769812266', 'Juan Pérez 8-123-456');
reiniciarWA();
toca('+50769812266', 'bot_acc_si');

ok(ENVIADO.length === 2,
   'se le mandan DOS mensajes: la confirmación y el reenviable aparte → ' + ENVIADO.length);
const reenv = ENVIADO[1].texto;
ok(/Está autorizado para entrar a Aires de Chicá/.test(reenv), 'el reenviable dice a dónde');
ok(/Juan Pérez/.test(reenv), 'a quién');
ok(/Lo autoriza: 9 · Ana Rosa Tejada/.test(reenv), 'y quién lo autorizó, con su unidad');
ok(/Válido hasta el/.test(reenv), 'hasta cuándo vale');
ok(/Presente su cédula en la garita/.test(reenv), 'y qué tiene que hacer al llegar');
ok(/maps\.app\.goo\.gl/.test(reenv) && /waze\.com/.test(reenv),
   'con los dos enlaces: la gente usa uno u otro y no se convierten entre sí');
ok(/después del puente/.test(reenv), 'y la dirección en palabras, que en Panamá hace más falta que el enlace');
ok(/wa\.me\/50769812266\?text=/.test(reenv),
   'y el enlace para que el visitante mande su cédula ÉL MISMO: así la imagen no pasa ' +
   'por el teléfono del guardia → ' + (/https:\/\/wa[^\s]*/.exec(reenv) || [''])[0]);
ok(!/wa\.me\/[^\s]*[-+ ]/.test(reenv),
   'sin guiones ni signos: wa.me sólo entiende dígitos, y en la configuración está con guion');
ok(/Voy%20de%20visita/.test(reenv),
   'con el texto precargado, para que el primer mensaje traiga ya a qué casa va');

ok(ENVIADO.every(e => e.tel === '+50769812266'),
   'TODO va al residente. Al visitante no se le escribe: no tenemos su número, no dio ' +
   'su consentimiento, y un dígito mal tecleado le diría a un desconocido que la garita ' +
   'lo va a dejar pasar');
ok(!/8-123-456/.test(reenv),
   'y la cédula no viaja en el reenviable: el visitante ya sabe la suya, y ese mensaje ' +
   'puede acabar en cualquier chat');

console.log('\n── SIN DIRECCIÓN CONFIGURADA, NO SE INVENTA UNA ──');
// Un enlace de mapa escrito en el código mandaría a los visitantes de un PH a la
// puerta de otro. Es el mismo error que la cuenta bancaria y se paga más caro.
reiniciar(); reiniciarWA(); CACHE = {};
CONFIG.DIRECCION = ''; CONFIG.MAPS_URL = ''; CONFIG.WAZE_URL = '';
PADRON[0].lote = '9';
toca('+50769812266', 'bot_acc_permiso');
CLAUDE = { visitante: 'Juan Pérez', cedula: '8-123-456', lote: '' };
escribe('+50769812266', 'Juan Pérez 8-123-456');
reiniciarWA();
toca('+50769812266', 'bot_acc_si');
const sinDir = ENVIADO[1].texto;
ok(!/Cómo llegar/.test(sinDir),
   'sin nada configurado, la sección entera desaparece en vez de salir vacía');
ok(!/Maps:|Waze:/.test(sinDir), 'y no quedan etiquetas huérfanas colgando');
ok(/Está autorizado para entrar/.test(sinDir), 'el resto del mensaje sigue sirviendo');
CONFIG.NEGOCIO = 'Aires de Chicá';

console.log('\n── LA SALIDA: EL REGISTRO SE CIERRA ──');
// La columna `salida` existía desde el primer día y NADA la escribía. Un registro de
// entradas que nunca se cierra sabe quién entró y no sabe quién sigue dentro, que es
// justo lo que hace falta a las dos de la mañana.
const pide = (t) => { reiniciarWA(); return _botGuardia('+50760000000',
  { nombre: 'Garita principal' }, { type: 'text', text: { body: t } }); };

reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
guardarAutorizacion({ clave: 'Q-9', visitante: 'Luis Mendoza', cedula: '8-123-456' });
CLAUDE = { visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '' };
anuncia('Luis Mendoza 8-123-456');
ok(_sheetRows('Visitas')[0].estado === 'preautorizada', 'entra con permiso');

pide('adentro');
ok(hablo().lista && hablo().lista[0].rows.length === 1,
   'la palabra «adentro» devuelve la lista de quién está, no la trata como un anuncio');
ok(/1 visita adentro/.test(hablo().texto), 'con la cuenta: ' + hablo().texto.split('\n')[0]);
const filaSal = hablo().lista[0].rows[0];
ok(/Luis Mendoza/.test(filaSal.title), 'con su nombre');
ok(/entró/.test(filaSal.description), 'y desde cuándo está: ' + filaSal.description);

reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { button_reply: { id: filaSal.id } } });
ok(/Salió Luis Mendoza/.test(hablo().texto), 'al tocarlo se anota la salida: ' + hablo().texto.split('\n')[0]);
ok(/Estuvo/.test(hablo().texto), 'y se le dice cuánto estuvo adentro');
const vSal = _sheetRows('Visitas')[0];
ok(vSal.salida instanceof Date, 'la columna salida queda escrita, que era lo que nunca pasaba');
ok(vSal.estado === 'preautorizada',
   'y el estado NO cambia: quien entró autorizado sigue habiendo entrado autorizado');
ok(REGISTRO.some(r => r.accion === 'visita.salida'), 'queda en el registro');

pide('adentro');
ok(/No hay nadie adentro/.test(hablo().texto), 'y ya no está en la lista');

console.log('\n── UNA SALIDA NO SE ANOTA DOS VECES ──');
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { button_reply: { id: filaSal.id } } });
ok(/ya tenía salida anotada/.test(hablo().texto),
   'se avisa en vez de pisar la hora buena con una falsa: ' + hablo().texto.slice(0, 55));
ok(_sheetRows('Visitas')[0].salida.getTime() === vSal.salida.getTime(),
   'y la hora original no se toca');

console.log('\n── SÓLO ESTÁ DENTRO QUIEN EL REGISTRO DICE QUE ENTRÓ ──');
// Una visita «pendiente» no se pone en la lista aunque el guardia la haya dejado pasar
// de hecho: el sistema no sabe que entró, y ponerla ahí sería afirmar lo que nadie
// confirmó. Una rechazada, menos todavía.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Sigue Pendiente', cedula: '', lote: '9' };
anuncia('Sigue Pendiente va al 9');
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'queda pendiente, sin decidir');
ok(visitasAdentro(24).length === 0,
   'y NO figura adentro: el registro no dice que entrara');

const idPend = _sheetRows('Visitas')[0].id;
resolverVisita(idPend, 'rechazada', 'Garita principal');
ok(visitasAdentro(24).length === 0, 'una rechazada tampoco, evidentemente');
resolverVisita(idPend, 'autorizada', 'Garita principal');
ok(visitasAdentro(24).length === 1, 'en cuanto se decide que entró, aparece');

console.log('\n── LAS ENTRADAS QUE NADIE CERRÓ SE CUENTAN APARTE ──');
// Las de hoy son normales: esa gente está dentro. Las de hace días son un registro a
// medias, y no saber quién salió es no saber quién está.
HOJAS.Visitas[1][1] = new Date(Date.now() - 3 * 24 * 3600 * 1000);
ok(visitasAdentro(24).length === 0, 'una entrada de hace tres días sale de la lista del guardia');
ok(visitasAdentro(0).length === 1, 'pero NO se da por cerrada ni se borra');
let dAcc = getAccesoData('');
ok(dAcc.colgadas === 1 && dAcc.adentro === 0, 'el panel las cuenta aparte: ' +
   dAcc.adentro + ' adentro, ' + dAcc.colgadas + ' sin cerrar');
ok(dAcc.avisos.some(a => /sin salida anotada/.test(a.texto)), 'y avisa de ellas');

reiniciarWA();
pide('adentro');
ok(/No hay nadie adentro/.test(hablo().texto),
   'al guardia se le dice que no hay nadie de las últimas 24 h, sin llenarle la lista de ruido');

console.log('\n── LA CUENTA VA EN LA ENTRADA; LA LISTA, EN LA SALIDA ──');
// Mandar la lista entera en cada entrada serían cincuenta mensajes al día enterrando
// los avisos que sí hay que leer, y para cuando alguien saliera estaría vieja. La
// cuenta cabe en el mensaje que ya se manda. Después de una SALIDA sí compensa: la
// gente se va en tandas y el siguiente sale en dos minutos.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
guardarAutorizacion({ clave: 'Q-9', visitante: 'Uno Uno', cedula: '8-1-1' });
guardarAutorizacion({ clave: 'Q-9', visitante: 'Dos Dos', cedula: '8-2-2' });
CLAUDE = { visitante: 'Uno Uno', cedula: '8-1-1', lote: '' };
anuncia('Uno Uno 8-1-1');
ok(/1 visita adentro ahora/.test(hablo().texto),
   'el mensaje de entrada trae la cuenta, contando al que acaba de entrar');
ok(!hablo().lista,
   'y NO manda la lista de quién hay dentro: ni un mensaje extra ni una lista de más');

CLAUDE = { visitante: 'Dos Dos', cedula: '8-2-2', lote: '' };
anuncia('Dos Dos 8-2-2');
ok(/2 visitas adentro ahora/.test(hablo().texto), 'la cuenta sube con el segundo');

console.log('\n  · al anotar una salida, la lista actualizada');
const dentroAhora = visitasAdentro(24);
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { button_reply: { id: 'acc_sal_' + dentroAhora[0].id } } });
ok(ENVIADO.length === 2, 'se mandan dos: la confirmación y la lista → ' + ENVIADO.length);
ok(/Salió/.test(ENVIADO[0].texto), 'primero, quién salió');
ok(ENVIADO[1].lista && ENVIADO[1].lista[0].rows.length === 1,
   'y detrás quién queda, sin que tenga que pedirla');

console.log('\n  · y si no queda nadie, no se manda una lista vacía');
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { button_reply: { id: 'acc_sal_' + visitasAdentro(24)[0].id } } });
ok(ENVIADO.length === 1 && !ENVIADO[0].lista, 'sólo la confirmación');

console.log('\n── MÁS DE DIEZ ADENTRO: SE LLEGA A TODOS ──');
// WhatsApp admite diez filas por lista. La primera versión enseñaba las diez últimas
// y decía «de 15» — o sea, que a los otros cinco no había forma de anotarles la
// salida. Un tope que se anuncia sigue siendo un tope.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
_accHojas();
for (let i = 1; i <= 14; i++) {
  HOJAS.Visitas.push(['V' + i, new Date(), 'Q-9', '9', 'Visitante ' + i, '', '', '', '',
                      'autorizada', '', '', '', '', '', '', new Date()]);
}
ok(visitasAdentro(24).length === 14, 'catorce adentro');

pide('adentro');
let rows = hablo().lista[0].rows;
ok(rows.length === 10, 'la lista trae diez filas, que es el tope de WhatsApp');
ok(rows[9].id.indexOf('acc_mas_') === 0,
   'y la décima es «Ver más», no un visitante cortado: ' + rows[9].title);
ok(/Quedan 5/.test(rows[9].description), 'diciendo cuántos faltan: ' + rows[9].description);
ok(/Mostrando 1–9 de 14/.test(hablo().texto), 'y el encabezado sitúa la página');

reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { button_reply: { id: rows[9].id } } });
rows = hablo().lista[0].rows;
ok(rows.length === 5, 'la segunda página trae los cinco que faltaban: ' + rows.length);
ok(rows.every(r => r.id.indexOf('acc_sal_') === 0),
   'todos con su botón de salida: se llega a los catorce, no a diez');
ok(/Mostrando 10–14 de 14/.test(hablo().texto), 'y lo dice');

console.log('\n  · o se busca por nombre, que con treinta dentro es más rápido');
pide('adentro visitante 3');
ok(hablo().lista[0].rows.length === 1 && /Visitante 3/.test(hablo().lista[0].rows[0].title),
   'filtra por nombre');
ok(/1 de 14 casan/.test(hablo().texto), 'y dice cuántos casaron: ' + hablo().texto.split('\n')[0]);

pide('adentro zutano');
ok(/Nadie de los 14/.test(hablo().texto),
   'si no casa nadie lo dice, y recuerda cómo verlos todos: ' + hablo().texto.split('\n')[0]);

/* ═══════════════════════════════════════════════════════════════════════════
 * Lo que la administración arregla desde el panel
 * ═══════════════════════════════════════════════════════════════════════════ */
global.AC_AUTOR = 'Iris';

console.log('\n── EL PANEL NO PUEDE AUTORIZAR UNA ENTRADA ──');
// La afirmación que más importa de esta tanda. El guardia tiene el documento en la
// mano; quien mira el panel no ve a nadie. Autorizar desde aquí es autorizar a alguien
// que no se ve, fiándose de lo que leyó el sistema.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Queda Pendiente', cedula: '8-1-1', lote: '9' };
anuncia('Queda Pendiente 8-1-1 va al 9');
const vP = _sheetRows('Visitas')[0];
ok(vP.estado === 'pendiente', 'la visita queda pendiente');

let err = '';
try { cerrarVisitaDesdePanel(vP.id, 'autorizada'); } catch (x) { err = x.message; }
ok(/sólo se puede cerrar como/.test(err), 'se rechaza y se explica: ' + err.slice(0, 60));
ok(/documento delante/.test(err), 'diciendo POR QUÉ, no sólo que no');
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'y la visita no se tocó');
try { cerrarVisitaDesdePanel(vP.id, 'preautorizada'); } catch (x) { err = x.message; }
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'ni con «preautorizada» por la puerta de atrás');

console.log('\n── CERRAR UNA PENDIENTE QUE NADIE VA A DECIDIR ──');
cerrarVisitaDesdePanel(vP.id, 'sin-respuesta');
let vC = _sheetRows('Visitas')[0];
ok(vC.estado === 'sin-respuesta', 'se cierra como sin-respuesta, que es la verdad');
ok(/Administración · Iris/.test(String(vC.autorizadoPor)),
   'firmada por la administración, NO como si lo hubiera hecho el guardia: ' + vC.autorizadoPor);
err = '';
try { cerrarVisitaDesdePanel(vP.id, 'sin-respuesta'); } catch (x) { err = x.message; }
ok(/sólo se cierran las pendientes/.test(err), 'y una ya cerrada no se vuelve a cerrar');

console.log('\n── ANOTAR UNA SALIDA QUE EL GUARDIA OLVIDÓ ──');
// El panel avisaba de «2 entradas sin salida anotada» y no daba forma de cerrarlas.
// Avisar de un problema sin dar la solución es peor que no avisar.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
guardarAutorizacion({ clave: 'Q-9', visitante: 'Entró Y Nadie Anotó', cedula: '8-2-2' });
CLAUDE = { visitante: 'Entró Y Nadie Anotó', cedula: '8-2-2', lote: '' };
anuncia('Entró Y Nadie Anotó 8-2-2');
const vE = _sheetRows('Visitas')[0];
ok(vE.estado === 'preautorizada' && !vE.salida, 'entró y no tiene salida');

const rS = anotarSalidaDesdePanel(vE.id);
ok(rS.ok && _sheetRows('Visitas')[0].salida instanceof Date, 'la salida queda anotada');
ok(REGISTRO.some(r => r.accion === 'visita.salida' && /Administración · Iris/.test(r.detalle)),
   'firmada por la administración en el registro');
err = '';
try { anotarSalidaDesdePanel(vE.id); } catch (x) { err = x.message; }
ok(/Ya tenía salida/.test(err), 'y no se anota dos veces');

console.log('\n  · pero no a quien no consta que entrara');
// Anotarle la salida a una pendiente afirmaría que entró, que es justo lo que el
// registro NO dice.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Nunca Consta', cedula: '', lote: '9' };
anuncia('Nunca Consta va al 9');
err = '';
try { anotarSalidaDesdePanel(_sheetRows('Visitas')[0].id); } catch (x) { err = x.message; }
ok(/el registro no dice que entrara/.test(err),
   'se rechaza: anotar una salida afirmaría una entrada que nadie confirmó');
ok(!_sheetRows('Visitas')[0].salida, 'y no se escribió nada');

console.log('\n── CORREGIR UN DATO, DEJANDO CONSTANCIA ──');
// A diferencia de la corrección del guardia —quince minutos y antes de decidir— ésta
// vale sobre una visita ya cerrada. Si la bitácora acaba delante de un abogado, un dato
// mal leído tiene que poder arreglarse y tiene que VERSE que se arregló.
reiniciar(); reiniciarF4(); CACHE = {};
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
guardarAutorizacion({ clave: 'Q-9', visitante: 'Mal Leido', cedula: '10445031' });
CLAUDE = { visitante: 'Mal Leido', cedula: '10445031', lote: '' };
anuncia('Mal Leido 10445031');
const vM = _sheetRows('Visitas')[0];
resolverVisita(vM.id, 'autorizada', 'Garita principal');

corregirVisitaDesdePanel(vM.id, { visitante: 'Georgina Vanesa Martinez Calero', cedula: '1045031' });
const vF = _sheetRows('Visitas')[0];
ok(vF.visitante === 'Georgina Vanesa Martinez Calero' && vF.cedula === '1045031',
   'el dato queda corregido aunque la visita estuviera cerrada');
ok(/Antes decía: Mal Leido \/ 10445031/.test(String(vF.notas)),
   'con lo que decía antes, palabra por palabra: ' + String(vF.notas).slice(-55));
ok(/Administración · Iris/.test(String(vF.notas)), 'y quién lo corrigió');
ok(vF.estado === 'autorizada', 'corregir un dato NO cambia lo que pasó');

err = '';
try { corregirVisitaDesdePanel(vM.id, {}); } catch (x) { err = x.message; }
ok(/nada que corregir/.test(err), 'sin datos no se hace una corrección vacía');

console.log('\n  · y una corrección no borra la nota anterior');
corregirVisitaDesdePanel(vM.id, { cedula: '1045032' });
ok(/Mal Leido/.test(String(_sheetRows('Visitas')[0].notas)) &&
   /Georgina Vanesa Martinez Calero/.test(String(_sheetRows('Visitas')[0].notas)),
   'se apilan: el historial completo de lo que dijo esa fila');

console.log('\n── AUDITORÍA: UN PH SIN EL MÓDULO NO SE ENCUENTRA HOJAS DE ACCESO ──');
// Un disparador corre pase lo que pase, y _accSheet CREA la hoja si no está. El módulo
// promete que sus cuatro hojas sólo aparecen cuando se usa; sin esta verja, el reloj
// diario de Google se las plantaba a un PH que sólo contrató lo financiero.
const _mod = global.moduloActivo;
global.moduloActivo = (m) => m !== 'acceso';
HOJAS = {};
let rC = cerrarVisitasSinRespuesta();
ok(Object.keys(HOJAS).length === 0,
   'cerrarVisitasSinRespuesta no crea ninguna hoja: ' + Object.keys(HOJAS).join(',') || '(ninguna)');
ok(/no está activo/.test(String(rC.motivo)), 'y dice por qué no hizo nada');
capturar(); let rB = borrarFotosVencidas(); soltar();
ok(Object.keys(HOJAS).length === 0, 'borrarFotosVencidas tampoco');
ok(rB.borradas === 0 && /no está activo/.test(String(rB.motivo)), 'y lo mismo');
global.moduloActivo = _mod;
HOJAS = {};
cerrarVisitasSinRespuesta();
ok(Object.keys(HOJAS).length > 0, 'con el módulo activo sí trabaja, que es lo que tiene que hacer');

console.log('\n── AUDITORÍA: EL PANEL LEE LA HOJA DE VISITAS UNA SOLA VEZ ──');
// Pedía tres cosas de la misma hoja por separado —las últimas cien, quién está dentro y
// quién quedó sin cerrar—: tres lecturas completas en cada carga. Con unos miles de
// filas eso se nota, y crece cada día.
reiniciar(); reiniciarF4();
_accHojas();
let lecturas = 0;
const _rows = global._sheetRows;
global._sheetRows = (n) => { if (n === 'Visitas') lecturas++; return _rows(n); };
getAccesoData('');
global._sheetRows = _rows;
ok(lecturas === 1, 'una sola lectura por carga del panel, no tres: ' + lecturas);

console.log('\n── AUDITORÍA: EL MODELO SE RESUELVE AL LLAMAR ──');
// Apps Script evalúa los archivos por orden, y éste va antes que el que declara
// ANTHROPIC_MODEL: con una var de nivel superior el respaldo quedaba congelado y
// cambiar el modelo en Comprobantes no movía el lector de cédulas, sin error ni aviso.
ok(typeof _accModelo1 === 'function', 'es una función, no una var congelada al cargar');
const _am = global.ANTHROPIC_MODEL;
global.ANTHROPIC_MODEL = 'claude-otro-modelo';
ok(_accModelo1() === 'claude-otro-modelo', 'sigue al que esté puesto en Comprobantes');
global.ANTHROPIC_MODEL = undefined;
ok(_accModelo1() === 'claude-haiku-4-5', 'y sin él, cae en un respaldo que existe');
global.ANTHROPIC_MODEL = _am;

console.log('\n════════ EL VISITANTE SE ANUNCIA ÉL MISMO ════════');
// El punto de todo esto: la imagen del documento no pasa por el teléfono del guardia.
// Y las tres reglas que lo gobiernan — al visitante no se le cuenta nada de la
// comunidad, anunciarse no autoriza, y a la casa se le pregunta sólo tras el toque del
// guardia — son las que cuidan estas pruebas.
reiniciar(); reiniciarWA(); CACHE = {}; PROPS = {};
CONFIG.NEGOCIO = 'Aires de Chicá';
CONFIG.WA_NUMERO = '6981-2266';
PADRON[0].lote = '9'; PADRON[1].lote = '14';
_accHojas();
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });

const VIS = '+50761234567';
const visEscribe = (tel, t) => { reiniciarWA(); return _botVisitante(tel,
  { type: 'text', text: { body: t } }); };
const mandaFoto = (tel) => { reiniciarWA(); return _botVisitante(tel,
  { type: 'image', image: { id: 'M1' } }); };
const dice = (i) => (ENVIADO[i] || { texto: '', botones: null });

console.log('\n── UN MENSAJE QUE NO ES UN ANUNCIO NO LO TOCA ──');
ok(_botVisitante(VIS, { type: 'text', text: { body: 'hola buenas' } }) === null,
   'devuelve null y el router sigue su curso: un desconocido cualquiera recibe lo de siempre');
ok(_botVisitante(VIS, { type: 'image', image: { id: 'M1' } }) === null,
   'y una foto suelta, sin conversación abierta, tampoco es suya');

console.log('\n── PRIMER MENSAJE: EL DESTINO VIENE PRECARGADO ──');
let rv = visEscribe(VIS, 'Voy de visita al lote: 9');
ok(rv && rv.contesto === true, 'el bot sí le contesta, aunque no esté en el padrón');
ok(/foto de su c[eé]dula/i.test(hablo().texto), 'y le pide la cédula: ' + hablo().texto.slice(0, 48));
ok(/borra en el acto/.test(hablo().texto),
   'diciéndole qué se hace con ella, que es lo mínimo que se le debe a un tercero');
ok(_sheetRows('Anuncios').length === 0, 'todavía no hay anuncio: sólo dijo a dónde va');

console.log('\n── TODO EN UN SOLO MENSAJE: FOTO CON PIE DE TEXTO ──');
// En WhatsApp, si escribes y luego adjuntas, lo escrito se vuelve el pie de la foto.
// Mucha gente manda destino y cédula juntos sin proponérselo. Sin esto, ese mensaje no
// se reconocía como anuncio y el visitante caía en «no aparece en el padrón».
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Ana Gómez',
           cedula: '8-400-900', confianza: 0.95 };
// SIN conversación abierta: es un primer mensaje, que es justo lo que hay que probar.
// Con una charla a medias el destino saldría de ahí y el pie nunca se miraría — la
// prueba pasaría sin tocar el código nuevo.
reiniciarWA(); CACHE = {};
let rUno = _botVisitante(VIS, { type: 'image', image: { id: 'M1', caption: 'Voy de visita al lote: 9' } });
ok(rUno && rUno.contesto === true, 'una foto con pie SÍ es un anuncio, y se atiende');
ok(_sheetRows('Anuncios').length === 1 && _sheetRows('Anuncios')[0].clave === 'Q-9',
   'en un solo mensaje quedan el documento y el destino: ' + _sheetRows('Anuncios')[0].clave);
ok(ENVIADO.filter(e => e.tel !== VIS).length === 1,
   'y la ficha sale a la garita sin ningún ida y vuelta de por medio');
ok(!ENVIADO.some(e => e.tel === VIS && /foto de su c[eé]dula/i.test(e.texto)),
   'nunca se le pidió la foto: ya venía');

reiniciarWA(); CACHE = {};
ok(_botVisitante(VIS, { type: 'image', image: { id: 'M1', caption: 'hola qué tal' } }) === null,
   'pero un pie que no es un anuncio sigue sin ser nuestro');

console.log('\n  · y el destino se lee sólo de la primera línea');
ok(_accDestinoDicho('Voy de visita al lote: 9\n\n*Adjunta tu cédula aquí mismo*') === '9',
   'lo que venga debajo es instrucción o cortesía, no el destino');
ok(_accDestinoDicho('Voy de visita al lote: donde Ana') === 'donde Ana', 'y el nombre entero sí');

reiniciar(); reiniciarWA(); CACHE = {};
_accHojas();
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9'; PADRON[1].lote = '14';
visEscribe(VIS, 'Voy de visita al lote: 9');

console.log('\n── LA FOTO: SE LEE, SE BORRA, Y LA FICHA VA A LA GARITA ──');
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Luis Mendoza',
           cedula: '8-123-456', confianza: 0.95 };
mandaFoto(VIS);
ok(ARCHIVOS.length === 1 && DRIVE[ARCHIVOS[0].id] === false,
   'la imagen ya está en la papelera: es el motivo de existir de todo este flujo');
const an = _sheetRows('Anuncios');
ok(an.length === 1 && an[0].visitante === 'Luis Mendoza' && an[0].cedula === '8-123-456',
   'el anuncio queda con el TEXTO, que es lo que sirve');
ok(an[0].clave === 'Q-9', 'y con el destino resuelto a una unidad del padrón: ' + an[0].clave);
ok(_sheetRows('Visitas').length === 0,
   'pero NO hay visita: anunciarse no es haber estado en la garita');

const alVisitante = ENVIADO.filter(e => e.tel === VIS);
const aLaGarita = ENVIADO.filter(e => e.tel !== VIS);
ok(alVisitante.length === 1 && /Qued[oó] anotado/i.test(alVisitante[0].texto),
   'al visitante se le confirma');
ok(!/Ana Rosa/.test(alVisitante[0].texto) && !/permiso/i.test(alVisitante[0].texto),
   'y NADA de la comunidad: ni quién vive ahí, ni si hay permiso. Es un desconocido');
ok(aLaGarita.length === 1 && /Luis Mendoza/.test(aLaGarita[0].texto),
   'la ficha le llega a la garita, en el acto');
ok(/8-123-456/.test(aLaGarita[0].texto) && /Ana Rosa/.test(aLaGarita[0].texto),
   'con documento y a qué casa va, que es lo que el guardia va a comparar');
ok((aLaGarita[0].botones || []).length === 1 &&
   /Est[aá] aqu[ií]/.test(aLaGarita[0].botones[0].reply.title),
   'y un solo botón: el que confirma que la persona está presente');
ok(PLANTILLAS.length === 0,
   'A LA CASA NO SE LE HA PREGUNTADO NADA: si bastara con escribirle al bot, cualquiera ' +
   'haría sonar el teléfono de cualquier vecino escaneando el cartel');

console.log('\n── EL TOQUE DEL GUARDIA ES LO QUE DISPARA TODO ──');
reiniciarWA();
const idAn = _sheetRows('Anuncios')[0].id;
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: ACC_BOT_AQUI + idAn } } });
ok(_sheetRows('Visitas').length === 1, 'ahí sí nace la visita');
ok(/documento él mismo/.test(_sheetRows('Visitas')[0].notas),
   'y queda anotado cómo entró el dato: ' + _sheetRows('Visitas')[0].notas);
ok(String(_sheetRows('Anuncios')[0].usado || '') !== '', 'el anuncio queda marcado como usado');
ok(PLANTILLAS.length === 1 && /Luis Mendoza/.test((PLANTILLAS[0].params || []).join(' ')),
   'AHORA sí se le pregunta a la casa, y con el nombre del visitante');

reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: ACC_BOT_AQUI + idAn } } });
ok(/ya lo confirm/i.test(hablo().texto) && _sheetRows('Visitas').length === 1,
   'y tocarlo dos veces no anota dos visitas: ' + hablo().texto.slice(0, 40));

console.log('\n── CON PERMISO VIGENTE NO SE MOLESTA A NADIE ──');
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas();
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
guardarAutorizacion({ clave: 'Q-9', visitante: 'Pedro Jardinero', cedula: '8-700-100' });
PADRON[0].lote = '9';
visEscribe(VIS, 'Voy de visita al lote: 9');
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Pedro Jardinero',
           cedula: '8-700-100', confianza: 0.95 };
mandaFoto(VIS);
ok(/Tiene permiso/.test(ENVIADO.filter(e => e.tel !== VIS)[0].texto),
   'la ficha ya le dice al guardia que hay permiso, antes de que toque nada');
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { type: 'button_reply',
    button_reply: { id: ACC_BOT_AQUI + _sheetRows('Anuncios')[0].id } } });
ok(/PUEDE PASAR/.test(hablo().texto), 'y al confirmar, pasa');
ok(PLANTILLAS.length === 0,
   'sin despertar a la dueña un domingo: el permiso se revisa ANTES de preguntar');

console.log('\n── SI NO SE SABE A QUÉ CASA VA, LO RESUELVE EL GUARDIA ──');
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
visEscribe(VIS, 'Voy de visita al lote: la casa verde del portón');
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Luis Mendoza',
           cedula: '8-123-456', confianza: 0.95 };
mandaFoto(VIS);
const fichaSin = ENVIADO.filter(e => e.tel !== VIS)[0].texto;
ok(/no lo pude resolver/.test(fichaSin) && /casa verde/.test(fichaSin),
   'la ficha llega igual, con lo que DIJO y avisando que no se resolvió: ' +
   (/Va a:[^\n]*/.exec(fichaSin) || [''])[0]);
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { type: 'button_reply',
    button_reply: { id: ACC_BOT_AQUI + _sheetRows('Anuncios')[0].id } } });
ok(/NO S[ÉE] A QU[ÉE]/.test(hablo().texto), 'y el guardia lo sabe al confirmar');
const botsSinDest = (hablo().botones || []).map(b => b.reply.title);
ok(botsSinDest.length === 3 && botsSinDest.some(x => /Decir a qu[ée] casa/.test(x)),
   'con el botón para decir el destino y los de siempre: nunca se queda sin salida → ' +
   botsSinDest.join(' | '));

console.log('\n── SE RESUELVE TAMBIÉN POR EL NOMBRE DE QUIEN VIVE AHÍ ──');
// En un residencial de casas mucha gente no se sabe el número de lote.
PADRON[0].lote = '9'; PADRON[1].lote = '14';
ok(_accDestinoDe('donde Judith') === 'L-14',
   '«donde Judith» llega a su unidad: ' + _accDestinoDe('donde Judith'));
ok(_accDestinoDe('9') === 'Q-9', 'y el número también');
ok(_accDestinoDe('donde el vecino') === '',
   'pero sin un ganador claro no se adivina: avisarle a la casa equivocada es peor');

console.log('\n── UNA BANDEJA ABIERTA SE ABUSA ──');
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
for (let i = 0; i < ACC_MAX_ANUNCIOS; i++) {
  visEscribe(VIS, 'Voy de visita al lote: 9');
  CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Nombre ' + i,
             cedula: '8-000-' + i, confianza: 0.95 };
  mandaFoto(VIS);
}
reiniciarWA();
visEscribe(VIS, 'Voy de visita al lote: 9');
ok(/Pres[eé]ntese en la garita/i.test(hablo().texto),
   'pasado el tope, el bot no se calla: lo manda a la garita, que es lo que hay que hacer');
ok(_sheetRows('Anuncios').length === ACC_MAX_ANUNCIOS,
   'y no se crea un anuncio más: ' + _sheetRows('Anuncios').length);

console.log('\n── EL QUE NO VIO LA CONFIRMACIÓN Y MANDA OTRA VEZ ──');
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Luis Mendoza',
           cedula: '8-123-456', confianza: 0.95 };
visEscribe(VIS, 'Voy de visita al lote: 9'); mandaFoto(VIS);
visEscribe(VIS, 'Voy de visita al lote: 9'); mandaFoto(VIS);
ok(_sheetRows('Anuncios').length === 1,
   'una sola ficha por cédula: dos es el guardia buscando cuál de las dos toca');

console.log('\n── «PENDIENTES»: SIN ESO, EL GUARDIA VUELVE A FOTOGRAFIAR ──');
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' }, { type: 'text', text: { body: 'pendientes' } });
ok(/Luis Mendoza/.test(hablo().texto), 'le lista a quien está esperando');
ok((hablo().botones || []).length === 1, 'con su botón, para no tener que buscar la ficha vieja');
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { type: 'button_reply',
    button_reply: { id: ACC_BOT_AQUI + _sheetRows('Anuncios')[0].id } } });
reiniciarWA();
_botGuardia('+50760000000', { nombre: 'Garita principal' }, { type: 'text', text: { body: 'pendientes' } });
ok(/No hay nadie anunciado/.test(hablo().texto), 'y una vez confirmado, deja de estar pendiente');

console.log('\n════════ LOS TRES ARREGLOS CHICOS ════════');

console.log('\n── EL DESTINO SE ARREGLA SIN DUPLICAR LA VISITA ──');
// Antes, cuando el anuncio venía sin destino, al guardia se le pedía que tecleara el
// nombre y la cédula con el lote — y eso habría creado una visita NUEVA encima de la
// que ya estaba. Es el mismo error de duplicar que ya costó caro una vez.
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas();
guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
visEscribe(VIS, 'Voy de visita al lote: la casa del portón negro');
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Luis Mendoza',
           cedula: '8-123-456', confianza: 0.95 };
mandaFoto(VIS);
reiniciarWA();
const tocaG = (id) => { reiniciarWA(); return _botGuardia('+50760000000',
  { nombre: 'Garita principal' },
  { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } }); };
const escribeG = (t) => { reiniciarWA(); return _botGuardia('+50760000000',
  { nombre: 'Garita principal' }, { type: 'text', text: { body: t } }); };

tocaG(ACC_BOT_AQUI + _sheetRows('Anuncios')[0].id);
ok(/NO S[ÉE] A QU[ÉE]/.test(hablo().texto), 'la visita nace sin destino y se dice');
const bot0 = (hablo().botones || []).map(b => b.reply.title);
ok(bot0.some(t => /Decir a qu[ée] casa/.test(t)),
   'y se ofrece un BOTÓN, no un instructivo para teclear: ' + bot0.join(' | '));
ok(!/mándeme el nombre y la cédula/i.test(hablo().texto),
   'porque teclear nombre y cédula habría creado una visita nueva encima de ésta');

const idVis = _sheetRows('Visitas')[0].id;
tocaG(ACC_BOT_DEST + idVis);
ok(/a qu[ée] lote va/i.test(hablo().texto) && /no se crea otra/.test(hablo().texto),
   'el bot pide el destino, diciendo que arregla la de antes');
escribeG('9');
ok(_sheetRows('Visitas').length === 1,
   'sigue habiendo UNA visita: ' + _sheetRows('Visitas').length);
ok(_sheetRows('Visitas')[0].clave === 'Q-9', 'con su destino puesto');
ok(PLANTILLAS.length === 1, 'y AHORA se le pregunta a la casa, que antes no se podía');

console.log('\n  · un destino que no existe no se da por bueno');
// Sin esto, la visita se quedaba con la unidad vacía y preguntarALaCasa no tenía a
// quién preguntarle: el guardia creería que avisó y no avisó nadie.
reiniciarWA();
const clave0 = _sheetRows('Visitas')[0].clave;
const plant0 = PLANTILLAS.length;
tocaG(ACC_BOT_DEST + idVis);
escribeG('lote 999');
ok(/No encontr[ée] esa casa/.test(hablo().texto),
   'se le vuelve a preguntar, en vez de anotar una unidad que no existe');
ok(_sheetRows('Visitas')[0].clave === clave0 && PLANTILLAS.length === plant0,
   'y no se toca la visita ni se avisa a nadie');
_accEsperaDestino('+50760000000', null);

console.log('\n  · y si esa casa tenía permiso, entra sin molestar a nadie');
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
guardarAutorizacion({ clave: 'Q-9', visitante: 'Pedro Jardinero', cedula: '8-700-100' });
PADRON[0].lote = '9';
visEscribe(VIS, 'Voy de visita al lote: no sé');
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Pedro Jardinero',
           cedula: '8-700-100', confianza: 0.95 };
mandaFoto(VIS);
tocaG(ACC_BOT_AQUI + _sheetRows('Anuncios')[0].id);
tocaG(ACC_BOT_DEST + _sheetRows('Visitas')[0].id);
escribeG('donde Ana');
ok(/PUEDE PASAR/.test(hablo().texto), 'al poner el destino aparece el permiso: ' + hablo().texto.slice(0, 30));
ok(PLANTILLAS.length === 0, 'y no se molestó a la casa');

console.log('\n── QUIÉN AUTORIZÓ, CUANDO EL RESIDENTE LLAMA A LA GARITA ──');
// El atajo más usado: el residente llama a la garita en vez de contestarle al bot. La
// bitácora decía que lo decidió el guardia. No es falso, pero no es lo que pasó.
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
guardarContacto({ clave: 'Q-9', nombre: 'Ana Rosa', celular: '6981-2266', autoriza: 'si' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '9' };
escribeG('Luis Mendoza 8-123-456 va al lote 9');
const vId = _sheetRows('Visitas')[0].id;
ok(_sheetRows('Visitas')[0].estado === 'pendiente', 'la visita queda esperando a la casa');

tocaG(ACC_BOT_SI + vId);
ok(/Lo autoriz[óo] alguien de la casa/i.test(hablo().texto),
   'al dejarlo pasar sin que la casa contestara, se pregunta quién autorizó');
ok((hablo().botones || []).some(b => /decisi[óo]n m[ií]a/i.test(b.reply.title)),
   'con salida para el caso normal: si nadie llamó, un toque y listo');
escribeG('Ana Rosa');
ok(/llam[óo]/.test(_sheetRows('Visitas')[0].autorizadoPor) &&
   /Ana Rosa/.test(_sheetRows('Visitas')[0].autorizadoPor),
   'y la bitácora deja de decir que lo decidió el guardia: ' + _sheetRows('Visitas')[0].autorizadoPor);

console.log('\n  · si fue decisión suya, no se le insiste');
reiniciarWA(); CACHE = {};
CLAUDE = { visitante: 'Marta Ruiz', cedula: '8-999-111', lote: '9' };
escribeG('Marta Ruiz 8-999-111 va al lote 9');
const vId2 = _sheetRows('Visitas')[1].id;
tocaG(ACC_BOT_SI + vId2);
tocaG(ACC_BOT_MIO + vId2);
ok(/a su nombre/.test(hablo().texto), 'se cierra sin cambiar nada');
ok(/Guardia/.test(_sheetRows('Visitas')[1].autorizadoPor),
   'y queda a nombre del guardia, que es lo que pasó: ' + _sheetRows('Visitas')[1].autorizadoPor);

console.log('\n  · y la pregunta no se traga al siguiente que llega');
// El guardia tiene gente esperando. Con la pregunta abierta, lo siguiente que escriba
// puede ser el anuncio del que acaba de llegar. Tragárselo como «quién autorizó» dejaba
// a esa persona sin visita anotada y al guardia creyendo que sí. La pregunta es
// opcional; el anuncio no.
reiniciarWA(); CACHE = {};
CLAUDE = { visitante: 'Carlos Ruiz', cedula: '8-321-654', lote: '9' };
escribeG('Carlos Ruiz 8-321-654 va al lote 9');
const antesN = _sheetRows('Visitas').length;
tocaG(ACC_BOT_SI + _sheetRows('Visitas')[antesN - 1].id);
CLAUDE = { visitante: 'María López', cedula: '8-555-222', lote: '9' };
escribeG('María López 8-555-222 va al lote 9');
ok(_sheetRows('Visitas').length === antesN + 1,
   'el anuncio del siguiente SÍ crea su visita: ' + _sheetRows('Visitas').length);
ok(_sheetRows('Visitas')[antesN].visitante === 'María López',
   'y es la persona que llegó, no un nombre metido en la casilla de quién autorizó');

console.log('\n  · y no se pregunta cuando la casa YA había contestado');
reiniciarWA(); CACHE = {};
CLAUDE = { visitante: 'Pedro Solís', cedula: '8-777-222', lote: '9' };
escribeG('Pedro Solís 8-777-222 va al lote 9');
const vId3 = _sheetRows('Visitas')[2].id;
resolverVisitaPorResidente(vId3, 'autorizada', 'Ana Rosa');
tocaG(ACC_BOT_SI + vId3);
ok(!/alguien de la casa/i.test(hablo().texto),
   'con el «Autorizo» del bot no hay nada que averiguar: ' + hablo().texto.slice(0, 40));

console.log('\n── LO TECLEADO TAMBIÉN SE PUEDE CORREGIR ──');
// Un nombre mal escrito se reconoce igual. Un dígito cambiado en la cédula no: en la
// bitácora queda apuntando a una persona real que no estuvo ahí. Y lo tecleado de noche
// no lo revisó ningún modelo.
reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
PADRON[0].lote = '9';
CLAUDE = { visitante: 'Joce Peres', cedula: '8-123-457', lote: '9' };
escribeG('Joce Peres 8-123-457 va al lote 9');
const botT = (hablo().botones || []).map(b => b.reply.title);
ok(botT.some(t => /Corregir/.test(t)),
   'lo que tecleó el guardia se puede corregir: ' + botT.join(' | '));

reiniciar(); reiniciarWA(); CACHE = {};
_accHojas(); guardarGarita({ nombre: 'Garita principal', celular: '6000-0000' });
CLAUDE = { esCedula: true, tipoDoc: 'cedula', visitante: 'Joslyn Alonso Lopez Albelo',
           cedula: '8-743-456', confianza: 0.95 };
foto();
const botF = (hablo().botones || []).map(b => b.reply.title);
ok(!botF.some(t => /Corregir/.test(t)),
   'pero una lectura limpia no: ofrecer corregir lo que está bien invita a tocarlo');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
