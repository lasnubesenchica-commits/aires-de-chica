/**
 * Configuración editable desde el panel (sección Opciones/Admin).
 *
 * Guarda los parámetros en Script Properties y los fusiona con los valores
 * por defecto de CONFIG. El motor de estado de cuenta y los correos leen de
 * aquí, así que cambiar la cuota o la mora afecta los cálculos de inmediato.
 *
 * Notificaciones (cinco, cada una con su interruptor y su día):
 *   - notifOnPago                              confirmación inmediata al registrar un pago
 *   - notifEstadoMensual  + estadoMensualDia   estado de cuenta a TODOS (día 1–10 del mes siguiente)
 *   - notifPreaviso       + preavisoDias       aviso N días antes de que venza la cuota del mes
 *   - notifMora           + moraDia            aviso a quien arrastra cuotas vencidas
 *   - notifInformeMensual + informeMensualDia  Informe Financiero del mes cerrado
 *
 * El informe ANUAL no se automatiza: se envía a mano desde Finanzas.
 */

var CFG_PROP = 'AC_CONFIG';
var _cfgCache = null;

// Versión de la política de mora vigente. La política la fija la Junta y vive en el
// código, no en la configuración guardada: si alguien había guardado Opciones antes de
// un cambio de política, ese valor viejo se quedaba pegado en Script Properties y le
// ganaba al nuevo valor por defecto (el orden de imputación siguió siendo el anterior
// aunque el deploy hubiera pasado). Al subir esta versión, los campos de mora del
// config guardado se descartan y se re-guardan con los de la política nueva.
var MORA_POLITICA_V = '2026-08-orden-capital';
var MORA_POLITICA_CAMPOS = ['moraOrden', 'moraBase'];

function _cfgDefaults() {
  return {
    cuotaBase:         CONFIG.CUOTA_BASE,     // B/. cuota base / mes
    cabanaPct:         30,                    // % de la cuota base que suma CADA cabaña (30% de 45 = 13.50)
    moraPct:           CONFIG.MORA_PCT * 100, // porcentaje (10 = 10%)
    moraDesde:         CONFIG.MORA_DESDE,     // 'YYYY-MM'
    moraCrece:         false,                 // false = recargo fijo de una sola vez; true = crece moraPct% por mes de atraso (se congela al saldar la cuota)
    // Política de mora ratificada por la Junta (ago-2026). Ver AiresChica_EstadoCuenta.gs.
    moraOrden:         'capital',             // orden de imputación del pago:
                                              //   'capital' = cuotas vencidas -> cuota del mes en curso -> mora (ratificado)
                                              //   'cuota'   = cuotas vencidas -> mora -> cuota del mes en curso
                                              //   'mora'    = mora -> cuotas vencidas -> cuota del mes en curso
    moraBase:          'cuota',               // base del recargo: 'cuota' = 10% de la cuota íntegra vencida (ratificado); 'pendiente' = 10% de la parte sin cubrir
    moraPolitica:      MORA_POLITICA_V,       // sello de la política vigente; ver _cfg()
    enviosActivos:     false,                 // INTERRUPTOR MAESTRO. Apagado = no sale ningún correo por ninguna vía.
    modoPrueba:        false,                 // Si está activo, TODO correo se redirige a `correoPrueba` (para probar sin avisar a nadie).
    correoPrueba:      '',                     // dirección única a la que llegan los correos en modo prueba.
    // ── Notificaciones automáticas ──────────────────────────────────────────
    // Cada una tiene su interruptor y su día. Todas pasan además por el interruptor
    // maestro (enviosActivos) y por el modo prueba.
    notifOnPago:       true,     // confirmación inmediata al consolidar un pago
    notifEstadoMensual: false,   // estado de cuenta a TODOS los propietarios
    estadoMensualDia:  5,        // día del mes siguiente (el contrato exige dentro de los 10 primeros)
    notifPreaviso:     false,    // aviso preventivo antes de que la cuota del mes venza
    preavisoDias:      5,        // cuántos días ANTES de terminar el mes se avisa
    notifMora:         false,    // aviso a quien ya arrastra cuotas vencidas
    moraDia:           5,
    moraAvisoMeses:    2,        // avisar solo a quien tenga >= N meses de mora (para al bajar a N-1)
    notifInformeMensual: false,  // envío mensual del Informe Financiero a los propietarios
    informeMensualDia: 10,       // día del mes siguiente en que sale el informe del mes cerrado
    fondoInicial:      0,        // saldo/fondo disponible al inicio del año (para el Informe Financiero)
    capturaComprobantes: false,  // lee comprobantes@ 1 vez al día y los deja pendientes de revisión
    // Cuenta de cobro (editable). Se usa en correos, instructivo de pago y verificación de comprobantes.
    banco:             CONFIG.BANCO,
    cuentaTipo:        CONFIG.CUENTA_TIPO,
    cuentaNum:         CONFIG.CUENTA_NUM,
    cuentaNombre:      CONFIG.CUENTA_NOMBRE
  };
}

