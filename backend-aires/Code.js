/**
 * Aires de Chicá — Sistema de estados de cuenta y cobros de mantenimiento.
 * Router principal (doGet / doPost). Un proyecto Apps Script por comunidad.
 *
 * Lecturas  (JSONP, doGet):   ping, getDashboard, getEstadoCuenta, getPropietarios
 * Escrituras (fetch, doPost):  seedInicial, ensureSheets, registrarPago,
 *                              conciliarBanco, consolidarPagos, enviarEstado,
 *                              enviarRecordatorios
 *
 * Convención: UI en español, código/comentarios en inglés/español mezclado
 * (igual que el resto del stack BalanceClip).
 */

var CONFIG = {
  NEGOCIO:        'Aires de Chicá',
  RAZON_SOCIAL:   'Aires de Chica, S.A.',
  // Si se deja vacío y el script está ligado a un Sheet, usa el Sheet activo.
  SHEET_ID:       '1S-mea6zy87PwYFuwtbb4hqHX8LaK7sHW4zqX5kk2_4E',
  ADMIN_EMAIL:    'admin@airesdechica.org',
  REPLY_TO:       'admin@airesdechica.org',
  COMPROBANTES_EMAIL: 'comprobantes@airesdechica.org', // alias/reenvío a admin@
  // Logo servido desde GitHub Pages (dominio propio de Aires de Chicá).
  LOGO_URL:       'https://admin.airesdechica.org/logo-airesdechica.jpeg',
  LOGO_PNG_URL:   'https://admin.airesdechica.org/logo-airesdechica.jpeg',

  // Datos de cobro
  BANCO:          'Banco General',
  CUENTA_TIPO:    'Cuenta de ahorros',
  CUENTA_NUM:     '04-02-98-706290-3',
  CUENTA_NOMBRE:  'Aires de Chica, S.A.',

  // Reglas de la cuota (confirmadas con el cliente)
  CUOTA_BASE:     45.00,   // B/. por lote / mes
  CABANA_FEE:     13.50,   // B/. por cabaña / mes
  MORA_PCT:       0.10,    // 10% mensual
  MORA_DESDE:     '2026-04', // primera cuota que genera mora (abril 2026)
  DUE_DAY:        0,       // 0 = vence fin de mes; la mora corre el mes siguiente
  ANIO_ACTUAL:    2026,
  MONEDA:         'B/.',
  TZ:             'America/Panama'
};

var AC_MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
var AC_MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                      'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/* ─────────────────────────── Router ─────────────────────────── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  var out;
  try {
    if (action === 'ping')           out = { ok: true, negocio: CONFIG.NEGOCIO, ts: new Date().toISOString() };
    else if (action === 'getAuthState')    out = { ok: true, data: getAuthState() };
    else if (action === 'getDashboard')    { requireAuth(p.token); out = { ok: true, data: buildDashboard(p.asOf || null) }; }
    else if (action === 'getPropietarios') { requireAuth(p.token); out = { ok: true, data: getPropietarios(p.todos === '1') }; }
    else if (action === 'getPagos')        { requireAuth(p.token); out = { ok: true, data: getPagos() }; }
    else if (action === 'getComprobantes') { requireAuth(p.token); out = { ok: true, data: getComprobantes(p.estado || null) }; }
    else if (action === 'auditarDuplicados') { requireAuth(p.token); out = { ok: true, data: auditarDuplicados(p.tolDias) }; }
    else if (action === 'previsualizarComprobante') { requireAuth(p.token); out = { ok: true, data: previsualizarComprobante(p.clave, p.monto) }; }
    else if (action === 'getEstadoCuenta') { requireAuth(p.token); out = { ok: true, data: getEstadoCuentaByKey(p.clave) }; }
    else if (action === 'getConfig')       { requireAuth(p.token); out = { ok: true, data: getConfig() }; }
    else if (action === 'getGastosData')   { requireAuth(p.token); out = { ok: true, data: getGastosData(p.anio) }; }
    else out = { ok: false, error: 'accion desconocida: ' + action };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return _reply(out, p.callback);
}

