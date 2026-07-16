/**
 * Captura de comprobantes de pago por email.
 *
 * Los propietarios envían su comprobante a comprobantes@airesdechica.org
 * (alias/reenvío a admin@, que es la cuenta bajo la que corre el script).
 * Un trigger diario `capturarComprobantes()` lee los correos nuevos, analiza
 * el adjunto con Claude vision (extrae si es un pago + monto + referencia +
 * fecha + pagador), empareja al propietario (por email del remitente, lote o
 * nombre), guarda el adjunto en Drive y deja el comprobante como PENDIENTE.
 *
 * ANÁLISIS DEL ADJUNTO: se usa Claude vision (modelo Haiku 4.5) que LEE y
 * ENTIENDE el comprobante y devuelve datos estructurados. Requiere la Script
 * Property `ANTHROPIC_API_KEY`. Si no hay key (o la llamada falla), cae
 * automáticamente al OCR de Google Drive + reglas (fallback).
 *
 * NADA se aplica solo: la cola queda para revisión en el panel; el admin
 * confirma (se registra el pago) o rechaza. Así se evita aplicar montos
 * equivocados y el doble conteo con la conciliación bancaria.
 */

var GMAIL_LABEL_COMPROB = 'AC-Comprobantes';

// ─── Claude vision ───
var ANTHROPIC_KEY_PROP = 'ANTHROPIC_API_KEY';
var ANTHROPIC_MODEL    = 'claude-haiku-4-5';   // barato y con visión; suficiente para leer recibos
var ANTHROPIC_URL      = 'https://api.anthropic.com/v1/messages';

function _anthropicKey() {
  return String(PropertiesService.getScriptProperties().getProperty(ANTHROPIC_KEY_PROP) || '').trim();
}

// Extrae el primer objeto JSON de un texto (tolerante a texto alrededor).
function _parseJsonLoose(txt) {
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) {}
  var m = String(txt).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
  return null;
}

/**
 * Analiza un comprobante (imagen o PDF) con Claude vision.
 * Devuelve { esPago, monto, fecha, referencia, banco, pagador, metodo, lote, confianza, texto }
 * o null si no hay API key o la llamada falla (para caer al fallback OCR).
 */
function _analizarComprobante(blob) {
  var key = _anthropicKey();
  if (!key) return null;
  var ct = String(blob.getContentType() || '').toLowerCase();
  var b64 = Utilities.base64Encode(blob.getBytes());
  var src;
  if (ct.indexOf('pdf') >= 0) {
    src = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  } else {
    var mt = (ct.indexOf('image/') === 0) ? ct : 'image/jpeg';
    src = { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } };
  }
  var prompt =
    'Eres un asistente que revisa comprobantes de pago (transferencias ACH, Yappy, Nequi, depósitos y ' +
    'pagos bancarios) de propietarios de una comunidad en Panamá. Analiza la imagen/PDF adjunto y responde ' +
    'ÚNICAMENTE con un objeto JSON válido, sin texto ni explicación adicional, con esta forma exacta:\n' +
    '{"esPago": true|false, "monto": number, "fecha": "YYYY-MM-DD" o "", "referencia": "", "banco": "", ' +
    '"pagador": "", "metodo": "", "lote": "", "cuentaDestino": "", "beneficiario": "", "confianza": 0.0}\n' +
    'Reglas:\n' +
    '- esPago: true SOLO si realmente es un comprobante/recibo de un pago o transferencia de dinero.\n' +
    '- monto: el monto pagado en balboas/dólares como número, sin símbolo (ej: 72.00). 0 si no aplica.\n' +
    '- fecha: la fecha del pago en formato YYYY-MM-DD; "" si no se ve.\n' +
    '- metodo: el MEDIO de pago: ACH, Yappy, Nequi, depósito, transferencia, etc. si se identifica; "" si no.\n' +
    '- lote: si aparece un número de lote/casa/finca, ponlo (ej: "16A"); "" si no.\n' +
    '- pagador: nombre de quien envía/paga si aparece; "" si no.\n' +
    '- cuentaDestino: el número de cuenta A LA QUE se envió el dinero (cuenta destino/beneficiaria). ' +
    'Cópialo tal cual aparece con sus guiones; "" si no se ve (ej. en Yappy suele no haber número de cuenta).\n' +
    '- beneficiario: el nombre del titular/beneficiario que RECIBE el dinero (a quién se le pagó); "" si no se ve.\n' +
    '- confianza: 0 a 1, qué tan seguro estás de que es un pago y de que el monto es correcto.';
  var payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: [src, { type: 'text', text: prompt }] }]
  };
  try {
    var resp = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return null;
    var data = JSON.parse(resp.getContentText());
    var txt = '';
    (data.content || []).forEach(function (b) { if (b.type === 'text') txt += b.text; });
    var j = _parseJsonLoose(txt);
    if (!j) return null;
    j.esPago    = !!j.esPago;
    j.monto     = _round2(Number(j.monto) || 0);
    j.confianza = Number(j.confianza) || 0;
    j.referencia = String(j.referencia || '');
    j.pagador   = String(j.pagador || '');
    j.lote      = String(j.lote || '');
    j.metodo    = String(j.metodo || '');
    j.cuentaDestino = String(j.cuentaDestino || '');
    j.beneficiario  = String(j.beneficiario || '');
    j.texto     = txt;
    return j;
  } catch (e) {
    return null;
  }
}

