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

function reiniciar() {
  HOJAS = {};
  REGISTRO = [];
  DRIVE = {};
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

global.DriveApp = { getFileById: id => {
  if (!(id in DRIVE)) throw new Error('archivo no encontrado');
  return { setTrashed: v => { DRIVE[id] = !v; } };
} };
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
const hace = d => { const f = new Date(); f.setDate(f.getDate() - d); return f; };
// Ids de Drive del largo real (33 caracteres). Con ids cortos la prueba pasaba
// por el camino equivocado y no se veía que la foto seguía en Drive.
const ID_VIEJA = '1F62Z1LPLqrz0Efkq1diNhWrPMGdP9QsO';
const ID_NUEVA = '1n943waWOiseWJgKJbQLos5qv1hkTn5zJ';
DRIVE[ID_VIEJA] = true; DRIVE[ID_NUEVA] = true;
HOJAS.Visitas.push(['V1', hace(120), 'Q-9', '9', 'Luis Mendoza', '8-123-456', 'visita', '',
  'Garita principal', 'autorizada', 'Ana Rosa', hace(120),
  'https://drive.google.com/file/d/' + ID_VIEJA + '/view', '', '', '', hace(120)]);
HOJAS.Visitas.push(['V2', hace(10), 'Q-9', '9', 'Marta Ruiz', '8-999-111', 'visita', '',
  'Garita principal', 'autorizada', 'Ana Rosa', hace(10),
  'https://drive.google.com/file/d/' + ID_NUEVA + '/view', '', '', '', hace(10)]);

capturar(); r = borrarFotosVencidas(); let txt = soltar();
ok(r.seBorrarian === 1 && DRIVE[ID_VIEJA] === true,
   'sin confirmar dice cuántas borraría y no borra ninguna');
ok(/irreversible/.test(txt), 'y avisa de que no tiene vuelta atrás');

capturar(); r = borrarFotosVencidas(true); soltar();
ok(r.borradas === 1, 'confirmando borra una');
ok(DRIVE[ID_VIEJA] === false, 'la de 120 días se va a la papelera');
ok(DRIVE[ID_NUEVA] === true, 'y la de 10 días se queda: el plazo son 90');
ok(HOJAS.Visitas.length === 3, 'la VISITA no se borra: quién entró y cuándo es un registro legítimo');
ok(String(HOJAS.Visitas[1][12]) === '' && HOJAS.Visitas[1][13] instanceof Date,
   'se le quita la URL y queda anotada la fecha de borrado');
capturar(); r = borrarFotosVencidas(true); soltar();
ok(r.borradas === 0, 'volver a correrlo no intenta borrar lo ya borrado');

// Lo que destapó esta prueba la primera vez: si el id no se puede leer de la URL,
// el archivo NO se borra. Marcar la fila igual sería decir que la foto ya no está
// cuando sigue en Drive, y nadie vuelve a mirar una fila que dice «borrada».
HOJAS.Visitas.push(['V3', hace(200), 'Q-9', '9', 'Pedro Solís', '8-777-222', 'visita', '',
  'Garita principal', 'autorizada', 'Ana Rosa', hace(200),
  'https://algun-sitio.com/foto.jpg', '', '', '', hace(200)]);
capturar(); r = borrarFotosVencidas(true); txt = soltar();
ok(r.borradas === 0 && r.sinBorrar === 1, 'una URL sin id de Drive no se cuenta como borrada');
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
// Lo importante: si la autorización TIENE cédula, el nombre solo no abre la puerta.
ok(autorizacionVigente('Q-9', { visitante: 'Luis Mendoza' }) === null,
   'un desconocido que dice llamarse Luis Mendoza NO entra: la autorización lleva cédula');

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

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);
