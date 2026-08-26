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

/**
 * Avisos para el dispositivo DESPLAZADO.
 *
 * Mover o liberar un nombre ajeno exige la contraseña del panel, que es una sola para
 * todos: no se puede impedir. Lo que sí se puede es que el dueño se entere. Cuando a
 * un equipo le quitan su nombre se le deja aquí un aviso, y su panel lo muestra en
 * cuanto vuelva a abrirlo — sin depender de que intente escribir para chocar.
 */
var USU_AVISOS_PROP = 'AC_USU_AVISOS';
var USU_AVISOS_MAX  = 60;

function _avLeer() {
  var raw = PropertiesService.getScriptProperties().getProperty(USU_AVISOS_PROP);
  if (!raw) return [];
  try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function _avGuardar(a) {
  PropertiesService.getScriptProperties().setProperty(USU_AVISOS_PROP, JSON.stringify(a || []));
}
// tipo: 'movido' (se lo llevaron a otro equipo) | 'liberado' (lo soltaron y quedó libre)
function _avPush(disp, tipo, nombre, quien, correo) {
  disp = _usuDisp(disp);
  if (!disp) return;
  var a = _avLeer();
  a.unshift({ id: 'A' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000),
              disp: disp, tipo: tipo, nombre: nombre,
              quien: String(quien || '').slice(0, 60), cuando: new Date().toISOString(),
              correo: correo || null });   // { enviado, email } o el motivo por el que no salió
  _avGuardar(a.slice(0, USU_AVISOS_MAX));
}
function _avDe(disp) {
  disp = _usuDisp(disp);
  if (!disp) return [];
  return _avLeer().filter(function (x) { return x.disp === disp; });
}
/** El dueño ya vio el aviso. Sólo puede descartar los suyos. */
function marcarAvisoVisto(id, dispositivo) {
  var disp = _usuDisp(dispositivo);
  var a = _avLeer(), antes = a.length;
  a = a.filter(function (x) { return !(x.id === id && x.disp === disp); });
  _avGuardar(a);
  return { ok: true, borrado: antes !== a.length, quedan: _avDe(disp).length };
}

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
 * Quien usa el panel es propietario, así que su correo sale de la hoja Propietarios.
 * Al identificarse se guarda la CLAVE del lote junto al nombre; de ahí se resuelve el
 * correo en el momento de avisar, para que un cambio de correo en la hoja se respete
 * sin tener que re-identificarse.
 */
function _usuCorreoDe(clave) {
  var k = String(clave || '').trim();
  if (!k) return { clave: '', nombre: '', email: '' };
  var p = null;
  getPropietarios(true).forEach(function (x) { if (String(x.clave).trim() === k) p = x; });
  if (!p) return { clave: k, nombre: '', email: '' };
  return { clave: k, nombre: String(p.nombre || ''), email: String(p.email || '').trim() };
}