/** Prueba rápida: valida que la API key de Anthropic funcione. Ejecuta en el editor. */
function probarAnthropic() {
  var key = _anthropicKey();
  if (!key) return { ok: false, error: 'Falta la Script Property ANTHROPIC_API_KEY.' };
  try {
    var resp = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 16,
        messages: [{ role: 'user', content: 'Responde solo con la palabra: OK' }] }),
      muteHttpExceptions: true
    });
    return { ok: resp.getResponseCode() === 200, code: resp.getResponseCode(),
      respuesta: resp.getContentText().slice(0, 300) };
  } catch (e) { return { ok: false, error: String(e) }; }
}

function _emailDe(from) {
  var m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}
function _nombreDe(from) {
  var s = String(from || '').replace(/<[^>]+>/, '').replace(/["']/g, '').trim();
  return s || _emailDe(from);
}

// monto: primero con símbolo de moneda (B/., $, USD); si no, un número con 2 decimales.
function _extraerMonto(t) {
  t = String(t || '');
  var re = /(?:B\s*\/\.?|\$|USD)\s*([0-9]+(?:[.,][0-9]{1,2})?)/ig, m, cands = [];
  while ((m = re.exec(t))) cands.push(parseFloat(m[1].replace(',', '.')));
  if (cands.length) return _round2(Math.max.apply(null, cands));
  var re2 = /\b([0-9]{2,4}[.,][0-9]{2})\b/g, best = 0;
  while ((m = re2.exec(t))) { var v = parseFloat(m[1].replace(',', '.')); if (v > best) best = v; }
  return best ? _round2(best) : 0;
}

function _extraerLote(t) {
  var m = String(t || '').match(/lote[s]?\s*([LQH])?\s*([0-9]+\s*[A-Za-z]?)/i);
  if (!m) return { num: '', resPref: '', raw: '' };
  var pref = m[1] ? m[1].toUpperCase() : '';
  var num = m[2].replace(/\s/g, '').toUpperCase();
  return { num: num, resPref: ({ L: 'Los Laureles', Q: 'El Quira', H: 'El Higueron' }[pref] || ''), raw: (pref || '') + num };
}

function _carpetaComprobantes() {
  var name = 'Aires de Chicá - Comprobantes';
  var it = DriveApp.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  // Enlace público de solo lectura: los comprobantes se ven sin iniciar sesión.
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return folder;
}

// OCR de una imagen/PDF: convierte a Google Doc con OCR (Servicio avanzado Drive v2),
// lee el texto y borra el doc temporal. Devuelve '' si falla.
function _ocrTexto(blob) {
  var fileId = null;
  try {
    var f = Drive.Files.insert(
      { title: 'ac-ocr-tmp', mimeType: 'application/vnd.google-apps.document' },
      blob, { ocr: true, ocrLanguage: 'es' }
    );
    fileId = f.id;
    var txt = DocumentApp.openById(fileId).getBody().getText();
    return txt || '';
  } catch (e) {
    return '';
  } finally {
    if (fileId) { try { Drive.Files.remove(fileId); } catch (e2) {} }
  }
}

// FALLBACK (sin API key): ¿el texto (OCR o del correo) parece un comprobante de pago? -> palabra clave + un monto.
function _esPago(texto) {
  if (!texto) return false;
  var t = _normTxt(texto);
  var kw = /(TRANSFERENCIA|COMPROBANTE|ACH|YAPPY|NEQUI|BANCO|DEPOSITO|MANTENIMIENTO|CUOTA|MONTO|CONFIRMAC|REFERENCIA|EXITOS|BALBOA|PAGO)/;
  return kw.test(t) && _extraerMonto(texto) > 0;
}

// Verifica si el pago fue hecho a la cuenta de Aires de Chicá.
//   nivel: 'ok' (coincide) | 'bad' (no coincide / medio no válido) | 'warn' (no se pudo verificar)
// Aires de Chicá SOLO recibe por su cuenta de Banco General; no tiene Yappy/Nequi.
function _verificarDestino(metodoPago, cuentaDestino, beneficiario) {
  var acct = String(CONFIG.CUENTA_NUM || '').replace(/\D/g, '');
  var mp = _normTxt(metodoPago || '');
  var cd = String(cuentaDestino || '').replace(/\D/g, '');
  var ben = _normTxt(beneficiario || '');
  var esAC = /AIRES\s*DE\s*CHIC/.test(ben);

  // Medios que Aires de Chicá NO usa
  if (/YAPPY|NEQUI/.test(mp)) {
    return { nivel: 'bad', metodo: metodoPago,
      mensaje: 'Pago por ' + (metodoPago || 'Yappy/Nequi') + ': Aires de Chicá NO tiene Yappy/Nequi. Solo recibe por su cuenta de ' + CONFIG.BANCO + '. Verifica a dónde se envió.' };
  }

  // Comparación por número de cuenta destino
  if (cd && acct) {
    var coincide = (cd === acct) ||
      (cd.length >= 5 && acct.indexOf(cd) >= 0) ||
      (acct.length >= 5 && cd.indexOf(acct) >= 0) ||
      (cd.length >= 3 && cd.length <= 4 && acct.slice(-cd.length) === cd); // "terminación de producto" (últimos dígitos)
    if (coincide) return { nivel: 'ok', mensaje: 'Transferencia a la cuenta de Aires de Chicá (' + CONFIG.CUENTA_NUM + ').' };
    return { nivel: 'bad',
      mensaje: 'La cuenta destino (' + cuentaDestino + ') NO coincide con la de Aires de Chicá (' + CONFIG.CUENTA_NUM + '). Verifica antes de aplicar.' };
  }

  // Sin número de cuenta: apóyate en el beneficiario
  if (esAC) return { nivel: 'ok', mensaje: 'Beneficiario: ' + beneficiario + ' — coincide con Aires de Chicá.' };
  if (ben) return { nivel: 'warn', mensaje: 'No se detectó el número de cuenta destino. Beneficiario: ' + beneficiario + '. Verifica manualmente.' };
  return { nivel: 'warn', mensaje: 'No se pudo verificar la cuenta ni el beneficiario de destino. Revisa el comprobante manualmente.' };
}

// ¿Es un aviso automático de Banco General? (no trae adjunto: el correo ES el comprobante)
//   - por remitente: mensajesyalertas@bgeneral.com (u otro @bgeneral.com), o
//   - por contenido: la redacción fija de BG + un "Monto:" (cubre reenvíos del propietario).
function _esNotifBanco(from, subject, body) {
  var f = String(from || '').toLowerCase();
  if (f.indexOf('bgeneral.com') >= 0) return true;
  var t = _normTxt(String(subject || '') + ' \n ' + String(body || ''));
  return /TE\s+(TRANSFIRIO|ENVIO)/.test(t) &&
         /(SIGUIENTE TRANSACCION|BANCA EN LINEA)/.test(t) &&
         /MONTO/.test(t);
}

// Genera un PDF con formato del aviso de Banco General (para que el comprobante
// tenga una miniatura legible en Drive / en el tooltip de "Ver comprobante").
function _pdfRow(k, v) {
  return '<tr><td style="padding:3px 16px 3px 0;color:#5B7883">' + k + '</td>' +
         '<td style="padding:3px 0;font-weight:600">' + (v || '—') + '</td></tr>';
}
function _notifBancoPdf(nb, body, fecha) {
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var f = Utilities.formatDate(fecha, CONFIG.TZ, 'dd/MM/yyyy');
  var html = '<html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Helvetica,Arial,sans-serif;color:#143039;padding:36px">' +
    '<div style="font-size:20px;font-weight:700;color:#0E8FB0">Aviso de pago recibido</div>' +
    '<div style="color:#5B7883;margin:2px 0 16px">Banca en Línea · ' + CONFIG.BANCO + ' · ' + f + '</div>' +
    '<div style="font-size:34px;font-weight:800;color:#0E8FB0;margin:6px 0 18px">' + _money(nb.monto || 0) + '</div>' +
    '<table style="border-collapse:collapse;font-size:14px">' +
      _pdfRow('Pagador', esc(nb.pagador)) +
      _pdfRow('Descripción', esc(nb.descripcion)) +
      _pdfRow('Cuenta destino (terminación)', esc(nb.cuentaTerm)) +
    '</table>' +
    '<div style="margin-top:22px;color:#5B7883;font-size:11px;white-space:pre-wrap;border-top:1px solid #ddd;padding-top:10px">' +
      esc(body) + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).getAs('application/pdf');
}

// Extrae los datos de un aviso de Banco General (texto plano, formato fijo).
function _parseNotifBanco(subject, body) {
  var out = { monto: 0, descripcion: '', pagador: '', cuentaTerm: '', tipoCuenta: '' };
  var b = String(body || '');
  var mMonto = b.match(/Monto:\s*(?:US\$|USD|B\/\.?|\$)?\s*([0-9][0-9.,]*)/i);
  if (mMonto) out.monto = _round2(parseFloat(mMonto[1].replace(/,/g, '')) || 0);
  var mTerm = b.match(/Terminaci[oó]n de producto:\s*([0-9]+)/i);
  if (mTerm) out.cuentaTerm = mTerm[1];
  var mTipo = b.match(/A tu:?\s*(.+)/i);
  if (mTipo) out.tipoCuenta = mTipo[1].trim();
  var mDesc = b.match(/Descripci[oó]n:\s*(.+)/i);
  if (mDesc) out.descripcion = mDesc[1].trim();
  // pagador: "<NOMBRE> te transfirió..." (asunto) o "<NOMBRE> te envió..." (cuerpo)
  var mPag = String(subject || '').match(/^\s*(.+?)\s+te\s+(?:transfiri|envi)/i) ||
             b.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .]{3,})\s+te\s+(?:envi|transfiri)/i);
  if (mPag) out.pagador = mPag[1].replace(/\s+/g, ' ').trim();
  return out;
}

