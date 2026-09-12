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

/**
 * CONFIG — la identidad de ESTA comunidad.
 *
 * Lo que manda son las Propiedades del script: AC_NEGOCIO, AC_SHEET_ID, AC_CUENTA_NUM…
 * Los valores de abajo son sólo el respaldo mientras dura la migración, y quedarán
 * vacíos en cuanto esta comunidad tenga sus propiedades puestas.
 *
 * La razón es concreta: el despliegue automático sobrescribe el código en cada push a
 * main, así que una copia para otro PH no puede llevar sus datos aquí dentro — se le
 * borrarían solos. Y con los datos en el código, una copia mal configurada mandaría a
 * los propietarios de un PH a la cuenta bancaria de otro.
 *
 * Se arma aquí mismo, sin llamar a ninguna función de otro archivo: en Apps Script el
 * código de nivel superior de un archivo corre antes de que existan las funciones de
 * los archivos que se evalúan después, y a CONFIG lo usa medio sistema.
 */
var CONFIG = (function () {
  // Nada de esto identifica a ninguna comunidad. Los datos viven en las Propiedades
  // del script —AC_NEGOCIO, AC_SHEET_ID, AC_CUENTA_NUM…— y se ponen con
  // configurarCliente(). Lo que queda aquí es sólo lo que NO cambia entre copias, más
  // valores neutros que fallan de forma visible y barata:
  //
  //   · cuota y mora en 0        — una copia sin configurar no cobra de más; no cobra.
  //   · cuenta de cobro vacía    — el bot deriva a una persona en vez de dar una
  //                                cuenta ajena, que era el riesgo de dejarla escrita.
  //   · SHEET_ID vacío           — usa la hoja a la que esté ligado el script.
  //   · año en curso             — un 0 rompería todo cálculo; el año de hoy es la
  //                                única suposición razonable.
  //
  // Ejecuta verConfiguracionCliente() para ver qué falta en esta copia.
  var d = {
    NEGOCIO:        '',
    RAZON_SOCIAL:   '',
    SHEET_ID:       '',
    ADMIN_EMAIL:    '',
    REPLY_TO:       '',
    COMPROBANTES_EMAIL: '',
    WEBAPP_URL:     '',
    LOGO_URL:       '',
    LOGO_PNG_URL:   '',

    BANCO:          '',
    CUENTA_TIPO:    '',
    CUENTA_NUM:     '',
    CUENTA_NOMBRE:  '',

    CUOTA_BASE:     0,
    CABANA_FEE:     0,
    MORA_PCT:       0,
    MORA_DESDE:     '',
    DUE_DAY:        0,                        // 0 = vence fin de mes
    ANIO_ACTUAL:    new Date().getFullYear(),

    // Lo único que de verdad no cambia entre comunidades: son de Panamá.
    MONEDA:         'B/.',
    TZ:             'America/Panama'
  };
  try {
    var p = PropertiesService.getScriptProperties().getProperties() || {};
    Object.keys(d).forEach(function (k) {
      var v = p['AC_' + k];
      if (v === undefined || v === null || String(v).trim() === '') return;
      if (typeof d[k] === 'number') {
        var n = Number(v);
        if (!isNaN(n)) d[k] = n;          // una propiedad ilegible no pisa el valor neutro
      } else {
        d[k] = String(v).trim();
      }
    });
  } catch (e) {
    // Sin acceso a propiedades —contexto sin autorizar— se sigue con los neutros.
  }
  return d;
})();

