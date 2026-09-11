/**
 * El bot — qué contesta el WhatsApp de la Asociación.
 *
 * ── Dónde vive esto ──────────────────────────────────────────────────────────
 * Todo lo de aquí ocurre DENTRO de la ventana de 24 horas: el propietario escribió
 * primero, así que se le puede contestar con texto libre, botones y archivos sin
 * plantilla aprobada. Las plantillas son para cuando escribe el sistema.
 *
 * ── La regla que ordena el resto ─────────────────────────────────────────────
 * El modelo entiende; el código responde. Claude clasifica en qué está preguntando
 * el propietario y devuelve UNA palabra de una lista cerrada. La cifra la compone el
 * código leyendo la hoja. Un modelo de lenguaje no redacta un saldo: una cifra
 * inventada es la administración diciéndole a alguien que debe algo que no debe.
 *
 * ── Lo que el bot no hace, y no es un olvido ─────────────────────────────────
 *   · No aplica pagos ni cambia nada del padrón. Un comprobante que llega se guarda
 *     y se avisa; acreditarlo lo decide una persona.
 *   · No da cifras a un número que aparece en lotes de dueños distintos.
 *   · No contesta a números que no están en el padrón.
 *   · No negocia, no interpreta el reglamento y no promete nada de la Junta. Todo eso
 *     va a un humano, y el bot se calla mientras esa conversación está viva.
 *
 * ── El interruptor ───────────────────────────────────────────────────────────
 * Propiedad del script META_BOT:
 *   (vacío)  — apagado. Se anota y se avisa a la administración, como hasta ahora.
 *   prueba   — sólo contesta a los números de META_ADMIN_WHATSAPP.
 *   activo   — contesta a todo el padrón.
 * Empieza apagado a propósito. Se prueba con el propio celular antes de soltarlo
 * sobre setenta personas.
 */

var BOT_PROP        = 'META_BOT';
var BOT_SILENCIO    = 21600;   // 6 h de silencio tras pasar a un humano (tope de CacheService)
var BOT_MAX_BOTONES = 3;       // límite de WhatsApp

/* ─────────────── el interruptor ─────────────── */

function _botModo() {
  return String(_waProps().getProperty(BOT_PROP) || '').trim().toLowerCase();
}

/** ¿Le contesta el bot a este número, con el modo que hay puesto? */
function _botContestaA(tel) {
  var modo = _botModo();
  if (modo === 'activo') return true;
  if (modo === 'prueba') return _waAdmins().indexOf(tel) >= 0;
  return false;
}

/* ─────────────── silencio tras pasar a un humano ─────────────── */

function _botSilenciar(tel) {
  try { CacheService.getScriptCache().put('bot_mudo_' + String(tel).replace(/\D/g, ''), '1', BOT_SILENCIO); }
  catch (e) {}
}

function _botSilenciado(tel) {
  try { return !!CacheService.getScriptCache().get('bot_mudo_' + String(tel).replace(/\D/g, '')); }
  catch (e) { return false; }
}

/* ─────────────── qué quiere quien escribe ─────────────── */

/**
 * De un mensaje entrante a una de las acciones que el bot sabe hacer.
 *
 * Un botón no se interpreta: trae su identificador y no hay nada que adivinar. El
 * texto libre sí, y ahí entra Claude. Lo que no es ni una cosa ni la otra —una nota
 * de voz, una ubicación, un sticker— va a un humano en vez de fingir que se entendió.
 */
function _botAccion(msg) {
  var tipo = String(msg.type || '');
  if (tipo === 'interactive') {
    var i = msg.interactive || {};
    var b = i.button_reply || i.list_reply || {};
    if (b.id) return String(b.id);
  }
  if (tipo === 'button' && msg.button && msg.button.payload) return String(msg.button.payload);
  if (tipo === 'image' || tipo === 'document') return 'bot_comprobante_recibido';
  if (tipo === 'text') return _botIntencion((msg.text && msg.text.body) || '');
  return 'bot_humano';
}

var BOT_ACCIONES = ['bot_saldo', 'bot_detalle', 'bot_comprobante', 'bot_humano'];

/**
 * Clasifica texto libre. Devuelve siempre una de BOT_ACCIONES, o '' para saludar.
 *
 * Claude primero porque el español real trae faltas, audios transcritos y frases
 * como «y el de mi esposa también». Las palabras clave quedan de red: si no hay clave
 * de API o Anthropic falla, el bot sigue funcionando peor pero sigue funcionando.
 */
