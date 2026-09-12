/**
 * Router de WhatsApp — reparte los mensajes de Meta al Apps Script de cada comunidad.
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 * Meta entrega TODOS los webhooks de una app a una sola URL. Con una comunidad eso no
 * importaba: la URL era la suya. Con varias, hace falta algo en medio que mire a qué
 * número llegó el mensaje y lo mande al proyecto correcto.
 *
 * ── Por el número que RECIBE, no por el que escribe ──────────────────────────
 * El router de BalanceClip enruta por el número del remitente, porque allí cada cliente
 * es una persona con su número. Un PH tiene doscientos residentes: eso no sirve. Aquí
 * se enruta por el `phone_number_id` —el número de la comunidad, el que recibe— que
 * Meta incluye en `value.metadata` de cada webhook.
 *
 * Consecuencia: cada PH necesita su propio número de WhatsApp. Una sola cuenta de
 * WhatsApp Business (WABA) admite hasta 20 números verificados, y las plantillas se
 * aprueban una vez para toda la cuenta.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 * No lee mensajes, no contesta, no guarda saldos. Reenvía el cuerpo tal cual y devuelve
 * 200. Cada comunidad procesa lo suyo en su propio proyecto, con su propia hoja, sin
 * ver nada de las demás. Eso es lo que mantiene las copias aisladas de verdad.
 *
 * ── Propiedades del script ───────────────────────────────────────────────────
 *   META_VERIFY_TOKEN  — la frase que se pone en Meta al dar de alta el webhook.
 *   RUTEO_JSON         — { "<phone_number_id>": { "url": "...", "nombre": "..." } }
 *   ROUTER_SHEET_ID    — opcional; hoja donde anotar lo que pasa por aquí.
 */

var R_PROP_VERIFY = 'META_VERIFY_TOKEN';
var R_PROP_RUTEO  = 'RUTEO_JSON';
var R_PROP_HOJA   = 'ROUTER_SHEET_ID';
var R_SH          = 'Ruteo';
var R_COL         = ['fecha', 'phoneId', 'comunidad', 'tipo', 'resultado', 'detalle'];

function _rProps() { return PropertiesService.getScriptProperties(); }

/** El mapa de números a comunidades. Un JSON roto no puede tumbar el router. */
function _ruteo() {
  try {
    var crudo = String(_rProps().getProperty(R_PROP_RUTEO) || '').trim();
    if (!crudo) return {};
    var m = JSON.parse(crudo);
    return (m && typeof m === 'object') ? m : {};
  } catch (e) {
    Logger.log('RUTEO_JSON no es JSON válido: ' + (e && e.message || e));
    return {};
  }
}

/**
 * Verificación del webhook (doGet).
 *
 * Meta llama una vez, al dar de alta la URL, y espera el hub.challenge en TEXTO PLANO.
 * Envuelto en JSON, la verificación falla y el mensaje de Meta no dice por qué.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var modo = p['hub.mode'] || p.hub_mode || '';
  var token = p['hub.verify_token'] || p.hub_verify_token || '';
  var reto = p['hub.challenge'] || p.hub_challenge || '';
  var esperado = String(_rProps().getProperty(R_PROP_VERIFY) || '').trim();

  if (modo === 'subscribe' && esperado && String(token) === esperado) {
    return ContentService.createTextOutput(String(reto));
  }
  if (modo) {
    Logger.log('Verificación rechazada (modo=%s)', modo);
    return ContentService.createTextOutput('no');
  }
  // Sin hub.mode es alguien mirando la URL. No se dice qué es ni a quién sirve.
  return ContentService.createTextOutput('ok');
}

/**
 * Reparto (doPost).
 *
 * SIEMPRE devuelve 200, pase lo que pase. Meta reintenta lo que no se acusa, y un fallo
 * nuestro se convertiría en el mismo mensaje llegando una y otra vez.
 */
