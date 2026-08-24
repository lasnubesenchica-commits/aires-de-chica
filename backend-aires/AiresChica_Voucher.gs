/**
 * AiresChica_Voucher.gs — constancia de pago en PDF.
 *
 * Cuando un pago se registra desde el panel (típicamente al aplicar un
 * movimiento del estado de cuenta del banco), el sistema puede emitir una
 * constancia en PDF, guardarla en Drive y enlazarla al pago. Ese enlace es el
 * mismo campo `comprobanteUrl` que usan los comprobantes que llegan por correo,
 * así que la constancia aparece con el clip 📎 en el estado de cuenta, junto al
 * monto del mes, exactamente igual que un comprobante enviado por el propietario.
 *
 * La constancia acredita el registro del pago en el sistema; no sustituye al
 * comprobante bancario. El pie del documento lo dice de forma expresa.
 */

/* ─────────────── numeración correlativa ─────────────── */

var VOUCHER_SEQ_PROP = 'AC_VOUCHER_SEQ';

/** Correlativo CP-AAAA-0001, atómico entre ejecuciones concurrentes. */
function _correlativoVoucher(fecha) {
  var anio = Utilities.formatDate(fecha || new Date(), CONFIG.TZ, 'yyyy');
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  var n = 0;
  try {
    lock.waitLock(10000);
    var raw = props.getProperty(VOUCHER_SEQ_PROP) || '{}';
    var seq = {};
    try { seq = JSON.parse(raw) || {}; } catch (e) { seq = {}; }
    n = (Number(seq[anio]) || 0) + 1;
    seq[anio] = n;
    props.setProperty(VOUCHER_SEQ_PROP, JSON.stringify(seq));
  } catch (e) {
    // Si no se pudo tomar el lock, se usa un sufijo por tiempo antes que fallar
    // la emisión: el número deja de ser correlativo pero sigue siendo único.
    n = Number(Utilities.formatDate(new Date(), CONFIG.TZ, 'DDHHmm'));
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
  return 'CP-' + anio + '-' + ('0000' + n).slice(-4);
}

/* ─────────────── monto en letras ─────────────── */

var _VL_UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
               'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO',
               'DIECINUEVE', 'VEINTE'];
var _VL_DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
// 21-29 se escriben en una palabra y tres llevan tilde; no se arman con 'VEINTI' + unidad.
var _VL_20 = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
              'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
var _VL_CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
               'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function _letrasHasta999(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  var out = [];
  var c = Math.floor(n / 100), r = n % 100;
  if (c) out.push(_VL_CEN[c]);
  if (r) {
    if (r <= 20) out.push(_VL_UNI[r]);
    else if (r < 30) out.push(_VL_20[r - 20]);
    else {
      var d = Math.floor(r / 10), u = r % 10;
      out.push(_VL_DEC[d] + (u ? ' Y ' + _VL_UNI[u] : ''));
    }
  }
  return out.join(' ');
}

/** Apócope delante de 'MIL': VEINTIUNO MIL → VEINTIÚN MIL, CIENTO UNO MIL → CIENTO UN MIL. */
function _apocopeUno(txt) {
  if (/VEINTIUNO$/.test(txt)) return txt.replace(/VEINTIUNO$/, 'VEINTIÚN');
  if (/(^|\s)UNO$/.test(txt)) return txt.replace(/UNO$/, 'UN');
  return txt;
}

/** 94.5 → "NOVENTA Y CUATRO CON 50/100 BALBOAS" */
function _montoEnLetras(monto) {
  var v = _round2(Math.abs(Number(monto) || 0));
  var ent = Math.floor(v);
  var cts = Math.round((v - ent) * 100);
  var txt;
  if (ent === 0) txt = 'CERO';
  else if (ent === 1) txt = 'UNO';
  else {
    var mil = Math.floor(ent / 1000), res = ent % 1000, p = [];
    if (mil === 1) p.push('MIL');
    else if (mil > 1) p.push(_apocopeUno(_letrasHasta999(mil)) + ' MIL');
    if (res) p.push(_letrasHasta999(res));
    txt = p.join(' ');
  }
  return txt + ' CON ' + ('0' + cts).slice(-2) + '/100 BALBOAS';
}