function _botIntencion(texto) {
  var t = String(texto || '').trim();
  if (!t) return '';
  var deRespaldo = _botIntencionPorPalabras(t);
  var key = (typeof _anthropicKey === 'function') ? _anthropicKey() : '';
  if (!key) return deRespaldo;

  try {
    var r = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 12,
        system:
          'Clasificas mensajes de WhatsApp que propietarios de una comunidad en Panamá le ' +
          'escriben a la administración sobre su cuota de mantenimiento. Responde SOLO con ' +
          'una de estas cinco palabras, sin explicar nada:\n' +
          'saldo — pregunta cuánto debe, si está al día, si le llegó un pago.\n' +
          'detalle — pide el estado de cuenta, el desglose o el PDF.\n' +
          'comprobante — dice que va a mandar o que mandó un comprobante de pago, o pregunta ' +
          'a qué cuenta pagar.\n' +
          'humano — reclama, no está de acuerdo con un cargo, pide un arreglo de pago, ' +
          'pregunta por el reglamento o por cualquier asunto de la comunidad.\n' +
          'saludo — sólo saluda o no se entiende qué necesita.\n' +
          'Ante la duda entre saldo y humano, responde humano.',
        messages: [{ role: 'user', content: t.slice(0, 600) }]
      }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return deRespaldo;
    var j = JSON.parse(r.getContentText());
    var txt = '';
    (j.content || []).forEach(function (c) { if (c.type === 'text' && !txt) txt = String(c.text || ''); });
    var w = txt.toLowerCase().replace(/[^a-z]/g, '');
    if (w === 'saldo') return 'bot_saldo';
    if (w === 'detalle') return 'bot_detalle';
    if (w === 'comprobante') return 'bot_comprobante';
    if (w === 'humano') return 'bot_humano';
    if (w === 'saludo') return '';
    return deRespaldo;
  } catch (e) {
    Logger.log('Bot: Claude falló, se usan palabras clave — ' + (e && e.message || e));
    return deRespaldo;
  }
}

/** La red de abajo: sin API, o si falla. El orden importa. */
function _botIntencionPorPalabras(texto) {
  var t = String(texto || '').toLowerCase()
    .replace(/[áà]/g, 'a').replace(/[éè]/g, 'e').replace(/[íì]/g, 'i')
    .replace(/[óò]/g, 'o').replace(/[úù]/g, 'u');
  if (/estado de cuenta|desglose|detalle|pdf|documento/.test(t)) return 'bot_detalle';
  if (/comprobante|recibo|transferenc|deposit|yappy|ach|ya pague|le pague|hice el pago|a que cuenta|numero de cuenta/.test(t)) return 'bot_comprobante';
  if (/saldo|cuanto debo|cuanto es|deuda|debo|pendiente|mora|atrasad|al dia|adeud/.test(t)) return 'bot_saldo';
  if (/reclamo|no estoy de acuerdo|arreglo|abono|plazo|reglamento|junta|queja|error/.test(t)) return 'bot_humano';
  return '';
}

/* ─────────────── lo que contesta ─────────────── */

function _botBoton(id, titulo) { return { type: 'reply', reply: { id: id, title: titulo } }; }

// Los títulos no pasan de 20 caracteres: WhatsApp los corta sin avisar.
var BOT_BTN_SALDO   = _botBoton('bot_saldo', 'Mi saldo');
var BOT_BTN_DETALLE = _botBoton('bot_detalle', 'Estado de cuenta');
var BOT_BTN_HUMANO  = _botBoton('bot_humano', 'Hablar con alguien');

// El menú de entrada. Enviar un comprobante NO tiene botón: recibirlos funciona
// —la gente manda la foto igual, se invite o no, y si no se atendiera se perdería—
// pero no se ofrece hasta que la administración quiera ese flujo abierto.
var BOT_MENU = [BOT_BTN_SALDO, BOT_BTN_DETALLE, BOT_BTN_HUMANO];

/** El saldo, compuesto por el código. Sin adornos y sin prometer nada. */
function _botTextoSaldo(est) {
  var saldo = Number(est.saldoConMora) || 0;
  var credito = Number(est.creditoAFavor) || 0;
  var l = [];
  l.push('Lote ' + est.lote + ' · ' + est.nombre);
  if (saldo > 0.009) {
    l.push('Saldo pendiente: B/. ' + saldo.toFixed(2));
    var mora = Number(est.mora) || 0;
    if (mora > 0.009) l.push('(incluye B/. ' + mora.toFixed(2) + ' de recargo por mora)');
  } else if (credito > 0.009) {
    l.push('Está al día, y tiene B/. ' + credito.toFixed(2) + ' a favor.');
  } else {
    l.push('Está al día. No tiene saldo pendiente.');
  }
  return l.join('\n');
}

