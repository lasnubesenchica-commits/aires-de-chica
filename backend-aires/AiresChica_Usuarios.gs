/**
 * Padrón de usuarios del panel: cada nombre queda apartado para un dispositivo.
 *
 * El problema que resuelve: el autor de la bitácora era texto libre. Cualquiera podía
 * escribir "Josh" y firmar cambios a su nombre, o crear un "JOSH" que en la práctica
 * es la misma persona partida en dos. Con el padrón, el primero que usa un nombre lo
 * reserva para SU dispositivo, y desde otro navegador ese nombre aparece tomado y no
 * se puede escoger.
 *
 * ALCANCE — esto NO es autenticación. El sistema sigue teniendo una sola contraseña
 * compartida, así que quien la tenga puede montar un POST a mano. Lo que se evita es
 * el choque accidental y que alguien se ponga el nombre de otro desde el panel. La
 * identidad de verdad llega cuando cada persona tenga su propia contraseña y _autor()
 * lea la sesión en vez de lo que declara el panel.
 *
 * Almacenamiento: Script Property `AC_USUARIOS`, un objeto
 *   { <claveNormalizada>: { nombre, dispositivo, creado, ultimo } }
 * La clave normaliza tildes, mayúsculas y espacios, de modo que "José" y "jose"
 * son el mismo usuario y no se pueden reservar por separado.
 *
 * Endpoints:
 *   getAutores(dispositivo)              -> { usuarios:[…], yo }
 *   claimAutor(nombre, dispositivo)      -> reserva; lanza 'nombre-tomado' si es de otro
 *   moverAutor(nombre, dispositivo, pwd) -> pasa un nombre propio a este equipo
 *   liberarAutor(nombre)                 -> suelta el nombre (desde Opciones)
 */

var USU_PROP = 'AC_USUARIOS';
var USU_MAX  = 60;   // largo máximo del nombre

function _usuLeer() {
  var raw = PropertiesService.getScriptProperties().getProperty(USU_PROP);
  if (!raw) return {};
  try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; }
  catch (e) { return {}; }
}
function _usuGuardar(o) {
  PropertiesService.getScriptProperties().setProperty(USU_PROP, JSON.stringify(o || {}));
}

// Nombre tal como se muestra: sin espacios de sobra y acotado.
function _usuLimpio(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, USU_MAX); }

// Clave de comparación: sin tildes, sin mayúsculas, sin espacios repetidos. Es lo que
// impide que "IRIS", "Iris" e "irís" convivan como tres usuarios distintos.
function _usuClave(n) {
  return _usuLimpio(n)
    .toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U').replace(/Ñ/g, 'N')
    .replace(/\s+/g, ' ');
}

function _usuDisp(d) { return String(d || '').trim().slice(0, 80); }

/**
 * Lista para el selector del panel. No exige dispositivo: sin él, todos los nombres
 * salen como ajenos, que es justo lo que hay que mostrar.
 */
function getAutores(dispositivo) {
  var disp = _usuDisp(dispositivo), reg = _usuLeer(), out = [], yo = '';
  Object.keys(reg).forEach(function (k) {
    var u = reg[k] || {};
    var mio = !!disp && u.dispositivo === disp;
    if (mio) yo = u.nombre;
    out.push({ nombre: u.nombre, mio: mio, creado: u.creado || '', ultimo: u.ultimo || '' });
  });
  out.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
  return { usuarios: out, yo: yo };
}

/**
 * Reserva un nombre para este dispositivo.
 *   libre           -> lo aparta y lo anota en la bitácora
 *   ya es suyo      -> no hace nada (idempotente), sólo refresca la última vez
 *   es de otro      -> lanza 'nombre-tomado'
 */
