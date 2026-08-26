/**
 * Control de acceso del panel (contraseña).
 *
 * El hash de la contraseña vive en Script Properties (no en el código ni en
 * el Sheet público). El panel obtiene un token de sesión al verificar la
 * contraseña y lo envía en cada llamada; las acciones sensibles lo exigen.
 *
 * Endpoints:
 *   getAuthState()          -> { hasPassword }
 *   setPassword(nueva, act) -> crea/cambia la contraseña
 *   verifyPassword(pwd)     -> { ok, token }
 *   resetPassword(token,new)-> reset admin (requiere Script Property AUTH_RESET_TOKEN)
 */

var AUTH_PROP_HASH  = 'AC_AUTH_HASH';
var AUTH_PROP_SALT  = 'AC_AUTH_SALT';
var AUTH_RESET_PROP = 'AUTH_RESET_TOKEN';

function _props() { return PropertiesService.getScriptProperties(); }

function _sha256Hex(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function _hashPassword(pwd, salt) { return _sha256Hex(salt + '|' + pwd); }

// token de sesión derivado del hash (estable hasta que cambie la contraseña)
function _sessionToken() {
  var h = _props().getProperty(AUTH_PROP_HASH) || '';
  return h ? _sha256Hex(h + '|aires-session-v1') : '';
}

function getAuthState() {
  return { hasPassword: !!_props().getProperty(AUTH_PROP_HASH) };
}

function setPassword(nueva, actual) {
  if (!nueva || String(nueva).length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  var p = _props();
  var existing = p.getProperty(AUTH_PROP_HASH);
  if (existing) {
    var salt0 = p.getProperty(AUTH_PROP_SALT) || '';
    if (_hashPassword(actual || '', salt0) !== existing) {
      throw new Error('La contraseña actual no coincide.');
    }
  }
  var salt = Utilities.getUuid();
  p.setProperty(AUTH_PROP_SALT, salt);
  p.setProperty(AUTH_PROP_HASH, _hashPassword(nueva, salt));
  return { ok: true, token: _sessionToken() };
}

function verifyPassword(pwd) {
  var p = _props();
  var hash = p.getProperty(AUTH_PROP_HASH), salt = p.getProperty(AUTH_PROP_SALT) || '';
  if (!hash) return { ok: false, motivo: 'sin-contrasena' };
  if (_hashPassword(pwd || '', salt) === hash) return { ok: true, token: _sessionToken() };
  return { ok: false, motivo: 'incorrecta' };
}

function resetPassword(resetToken, nueva) {
  var expected = _props().getProperty(AUTH_RESET_PROP);
  if (!expected || resetToken !== expected) throw new Error('Token de reset inválido.');
  var salt = Utilities.getUuid();
  _props().setProperty(AUTH_PROP_SALT, salt);
  _props().setProperty(AUTH_PROP_HASH, _hashPassword(nueva, salt));
  return { ok: true };
}

// exige un token válido; si no hay contraseña configurada, permite (bootstrap)
function requireAuth(token) {
  if (!_props().getProperty(AUTH_PROP_HASH)) return true; // aún sin contraseña
  if (token && token === _sessionToken()) return true;
  throw new Error('no-auth');
}

/**
 * Acciones administrativas: además del token, exigen escribir la CONTRASEÑA.
 *
 * El token vive en el navegador, así que quien se siente frente a un panel abierto
 * ya lo tiene. Eso alcanza para el trabajo del día —registrar un pago, aplicar un
 * comprobante—, pero no para cambiar las reglas del sistema: la cuota, la mora, el
 * interruptor de envíos o una carga masiva. Esas piden la contraseña aunque la sesión
 * esté abierta, de modo que un equipo desatendido no baste para tocarlas.
 *
 * Se comprueba en el SERVIDOR y no sólo en el panel: si viviera únicamente en la
 * interfaz, un POST directo con el token se la saltaría entera.
 */
var ADMIN_ACCIONES = {
  guardarConfig: 1,              // cuota, mora, notificaciones, cuenta de cobro, envíos
  liberarAutor: 1,               // soltar un nombre del padrón de usuarios
  actualizarJulio2026: 1, rollbackJulio2026: 1,
  seedInicial: 1, seedGastos2026: 1, seedRecurrentes: 1,
  seedRegistro18Ago: 1, rollbackSeedRegistro18Ago: 1,
  enviarPruebaEstado: 1, enviarPruebaAlertaUsuario: 1,
  emitirConstanciasFaltantes: 1,
  // escriben a TODOS los propietarios de una vez
  enviarRecordatorios: 1, enviarInformePL: 1,
  enviarComunicado: 1, reenviarComunicado: 1, enviarPruebaComunicado: 1
};

function requireAdmin(accion, password) {
  if (!ADMIN_ACCIONES[accion]) return true;
  if (!_props().getProperty(AUTH_PROP_HASH)) return true;   // aún sin contraseña (bootstrap)
  var v = verifyPassword(password);
  if (v && v.ok) return true;
  throw new Error('admin-clave');
}