/**
 * Contesta a quien escribió. Devuelve { contesto, avisar }.
 *
 * `avisar` manda el aviso a la administración, y lo decide esta función: no tiene
 * sentido avisar de que alguien tocó «Mi saldo» y el bot ya le contestó.
 */
function _botAtender(info, msg) {
  var tel = info.telefono;
  if (!_botContestaA(tel)) return { contesto: false, avisar: true, motivo: 'bot apagado para este número' };
  // Mientras una persona lleva la conversación, el bot no habla por encima. El aviso
  // sigue saliendo —con su propio límite de uno por hora— porque quien contesta
  // necesita ver lo nuevo.
  if (_botSilenciado(tel)) return { contesto: false, avisar: true, motivo: 'silenciado tras pasar a un humano' };

  var accion = _botAccion(msg);

  // Un número que aparece en lotes de dueños distintos no recibe cifras. Contestarle a
  // uno de los dos al azar sería enseñarle a alguien el saldo de otro.
  if (info.nota === 'varios-duenos') {
    _botSilenciar(tel);
    enviarWhatsAppTexto(tel,
      'Gracias por escribir. Este número figura en más de un lote a nombre de personas ' +
      'distintas, así que por aquí no podemos darle cifras. La administración le ' +
      'contestará en un momento.');
    return { contesto: true, avisar: true };
  }
  if (!info.clave) {
    _botSilenciar(tel);
    enviarWhatsAppTexto(tel,
      'Gracias por escribir. Este número no aparece en el padrón de la comunidad, así que ' +
      'no podemos darle información de ningún lote. Si es usted propietario, escríbanos a ' +
      'admin@airesdechica.org y lo registramos.');
    return { contesto: true, avisar: true };
  }

  var quien = identificarPorCelular(tel);
  var claves = (quien.claves && quien.claves.length) ? quien.claves : [info.clave];

  if (accion === 'bot_saldo') return _botContestaSaldo(tel, claves);
  if (accion === 'bot_detalle') return _botMandaEstado(tel, claves);
  if (accion === 'bot_comprobante') return _botPideComprobante(tel);
  if (accion === 'bot_comprobante_recibido') return _botRecibeComprobante(tel, info, msg);
  if (accion === 'bot_humano') return _botPasaAHumano(tel);
  return _botSaluda(tel, info);
}

function _botSaluda(tel, info) {
  var nombre = String(info.nombre || '').split(' ')[0];
  _waEnviarBotones(tel,
    (nombre ? 'Hola ' + nombre + '. ' : 'Hola. ') +
    'Le contesta el sistema de la Asociación de Aires de Chicá. ¿En qué le ayudamos?',
    BOT_MENU);
  return { contesto: true, avisar: false };
}

function _botContestaSaldo(tel, claves) {
  var partes = [];
  claves.forEach(function (c) {
    try { partes.push(_botTextoSaldo(getEstadoCuentaByKey(c))); }
    catch (e) { Logger.log('Bot saldo ' + c + ': ' + (e && e.message || e)); }
  });
  if (!partes.length) return _botPasaAHumano(tel);

  var cta = (typeof _ctaCobro === 'function') ? _ctaCobro() : null;
  var texto = partes.join('\n\n') +
    '\n\nEs el saldo al día de hoy. Si pagó en los últimos días, puede que todavía no esté registrado.';
  if (cta && cta.numero) {
    texto += '\n\nPara pagar: ' + cta.banco + ' · ' + cta.tipo + ' N.º ' + cta.numero +
             ' a nombre de ' + cta.titular + '.';
  }
  _waEnviarBotones(tel, texto, [BOT_BTN_DETALLE, BOT_BTN_HUMANO]);
  return { contesto: true, avisar: false };
}

function _botMandaEstado(tel, claves) {
  var mandados = 0;
  claves.forEach(function (c) {
    try {
      var est = getEstadoCuentaByKey(c);
      var r = _waEnviarDocumento(tel, estadoCuentaPDF(est),
        'Estado de cuenta del lote ' + est.lote + ' al día de hoy.');
      if (r.ok) mandados++;
      else Logger.log('Bot PDF ' + c + ': ' + r.error);
    } catch (e) { Logger.log('Bot PDF ' + c + ': ' + (e && e.message || e)); }
  });
  if (!mandados) {
    enviarWhatsAppTexto(tel,
      'No pudimos generar su estado de cuenta en este momento. La administración se lo envía enseguida.');
    return { contesto: true, avisar: true };
  }
  return { contesto: true, avisar: false };
}

