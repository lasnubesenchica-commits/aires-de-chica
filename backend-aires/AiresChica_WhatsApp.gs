/**
 * WhatsApp — recepción y envío por la Cloud API de Meta.
 *
 * Aires de Chicá tiene NÚMERO PROPIO, así que esto es «single-tenant»: todo lo que
 * llega a ese número es de esta comunidad y no hace falta enrutar a nadie. El webhook
 * de Meta entra directo al doPost de este mismo proyecto, que es el patrón que ya usa
 * ContaFácil cuando no hay router de por medio.
 *
 * Propiedades del script (Configuración → Propiedades del script):
 *   META_VERIFY_TOKEN    — una frase inventada; tiene que coincidir con la que se
 *                          escribe en Meta al dar de alta el webhook.
 *   META_WHATSAPP_TOKEN  — token permanente (el de usuario del sistema, NO el de
 *                          prueba: ese caduca en 24 horas).
 *   META_PHONE_ID        — el `phone_number_id` que da Meta. No es el número.
 *
 * ── Sobre la seguridad de esta puerta ──────────────────────────────────────────
 * Meta firma cada webhook con la cabecera `X-Hub-Signature-256`, y `doPost(e)` de
 * Apps Script NO da acceso a las cabeceras: esa firma no se puede verificar. Lo que
 * protege esto es que la URL del despliegue es larga e impredecible, más comprobar la
 * forma del contenido antes de hacerle caso. Es lo mismo que hace el router de
 * BalanceClip en producción. Conviene saberlo y no descubrirlo después.
 *
 * Por eso este módulo NO escribe nada en el sistema todavía: reconoce, registra y
 * responde. Aplicar pagos o cambiar datos desde aquí es un paso posterior y deliberado.
 */

var WA_PROP_VERIFY = 'META_VERIFY_TOKEN';
var WA_PROP_TOKEN  = 'META_WHATSAPP_TOKEN';
var WA_PROP_PHONE  = 'META_PHONE_ID';
var WA_GRAPH       = 'https://graph.facebook.com/v21.0';
var SH_WA          = 'WhatsApp';
var COL_WA         = ['id', 'fecha', 'direccion', 'telefono', 'clave', 'nombre',
                      'tipo', 'texto', 'estado', 'nota'];

function _waProps() { return PropertiesService.getScriptProperties(); }
function _waToken() { return String(_waProps().getProperty(WA_PROP_TOKEN) || '').trim(); }
function _waPhoneId() { return String(_waProps().getProperty(WA_PROP_PHONE) || '').trim(); }

/**
 * Verificación del webhook (doGet).
 *
 * Meta llama una sola vez, al dar de alta la URL, con hub.mode=subscribe. Hay que
 * devolverle el hub.challenge TAL CUAL, en texto plano y sin nada alrededor: si se
 * envuelve en JSON, la verificación falla y el mensaje de Meta no dice por qué.
 *
 * Devuelve null cuando la petición no es de Meta, para que doGet siga su camino.
 */
function _whatsappHandleVerify(params) {
  var modo = params['hub.mode'] || params.hub_mode || '';
  if (!modo) return null;
  var token = params['hub.verify_token'] || params.hub_verify_token || '';
  var reto  = params['hub.challenge'] || params.hub_challenge || '';
  var esperado = String(_waProps().getProperty(WA_PROP_VERIFY) || '').trim();
  if (modo === 'subscribe' && esperado && String(token) === esperado) {
    return ContentService.createTextOutput(String(reto));
  }
  // 403 no se puede devolver desde Apps Script; se responde algo que no es el reto,
  // que para Meta equivale a rechazo.
  Logger.log('WhatsApp: verificación rechazada (modo=%s, token recibido=%s)', modo,
    token ? '«' + String(token).slice(0, 4) + '…»' : '(vacío)');
  return ContentService.createTextOutput('no');
}

/**
 * Entrada de mensajes (doPost).
 *
 * Devuelve null si el contenido no es un webhook de WhatsApp, para que doPost siga con
 * el enrutado normal del panel. Si lo es, SIEMPRE responde 200 —incluso ante un error—
 * porque Meta reintenta lo que no se acusa, y un fallo nuestro se convertiría en el
 * mismo mensaje llegando una y otra vez.
 */
