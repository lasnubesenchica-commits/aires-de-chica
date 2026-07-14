/**
 * Configuración editable desde el panel (sección Opciones/Admin).
 *
 * Guarda los parámetros en Script Properties y los fusiona con los valores
 * por defecto de CONFIG. El motor de estado de cuenta y los correos leen de
 * aquí, así que cambiar la cuota o la mora afecta los cálculos de inmediato.
 *
 * Notificaciones:
 *   - notifOnPago: enviar estado de cuenta al consolidar un pago (inmediato).
 *   - notifRecordatorio + recordatorioDia: recordatorio mensual (trigger).
 *   - notifMora + moraDia: aviso de mora mensual (trigger).
 */

var CFG_PROP = 'AC_CONFIG';
var _cfgCache = null;

function _cfgDefaults() {
  return {
    cuotaBase:         CONFIG.CUOTA_BASE,     // B/. por lote / mes
    cabanaFee:         CONFIG.CABANA_FEE,     // B/. por cabaña / mes
    moraPct:           CONFIG.MORA_PCT * 100, // porcentaje (10 = 10%)
    moraDesde:         CONFIG.MORA_DESDE,     // 'YYYY-MM'
    airbnbPct:         30,                    // % de incremento sobre la cuota para lotes con AirBnB
    enviosActivos:     false,                 // INTERRUPTOR MAESTRO. Apagado = no sale ningún correo por ninguna vía.
    modoPrueba:        false,                 // Si está activo, TODO correo se redirige a `correoPrueba` (para probar sin avisar a nadie).
    correoPrueba:      '',                     // dirección única a la que llegan los correos en modo prueba.
    notifOnPago:       true,
    notifRecordatorio: false,
    recordatorioDia:   1,
    notifMora:         false,
    moraDia:           5
  };
}

function _cfg() {
  if (_cfgCache) return _cfgCache;
  var stored = {};
  var raw = PropertiesService.getScriptProperties().getProperty(CFG_PROP);
  if (raw) { try { stored = JSON.parse(raw); } catch (e) {} }
  var d = _cfgDefaults(), out = {};
  Object.keys(d).forEach(function (k) { out[k] = (stored[k] !== undefined && stored[k] !== null) ? stored[k] : d[k]; });
  _cfgCache = out;
  return out;
}

// cuota mensual de una cuenta:
//   - si el propietario tiene una cuota fija (cuotaMensual > 0), esa manda;
//   - si no, usa la cuota global de Opciones (cuotaBase);
//   - luego, si el lote opera AirBnB, aplica el incremento configurado.
function cuotaDe(prop) {
  var c = _cfg();
  var base = (Number(prop.cuotaMensual) > 0) ? Number(prop.cuotaMensual) : c.cuotaBase;
  if (prop.airbnb) base = base * (1 + (Number(c.airbnbPct) || 0) / 100);
  return _round2(base);
}

/* ─────────────── endpoints ─────────────── */

function getConfig() {
  var c = _cfg();
  return {
    config: c,
    banco: { banco: CONFIG.BANCO, tipo: CONFIG.CUENTA_TIPO, numero: CONFIG.CUENTA_NUM, nombre: CONFIG.CUENTA_NOMBRE },
    triggers: _listNotifTriggers(),
    moneda: CONFIG.MONEDA
  };
}

function guardarConfig(nueva) {
  var d = _cfgDefaults(), clean = {};
  Object.keys(d).forEach(function (k) { clean[k] = (nueva && nueva[k] !== undefined) ? nueva[k] : d[k]; });
  // saneo
  clean.cuotaBase = Math.max(0, Number(clean.cuotaBase) || 0);
  clean.cabanaFee = Math.max(0, Number(clean.cabanaFee) || 0);
  clean.moraPct = Math.max(0, Number(clean.moraPct) || 0);
  clean.airbnbPct = Math.max(0, Number(clean.airbnbPct) || 0);
  clean.moraDesde = /^\d{4}-\d{2}$/.test(String(clean.moraDesde)) ? clean.moraDesde : d.moraDesde;
  clean.recordatorioDia = Math.min(28, Math.max(1, Number(clean.recordatorioDia) || 1));
  clean.moraDia = Math.min(28, Math.max(1, Number(clean.moraDia) || 1));
  clean.enviosActivos = !!clean.enviosActivos;
  clean.modoPrueba = !!clean.modoPrueba;
  clean.correoPrueba = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(clean.correoPrueba || '').trim())
    ? String(clean.correoPrueba).trim() : '';
  clean.notifOnPago = !!clean.notifOnPago;
  clean.notifRecordatorio = !!clean.notifRecordatorio;
  clean.notifMora = !!clean.notifMora;

  PropertiesService.getScriptProperties().setProperty(CFG_PROP, JSON.stringify(clean));
  _cfgCache = null;

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

function reconcileTriggers(cfg) {
  cfg = cfg || _cfg();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'recordatorioMensual' || h === 'avisoDeMora') ScriptApp.deleteTrigger(t);
  });
  if (cfg.notifRecordatorio) {
    ScriptApp.newTrigger('recordatorioMensual').timeBased().onMonthDay(cfg.recordatorioDia).atHour(8).create();
  }
  if (cfg.notifMora) {
    ScriptApp.newTrigger('avisoDeMora').timeBased().onMonthDay(cfg.moraDia).atHour(8).create();
  }
}

// Ejecuta esto UNA vez en el editor si el panel avisa que faltan permisos.
function activarNotificaciones() {
  reconcileTriggers(_cfg());
  return _listNotifTriggers();
}

function recordatorioMensual() { return enviarRecordatorios('mensual'); }
function avisoDeMora()         { return enviarRecordatorios('mora'); }

function _listNotifTriggers() {
  return ScriptApp.getProjectTriggers()
    .filter(function (t) { return ['recordatorioMensual', 'avisoDeMora'].indexOf(t.getHandlerFunction()) >= 0; })
    .map(function (t) {
      return { funcion: t.getHandlerFunction() };
    });
}