/** Lista ligera de lotes para el selector de identidad (sin correos ni saldos). */
function _usuLotes() {
  return getPropietarios(true).map(function (p) {
    return { clave: String(p.clave).trim(), nombre: String(p.nombre || ''),
             lote: String(p.lote || ''), residencial: String(p.residencial || ''),
             tieneCorreo: !!String(p.email || '').trim() };
  }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
}

/**
 * Correo de alerta a quien le quitaron su nombre del panel.
 *
 * Respeta el interruptor maestro y el modo prueba igual que el resto de los envíos:
 * mientras `enviosActivos` esté apagado no sale nada, y la alerta en pantalla sigue
 * funcionando igual. Devuelve qué pasó para dejarlo anotado en el propio aviso.
 */
function _avisarPorCorreo(u, tipo, quien) {
  var cfg = _cfg();
  var info = _usuCorreoDe(u && u.clave);
  if (!info.email) return { enviado: false, motivo: 'sin-correo' };
  if (!cfg.enviosActivos) return { enviado: false, motivo: 'envios-pausados', email: info.email };
  var prueba = !!(cfg.modoPrueba && cfg.correoPrueba);
  var destino = prueba ? cfg.correoPrueba : info.email;
  var B = AC_BRAND;
  var fecha = Utilities.formatDate(new Date(), CONFIG.TZ, 'dd/MM/yyyy') + ' a las ' +
              Utilities.formatDate(new Date(), CONFIG.TZ, 'HH:mm');
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var qué = (tipo === 'movido')
    ? 'Alguien pasó tu nombre <b>«' + esc(u.nombre) + '»</b> a <b>otro dispositivo</b>.'
    : 'Alguien <b>liberó</b> tu nombre <b>«' + esc(u.nombre) + '»</b> en el panel, y quedó disponible para que cualquiera lo tome.';
  var deQuién = quien ? ' La sesión que lo hizo estaba identificada como <b>' + esc(quien) + '</b>.' : '';
  var asunto = (prueba ? '[PRUEBA→' + info.email + '] ' : '') +
    '⚠️ Tu nombre en el panel de ' + CONFIG.NEGOCIO + ' cambió de manos';
  var cuerpo = _emailShell(
    '<p style="font-size:16px;font-weight:700;color:' + B.coral + ';margin:0 0 10px">Tu nombre en el panel cambió de manos</p>' +
    '<p>' + qué + deQuién + ' Desde ese momento, tu equipo dejó de poder firmar cambios con ese nombre.</p>' +
    '<div style="background:#fff5f2;border-left:4px solid ' + B.coral + ';padding:11px 14px;border-radius:6px;margin:14px 0">' +
      '<b>Si no fuiste tú, avísale a la Junta cuanto antes.</b><br>' +
      'Para hacerlo hubo que escribir la contraseña del panel, y la acción quedó anotada en el ' +
      '<b>Registro</b> con fecha, hora y quién estaba identificado.</div>' +
    '<p style="color:' + B.muted + ';font-size:12.5px">Ocurrió el ' + fecha + ' (hora de Panamá).<br>' +
    'Si fuiste tú —por ejemplo, porque cambiaste de computadora— puedes ignorar este correo.</p>');
  try {
    GmailApp.sendEmail(destino, asunto,
      'Alguien cambió de dispositivo el nombre con el que firmas en el panel de ' + CONFIG.NEGOCIO +
      '. Si no fuiste tú, avísale a la Junta.',
      { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: cuerpo });
  } catch (e) {
    return { enviado: false, motivo: String(e && e.message || e), email: info.email };
  }
  _reg('usuario.alerta', { clave: info.clave, propietario: u.nombre, campo: 'correo',
                           despues: destino,
                           detalle: 'Alerta enviada: le ' + (tipo === 'movido' ? 'movieron' : 'liberaron') + ' su nombre del panel' });
  return { enviado: true, email: destino, prueba: prueba, destinatarioReal: info.email };
}

/**
 * Prueba explícita de la alerta, para verificar el formato antes de abrir los envíos.
 * Es un envío a una dirección dada, así que NO depende del interruptor maestro —igual
 * que `enviarPruebaEstado`.
 */
function enviarPruebaAlertaUsuario(email) {
  var to = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Escribe un correo válido para la prueba.');
  var B = AC_BRAND;
  var cuerpo = _emailShell(
    '<p style="font-size:16px;font-weight:700;color:' + B.coral + ';margin:0 0 10px">Tu nombre en el panel cambió de manos</p>' +
    '<p>Alguien pasó tu nombre <b>«Ejemplo»</b> a <b>otro dispositivo</b>. La sesión que lo hizo estaba identificada como <b>Otra persona</b>. Desde ese momento, tu equipo dejó de poder firmar cambios con ese nombre.</p>' +
    '<div style="background:#fff5f2;border-left:4px solid ' + B.coral + ';padding:11px 14px;border-radius:6px;margin:14px 0">' +
      '<b>Si no fuiste tú, avísale a la Junta cuanto antes.</b><br>' +
      'Para hacerlo hubo que escribir la contraseña del panel, y la acción quedó anotada en el ' +
      '<b>Registro</b> con fecha, hora y quién estaba identificado.</div>' +
    '<p style="color:' + B.muted + ';font-size:12.5px">Éste es un <b>correo de prueba</b>: nadie tocó ningún nombre.</p>');
  GmailApp.sendEmail(to, '[PRUEBA] ⚠️ Tu nombre en el panel de ' + CONFIG.NEGOCIO + ' cambió de manos',
    'Prueba de la alerta de cambio de identidad.',
    { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: cuerpo });
  return { enviado: true, email: to };
}

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
    var info = _usuCorreoDe(u.clave);
    out.push({ nombre: u.nombre, mio: mio, creado: u.creado || '', ultimo: u.ultimo || '',
               clave: u.clave || '', email: info.email || '' });
  });
  out.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
  var yoU = yo ? reg[_usuClave(yo)] : null;
  return { usuarios: out, yo: yo, yoClave: (yoU && yoU.clave) || '',
           avisos: _avDe(disp), lotes: _usuLotes() };
}