/* ─────────────── carpeta en Drive ─────────────── */

function _carpetaConstancias() {
  var padre = _carpetaComprobantes();
  var name = 'Constancias de pago';
  var it = padre.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : padre.createFolder(name);
  // Enlace público de solo lectura: la constancia se abre desde el panel y
  // se puede reenviar al propietario sin que tenga cuenta de Google.
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return folder;
}

/* ─────────────── HTML de la constancia ─────────────── */

function _vRow(k, v) {
  return '<tr>' +
    '<td style="width:190px;padding:6px 18px 6px 0;color:' + AC_BRAND.muted + ';white-space:nowrap;font-size:11.5px;' +
      'text-transform:uppercase;letter-spacing:.05em;vertical-align:top">' + k + '</td>' +
    '<td style="padding:6px 0;font-weight:600;vertical-align:top">' + (v || '—') + '</td></tr>';
}

var AC_ORIGEN_TXT = {
  banco:     'Transferencia / ACH acreditada en la cuenta de la asociación',
  manual:    'Registro manual de la administración',
  correo:    'Comprobante recibido por correo',
  efectivo:  'Efectivo',
  simulado:  'Simulación'
};

function voucherPagoHTML(d) {
  var B = AC_BRAND;
  var cfg = _cfg();
  var esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var saldo = Number(d.saldoDespues) || 0;
  var alDia = saldo <= 0.009;
  var colSaldo = alDia ? B.ok : B.red;
  var origenTxt = AC_ORIGEN_TXT[String(d.origen || '').toLowerCase()] || (d.origen || 'Registro manual');

  return '' +
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  '@page{margin:0}' +
  'body{margin:0;font-family:Helvetica,Arial,sans-serif;color:' + B.ink + ';font-size:13px}' +
  '.wrap{padding:38px 44px}' +
  '.muted{color:' + B.muted + '}' +
  '</style></head><body><div class="wrap">' +

  // Encabezado
  '<table style="width:100%;border-collapse:collapse"><tr>' +
    '<td style="vertical-align:top">' +
      '<img src="' + CONFIG.LOGO_PNG_URL + '" style="height:74px" alt="' + CONFIG.NEGOCIO + '"/>' +
    '</td>' +
    '<td style="vertical-align:top;text-align:right">' +
      '<div style="font-size:20px;font-weight:700;color:' + B.teal + '">Constancia de pago</div>' +
      '<div class="muted" style="margin-top:2px">Nº ' + esc(d.numero) + '</div>' +
      '<div class="muted" style="margin-top:2px">Emitida: ' + _fmtFechaLarga(d.emitida) + '</div>' +
    '</td>' +
  '</tr></table>' +
  '<div style="height:4px;background:linear-gradient(90deg,' + B.teal + ',' + B.green + ' 60%,' + B.coral + ');margin:16px 0 22px;border-radius:2px"></div>' +

  // Declaración. El lote y el residencial pueden faltar (pago sin propietario
  // enlazado); la frase se arma para que siga leyéndose bien sin ellos.
  '<div style="font-size:13.5px;line-height:1.55">' +
    CONFIG.RAZON_SOCIAL + ' hace constar que recibió de <b>' + esc(d.nombre) + '</b>' +
    (d.lote ? ', propietario del lote <b>' + esc(d.lote) + '</b>' +
              (d.residencial ? ' en <b>' + esc(d.residencial) + '</b>' : '') : '') +
    ', la suma de:' +
  '</div>' +

  // Monto
  '<div style="margin:14px 0 4px;padding:16px 20px;background:' + B.teal50 + ';border-radius:10px">' +
    '<div style="font-size:34px;font-weight:800;color:' + B.teal + ';line-height:1">' + _money(d.monto) + '</div>' +
    '<div class="muted" style="margin-top:6px;font-size:11.5px;letter-spacing:.03em">' + _montoEnLetras(d.monto) + '</div>' +
  '</div>' +
  '<div class="muted" style="font-size:11.5px;margin-bottom:20px">en concepto de cuotas de mantenimiento.</div>' +

  // Detalle
  '<table style="border-collapse:collapse;font-size:13px;width:100%">' +
    _vRow('Fecha del pago', _fmtFechaLarga(d.fechaPago)) +
    _vRow('Forma de pago', esc(origenTxt)) +
    (d.referencia ? _vRow('Referencia', esc(d.referencia)) : '') +
    (d.banco ? _vRow('Detalle bancario', '<span style="font-weight:400" class="muted">' + esc(d.banco) + '</span>') : '') +
    _vRow('Cuenta de destino', esc(cfg.banco) + ' · ' + esc(cfg.cuentaTipo) + ' Nº ' + esc(cfg.cuentaNum)) +
    _vRow('Registro en el sistema', esc(d.pagoId)) +
  '</table>' +

  // Saldo resultante
  '<div style="margin-top:24px;padding:14px 18px;border:1px solid ' + B.border + ';border-radius:10px;background:#fbfeff">' +
    '<div style="font-weight:700;color:' + B.teal700 + ';margin-bottom:8px">Situación de la cuenta con este pago aplicado</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>' +
      '<td class="muted">Saldo de la cuenta</td>' +
      '<td style="text-align:right;font-weight:800;font-size:16px;color:' + colSaldo + '">' +
        (saldo < -0.009 ? _money(-saldo) + ' a favor' : _money(saldo)) + '</td>' +
    '</tr></table>' +
    '<div class="muted" style="margin-top:6px;font-size:11.5px">' +
      (alDia ? 'La cuenta queda <b style="color:' + B.ok + '">al día</b> a la fecha de emisión.'
             : 'Queda un saldo pendiente de ' + _money(saldo) + ' a la fecha de emisión. ' +
               'El detalle mes por mes está en el estado de cuenta.') +
    '</div>' +
  '</div>' +

  // Pie
  '<div style="margin-top:26px;border-top:1px solid ' + B.border + ';padding-top:12px;font-size:10.5px;color:' + B.muted + ';line-height:1.55">' +
    'Documento generado automáticamente por el sistema de cobros de ' + CONFIG.NEGOCIO + ' el ' +
      Utilities.formatDate(d.emitida, CONFIG.TZ, 'dd/MM/yyyy') + ' a las ' +
      Utilities.formatDate(d.emitida, CONFIG.TZ, 'HH:mm') + '. ' +
    'Registrado por: <b>' + esc(d.autor) + '</b>.<br>' +
    'Esta constancia acredita el registro del pago en el sistema de la asociación. ' +
    'No sustituye al comprobante emitido por el banco ni constituye recibo fiscal. ' +
    'Cualquier diferencia debe consultarse con la administración.' +
  '</div>' +

  '</div></body></html>';
}