function doPost(e) {
  var data = {};
  try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) {}

  try {
    if (data && data.object === 'whatsapp_business_account') {
      _repartir(data, (e && e.postData && e.postData.contents) || '{}');
    }
  } catch (err) {
    Logger.log('Router ERROR: ' + (err && err.message || err));
    _anotar({ resultado: 'error', detalle: String(err && err.message || err) });
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * A quién le toca cada entrada.
 *
 * Un webhook puede traer varias entradas de varios números. Se agrupa por destino y se
 * reenvía UNA vez por comunidad, con sólo las entradas que le corresponden: así una
 * comunidad nunca ve el tráfico de otra, ni siquiera de pasada.
 */
function _repartir(data, crudo) {
  var mapa = _ruteo();
  var porDestino = {};

  (data.entry || []).forEach(function (en) {
    (en.changes || []).forEach(function (ch) {
      var v = ch.value || {};
      var id = String((v.metadata && v.metadata.phone_number_id) || '');
      if (!porDestino[id]) porDestino[id] = [];
      porDestino[id].push({ entry: en, change: ch });
    });
  });

  Object.keys(porDestino).forEach(function (id) {
    var destino = mapa[id];
    if (!destino || !destino.url) {
      Logger.log('Número sin comunidad asignada: %s', id);
      _anotar({ phoneId: id, resultado: 'sin-ruta',
                detalle: 'phone_number_id no está en RUTEO_JSON' });
      return;
    }
    var trozo = {
      object: data.object,
      entry: porDestino[id].map(function (x) {
        return { id: x.entry.id, time: x.entry.time, changes: [x.change] };
      })
    };
    var r = _reenviar(destino.url, trozo);
    _anotar({ phoneId: id, comunidad: destino.nombre || '',
              tipo: _tipoDe(trozo), resultado: r.ok ? 'entregado' : 'fallo',
              detalle: r.ok ? ('HTTP ' + r.codigo) : r.error });
  });
}

/** Qué traía el webhook, para que la bitácora se lea sin abrir el JSON. */
function _tipoDe(data) {
  var tipos = [];
  (data.entry || []).forEach(function (en) {
    (en.changes || []).forEach(function (ch) {
      var v = ch.value || {};
      if (v.messages && v.messages.length) tipos.push('mensaje');
      if (v.statuses && v.statuses.length) tipos.push('acuse');
    });
  });
  return tipos.length ? tipos.join('+') : 'otro';
}

function _reenviar(url, cuerpo) {
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(cuerpo), muteHttpExceptions: true,
      followRedirects: true
    });
    var c = r.getResponseCode();
    return { ok: c >= 200 && c < 400, codigo: c };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ─────────────── bitácora ─────────────── */

function _anotar(d) {
  var id = String(_rProps().getProperty(R_PROP_HOJA) || '').trim();
  if (!id) return;                       // sin hoja configurada, sólo queda el Logger
  try {
    var ss = SpreadsheetApp.openById(id);
    var sh = ss.getSheetByName(R_SH);
    if (!sh) {
      sh = ss.insertSheet(R_SH);
      sh.getRange(1, 1, 1, R_COL.length).setValues([R_COL]);
      sh.setFrozenRows(1);
    }
    sh.appendRow(R_COL.map(function (c) {
      if (c === 'fecha') return new Date();
      var v = d[c] === undefined ? '' : String(d[c]);
      // Sheets evalúa como fórmula lo que empieza por = + - @.
      return /^[=+\-@]/.test(v) ? "'" + v : v;
    }));
  } catch (e) {
    Logger.log('No se pudo anotar en la hoja del router: ' + (e && e.message || e));
  }
}

/* ─────────────── administración, desde el editor ─────────────── */

/**
 * Formulario de alta. Se rellena, se ejecuta altaDePH(), y se vuelve a vaciar.
 *
 * El botón «Ejecutar» del editor no sabe pasar argumentos, así que registrarPH(a,b,c)
 * no se puede llamar desde ahí. Y la pantalla de propiedades del script es una
 * interfaz frágil para esto: la URL de un despliegue son ochenta caracteres que no
 * pueden ir mal ni en un carácter.
 *
 * Nada de aquí se lee durante el funcionamiento normal: el ruteo vive en las
 * propiedades. Esto sólo lo mira altaDePH(), y sólo cuando alguien la ejecuta a mano.
 *
 * Vacíalo después. El repositorio no tiene por qué llevar la URL de nadie: quien
 * tenga una de esas URL puede mandarle un webhook falso a esa comunidad.
 */
var R_ALTA = {
  // verifyToken: '',      // sólo la primera vez, para dar de alta el webhook en Meta
  // phoneId:     '',      // el phone_number_id que da Meta. NO es el número.
  // url:         '',      // https://script.google.com/macros/s/…/exec de esa comunidad
  // nombre:      ''
};

/**
 * Escribe lo que haya en R_ALTA. Sin argumentos, para que el editor pueda ejecutarla.
 *
 * Con R_ALTA vacío no toca nada: esta función vive en el mismo desplegable que todas
 * las demás y se puede abrir sin querer.
 */