var AC_MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
var AC_MESES_LARGO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                      'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/* ─────────────────────────── Router ─────────────────────────── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  var out;

  // Verificación del webhook de WhatsApp. Meta llama con hub.mode y espera el
  // hub.challenge en TEXTO PLANO: va antes del try/JSON porque no comparte formato, y
  // antes de cualquier requireAuth porque Meta no tiene token del panel.
  if (typeof _whatsappHandleVerify === 'function' && (p['hub.mode'] || p.hub_mode)) {
    var _waV = _whatsappHandleVerify(p);
    if (_waV) return _waV;
  }

  // Páginas públicas de comunicados: devuelven HTML, no JSON, y no llevan token de
  // panel — el enlace ya trae el token personal del propietario (ver
  // AiresChica_Comunicados.gs). Van antes del try/JSON porque no comparten formato.
  if (action === 'verComunicado')   return verComunicadoWeb(p.id, p.t);
  if (action === 'misComunicados')  return misComunicadosWeb(p.t);
  if (action === 'acuseComunicado') return acuseComunicadoWeb(p.id, p.t);

  try {
    if (action === 'ping')           out = { ok: true, negocio: CONFIG.NEGOCIO, ts: new Date().toISOString() };
    else if (action === 'getAuthState')    out = { ok: true, data: getAuthState() };
    else if (action === 'getPropuesta')     out = { ok: true, data: getPropuesta() };
    else if (action === 'getContrato')      out = { ok: true, data: getContrato() };
    else if (action === 'getComunicadoDoc')  out = { ok: true, data: getComunicadoDoc() };
    else if (action === 'getDashboard')    { requireAuth(p.token); out = { ok: true, data: buildDashboard(p.asOf || null) }; }
    else if (action === 'getPropietarios') { requireAuth(p.token); out = { ok: true, data: getPropietarios(p.todos === '1') }; }
    else if (action === 'getPagos')        { requireAuth(p.token); out = { ok: true, data: getPagos() }; }
    else if (action === 'getComprobantes') { requireAuth(p.token); out = { ok: true, data: getComprobantes(p.estado || null) }; }
    else if (action === 'auditarDuplicados') { requireAuth(p.token); out = { ok: true, data: auditarDuplicados(p.tolDias) }; }
    else if (action === 'previsualizarComprobante') { requireAuth(p.token); out = { ok: true, data: previsualizarComprobante(p.clave, p.monto) }; }
    else if (action === 'getEstadoCuenta') { requireAuth(p.token);
      // simFecha + simMonto: calcula el estado COMO SI ese pago ya estuviera
      // registrado, sin escribir nada (comparar antes/después de cargar un pago).
      var _sim = (p.simFecha && Number(p.simMonto) > 0) ? { fecha: p.simFecha, monto: Number(p.simMonto) } : null;
      out = { ok: true, data: getEstadoCuentaByKey(p.clave, _sim) }; }
    else if (action === 'getConfig')       { requireAuth(p.token); out = { ok: true, data: getConfig() }; }
    else if (action === 'getGastosData')   { requireAuth(p.token); out = { ok: true, data: getGastosData(p.anio) }; }
    else if (action === 'getBalance')      { requireAuth(p.token); out = { ok: true, data: getBalance(p.asOf || null) }; }
    else if (action === 'estadoUpdateJulio') { requireAuth(p.token); out = { ok: true, data: estadoUpdateJulio() }; }
    else if (action === 'getCuentasData')  { requireAuth(p.token); out = { ok: true, data: getCuentasData() }; }
    else if (action === 'getSaldosCuentas'){ requireAuth(p.token); out = { ok: true, data: saldosPorCuenta(p.asOf || null) }; }
    else if (action === 'getTraspasos')    { requireAuth(p.token); out = { ok: true, data: getTraspasos() }; }
    else if (action === 'getRegistro')     { requireAuth(p.token); out = { ok: true, data: getRegistro({
        desde: p.desde, hasta: p.hasta, autor: p.autor, accion: p.accionFiltro, q: p.q, limite: p.limite }) }; }
    else if (action === 'getAutores')      { requireAuth(p.token); out = { ok: true, data: getAutores(p.dispositivo) }; }
    else if (action === 'getComunicados')  { requireAuth(p.token); out = { ok: true, data: getComunicados(p.limite) }; }
    else if (action === 'getComunicadoDetalle') { requireAuth(p.token); out = { ok: true, data: getComunicadoDetalle(p.id) }; }
    // cola de salida por canal — la consumirá el bot de WhatsApp
    else if (action === 'getEnviosPendientes')   { requireAuth(p.token); out = { ok: true, data: getEnviosPendientes(p.canal, p.limite) }; }
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
  // Quién dice ser el que hace el cambio. La bitácora lo usa como autor.
  // Es una identidad DECLARADA por el panel, no autenticada: el sistema tiene una
  // sola contraseña compartida. Al haber multiusuario real, _autor() debe leer la
  // sesión y este renglón sobra.
  AC_AUTOR = String(data.autor || '').trim().slice(0, 60);
  // Dispositivo desde el que se escribe. Lo usa el padrón de usuarios para que un
  // nombre ya reservado no se pueda usar desde otro equipo (AiresChica_Usuarios.gs).
  var AC_DISP = String(data.dispositivo || '').trim().slice(0, 80);
  var out;

  // Mensajes entrantes de WhatsApp. Va lo primero, antes del enrutado por `action` y
  // de cualquier comprobación de sesión: el webhook de Meta no lleva token de panel ni
  // campo `action`, y devuelve siempre 200 para que Meta no reintente. Si el contenido
  // no es suyo, devuelve null y el panel sigue su camino normal.
  if (typeof _whatsappHandleWebhook === 'function') {
    var _waR = _whatsappHandleWebhook(data);
    if (_waR) return _waR;
  }

  try {
    // acciones de autenticación (públicas)
    if (action === 'verifyPassword')        return _reply({ ok: true, data: verifyPassword(data.password) }, null);
    if (action === 'setPassword')           return _reply({ ok: true, data: setPassword(data.nueva, data.actual) }, null);
    if (action === 'resetPassword')         return _reply({ ok: true, data: resetPassword(data.resetToken, data.nueva) }, null);
    // guardado del contrato: público (para que el Cliente pueda editar/sugerir sin la contraseña del panel)
    if (action === 'guardarContrato')       return _reply({ ok: true, data: guardarContrato(data.html, data.quien, data.version) }, null);
    if (action === 'guardarComunicadoDoc')  return _reply({ ok: true, data: guardarComunicadoDoc(data.html, data.quien, data.version) }, null);

    // el resto exige token válido (permite bootstrap si aún no hay contraseña)
    requireAuth(data.token);
    // …y además exige saber QUIÉN lo hace. Se valida en el servidor, no sólo en el
    // panel: cualquiera con el token podría hacer un POST directo sin identificarse
    // y la bitácora quedaría con cambios anónimos.
    // El padrón de usuarios se resuelve ANTES de exigir identidad: son justamente
    // las acciones con las que alguien se identifica o recupera su nombre, así que
    // pedirles un autor ya validado sería circular. Ver AiresChica_Usuarios.gs.
    if (action === 'claimAutor')            return _reply({ ok: true, data: claimAutor(data.nombre, AC_DISP, data.clave) }, null);
    if (action === 'moverAutor')            return _reply({ ok: true, data: moverAutor(data.nombre, AC_DISP, data.password) }, null);
    // A quien le quitaron su nombre no puede escribir con él: descartar su propio
    // aviso tiene que poder hacerlo igual, así que va antes de exigir identidad.
    if (action === 'marcarAvisoVisto')      return _reply({ ok: true, data: marcarAvisoVisto(data.id, AC_DISP) }, null);

    requireAutor(action);
    // …y que ese nombre sea de QUIEN dice serlo: si ya está reservado por otro
    // dispositivo, la escritura se corta.
    requireAutorDispositivo(action, AC_AUTOR, AC_DISP);
    // Las acciones de Opciones (reglas del sistema, cargas masivas, envíos de prueba)
    // piden además la contraseña, aunque la sesión ya esté abierta.
    requireAdmin(action, data.password);
    if (action === 'liberarAutor')          out = { ok: true, data: liberarAutor(data.nombre, AC_DISP, data.password) };
    else if (action === 'ensureSheets')     out = { ok: true, data: ensureSheets(true) };
    else if (action === 'seedInicial')      out = { ok: true, data: seedInicial(!!data.force) };
    else if (action === 'registrarPago')    out = { ok: true, data: registrarPago(data.pago) };
    else if (action === 'eliminarPago')     out = { ok: true, data: eliminarPago(data.id) };
    else if (action === 'actualizarPago')   out = { ok: true, data: actualizarPago(data.id, data.datos || {}) };
    else if (action === 'generarVoucherPago') out = { ok: true, data: generarVoucherPago(data.id, { forzar: !!data.forzar }) };
    else if (action === 'emitirConstanciasFaltantes') out = { ok: true, data: emitirConstanciasFaltantes(data.origen, data.limite) };
    else if (action === 'seedRegistro18Ago') out = { ok: true, data: seedRegistro18Ago(!!data.force) };
    else if (action === 'rollbackSeedRegistro18Ago') out = { ok: true, data: rollbackSeedRegistro18Ago() };
    else if (action === 'registrarGasto')   out = { ok: true, data: registrarGasto(data.gasto) };
    else if (action === 'registrarOtroIngreso') out = { ok: true, data: registrarOtroIngreso(data.ingreso || {}) };
    else if (action === 'eliminarOtroIngreso')  out = { ok: true, data: eliminarOtroIngreso(data.id) };
    else if (action === 'registrarGastosBatch') out = { ok: true, data: registrarGastosBatch(data.gastos) };
    else if (action === 'actualizarGasto')  out = { ok: true, data: actualizarGasto(data.id, data.datos || {}) };
    else if (action === 'eliminarGasto')    out = { ok: true, data: eliminarGasto(data.id) };
    else if (action === 'guardarGastoRecurrente') out = { ok: true, data: guardarGastoRecurrente(data.plantilla) };
    else if (action === 'eliminarGastoRecurrente') out = { ok: true, data: eliminarGastoRecurrente(data.id) };
    else if (action === 'guardarPartidaBalance')  out = { ok: true, data: guardarPartidaBalance(data.partida || {}) };
    else if (action === 'eliminarPartidaBalance') out = { ok: true, data: eliminarPartidaBalance(data.id) };
    else if (action === 'registrarAbonoBalance')  out = { ok: true, data: registrarAbonoBalance(data.partidaId, data.abono || {}) };
    else if (action === 'eliminarAbonoBalance')   out = { ok: true, data: eliminarAbonoBalance(data.id) };
    else if (action === 'guardarCuenta')      out = { ok: true, data: guardarCuenta(data.cuenta || {}) };
    else if (action === 'eliminarCuenta')     out = { ok: true, data: eliminarCuenta(data.id) };
    else if (action === 'marcarCuentaCobro')  out = { ok: true, data: marcarCuentaCobro(data.id) };
    else if (action === 'registrarTraspaso')  out = { ok: true, data: registrarTraspaso(data.traspaso || {}) };
    else if (action === 'eliminarTraspaso')   out = { ok: true, data: eliminarTraspaso(data.id) };
    else if (action === 'guardarPresupuesto') out = { ok: true, data: guardarPresupuesto(data.anio, data.presupuesto || {}) };
    else if (action === 'guardarGastoCategorias') out = { ok: true, data: guardarGastoCategorias(data.categorias || []) };
    else if (action === 'seedGastos2026')   out = { ok: true, data: seedGastos2026(!!data.force) };
    else if (action === 'seedRecurrentes')  out = { ok: true, data: seedRecurrentes(!!data.force) };
    else if (action === 'actualizarJulio2026') out = { ok: true, data: actualizarJulio2026(!!data.force) };
    else if (action === 'rollbackJulio2026')   out = { ok: true, data: rollbackJulio2026() };
    else if (action === 'descargarInformePL') out = { ok: true, data: descargarInformePL(data.anio, data.mesIni, data.mesFin, data.nota) };
    else if (action === 'enviarInformePL')  out = { ok: true, data: enviarInformePL(data.anio, data.mesIni, data.mesFin, data.nota) };
    else if (action === 'conciliarBanco')   out = { ok: true, data: conciliarBanco(data.rows, data.filename) };
    else if (action === 'consolidarPagos')  out = { ok: true, data: consolidarPagos(data.pagos, !!data.enviarCorreos) };
    // El contexto sólo cambia la redacción. Se filtra contra una lista blanca: desde
    // el modal únicamente tienen sentido el genérico y el del cierre del mes, y un
    // valor suelto haría que el correo se presentara como algo que no es —un aviso de
    // mora, por ejemplo— sin que nadie lo hubiera pedido.
    else if (action === 'enviarEstado')     { var _cx = (data.contexto === 'estado') ? 'estado' : '';
                                              out = { ok: true, data: enviarEstadoCuenta(data.clave, _cx) }; }
    else if (action === 'enviarRecordatorios') out = { ok: true, data: enviarRecordatorios(data.tipo, data.claves || null) };
    else if (action === 'enviarPruebaEstado')  out = { ok: true, data: enviarPruebaEstado(data.email, data.tipo, data.clave) };
    else if (action === 'enviarPruebaAlertaUsuario') out = { ok: true, data: enviarPruebaAlertaUsuario(data.email) };
    else if (action === 'guardarComunicado')  out = { ok: true, data: guardarComunicado(data.comunicado || {}) };
    else if (action === 'eliminarComunicado') out = { ok: true, data: eliminarComunicado(data.id) };
    else if (action === 'enviarComunicado')   out = { ok: true, data: enviarComunicado(data.id, {}) };
    else if (action === 'reenviarComunicado') out = { ok: true, data: reenviarComunicado(data.id, data.claves || []) };
    else if (action === 'enviarPruebaComunicado') out = { ok: true, data: enviarPruebaComunicado(data.id, data.email) };
    else if (action === 'previsualizarComunicado') out = { ok: true, data: previsualizarComunicado(data.comunicado || {}) };
    else if (action === 'marcarEnvio')        out = { ok: true, data: marcarEnvio(data.envioId, data.estado, data.error) };
    else if (action === 'guardarConfig')    out = { ok: true, data: guardarConfig(data.config) };
    else if (action === 'guardarPropuesta') out = { ok: true, data: guardarPropuesta(data.html, data.quien, data.version) };
    else if (action === 'setPropLotes')     out = { ok: true, data: setPropLotes(data.clave, data.lotes) };
    else if (action === 'setPropCabanas')   out = { ok: true, data: setPropCabanas(data.clave, data.cabanas) };
    else if (action === 'setPropSaldo2025') out = { ok: true, data: setPropSaldo2025(data.clave, data.saldo2025) };
    else if (action === 'setPropInicio')    out = { ok: true, data: setPropInicio(data.clave, data.inicio) };
    else if (action === 'capturarComprobantes') out = { ok: true, data: capturarComprobantes() };
    else if (action === 'resolverComprobante')  out = { ok: true, data: resolverComprobante(data) };
    else if (action === 'setPropCuota')     out = { ok: true, data: setPropCuota(data.clave, data.cuota) };
    else if (action === 'setMoraCondon')    out = { ok: true, data: setMoraCondon(data.clave, data.mes, !!data.condonar) };
    else if (action === 'addPropietario')   out = { ok: true, data: addPropietario(data.prop) };
    else if (action === 'actualizarPropietario') out = { ok: true, data: actualizarPropietario(data.clave, data.datos || {}) };
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
