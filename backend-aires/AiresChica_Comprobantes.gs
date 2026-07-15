/**
 * Captura de comprobantes de pago por email.
 *
 * Los propietarios envían su comprobante a comprobantes@airesdechica.org
 * (alias/reenvío a admin@, que es la cuenta bajo la que corre el script).
 * Un trigger diario `capturarComprobantes()` lee los correos nuevos, extrae
 * lote + monto, empareja al propietario (por email del remitente, lote o
 * nombre), guarda el adjunto en Drive y deja el comprobante como PENDIENTE.
 *
 * NADA se aplica solo: la cola queda para revisión en el panel; el admin
 * confirma (se registra el pago) o rechaza. Así se evita aplicar montos
 * equivocados y el doble conteo con la conciliación bancaria.
 */

var GMAIL_LABEL_COMPROB = 'AC-Comprobantes';

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
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
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
  var nuevos = 0, filas = [];

  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (seen[id]) return;
      var to = (msg.getTo() + ' ' + msg.getCc()).toLowerCase();
      if (to.indexOf(buzon) === -1) return; // sólo los realmente dirigidos al buzón
      seen[id] = true;

      var from = msg.getFrom(), fromEmail = _emailDe(from);
      var subject = msg.getSubject() || '', body = (msg.getPlainBody() || '').slice(0, 4000);
      var texto = subject + ' \n ' + body;
      var monto = _extraerMonto(texto);
      var lote = _extraerLote(texto);

      // emparejar: 1) email del remitente, 2) lote, 3) nombre
      var prop = byEmail[fromEmail] || null, metodo = prop ? 'email' : '';
      if (!prop && lote.num) {
        var cands = (byLoteNum[lote.num] || []).slice();
        if (lote.resPref) cands = cands.filter(function (p) { return p.residencial === lote.resPref; });
        if (cands.length === 1) { prop = cands[0]; metodo = 'lote'; }
        else if (cands.length > 1) {
          var best = null, bs = 0;
          cands.forEach(function (p) { var s = _scoreNombre(_nombreDe(from), p.nombre); if (s > bs) { bs = s; best = p; } });
          if (best && bs > 0) { prop = best; metodo = 'lote+nombre'; }
        }
      }
      if (!prop) { var m2 = _matchPorNombre(_nombreDe(from), props); if (m2) { prop = m2.prop; metodo = 'nombre'; } }

      // guardar adjuntos en Drive
      var url = '';
      try {
        (msg.getAttachments() || []).forEach(function (a) {
          if (a.getSize() > 0 && a.getSize() < 25 * 1024 * 1024) {
            var f = folder.createFile(a.copyBlob());
            f.setName(Utilities.formatDate(msg.getDate(), CONFIG.TZ, 'yyyy-MM-dd') + ' ' + (prop ? prop.lote : lote.num || 's-l') + ' ' + a.getName());
            if (!url) url = f.getUrl();
          }
        });
      } catch (e) {}

      filas.push([
        'C' + id, msg.getDate(), from, subject,
        prop ? prop.clave : '', prop ? prop.nombre : _nombreDe(from), prop ? prop.lote : lote.raw,
        monto || '', '', 'pendiente', url, id, metodo || 'sin-match', new Date()
      ]);
      nuevos++;
    });
    try { th.addLabel(label); } catch (e) {}
  });

  if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, COL_COMPROB.length).setValues(filas);
  return { nuevos: nuevos, buzon: buzon, revisados: threads.length };
}

function getComprobantes(estado) {
  ensureSheets();
  return _sheetRows(SH.COMPROB).map(function (r) {
    r.monto = Number(r.monto) || 0;
    r.fecha = r.fecha instanceof Date ? r.fecha : new Date(r.fecha);
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
    if (String(vals[r][iEst]) !== 'pendiente') throw new Error('El comprobante ya fue ' + vals[r][iEst] + '.');
    if (data.accion === 'rechazar') { sh.getRange(r + 1, iEst + 1).setValue('rechazado'); return { ok: true, estado: 'rechazado' }; }
    // aplicar
    var clave = (data.clave || vals[r][iCl] || '').toString().trim();
    var monto = _round2(Number(data.monto != null ? data.monto : vals[r][iMo]) || 0);
    if (!clave) throw new Error('Asigna una cuenta antes de aplicar.');
    if (!(monto > 0)) throw new Error('Indica un monto válido.');
    var prop = _findProp(clave);
    if (!prop) throw new Error('No existe la cuenta ' + clave);
    appendPago({
      fecha: new Date(vals[r][iFe]), clave: clave, lote: prop.lote, nombre: prop.nombre, monto: monto,
      origen: 'comprobante', referencia: '',
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

/** Ejecuta UNA vez en el editor: autoriza Gmail/Drive, activa la captura diaria y hace la primera lectura. */
function activarCapturaComprobantes() {
  var cfg = _cfg(); cfg.capturaComprobantes = true;
  PropertiesService.getScriptProperties().setProperty(CFG_PROP, JSON.stringify(cfg));
  _cfgCache = null;
  reconcileTriggers(_cfg());
  return capturarComprobantes();
}