function _whatsappHandleWebhook(data) {
  if (!data || data.object !== 'whatsapp_business_account') return null;
  try {
    (data.entry || []).forEach(function (en) {
      (en.changes || []).forEach(function (ch) {
        var v = ch.value || {};
        (v.messages || []).forEach(function (msg) {
          try { _waProcesar(msg, v.metadata || {}); }
          catch (err) { Logger.log('WhatsApp procesar ERROR: ' + (err && err.message || err)); }
        });
        // Acuses de entrega y lectura de lo que mandamos nosotros.
        (v.statuses || []).forEach(function (st) {
          try { _waAnotarEstado(st); } catch (err) {}
        });
      });
    });
  } catch (err) {
    Logger.log('WhatsApp webhook ERROR: ' + (err && err.message || err));
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Un mensaje entrante.
 *
 * Por ahora sólo reconoce a quién pertenece el número y lo anota. NO contesta con
 * saldos ni aplica nada: eso llega en la fase 2, cuando estén escritas y aprobadas las
 * respuestas. Un bot a medio hacer que suelta cifras es peor que uno que aún no habla.
 */
function _waProcesar(msg, metadata) {
  var id = String(msg.id || '');
  if (!id || _waYaVisto(id)) return;
  var de = String(msg.from || '');
  var tipo = String(msg.type || '');
  var texto = (msg.text && msg.text.body) ? String(msg.text.body) :
              (msg.interactive ? JSON.stringify(msg.interactive).slice(0, 300) : '');

  var quien = identificarPorCelular(de);
  var clave = quien.prop ? quien.prop.clave : '';
  var nombre = quien.prop ? quien.prop.nombre : '';
  var nota = quien.motivo || (quien.claves && quien.claves.length > 1
    ? 'varios lotes: ' + quien.claves.join(', ') : '');

  _waAnotar({ id: id, direccion: 'entra', telefono: quien.e164 || de, clave: clave,
              nombre: nombre, tipo: tipo, texto: texto.slice(0, 500),
              estado: 'recibido', nota: nota });
  Logger.log('WhatsApp ← %s (%s) %s: %s', quien.e164 || de,
    clave || quien.motivo || 'desconocido', tipo, texto.slice(0, 80));
}

/** Acuse de Meta sobre un mensaje que mandamos: entregado, leído o fallido. */
function _waAnotarEstado(st) {
  var id = String(st.id || '');
  if (!id) return;
  var sh = _waSheet();
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iEs = h.indexOf('estado'), iNo = h.indexOf('nota');
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]) !== id) continue;
    sh.getRange(r + 1, iEs + 1).setValue(String(st.status || ''));
    if (st.errors && st.errors.length) {
      sh.getRange(r + 1, iNo + 1).setValue(String(st.errors[0].title || st.errors[0].message || ''));
    }
    return;
  }
}

/* ─────────────── bitácora de conversaciones ─────────────── */

function _waSheet() {
  var ss = _ss();
  var sh = ss.getSheetByName(SH_WA);
  if (!sh) {
    sh = ss.insertSheet(SH_WA);
    sh.getRange(1, 1, 1, COL_WA.length).setValues([COL_WA]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COL_WA.length).setFontWeight('bold');
  }
  return sh;
}

function _waAnotar(d) {
  var sh = _waSheet();
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var fila = h.map(function (c) {
    if (c === 'fecha') return new Date();
    return d[c] === undefined ? '' : d[c];
  });
  sh.appendRow(fila);
}

/**
 * ¿Ya procesamos este mensaje? Meta reintenta cuando no recibe el 200 a tiempo, y sin
 * esto un mismo mensaje se anotaría —y más adelante se contestaría— varias veces.
 * Se guarda en caché, no en la hoja: son minutos de vida y no vale una lectura entera.
 */
function _waYaVisto(id) {
  try {
    var c = CacheService.getScriptCache();
    if (c.get('wa_' + id)) return true;
    c.put('wa_' + id, '1', 21600);   // 6 horas, el máximo que admite
  } catch (e) {}
  return false;
}

/* ─────────────── envío ─────────────── */

/**
 * Manda un texto por WhatsApp y devuelve { ok, id, error }.
 *
 * Ojo con la ventana de servicio: un texto libre sólo se puede mandar dentro de las 24
 * horas siguientes al último mensaje del propietario. Fuera de esa ventana hay que
 * usar una PLANTILLA aprobada por Meta, y esta función no sirve. Por eso devuelve el
 * error de Meta en vez de tragárselo: el 131047 es exactamente ese caso.
 */