/* ─────────────── emisión ─────────────── */

/**
 * Emite la constancia de un pago ya registrado y la enlaza a la fila del pago.
 *
 * @param {string} pagoId  id de la fila en la hoja Pagos.
 * @param {Object} opts    { forzar:true } re-emite aunque el pago ya tenga
 *                         comprobante; por defecto no pisa un comprobante
 *                         existente (p. ej. el que mandó el propietario).
 * @return {Object} { url, numero, nombre, pagoId, ya }
 */
function generarVoucherPago(pagoId, opts) {
  ensureSheets();
  opts = opts || {};
  pagoId = String(pagoId || '').trim();
  if (!pagoId) throw new Error('Falta el id del pago.');

  var sh = _ss().getSheetByName(SH.PAGOS);
  if (!sh) throw new Error('No existe la hoja de pagos.');
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iUrl = h.indexOf('comprobanteUrl');
  if (iId < 0) throw new Error('No se encontró la columna id.');
  if (iUrl < 0) throw new Error('No se encontró la columna comprobanteUrl.');

  var row = -1;
  for (var r = vals.length - 1; r >= 1; r--) { if (String(vals[r][iId]) === pagoId) { row = r; break; } }
  if (row < 0) throw new Error('Pago no encontrado: ' + pagoId);

  var pago = {};
  h.forEach(function (k, i) { pago[k] = vals[row][i]; });

  var urlActual = String(pago.comprobanteUrl || '').trim();
  if (urlActual && !opts.forzar) {
    return { url: urlActual, pagoId: pagoId, ya: true, numero: '' };
  }

  var clave = String(pago.clave || '').trim();
  var prop = _findProp(clave);
  var fechaPago = pago.fecha instanceof Date ? pago.fecha : (_fechaPagoDesdeISO(pago.fecha) || new Date(pago.fecha));

  // El saldo que se imprime es el de la cuenta ya con el pago dentro (el pago
  // está escrito en la hoja antes de llegar aquí), no una proyección.
  var saldoDespues = 0;
  try { saldoDespues = Number(getEstadoCuentaByKey(clave).saldoNeto) || 0; } catch (e) {}

  var emitida = new Date();
  var numero = _correlativoVoucher(emitida);
  var html = voucherPagoHTML({
    numero: numero,
    emitida: emitida,
    nombre: String(pago.nombre || (prop ? prop.nombre : '') || clave),
    lote: String(pago.lote || (prop ? prop.lote : '')),
    residencial: prop ? prop.residencial : '',
    monto: _round2(pago.monto),
    fechaPago: fechaPago,
    origen: String(pago.origen || 'manual'),
    referencia: String(pago.referencia || ''),
    banco: String(pago.notas || ''),
    pagoId: pagoId,
    saldoDespues: saldoDespues,
    autor: (typeof _autor === 'function' ? _autor() : 'Sistema')
  });

  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf')
    .setName('Constancia ' + numero + ' · ' + (pago.lote || clave) + ' · ' +
             Utilities.formatDate(fechaPago, CONFIG.TZ, 'yyyy-MM-dd') + '.pdf');

  var f = _carpetaConstancias().createFile(blob);
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  var url = f.getUrl();

  sh.getRange(row + 1, iUrl + 1).setValue(url);

  _reg('pago.constancia', {
    clave: clave, propietario: String(pago.nombre || (prop ? prop.nombre : '')),
    monto: _round2(pago.monto), origen: String(pago.origen || ''),
    campo: 'comprobanteUrl', antes: urlActual, despues: url,
    detalle: 'Constancia de pago ' + numero + ' emitida' + (urlActual ? ' (reemplaza el comprobante anterior)' : '')
  });

  return { url: url, numero: numero, pagoId: pagoId, nombre: blob.getName(), ya: false };
}

/**
 * MANTENIMIENTO (ejecutar en el editor): emite la constancia de todos los pagos
 * de un origen dado que todavía no tienen comprobante enlazado. Sirve para los
 * pagos que se aplicaron antes de que existiera este módulo.
 * Idempotente: nunca pisa un comprobante existente.
 */
function emitirConstanciasFaltantes(origen, limite) {
  ensureSheets();
  origen = String(origen || 'banco').toLowerCase();
  limite = Number(limite) || 50;
  var pagos = getPagos();
  var hechos = [], errores = [];
  for (var i = 0; i < pagos.length && hechos.length < limite; i++) {
    var p = pagos[i];
    if (String(p.origen || '').toLowerCase() !== origen) continue;
    if (String(p.comprobanteUrl || '').trim()) continue;
    try {
      var res = generarVoucherPago(p.id);
      if (!res.ya) hechos.push({ id: p.id, clave: p.clave, numero: res.numero, url: res.url });
    } catch (e) {
      errores.push({ id: p.id, error: String(e) });
    }
  }
  return { emitidas: hechos.length, detalle: hechos, errores: errores };
}