function _botPideComprobante(tel) {
  var cta = (typeof _ctaCobro === 'function') ? _ctaCobro() : null;
  var texto = 'Puede enviarnos la foto o el PDF del comprobante por aquí mismo y lo registramos.';
  if (cta && cta.numero) {
    texto += '\n\nLa cuenta de la Asociación es: ' + cta.banco + ' · ' + cta.tipo +
             ' N.º ' + cta.numero + ' a nombre de ' + cta.titular +
             '.\nEn la descripción, escriba su número de lote.';
  }
  enviarWhatsAppTexto(tel, texto);
  return { contesto: true, avisar: false };
}

/**
 * Llegó un comprobante.
 *
 * Se guarda en Drive y se avisa; NO se acredita. Un pago aplicado por un bot a partir
 * de una foto es un asiento contable que nadie revisó. Además el bot se calla: a
 * partir de aquí lo lleva una persona.
 */
function _botRecibeComprobante(tel, info, msg) {
  var guardado = _botGuardarAdjunto(msg, info);
  _botSilenciar(tel);
  enviarWhatsAppTexto(tel,
    'Recibimos su comprobante, gracias. La administración lo revisa y le confirma cuando ' +
    'quede aplicado a su cuenta. No se aplica automáticamente.');
  return { contesto: true, avisar: true, adjunto: guardado };
}

/** Baja el archivo de Meta y lo deja en la carpeta de comprobantes de Drive. */
function _botGuardarAdjunto(msg, info) {
  try {
    var media = msg.image || msg.document || null;
    if (!media || !media.id) return { ok: false, error: 'el mensaje no traía archivo' };
    var blob = _waBajarMedia(media.id);
    if (!blob.ok) return blob;
    var ext = (String(blob.tipo || '').indexOf('pdf') >= 0) ? '.pdf' : '.jpg';
    var nombre = 'WA_' + String(info.clave || 'sin-lote').replace(/[^\w-]/g, '') + '_' +
      Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyyMMdd-HHmm') + ext;
    var f = _carpetaComprobantes().createFile(blob.blob.setName(nombre));
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    return { ok: true, url: f.getUrl(), nombre: nombre };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function _botPasaAHumano(tel) {
  _botSilenciar(tel);
  enviarWhatsAppTexto(tel,
    'Con gusto. Le paso su mensaje a la administración y le contestan en cuanto puedan.');
  return { contesto: true, avisar: true };
}

/* ─────────────── envío de botones y archivos ─────────────── */

/**
 * Mensaje con botones. Sólo funciona dentro de la ventana de 24 horas, que es
 * exactamente donde vive el bot.
 */
function _waEnviarBotones(telefono, texto, botones) {
  var token = _waToken(), phoneId = _waPhoneId();
  if (!token || !phoneId) return { ok: false, error: 'Faltan META_WHATSAPP_TOKEN o META_PHONE_ID.' };
  var n = normalizarCelular(telefono);
  if (!n.ok) return { ok: false, error: 'Número no utilizable: ' + n.por };
  var bs = (botones || []).slice(0, BOT_MAX_BOTONES).map(function (b) {
    // WhatsApp corta el título a 20 caracteres sin avisar; mejor cortarlo aquí y verlo.
    return { type: 'reply', reply: { id: b.reply.id, title: String(b.reply.title).slice(0, 20) } };
  });
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ messaging_product: 'whatsapp', to: n.e164.replace('+', ''),
        type: 'interactive',
        interactive: { type: 'button', body: { text: String(texto).slice(0, 1024) },
                       action: { buttons: bs } } }),
      muteHttpExceptions: true
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      var err = (j.error && j.error.message) || r.getContentText().slice(0, 200);
      _waAnotar({ direccion: 'sale', telefono: n.e164, tipo: 'interactive',
                  texto: String(texto).slice(0, 300), estado: 'error', nota: err });
      return { ok: false, error: err, codigo: (j.error && j.error.code) || r.getResponseCode() };
    }
    var mid = (j.messages && j.messages[0] && j.messages[0].id) || '';
    _waAnotar({ id: mid, direccion: 'sale', telefono: n.e164, tipo: 'interactive',
                texto: String(texto).slice(0, 300), estado: 'enviado',
                nota: bs.map(function (b) { return b.reply.title; }).join(' | ') });
    return { ok: true, id: mid };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/**
 * Sube un archivo a Meta y devuelve su id.
 *
 * Se sube, no se enlaza: el estado de cuenta lleva saldos y no sale a ninguna URL
 * pública. El id vale 30 días y sólo sirve para este número.
 */