function enviarWhatsAppTexto(telefono, texto) {
  var token = _waToken(), phoneId = _waPhoneId();
  if (!token || !phoneId) return { ok: false, error: 'Faltan META_WHATSAPP_TOKEN o META_PHONE_ID en las propiedades del script.' };
  // Sin anteponer «+»: ver la nota en identificarPorCelular. Un 6111-2233 con el +
  // delante se convierte en un número de otro país y el mensaje sale al vacío.
  var n = normalizarCelular(telefono);
  if (!n.ok) return { ok: false, error: 'Número no utilizable: ' + n.por };
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ messaging_product: 'whatsapp', to: n.e164.replace('+', ''),
                                type: 'text', text: { preview_url: false, body: String(texto || '') } }),
      muteHttpExceptions: true
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      var err = (j.error && (j.error.message || j.error.type)) || r.getContentText().slice(0, 200);
      _waAnotar({ direccion: 'sale', telefono: n.e164, texto: String(texto || '').slice(0, 500),
                  estado: 'error', nota: err });
      return { ok: false, error: err, codigo: (j.error && j.error.code) || r.getResponseCode() };
    }
    var mid = (j.messages && j.messages[0] && j.messages[0].id) || '';
    _waAnotar({ id: mid, direccion: 'sale', telefono: n.e164,
                texto: String(texto || '').slice(0, 500), estado: 'enviado', nota: '' });
    return { ok: true, id: mid };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ─────────────── comprobaciones para el editor ─────────────── */

/**
 * DIAGNÓSTICO — ejecútalo en el editor después de configurar Meta.
 * Dice qué falta antes de que nada funcione, sin mandar ningún mensaje.
 */
function diagnosticarWhatsApp() {
  var p = _waProps();
  var ver = String(p.getProperty(WA_PROP_VERIFY) || '');
  var tok = _waToken(), phone = _waPhoneId();
  console.log('════ WHATSAPP ════');
  console.log('META_VERIFY_TOKEN   : %s', ver ? 'puesto (' + ver.length + ' caracteres)' : '✗ FALTA');
  console.log('META_WHATSAPP_TOKEN : %s', tok ? 'puesto (' + tok.length + ' caracteres)' : '✗ FALTA');
  console.log('META_PHONE_ID       : %s', phone || '✗ FALTA');

  if (!tok || !phone) {
    console.log('\nFaltan datos. Ponlos en Configuración del proyecto → Propiedades del script.');
    return { listo: false };
  }
  // Preguntarle a Meta por el propio número confirma que el token sirve y que el
  // phone_number_id es el correcto, sin mandarle un mensaje a nadie.
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phone + '?fields=display_phone_number,verified_name,quality_rating', {
      headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    var j = JSON.parse(r.getContentText());
    if (r.getResponseCode() !== 200) {
      console.log('\n✗ Meta rechazó la consulta: %s', (j.error && j.error.message) || r.getContentText().slice(0, 200));
      console.log('  Si dice que el token expiró, es el de prueba: hay que generar el permanente.');
      return { listo: false, error: j.error || null };
    }
    console.log('\n✓ Conectado con Meta.');
    console.log('  Número      : %s', j.display_phone_number || '—');
    console.log('  A nombre de : %s', j.verified_name || '—');
    console.log('  Calidad     : %s', j.quality_rating || '—');
    console.log('\nWebhook: la URL del despliegue de este proyecto, con hub.mode/hub.verify_token.');
    return { listo: true, numero: j.display_phone_number, nombre: j.verified_name };
  } catch (e) {
    console.log('\n✗ No se pudo consultar a Meta: %s', String(e && e.message || e));
    return { listo: false };
  }
}

/** Manda un mensaje de prueba al número que le pases. Requiere la ventana de 24 h. */
function probarWhatsApp(telefono) {
  if (!telefono) { console.log('Llámala con tu número: probarWhatsApp("50769812266")'); return; }
  var r = enviarWhatsAppTexto(telefono, 'Prueba del sistema de ' + CONFIG.NEGOCIO + '. Si lees esto, la conexión funciona.');
  console.log(r.ok ? '✓ Enviado (id %s)' : '✗ %s', r.ok ? r.id : r.error);
  if (!r.ok && String(r.codigo) === '131047') {
    console.log('  Ese error significa que estás fuera de la ventana de 24 horas.');
    console.log('  Escríbele algo al número desde ese teléfono y vuelve a intentarlo.');
  }
  return r;
}