function _cfg() {
  if (_cfgCache) return _cfgCache;
  var stored = {};
  var raw = PropertiesService.getScriptProperties().getProperty(CFG_PROP);
  if (raw) { try { stored = JSON.parse(raw); } catch (e) {} }
  var d = _cfgDefaults(), out = {};
  Object.keys(d).forEach(function (k) { out[k] = (stored[k] !== undefined && stored[k] !== null) ? stored[k] : d[k]; });

  // Migración de política: si lo guardado quedó de una política anterior, sus campos de
  // mora se reemplazan por los vigentes y se persiste el sello, para que esto ocurra
  // una sola vez y no en cada lectura.
  if (stored.moraPolitica !== MORA_POLITICA_V) {
    MORA_POLITICA_CAMPOS.forEach(function (k) { out[k] = d[k]; stored[k] = d[k]; });
    out.moraPolitica = stored.moraPolitica = MORA_POLITICA_V;
    try { PropertiesService.getScriptProperties().setProperty(CFG_PROP, JSON.stringify(stored)); } catch (e) {}
  }

  _cfgCache = out;
  return out;
}

// cuota mensual de una cuenta:
//   - si el propietario tiene una cuota fija manual (cuotaMensual > 0), esa manda
//     (solo para casos especiales);
//   - si no: cuota base + (cabanaPct % de la base) por cada cabaña.
//     Ej: base 45, 2 cabañas, 30% -> 45 * (1 + 2*0.30) = 72.
function cuotaDe(prop) {
  var c = _cfg();
  if (Number(prop.cuotaMensual) > 0) return _round2(Number(prop.cuotaMensual));
  var cab = Math.max(0, Number(prop.cabanas) || 0);
  return _round2(c.cuotaBase * (1 + cab * (Number(c.cabanaPct) || 0) / 100));
}

/* ─────────────── endpoints ─────────────── */

function getConfig() {
  var c = _cfg();
  return {
    config: c,
    banco: { banco: c.banco, tipo: c.cuentaTipo, numero: c.cuentaNum, nombre: c.cuentaNombre },
    triggers: _listNotifTriggers(),
    moneda: CONFIG.MONEDA
  };
}