// adjuntos válidos: imagen o PDF, con contenido.
function _adjuntosValidos(msg) {
  return (msg.getAttachments() || []).filter(function (a) {
    var ct = String(a.getContentType() || '').toLowerCase();
    return a.getSize() > 0 && a.getSize() < 25 * 1024 * 1024 &&
      (ct.indexOf('image/') === 0 || ct.indexOf('pdf') >= 0);
  });
}

/**
 * Lee correos nuevos dirigidos a comprobantes@ y los deja como PENDIENTES.
 * Idempotente: deduplica por Message-Id contra la hoja Comprobantes.
 */
function capturarComprobantes(maxThreads) {
  ensureSheets();
  var buzon = (CONFIG.COMPROBANTES_EMAIL || 'comprobantes@airesdechica.org').toLowerCase();
  var sh = _ss().getSheetByName(SH.COMPROB);

  var seen = {};
  _sheetRows(SH.COMPROB).forEach(function (r) { if (r.msgId) seen[String(r.msgId)] = true; });

  var props = getPropietarios();
  var byEmail = {}; props.forEach(function (p) { if (p.email) byEmail[String(p.email).toLowerCase()] = p; });
  var byLoteNum = {};
  props.forEach(function (p) {
    String(p.lote).split(/[\/y]/i).forEach(function (tok) {
      var mm = String(tok).match(/([0-9]+\s*[A-Za-z]?)/);
      if (mm) { var k = mm[1].replace(/\s/g, '').toUpperCase(); (byLoteNum[k] = byLoteNum[k] || []).push(p); }
    });
  });

  var folder = _carpetaComprobantes();
  var label = GmailApp.getUserLabelByName(GMAIL_LABEL_COMPROB) || GmailApp.createLabel(GMAIL_LABEL_COMPROB);
  var threads = GmailApp.search('to:' + buzon + ' newer_than:120d', 0, maxThreads || 40);
  var nuevos = 0, descartados = 0, filas = [];

  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (seen[id]) return;
      var to = (msg.getTo() + ' ' + msg.getCc()).toLowerCase();
      if (to.indexOf(buzon) === -1) return; // sólo los realmente dirigidos al buzón
      seen[id] = true;

      var from = msg.getFrom(), fromEmail = _emailDe(from);
      var subject = msg.getSubject() || '', body = (msg.getPlainBody() || '').slice(0, 4000);
      var emailTxt = subject + ' \n ' + body;

      var estado = 'pendiente', motivo = '', ocrTxt = '', url = '';
      var vis = null, refCap = '', nombreMatch = _nombreDe(from);
      var monto = 0, lote = { num: '', resPref: '', raw: '' }, metodoPago = '', cuentaDestino = '', beneficiario = '';
      var esBanco = _esNotifBanco(from, subject, body);
      var atts = esBanco ? [] : _adjuntosValidos(msg);

      if (esBanco) {
        // AVISO DE BANCO GENERAL: el correo ES el comprobante (sin adjunto). Es la
        // confirmación directa del banco de que el dinero entró a la cuenta de AC.
        var nb = _parseNotifBanco(subject, body);
        monto = nb.monto || _extraerMonto(emailTxt);
        lote  = nb.descripcion ? _extraerLote(nb.descripcion) : { num: '', resPref: '', raw: '' };
        if (!lote.num) lote = _extraerLote(emailTxt);
        if (nb.pagador) nombreMatch = nb.pagador;
        metodoPago = 'Banca en Línea (Banco General)';
        cuentaDestino = nb.cuentaTerm || '';
        beneficiario = CONFIG.CUENTA_NOMBRE; // BG sólo notifica sobre la cuenta de Aires de Chicá
        // Guarda el aviso como PDF con formato en Drive (miniatura legible + enlace "Ver comprobante").
        try {
          var pdf = _notifBancoPdf(nb, body, msg.getDate())
            .setName('BG ' + Utilities.formatDate(msg.getDate(), CONFIG.TZ, 'yyyy-MM-dd') + ' ' + (lote.raw || nb.pagador || '') + '.pdf');
          var fb = folder.createFile(pdf);
          try { fb.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}
          url = fb.getUrl();
        } catch (e) {}
      } else if (!atts.length) {
        // FILTRO 1: un correo normal debe traer un adjunto (imagen/PDF)
        estado = 'descartado'; motivo = 'sin adjunto';
      } else {
        // guardar todos los adjuntos en Drive
        atts.forEach(function (a) {
          try {
            var f = folder.createFile(a.copyBlob());
            f.setName(Utilities.formatDate(msg.getDate(), CONFIG.TZ, 'yyyy-MM-dd') + ' ' + a.getName());
            try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}
            if (!url) url = f.getUrl();
          } catch (e) {}
        });
        // ANÁLISIS: Claude vision sobre el primer adjunto (fallback: OCR de Google, hasta 2 adjuntos)
        try { vis = _analizarComprobante(atts[0].copyBlob()); } catch (e) { vis = null; }
        if (!vis) {
          for (var oi = 0; oi < atts.length && oi < 2; oi++) {
            try { ocrTxt += ' ' + _ocrTexto(atts[oi].copyBlob()); } catch (e) {}
          }
        }
        // FILTRO 2: ¿es un pago?  (Claude si disponible; si no, reglas sobre OCR/correo)
        var esPago = vis ? vis.esPago : (_esPago(ocrTxt) || _esPago(emailTxt));
        if (!esPago) { estado = 'descartado'; motivo = vis ? 'Claude: no parece un pago' : 'no parece un pago'; }

        // monto / referencia / lote / destino — de Claude si lo tenemos, si no de OCR/correo
        if (vis) {
          monto = vis.monto || _extraerMonto(emailTxt);
          lote  = vis.lote ? _extraerLote('lote ' + vis.lote) : _extraerLote(emailTxt);
          refCap = vis.referencia || '';
          metodoPago = vis.metodo || '';
          cuentaDestino = vis.cuentaDestino || '';
          beneficiario = vis.beneficiario || '';
          if (vis.pagador) nombreMatch = vis.pagador;
        } else {
          var textoTot = emailTxt + ' ' + ocrTxt;
          monto = _extraerMonto(ocrTxt) || _extraerMonto(emailTxt);
          lote  = _extraerLote(textoTot);
        }
      }
      var prop = byEmail[fromEmail] || null, metodo = prop ? 'email' : '';
      if (!prop && lote.num) {
        var cands = (byLoteNum[lote.num] || []).slice();
        if (lote.resPref) cands = cands.filter(function (p) { return p.residencial === lote.resPref; });
        if (cands.length === 1) { prop = cands[0]; metodo = 'lote'; }
        else if (cands.length > 1) {
          var best = null, bs = 0;
          cands.forEach(function (p) { var s = _scoreNombre(nombreMatch, p.nombre); if (s > bs) { bs = s; best = p; } });
          if (best && bs > 0) { prop = best; metodo = 'lote+nombre'; }
        }
      }
      if (!prop) { var m2 = _matchPorNombre(nombreMatch, props); if (m2) { prop = m2.prop; metodo = 'nombre'; } }

      filas.push([
        'C' + id, msg.getDate(), from, subject,
        prop ? prop.clave : '', prop ? prop.nombre : nombreMatch, prop ? prop.lote : lote.raw,
        monto || '', refCap, estado, url, id,
        estado === 'pendiente' ? (metodo || 'sin-match') : '', new Date(), motivo,
        metodoPago, cuentaDestino, beneficiario
      ]);
      if (estado === 'pendiente') nuevos++; else descartados++;
    });
    try { th.addLabel(label); } catch (e) {}
  });

  if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, COL_COMPROB.length).setValues(filas);
  return { nuevos: nuevos, descartados: descartados, buzon: buzon, revisados: threads.length };
}