function _waSubirMedia(blob) {
  var token = _waToken(), phoneId = _waPhoneId();
  if (!token || !phoneId) return { ok: false, error: 'Faltan META_WHATSAPP_TOKEN o META_PHONE_ID.' };
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phoneId + '/media', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token },
      payload: { messaging_product: 'whatsapp', type: blob.getContentType(), file: blob },
      muteHttpExceptions: true
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200 || !j.id) {
      return { ok: false, error: (j.error && j.error.message) || r.getContentText().slice(0, 200) };
    }
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** Baja un archivo que mandó un propietario. Son dos pasos: pedir la URL y luego bajarla. */
function _waBajarMedia(mediaId) {
  var token = _waToken();
  if (!token) return { ok: false, error: 'Falta META_WHATSAPP_TOKEN.' };
  try {
    var r1 = UrlFetchApp.fetch(WA_GRAPH + '/' + mediaId,
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    var j = {}; try { j = JSON.parse(r1.getContentText()); } catch (e) {}
    if (r1.getResponseCode() !== 200 || !j.url) {
      return { ok: false, error: (j.error && j.error.message) || r1.getContentText().slice(0, 200) };
    }
    // La URL de descarga también exige el token: no es pública.
    var r2 = UrlFetchApp.fetch(j.url,
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (r2.getResponseCode() !== 200) {
      return { ok: false, error: 'descarga HTTP ' + r2.getResponseCode() };
    }
    return { ok: true, blob: r2.getBlob(), tipo: j.mime_type || r2.getBlob().getContentType() };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** Manda un archivo dentro de la ventana de 24 horas. */
function _waEnviarDocumento(telefono, blob, pie) {
  var token = _waToken(), phoneId = _waPhoneId();
  if (!token || !phoneId) return { ok: false, error: 'Faltan META_WHATSAPP_TOKEN o META_PHONE_ID.' };
  var n = normalizarCelular(telefono);
  if (!n.ok) return { ok: false, error: 'Número no utilizable: ' + n.por };
  var sub = _waSubirMedia(blob);
  if (!sub.ok) return sub;
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ messaging_product: 'whatsapp', to: n.e164.replace('+', ''),
        type: 'document',
        document: { id: sub.id, filename: blob.getName() || 'documento.pdf',
                    caption: String(pie || '').slice(0, 1024) } }),
      muteHttpExceptions: true
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      var err = (j.error && j.error.message) || r.getContentText().slice(0, 200);
      _waAnotar({ direccion: 'sale', telefono: n.e164, tipo: 'document',
                  texto: blob.getName(), estado: 'error', nota: err });
      return { ok: false, error: err, codigo: (j.error && j.error.code) || r.getResponseCode() };
    }
    var mid = (j.messages && j.messages[0] && j.messages[0].id) || '';
    _waAnotar({ id: mid, direccion: 'sale', telefono: n.e164, tipo: 'document',
                texto: blob.getName(), estado: 'enviado', nota: String(pie || '').slice(0, 120) });
    return { ok: true, id: mid };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ─────────────── comprobaciones para el editor ─────────────── */

/** En qué modo está el bot y qué haría con unas cuantas frases reales. */
function diagnosticarBot() {
  var modo = _botModo();
  console.log('════ BOT ════');
  console.log('META_BOT: %s', modo || '(vacío — apagado: sólo se anota y se avisa)');
  if (modo === 'prueba') console.log('  Sólo contesta a: %s', _waAdmins().join(', ') || '(nadie)');
  console.log('Claude   : %s', (typeof _anthropicKey === 'function' && _anthropicKey())
    ? 'ANTHROPIC_API_KEY puesta (' + ANTHROPIC_MODEL + ')'
    : '✗ falta ANTHROPIC_API_KEY — se clasificará sólo por palabras clave');

  var frases = ['cuanto debo?', 'Buenas, quisiera mi estado de cuenta',
                'ya hice la transferencia, les mando el comprobante',
                'no estoy de acuerdo con el recargo', 'Hola', 'kuanto devo del lote 9'];
  console.log('\nCómo clasificaría:');
  frases.forEach(function (f) {
    console.log('  «%s» → %s', f, _botIntencion(f) || 'saludo (menú de botones)');
  });
  return { modo: modo };
}