/**
 * Reserva un nombre para este dispositivo.
 *   libre           -> lo aparta y lo anota en la bitácora
 *   ya es suyo      -> no hace nada (idempotente), sólo refresca la última vez
 *   es de otro      -> lanza 'nombre-tomado'
 */
function claimAutor(nombre, dispositivo, clave) {
  var nom = _usuLimpio(nombre), disp = _usuDisp(dispositivo);
  if (!nom) throw new Error('Escribe un nombre para identificarte.');
  if (!disp) throw new Error('No se pudo identificar este dispositivo. Recarga el panel.');
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) {}
  try {
    var reg = _usuLeer(), k = _usuClave(nom), u = reg[k];
    if (u && u.dispositivo && u.dispositivo !== disp) throw new Error('nombre-tomado');
    var nuevo = !u;
    // el lote se puede fijar al identificarse y corregir después sin perder la reserva
    var cla = (clave === undefined || clave === null) ? ((u && u.clave) || '') : String(clave || '').trim();
    reg[k] = { nombre: u ? u.nombre : nom, dispositivo: disp, clave: cla,
               creado: (u && u.creado) || new Date().toISOString(),
               ultimo: new Date().toISOString() };
    _usuGuardar(reg);
    if (nuevo) {
      AC_AUTOR = reg[k].nombre;   // para que la propia alta quede firmada por quien la hace
      _reg('usuario.alta', { clave: cla, propietario: reg[k].nombre, campo: 'usuario',
                             despues: reg[k].nombre, detalle: 'Nombre reservado para este dispositivo' });
    }
    return { ok: true, nombre: reg[k].nombre, nuevo: nuevo, clave: cla,
             email: _usuCorreoDe(cla).email };
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
  var quienLoHizo = String(AC_AUTOR || '').trim();   // antes de que AC_AUTOR se reescriba
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) {}
  try {
    var reg = _usuLeer(), k = _usuClave(nom), u = reg[k];
    if (!u) return claimAutor(nom, disp);
    if (u.dispositivo === disp) return { ok: true, nombre: u.nombre, movido: false };
    var antes = u.dispositivo, duenoAnterior = { nombre: u.nombre, clave: u.clave || '' };
    u.dispositivo = disp; u.ultimo = new Date().toISOString();
    reg[k] = u; _usuGuardar(reg);
    // al equipo que se queda sin el nombre se le deja un aviso — y un correo, si los
    // envíos están abiertos y el propietario tiene dirección en la hoja.
    var mail = _avisarPorCorreo(duenoAnterior, 'movido', quienLoHizo);
    _avPush(antes, 'movido', u.nombre, quienLoHizo, mail);
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
    var quien = reg[k].nombre, dispAnterior = reg[k].dispositivo;
    var dueno = { nombre: quien, clave: reg[k].clave || '' };
    delete reg[k]; _usuGuardar(reg);
    // si le soltaron el nombre a otra persona, su equipo se entera al volver a entrar
    // —y por correo, si los envíos están abiertos.
    if (!esMio) {
      var mail = _avisarPorCorreo(dueno, 'liberado', String(AC_AUTOR || '').trim());
      _avPush(dispAnterior, 'liberado', quien, String(AC_AUTOR || '').trim(), mail);
    }
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