function getComprobantes(estado) {
  ensureSheets();
  return _sheetRows(SH.COMPROB).map(function (r) {
    r.monto = Number(r.monto) || 0;
    r.fecha = r.fecha instanceof Date ? r.fecha : new Date(r.fecha);
    r.verif = _verificarDestino(r.metodoPago, r.cuentaDestino, r.beneficiario);
    return r;
  }).filter(function (r) { return !estado || String(r.estado) === estado; })
    .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
}

/**
 * Resuelve un comprobante pendiente.
 *   accion 'aplicar'  -> registra el pago (origen 'comprobante') y marca 'aplicado'
 *   accion 'rechazar' -> marca 'rechazado'
 * data: { id, accion, clave, monto }
 */
function resolverComprobante(data) {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.COMPROB);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iEst = h.indexOf('estado'), iCl = h.indexOf('clave'), iMo = h.indexOf('monto'),
      iNo = h.indexOf('nombre'), iLo = h.indexOf('lote'), iFe = h.indexOf('fecha'), iAs = h.indexOf('asunto');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]) !== String(data.id)) continue;
    // recuperar: un descartado vuelve a la cola de revisión
    if (data.accion === 'recuperar') {
      if (String(vals[r][iEst]) !== 'descartado') throw new Error('Solo se recuperan descartados.');
      sh.getRange(r + 1, iEst + 1).setValue('pendiente');
      var iMot = h.indexOf('motivo'); if (iMot >= 0) sh.getRange(r + 1, iMot + 1).setValue('');
      return { ok: true, estado: 'pendiente' };
    }
    if (String(vals[r][iEst]) !== 'pendiente') throw new Error('El comprobante ya fue ' + vals[r][iEst] + '.');
    if (data.accion === 'rechazar') { sh.getRange(r + 1, iEst + 1).setValue('rechazado'); return { ok: true, estado: 'rechazado' }; }
    // aplicar
    var clave = (data.clave || vals[r][iCl] || '').toString().trim();
    var monto = _round2(Number(data.monto != null ? data.monto : vals[r][iMo]) || 0);
    if (!clave) throw new Error('Asigna una cuenta antes de aplicar.');
    if (!(monto > 0)) throw new Error('Indica un monto válido.');
    var prop = _findProp(clave);
    if (!prop) throw new Error('No existe la cuenta ' + clave);
    var iUrl = h.indexOf('adjuntoUrl'), iRef = h.indexOf('referencia');
    appendPago({
      fecha: new Date(vals[r][iFe]), clave: clave, lote: prop.lote, nombre: prop.nombre, monto: monto,
      origen: 'comprobante', referencia: (iRef >= 0 ? String(vals[r][iRef] || '') : ''),
      comprobanteUrl: (iUrl >= 0 ? String(vals[r][iUrl] || '') : ''),
      notas: 'Comprobante email: ' + String(vals[r][iAs] || '').slice(0, 120)
    });
    sh.getRange(r + 1, iCl + 1).setValue(clave);
    sh.getRange(r + 1, iMo + 1).setValue(monto);
    sh.getRange(r + 1, iNo + 1).setValue(prop.nombre);
    sh.getRange(r + 1, iLo + 1).setValue(prop.lote);
    sh.getRange(r + 1, iEst + 1).setValue('aplicado');
    return { ok: true, estado: 'aplicado', clave: clave, monto: monto, cuota: prop.cuota };
  }
  throw new Error('Comprobante no encontrado: ' + data.id);
}