function altaDePH() {
  var a = R_ALTA || {};
  var hizo = false;

  if (a.verifyToken) {
    _rProps().setProperty(R_PROP_VERIFY, String(a.verifyToken).trim());
    console.log('✓ Frase de verificación guardada (%s caracteres).',
                String(a.verifyToken).trim().length);
    hizo = true;
  }

  if (a.phoneId || a.url) {
    var r = registrarPH(a.phoneId, a.url, a.nombre);
    if (!r.ok) return r;
    hizo = true;
  }

  if (!hizo) {
    console.log('R_ALTA está vacío, así que no se escribió nada.');
    console.log('');
    console.log('Rellénalo en Router.gs y vuelve a ejecutar. Por ejemplo:');
    console.log('  var R_ALTA = {');
    console.log('    phoneId: "1351030198084248",');
    console.log('    url:     "https://script.google.com/macros/s/AKfy…/exec",');
    console.log('    nombre:  "PH Las Palmas"');
    console.log('  };');
    console.log('');
    console.log('Para ver cómo está ahora: diagnosticarRouter()');
    return { ok: false };
  }

  console.log('');
  console.log('Ahora vacía R_ALTA. El dato ya está en las propiedades.');
  return { ok: true };
}

/** Da de alta o actualiza una comunidad. */
function registrarPH(phoneId, url, nombre) {
  phoneId = String(phoneId || '').trim();
  url = String(url || '').trim();
  if (!phoneId || !url) {
    console.log('Llámala así:');
    console.log('  registrarPH("1351030198084248", "https://script.google.com/macros/s/…/exec", "PH Las Palmas")');
    return { ok: false };
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    console.log('✗ Esa no parece la URL de un despliegue de Apps Script.');
    console.log('  Tiene que terminar en /exec y ser la del despliegue de producción.');
    return { ok: false };
  }
  var m = _ruteo();
  var antes = m[phoneId];
  m[phoneId] = { url: url, nombre: String(nombre || '').trim() };
  _rProps().setProperty(R_PROP_RUTEO, JSON.stringify(m));
  console.log(antes ? '✓ Actualizada %s' : '✓ Registrada %s', m[phoneId].nombre || phoneId);
  if (antes && antes.url !== url) console.log('  La URL anterior era: %s', antes.url);
  return { ok: true };
}

function quitarPH(phoneId) {
  var m = _ruteo();
  phoneId = String(phoneId || '').trim();
  if (!m[phoneId]) { console.log('Ese número no estaba registrado.'); return { ok: false }; }
  var nombre = m[phoneId].nombre || phoneId;
  delete m[phoneId];
  _rProps().setProperty(R_PROP_RUTEO, JSON.stringify(m));
  console.log('✓ Quitada %s. Sus mensajes dejarán de repartirse.', nombre);
  return { ok: true };
}

/** A dónde va cada número. */
function verRuteo() {
  var m = _ruteo();
  var ids = Object.keys(m);
  console.log('════ RUTEO ════');
  if (!ids.length) {
    console.log('Vacío. Ningún mensaje se está repartiendo.');
    console.log('Da de alta una comunidad con registrarPH(phoneId, url, nombre).');
    return m;
  }
  ids.forEach(function (id) {
    console.log('%s  →  %s', id, m[id].nombre || '(sin nombre)');
    console.log('    %s', m[id].url);
  });
  console.log('\n%s comunidad(es).', ids.length);
  return m;
}

/** Qué falta para que el router funcione. */
function diagnosticarRouter() {
  var ver = String(_rProps().getProperty(R_PROP_VERIFY) || '');
  var hoja = String(_rProps().getProperty(R_PROP_HOJA) || '');
  var m = _ruteo();
  console.log('════ ROUTER ════');
  console.log('META_VERIFY_TOKEN : %s', ver ? 'puesto (' + ver.length + ' caracteres)' : '✗ FALTA');
  console.log('Comunidades       : %s', Object.keys(m).length);
  console.log('Bitácora          : %s', hoja ? 'hoja ' + hoja : 'sólo el registro de ejecución');
  if (!ver) console.log('\nSin la frase de verificación, Meta no puede dar de alta esta URL.');
  if (!Object.keys(m).length) console.log('Sin comunidades registradas, todo lo que llegue se descarta.');
  return { verify: !!ver, comunidades: Object.keys(m).length };
}