function doPost(e) {
  var data = {};
  try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) {}
  var action = data.action || '';
  var out;
  try {
    // acciones de autenticación (públicas)
    if (action === 'verifyPassword')        return _reply({ ok: true, data: verifyPassword(data.password) }, null);
    if (action === 'setPassword')           return _reply({ ok: true, data: setPassword(data.nueva, data.actual) }, null);
    if (action === 'resetPassword')         return _reply({ ok: true, data: resetPassword(data.resetToken, data.nueva) }, null);

    // el resto exige token válido (permite bootstrap si aún no hay contraseña)
    requireAuth(data.token);
    if (action === 'ensureSheets')          out = { ok: true, data: ensureSheets() };
    else if (action === 'seedInicial')      out = { ok: true, data: seedInicial(!!data.force) };
    else if (action === 'registrarPago')    out = { ok: true, data: registrarPago(data.pago) };
    else if (action === 'eliminarPago')     out = { ok: true, data: eliminarPago(data.id) };
    else if (action === 'registrarGasto')   out = { ok: true, data: registrarGasto(data.gasto) };
    else if (action === 'registrarGastosBatch') out = { ok: true, data: registrarGastosBatch(data.gastos) };
    else if (action === 'actualizarGasto')  out = { ok: true, data: actualizarGasto(data.id, data.datos || {}) };
    else if (action === 'eliminarGasto')    out = { ok: true, data: eliminarGasto(data.id) };
    else if (action === 'guardarGastoRecurrente') out = { ok: true, data: guardarGastoRecurrente(data.plantilla) };
    else if (action === 'eliminarGastoRecurrente') out = { ok: true, data: eliminarGastoRecurrente(data.id) };
    else if (action === 'guardarPresupuesto') out = { ok: true, data: guardarPresupuesto(data.anio, data.presupuesto || {}) };
    else if (action === 'guardarGastoCategorias') out = { ok: true, data: guardarGastoCategorias(data.categorias || []) };
    else if (action === 'seedGastos2026')   out = { ok: true, data: seedGastos2026(!!data.force) };
    else if (action === 'seedRecurrentes')  out = { ok: true, data: seedRecurrentes(!!data.force) };
    else if (action === 'conciliarBanco')   out = { ok: true, data: conciliarBanco(data.rows, data.filename) };
    else if (action === 'consolidarPagos')  out = { ok: true, data: consolidarPagos(data.pagos, !!data.enviarCorreos) };
    else if (action === 'enviarEstado')     out = { ok: true, data: enviarEstadoCuenta(data.clave) };
    else if (action === 'enviarRecordatorios') out = { ok: true, data: enviarRecordatorios(data.tipo, data.claves || null) };
    else if (action === 'enviarPruebaEstado')  out = { ok: true, data: enviarPruebaEstado(data.email, data.tipo, data.clave) };
    else if (action === 'guardarConfig')    out = { ok: true, data: guardarConfig(data.config) };
    else if (action === 'setPropLotes')     out = { ok: true, data: setPropLotes(data.clave, data.lotes) };
    else if (action === 'setPropCabanas')   out = { ok: true, data: setPropCabanas(data.clave, data.cabanas) };
    else if (action === 'setPropSaldo2025') out = { ok: true, data: setPropSaldo2025(data.clave, data.saldo2025) };
    else if (action === 'setPropInicio')    out = { ok: true, data: setPropInicio(data.clave, data.inicio) };
    else if (action === 'capturarComprobantes') out = { ok: true, data: capturarComprobantes() };
    else if (action === 'resolverComprobante')  out = { ok: true, data: resolverComprobante(data) };
    else if (action === 'setPropCuota')     out = { ok: true, data: setPropCuota(data.clave, data.cuota) };
    else if (action === 'setMoraCondon')    out = { ok: true, data: setMoraCondon(data.clave, data.mes, !!data.condonar) };
    else if (action === 'addPropietario')   out = { ok: true, data: addPropietario(data.prop) };
    else if (action === 'setPropActivo')    out = { ok: true, data: setPropActivo(data.clave, !!data.activo) };
    else if (action === 'eliminarPropietario') out = { ok: true, data: eliminarPropietario(data.clave) };
    else out = { ok: false, error: 'accion desconocida: ' + action };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), stack: String(err && err.stack || '') };
  }
  return _reply(out, null);
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function _reply(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function _ss() {
  if (CONFIG.SHEET_ID) return SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('No hay SHEET_ID configurado y el script no está ligado a un Sheet.');
}

function _money(n) {
  n = Number(n) || 0;
  return CONFIG.MONEDA + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function _today() { return new Date(); }