/**
 * Simula cómo se aplicaría un pago de `monto` a la cuenta `clave`, SIN registrar nada.
 * Reutiliza el motor de estado de cuenta (waterfall) comparando el estado antes y
 * después de añadir el pago: muestra a qué cuota(s) va, cuánto queda pendiente en cada
 * una y si sobra crédito a favor. Alimenta el panel de revisión previo a "Aplicar".
 */
function previsualizarComprobante(clave, monto) {
  var prop = _findProp(clave);
  if (!prop) throw new Error('No existe la cuenta ' + clave);
  monto = _round2(Number(monto) || 0);
  var pagos = getPagosByClave(clave);
  var antes = calcEstado(prop, pagos, null);
  var sim = pagos.concat([{ fecha: _today(), monto: monto, origen: 'sim' }]);
  var despues = calcEstado(prop, sim, null);

  // a qué buckets entró el dinero nuevo (principal y mora): aquellos cuyo saldo bajó
  var mapAntes = {}; antes.buckets.forEach(function (b) { mapAntes[b.label] = b; });
  var aplicacion = [], aplicacionMora = [];
  despues.buckets.forEach(function (b) {
    var a = mapAntes[b.label] || {};
    var apPrin = _round2((a.saldo != null ? a.saldo : b.monto) - b.saldo);
    if (apPrin > 0.009) aplicacion.push({ label: b.label, cuota: b.monto, aplicado: apPrin, quedaPendiente: b.saldo });
    var apMora = _round2((a.moraSaldo != null ? a.moraSaldo : b.mora) - b.moraSaldo);
    if (apMora > 0.009) aplicacionMora.push({ label: b.label, mora: b.mora, aplicado: apMora, quedaPendiente: b.moraSaldo });
  });

  return {
    clave: clave, nombre: prop.nombre, lote: prop.lote, cuota: cuotaDe(prop), monto: monto,
    orden: despues.moraOrden,
    antes:   { saldo: antes.saldo,   mora: antes.mora,   saldoConMora: antes.saldoConMora,   creditoAFavor: antes.creditoAFavor },
    despues: { saldo: despues.saldo, mora: despues.mora, saldoConMora: despues.saldoConMora, creditoAFavor: despues.creditoAFavor },
    aplicacion: aplicacion,
    aplicacionMora: aplicacionMora,
    totalAplicado: _round2(aplicacion.reduce(function (s, x) { return s + x.aplicado; }, 0) + aplicacionMora.reduce(function (s, x) { return s + x.aplicado; }, 0)),
    creditoResultante: despues.creditoAFavor,
    pendienteResultante: despues.saldoConMora
  };
}