function guardarConfig(nueva) {
  var d = _cfgDefaults(), clean = {};
  Object.keys(d).forEach(function (k) { clean[k] = (nueva && nueva[k] !== undefined) ? nueva[k] : d[k]; });
  // saneo
  clean.cuotaBase = Math.max(0, Number(clean.cuotaBase) || 0);
  clean.cabanaPct = Math.max(0, Number(clean.cabanaPct) || 0);
  clean.moraPct = Math.max(0, Number(clean.moraPct) || 0);
  clean.moraDesde = /^\d{4}-\d{2}$/.test(String(clean.moraDesde)) ? clean.moraDesde : d.moraDesde;
  clean.moraCrece = !!clean.moraCrece;
  clean.moraOrden = (clean.moraOrden === 'mora' || clean.moraOrden === 'cuota') ? clean.moraOrden : 'capital';
  clean.moraBase = (clean.moraBase === 'pendiente') ? 'pendiente' : 'cuota';
  // Guardar desde Opciones es un cambio deliberado de la Junta: se sella con la política
  // vigente para que la migración no lo revierta en la siguiente lectura.
  clean.moraPolitica = MORA_POLITICA_V;
  // El contrato exige que el estado de cuenta y el informe salgan dentro de los
  // primeros 10 días del mes siguiente: el tope se impone aquí, no en el panel.
  clean.estadoMensualDia = Math.min(10, Math.max(1, Number(clean.estadoMensualDia) || 5));
  clean.informeMensualDia = Math.min(10, Math.max(1, Number(clean.informeMensualDia) || 10));
  clean.preavisoDias = Math.min(15, Math.max(1, Math.floor(Number(clean.preavisoDias) || 5)));
  clean.moraDia = Math.min(28, Math.max(1, Number(clean.moraDia) || 1));
  clean.moraAvisoMeses = Math.min(12, Math.max(1, Math.floor(Number(clean.moraAvisoMeses) || 2)));
  clean.notifEstadoMensual = !!clean.notifEstadoMensual;
  clean.notifPreaviso = !!clean.notifPreaviso;
  clean.notifInformeMensual = !!clean.notifInformeMensual;
  clean.fondoInicial = _round2(Math.max(0, Number(clean.fondoInicial) || 0));
  clean.enviosActivos = !!clean.enviosActivos;
  clean.modoPrueba = !!clean.modoPrueba;
  clean.correoPrueba = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(clean.correoPrueba || '').trim())
    ? String(clean.correoPrueba).trim() : '';
  clean.notifOnPago = !!clean.notifOnPago;
  clean.notifMora = !!clean.notifMora;
  clean.capturaComprobantes = !!clean.capturaComprobantes;
  clean.banco = String(clean.banco || '').trim() || d.banco;
  clean.cuentaTipo = String(clean.cuentaTipo || '').trim() || d.cuentaTipo;
  clean.cuentaNum = String(clean.cuentaNum || '').trim() || d.cuentaNum;
  clean.cuentaNombre = String(clean.cuentaNombre || '').trim() || d.cuentaNombre;

  // Anotar en la bitácora SÓLO los campos que realmente cambiaron: guardar Opciones
  // reescribe el objeto entero y registrarlo completo llenaría el registro de ruido.
  var _antes = _cfg();
  var _an = [];
  Object.keys(clean).forEach(function (k) {
    if (String(_antes[k]) === String(clean[k])) return;
    _an.push({ accion: 'config.edita', entidad: 'config', campo: k,
               antes: String(_antes[k]), despues: String(clean[k]), detalle: 'Opciones del sistema' });
  });
  PropertiesService.getScriptProperties().setProperty(CFG_PROP, JSON.stringify(clean));
  _cfgCache = null;
  _regBatch(_an);

  // reconciliar triggers de envío programado (puede requerir autorización)
  var triggerAviso = null;
  try {
    reconcileTriggers(clean);
  } catch (e) {
    triggerAviso = 'La configuración se guardó, pero para activar los envíos programados ' +
      'ejecuta una vez la función activarNotificaciones() en el editor de Apps Script (autoriza los permisos).';
  }
  return { ok: true, config: clean, triggers: _listNotifTriggers(), aviso: triggerAviso };
}

/* ─────────────── triggers ─────────────── */

// Handlers que este módulo administra. Los dos últimos son de esquemas anteriores
// (recordatorio a los que deben, informe trimestral): se listan para BORRAR sus
// disparadores si quedaron instalados, aunque las funciones ya no existan.
var NOTIF_HANDLERS = ['estadoCuentaMensual', 'preavisoCuota', 'avisoDeMora',
                      'informeMensual', 'capturarComprobantes'];
var NOTIF_HANDLERS_VIEJOS = ['recordatorioMensual', 'informeTrimestral'];