function claimAutor(nombre, dispositivo) {
  var nom = _usuLimpio(nombre), disp = _usuDisp(dispositivo);
  if (!nom) throw new Error('Escribe un nombre para identificarte.');
  if (!disp) throw new Error('No se pudo identificar este dispositivo. Recarga el panel.');
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) {}
  try {
    var reg = _usuLeer(), k = _usuClave(nom), u = reg[k];
    if (u && u.dispositivo && u.dispositivo !== disp) throw new Error('nombre-tomado');
    var nuevo = !u;
    reg[k] = { nombre: u ? u.nombre : nom, dispositivo: disp,
               creado: (u && u.creado) || new Date().toISOString(),
               ultimo: new Date().toISOString() };
    _usuGuardar(reg);
    if (nuevo) {
      AC_AUTOR = reg[k].nombre;   // para que la propia alta quede firmada por quien la hace
      _reg('usuario.alta', { propietario: reg[k].nombre, campo: 'usuario',
                             despues: reg[k].nombre, detalle: 'Nombre reservado para este dispositivo' });
    }
    return { ok: true, nombre: reg[k].nombre, nuevo: nuevo };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/**
 * Pasa un nombre ya reservado a este dispositivo (cambio de equipo o de navegador).
 * Pide la contraseña del panel: no es una barrera fuerte —es la misma para todos—
 * pero obliga a un acto deliberado y deja rastro en la bitácora.
 */
function moverAutor(nombre, dispositivo, password) {
  var nom = _usuLimpio(nombre), disp = _usuDisp(dispositivo);
  if (!nom || !disp) throw new Error('Faltan datos para mover el nombre.');
  var v = verifyPassword(password);
  if (!v || !v.ok) throw new Error('La contraseña no coincide.');
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) {}
  try {
    var reg = _usuLeer(), k = _usuClave(nom), u = reg[k];
    if (!u) return claimAutor(nom, disp);
    if (u.dispositivo === disp) return { ok: true, nombre: u.nombre, movido: false };
    var antes = u.dispositivo;
    u.dispositivo = disp; u.ultimo = new Date().toISOString();
    reg[k] = u; _usuGuardar(reg);
    AC_AUTOR = u.nombre;
    _reg('usuario.mueve', { propietario: u.nombre, campo: 'dispositivo',
                            antes: String(antes).slice(0, 8) + '…', despues: disp.slice(0, 8) + '…',
                            detalle: 'El nombre pasa a otro dispositivo' });
    return { ok: true, nombre: u.nombre, movido: true };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/**
 * Suelta un nombre: vuelve a quedar disponible para quien lo tome.
 *
 * El PROPIO nombre se suelta sin más. El de otra persona exige la contraseña del
 * panel, porque si no bastaba con identificarse con cualquier nombre libre, liberar
 * el ajeno y reclamarlo acto seguido: tres clics y la reserva no servía de nada.
 */
function liberarAutor(nombre, dispositivo, password) {
  var nom = _usuLimpio(nombre);
  if (!nom) throw new Error('Falta el nombre.');
  var actual = _usuLeer()[_usuClave(nom)];
  var esMio = !!(actual && actual.dispositivo && _usuDisp(dispositivo) &&
                 actual.dispositivo === _usuDisp(dispositivo));
  if (actual && !esMio) {
    var v = verifyPassword(password);
    if (!v || !v.ok) throw new Error('Para liberar el nombre de otra persona hace falta la contraseña del panel.');
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) {}
  try {
    var reg = _usuLeer(), k = _usuClave(nom);
    if (!reg[k]) return { ok: true, liberado: false };
    var quien = reg[k].nombre;
    delete reg[k]; _usuGuardar(reg);
    _reg('usuario.libera', { propietario: quien, campo: 'usuario', antes: quien,
                             detalle: esMio ? 'Soltó su propio nombre'
                                            : 'Liberó el nombre de otra persona (con la contraseña del panel)' });
    return { ok: true, liberado: true, nombre: quien };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/**
 * Filtro que corre en CADA escritura: el nombre declarado tiene que ser de este
 * dispositivo. Va en el servidor porque el panel se puede saltar con un POST directo.
 *
 * Reglas, pensadas para no dejar a nadie fuera al desplegar por primera vez:
 *   - acción sin autor humano (arranque, informes)   -> pasa
 *   - nombre libre y llega el dispositivo            -> se reserva al vuelo
 *   - nombre libre sin dispositivo (panel viejo)     -> pasa sin reservar
 *   - nombre de ESTE dispositivo                     -> pasa
 *   - nombre de OTRO dispositivo                     -> se corta
 */
function requireAutorDispositivo(accion, nombre, dispositivo) {
  if (REG_SIN_AUTOR[accion]) return true;
  var nom = _usuLimpio(nombre);
  if (!nom) return true;                       // de la falta de nombre se encarga requireAutor()
  var reg = _usuLeer(), k = _usuClave(nom), u = reg[k];
  var disp = _usuDisp(dispositivo);
  if (!u) {
    if (disp) claimAutor(nom, disp);           // primer uso: queda apartado
    return true;
  }
  if (u.dispositivo && disp && u.dispositivo === disp) {
    // refresca la última actividad sin escribir en cada llamada
    var hoy = new Date().toISOString().slice(0, 10);
    if (String(u.ultimo || '').slice(0, 10) !== hoy) {
      u.ultimo = new Date().toISOString(); reg[k] = u; _usuGuardar(reg);
    }
    return true;
  }
  throw new Error('autor-de-otro');
}