/**
 * MIGRACIÓN (ejecutar UNA vez en el editor): regenera como PDF los avisos de
 * Banco General que se habían guardado como .txt (miniatura ilegible). Re-lee el
 * correo original por su msgId, crea el PDF con formato, actualiza el enlace del
 * comprobante y del pago asociado, y manda el .txt viejo a la papelera.
 * Seguro de correr varias veces: solo toca archivos que aún son .txt.
 */
function regenerarPdfsBanco() {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.COMPROB);
  var vals = sh.getDataRange().getValues(), h = vals[0].map(function (x) { return String(x).trim(); });
  var iUrl = h.indexOf('adjuntoUrl'), iMsg = h.indexOf('msgId'), iLo = h.indexOf('lote');
  var folder = _carpetaComprobantes();
  var cambios = [];

  for (var r = 1; r < vals.length; r++) {
    var url = String(vals[r][iUrl] || '');
    var idm = url.match(/[-\w]{25,}/); if (!idm) continue;
    var fileId = idm[0], mime = '';
    try { mime = DriveApp.getFileById(fileId).getMimeType(); } catch (e) { continue; }
    if (mime !== 'text/plain') continue;              // solo los .txt viejos

    var msgId = String(vals[r][iMsg] || ''); if (!msgId) continue;
    var msg = null; try { msg = GmailApp.getMessageById(msgId); } catch (e) {}
    if (!msg) continue;

    var body = (msg.getPlainBody() || '').slice(0, 4000);
    var nb = _parseNotifBanco(msg.getSubject() || '', body);
    var pdf = _notifBancoPdf(nb, body, msg.getDate())
      .setName('BG ' + Utilities.formatDate(msg.getDate(), CONFIG.TZ, 'yyyy-MM-dd') + ' ' + (String(vals[r][iLo] || nb.pagador || '')) + '.pdf');
    var f = folder.createFile(pdf);
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
    var newUrl = f.getUrl();
    sh.getRange(r + 1, iUrl + 1).setValue(newUrl);
    cambios.push({ old: url, neu: newUrl });
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}  // .txt viejo a la papelera
  }

  // actualiza los pagos que apuntaban al .txt viejo
  var shP = _ss().getSheetByName(SH.PAGOS);
  var pv = shP.getDataRange().getValues(), ph = pv[0].map(function (x) { return String(x).trim(); });
  var iCu = ph.indexOf('comprobanteUrl'), pagos = 0;
  if (iCu >= 0) {
    for (var p = 1; p < pv.length; p++) {
      var cur = String(pv[p][iCu] || '');
      cambios.forEach(function (c) { if (cur === c.old) { shP.getRange(p + 1, iCu + 1).setValue(c.neu); pagos++; } });
    }
  }
  return { regenerados: cambios.length, pagosActualizados: pagos };
}

/** Ejecuta UNA vez en el editor: autoriza Gmail/Drive, activa la captura diaria y hace la primera lectura. */
function activarCapturaComprobantes() {
  var cfg = _cfg(); cfg.capturaComprobantes = true;
  PropertiesService.getScriptProperties().setProperty(CFG_PROP, JSON.stringify(cfg));
  _cfgCache = null;
  reconcileTriggers(_cfg());
  return capturarComprobantes();
}