function reconcileTriggers(cfg) {
  cfg = cfg || _cfg();
  var todos = NOTIF_HANDLERS.concat(NOTIF_HANDLERS_VIEJOS);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (todos.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  if (cfg.notifEstadoMensual) {
    ScriptApp.newTrigger('estadoCuentaMensual').timeBased().onMonthDay(cfg.estadoMensualDia).atHour(8).create();
  }
  if (cfg.notifPreaviso) {
    // «N días antes de terminar el mes» no es un día fijo (febrero, meses de 30 y de 31),
    // así que el disparador corre A DIARIO y el handler decide si hoy toca.
    ScriptApp.newTrigger('preavisoCuota').timeBased().everyDays(1).atHour(8).create();
  }
  if (cfg.notifMora) {
    ScriptApp.newTrigger('avisoDeMora').timeBased().onMonthDay(cfg.moraDia).atHour(8).create();
  }
  if (cfg.notifInformeMensual) {
    ScriptApp.newTrigger('informeMensual').timeBased().onMonthDay(cfg.informeMensualDia).atHour(9).create();
  }
  if (cfg.capturaComprobantes) {
    ScriptApp.newTrigger('capturarComprobantes').timeBased().everyDays(1).atHour(7).create();
  }
}

// Ejecuta esto UNA vez en el editor si el panel avisa que faltan permisos.
function activarNotificaciones() {
  reconcileTriggers(_cfg());
  return _listNotifTriggers();
}

/* ─────────────── última corrida de cada tarea ───────────────
 * Apps Script no expone por API cuándo corrió por última vez un disparador ni cómo le
 * fue: eso sólo se ve entrando a Ejecuciones. Así estuvo ocho días fallando la captura
 * de comprobantes sin que se notara desde el panel. Cada tarea deja aquí su rastro y el
 * panel lo muestra al lado del interruptor.
 */
var TAREAS_PROP = 'AC_TAREAS';

function _tareasLeer() {
  try { return JSON.parse(_props().getProperty(TAREAS_PROP) || '{}'); } catch (e) { return {}; }
}

// Nunca debe tumbar la tarea que la llama: dejar de anotar es malo, no enviar es peor.
function _tareaCorrio(nombre, ok, detalle) {
  try {
    var t = _tareasLeer();
    t[nombre] = { ts: new Date().toISOString(), ok: !!ok, detalle: String(detalle || '').slice(0, 160) };
    _props().setProperty(TAREAS_PROP, JSON.stringify(t));
  } catch (e) {}
}

// Envuelve un handler programado para que quede constancia de cada corrida, salga bien
// o mal. Un error se vuelve a lanzar: Apps Script lo necesita para marcar la ejecución
// como fallida, pero antes ya quedó anotado y visible en Opciones.
function _tarea(nombre, fn) {
  try {
    var r = fn() || {};
    var detalle = r.motivo ? r.motivo
      : (r.omitido ? 'hoy no tocaba'
      : (r.enviados != null ? r.enviados + (r.objetivo != null ? ' de ' + r.objetivo : '') + ' enviado(s)'
      : 'sin novedad'));
    _tareaCorrio(nombre, true, detalle);
    return r;
  } catch (e) {
    _tareaCorrio(nombre, false, String(e && e.message || e));
    throw e;
  }
}

/* ─────────────── handlers programados ───────────────
 * Cada uno vuelve a comprobar su propio interruptor: un disparador puede sobrevivir a
 * un cambio de configuración (o haber quedado de una versión anterior), y no queremos
 * que eso baste para que salgan correos.
 */

// Estado de cuenta mensual a TODOS los propietarios (compromiso del contrato:
// dentro de los primeros 10 días del mes siguiente).
function estadoCuentaMensual() {
  return _tarea('estadoCuentaMensual', function () {
    var cfg = _cfg();
    if (!cfg.notifEstadoMensual || !cfg.enviosActivos) return { enviados: 0, motivo: 'estado mensual desactivado o envíos pausados' };
    return enviarRecordatorios('estado');
  });
}

// Aviso preventivo: faltan N días para que termine el mes y la cuota del mes en curso
// sigue sin cubrirse. El objetivo es que el propietario pague a tiempo y NO genere mora.
function preavisoCuota() {
  return _tarea('preavisoCuota', function () {
    var cfg = _cfg();
    if (!cfg.notifPreaviso || !cfg.enviosActivos) return { enviados: 0, motivo: 'preaviso desactivado o envíos pausados' };
    var hoy = new Date();
    var ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    var faltan = ultimoDia - hoy.getDate();
    if (faltan !== Math.floor(Number(cfg.preavisoDias) || 5)) {
      return { enviados: 0, omitido: true, faltan: faltan, motivo: 'faltan ' + faltan + ' días para fin de mes' };
    }
    return enviarRecordatorios('preaviso');
  });
}

function avisoDeMora() {
  return _tarea('avisoDeMora', function () {
    var cfg = _cfg();
    if (!cfg.notifMora || !cfg.enviosActivos) return { enviados: 0, motivo: 'aviso de mora desactivado o envíos pausados' };
    return enviarRecordatorios('mora');
  });
}

function _listNotifTriggers() {
  var ultimas = _tareasLeer();
  return ScriptApp.getProjectTriggers()
    .filter(function (t) { return NOTIF_HANDLERS.indexOf(t.getHandlerFunction()) >= 0; })
    .map(function (t) {
      var h = t.getHandlerFunction();
      return { funcion: h, ultima: ultimas[h] || null };
    });
}
