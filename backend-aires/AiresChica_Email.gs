/**
 * Estados de cuenta en PDF y correos a propietarios.
 *  - estadoCuentaHTML(est)  : plantilla profesional (usa la paleta de la marca)
 *  - estadoCuentaPDF(lote)  : Blob PDF
 *  - enviarEstadoCuenta(lote)      : correo con el PDF adjunto + resumen en cuerpo
 *  - enviarRecordatorios(tipo)     : lote por correo (recordatorio mensual / aviso de mora)
 */

var AC_BRAND = {
  teal:   '#0E8FB0',
  teal700:'#086176',
  teal50: '#E8F6FA',
  coral:  '#E8804C',
  green:  '#8DC63F',
  ink:    '#143039',
  muted:  '#5B7883',
  border: '#D3E6EC',
  red:    '#C0392B',
  amber:  '#B7791F',
  ok:     '#1E8E5A'
};

function _fmtFecha(d) {
  d = d instanceof Date ? d : new Date(d);
  return Utilities.formatDate(d, CONFIG.TZ, 'dd/MM/yyyy');
}
function _fmtFechaLarga(d) {
  d = d instanceof Date ? d : new Date(d);
  return AC_MESES_LARGO[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function estadoCuentaHTML(est) {
  var B = AC_BRAND;
  var color = est.saldoConMora > 0.009 ? (est.diasVencido > 0 ? B.red : B.amber) : B.ok;
  var badge = est.estado;
  var cfg = _cfg();
  var _md = String(cfg.moraDesde).split('-');
  var moraDesdeTxt = (AC_MESES_LARGO[Number(_md[1]) - 1] || '') + ' ' + _md[0];

  var filas = (est.mensual || []).map(function (b) {
    var saldoColor = b.saldo > 0.009 ? B.red : (b.saldo < -0.009 ? B.ok : B.ink);
    var pagadoTxt = b.pagado ? _money(b.pagado) : (b.cuota ? '<span style="color:' + B.coral + '">0.00</span>' : '—');
    var bg = b.saldo > 0.009 ? '#FFF7F4' : '#ffffff';
    return '<tr style="background:' + bg + '">' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + '">' + b.label + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right">' + (b.cuota ? _money(b.cuota) : '—') + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right">' + pagadoTxt + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right;color:' + saldoColor + '">' + _money(b.saldo) + '</td>' +
      '</tr>';
  }).join('');

  var lotesInfo = est.lotes + (est.lotes > 1 ? ' lotes' : ' lote') +
    (est.cabanas ? ' · ' + est.cabanas + (est.cabanas > 1 ? ' cabañas' : ' cabaña') : '') +
    (est.airbnb ? ' · AirBnB (+' + cfg.airbnbPct + '%)' : '');

  return '' +
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  '@page{margin:0}' +
  'body{margin:0;font-family:Helvetica,Arial,sans-serif;color:' + B.ink + ';font-size:13px}' +
  '.wrap{padding:34px 40px}' +
  '.muted{color:' + B.muted + '}' +
  '</style></head><body><div class="wrap">' +

  // Header
  '<table style="width:100%;border-collapse:collapse"><tr>' +
    '<td style="vertical-align:top">' +
      '<img src="' + CONFIG.LOGO_PNG_URL + '" style="height:78px" alt="Aires de Chicá"/>' +
    '</td>' +
    '<td style="vertical-align:top;text-align:right">' +
      '<div style="font-size:20px;font-weight:700;color:' + B.teal + '">Estado de Cuenta</div>' +
      '<div class="muted" style="margin-top:2px">Cuotas de mantenimiento ' + CONFIG.ANIO_ACTUAL + '</div>' +
      '<div class="muted" style="margin-top:2px">Emitido: ' + _fmtFechaLarga(est.asOf) + '</div>' +
    '</td>' +
  '</tr></table>' +
  '<div style="height:4px;background:linear-gradient(90deg,' + B.teal + ',' + B.green + ' 60%,' + B.coral + ');margin:16px 0 20px;border-radius:2px"></div>' +

  // Datos del propietario + estado
  '<table style="width:100%;border-collapse:collapse"><tr>' +
    '<td style="vertical-align:top">' +
      '<div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">Propietario</div>' +
      '<div style="font-size:16px;font-weight:700">' + est.nombre + '</div>' +
      '<div class="muted" style="margin-top:3px">' + est.residencial + ' · Lote ' + est.lote + '</div>' +
      '<div class="muted">' + lotesInfo + ' · Cuota mensual ' + _money(est.cuota) + '</div>' +
    '</td>' +
    '<td style="vertical-align:top;text-align:right">' +
      '<span style="display:inline-block;padding:6px 14px;border-radius:20px;font-weight:700;color:#fff;background:' + color + '">' + badge + '</span>' +
      (est.diasVencido > 0 ? '<div class="muted" style="margin-top:6px">' + est.diasVencido + ' días de atraso</div>' : '') +
    '</td>' +
  '</tr></table>' +

  // Tabla de cuotas
  '<table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:12.5px">' +
    '<thead><tr style="background:' + B.teal + ';color:#fff">' +
      '<th style="padding:9px 10px;text-align:left">Mes</th>' +
      '<th style="padding:9px 10px;text-align:right">Cuota</th>' +
      '<th style="padding:9px 10px;text-align:right">Pagado</th>' +
      '<th style="padding:9px 10px;text-align:right">Saldo acum.</th>' +
    '</tr></thead><tbody>' + filas + '</tbody></table>' +

  // Totales
  '<table style="width:100%;border-collapse:collapse;margin-top:18px"><tr>' +
    '<td style="width:55%"></td>' +
    '<td style="vertical-align:top">' +
      _totRow('Saldo pendiente', _money(est.saldo), B.ink, B) +
      _totRow('Recargo por mora (' + cfg.moraPct + '%)', _money(est.mora), B.coral, B) +
      (est.creditoAFavor > 0.009 ? _totRow('Crédito a favor', '-' + _money(est.creditoAFavor), B.ok, B) : '') +
      '<div style="display:flex;justify-content:space-between;padding:11px 12px;background:' + B.teal50 + ';border-radius:8px;margin-top:6px">' +
        '<span style="font-weight:700">SALDO TOTAL</span>' +
        '<span style="font-weight:800;font-size:16px;color:' + color + '">' + _money(est.saldoConMora) + '</span>' +
      '</div>' +
    '</td>' +
  '</tr></table>' +

  // Datos de pago
  '<div style="margin-top:24px;padding:14px 16px;border:1px solid ' + B.border + ';border-radius:8px;background:#fbfeff">' +
    '<div style="font-weight:700;color:' + B.teal700 + ';margin-bottom:4px">Datos para el pago</div>' +
    '<div class="muted">' + CONFIG.BANCO + ' · ' + CONFIG.CUENTA_TIPO + ' Nº ' + CONFIG.CUENTA_NUM + '</div>' +
    '<div class="muted">A nombre de ' + CONFIG.CUENTA_NOMBRE + '</div>' +
    '<div class="muted" style="margin-top:6px;font-size:11.5px">Nota: a partir de la cuota de ' + moraDesdeTxt + ' se aplica un recargo del ' + cfg.moraPct + '% mensual sobre el mes o meses morosos (Reglamento de copropietarios).</div>' +
  '</div>' +

  '<div class="muted" style="margin-top:22px;text-align:center;font-size:11px">' +
    CONFIG.NEGOCIO + ' · "Todo comienza con un sueño" · Documento generado automáticamente' +
  '</div>' +

  '</div></body></html>';
}

function _totRow(label, val, color, B) {
  return '<div style="display:flex;justify-content:space-between;padding:5px 12px">' +
    '<span class="muted">' + label + '</span>' +
    '<span style="color:' + color + ';font-weight:600">' + val + '</span></div>';
}

function estadoCuentaPDF(estOrClave) {
  var est = (estOrClave && estOrClave.buckets) ? estOrClave : getEstadoCuentaByKey(estOrClave);
  var html = estadoCuentaHTML(est);
  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf');
  var nombre = 'EstadoCuenta_' + String(est.clave).replace(/[^\w]/g, '') + '_' +
               Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM') + '.pdf';
  return blob.setName(nombre);
}

/**
 * Ejecuta esto UNA sola vez en el editor de Apps Script para autorizar el
 * permiso de envío de correo (MailApp). Google mostrará la pantalla de
 * consentimiento; acéptala. Después de eso el botón "Enviar por correo"
 * del panel ya funcionará. Envía un correo de prueba a tu correo de prueba
 * (o al ADMIN_EMAIL si no hay uno configurado).
 */
function autorizarCorreo() {
  var cfg = _cfg();
  var to = (cfg.modoPrueba && cfg.correoPrueba) ? cfg.correoPrueba : CONFIG.ADMIN_EMAIL;
  Logger.log('modoPrueba=%s | correoPrueba="%s" | enviosActivos=%s', cfg.modoPrueba, cfg.correoPrueba, cfg.enviosActivos);
  Logger.log('>>> Enviando correo de prueba a: %s', to);
  Logger.log('Cuota diaria de correo restante: %s', MailApp.getRemainingDailyQuota());
  MailApp.sendEmail({
    to: to,
    name: CONFIG.NEGOCIO,
    replyTo: CONFIG.REPLY_TO,
    subject: 'Prueba de autorización — ' + CONFIG.NEGOCIO,
    htmlBody: _emailShell('<p>✅ El permiso de envío de correo quedó autorizado correctamente.</p>' +
      '<p>Ya puedes usar el botón <b>“Enviar por correo”</b> desde el panel.</p>')
  });
  Logger.log('Enviado. Revisa la bandeja (y spam) de: %s', to);
  return 'Correo de prueba enviado a ' + to + '. Revisa la bandeja (y la carpeta de spam).';
}

/* ─────────────── correos ─────────────── */

function enviarEstadoCuenta(clave) {
  var cfg = _cfg();
  if (!cfg.enviosActivos) return { enviado: false, motivo: 'Envíos pausados (interruptor maestro apagado).', clave: clave };
  var est = getEstadoCuentaByKey(clave);
  // Modo prueba: todo correo se redirige a la dirección de prueba (sin avisar a los propietarios).
  var prueba = !!(cfg.modoPrueba && cfg.correoPrueba);
  var destino = prueba ? cfg.correoPrueba : est.email;
  if (!destino) return { enviado: false, motivo: 'Propietario sin correo', clave: clave, lote: est.lote };
  var pdf = estadoCuentaPDF(est);
  var asunto = (prueba ? '[PRUEBA→' + est.email + '] ' : '') +
    'Estado de cuenta — ' + CONFIG.NEGOCIO + ' — Lote ' + est.lote;
  var saldoTxt = est.saldoConMora > 0.009
    ? 'Su saldo pendiente es <b style="color:' + AC_BRAND.coral + '">' + _money(est.saldoConMora) + '</b>' +
      (est.mora > 0.009 ? ' (incluye ' + _money(est.mora) + ' de mora)' : '') + '.'
    : 'Su cuenta está <b style="color:' + AC_BRAND.ok + '">al día</b>. ¡Gracias!';
  var cuerpo = _emailShell(
    '<p>Estimado(a) <b>' + est.nombre + '</b>,</p>' +
    '<p>Adjuntamos su estado de cuenta de mantenimiento actualizado (Lote ' + est.lote + ', ' + est.residencial + ').</p>' +
    '<p>' + saldoTxt + '</p>' +
    (est.saldoConMora > 0.009 ?
      '<p style="margin-top:14px">Puede realizar su pago a:<br>' + CONFIG.BANCO + ' · ' + CONFIG.CUENTA_TIPO +
      ' Nº ' + CONFIG.CUENTA_NUM + '<br>' + CONFIG.CUENTA_NOMBRE + '</p>' : '')
  );
  MailApp.sendEmail({
    to: destino,
    replyTo: CONFIG.REPLY_TO,
    name: CONFIG.NEGOCIO,
    subject: asunto,
    htmlBody: cuerpo,
    attachments: [pdf]
  });
  return { enviado: true, clave: clave, lote: est.lote, email: destino, prueba: prueba, destinatarioReal: est.email, saldo: est.saldoConMora };
}

function enviarRecordatorios(tipo, lotes) {
  if (!_cfg().enviosActivos) return { enviados: 0, pausado: true, sinCorreo: [], motivo: 'Envíos pausados (interruptor maestro apagado).' };
  tipo = tipo || 'mensual'; // 'mensual' | 'mora'
  var dash = buildDashboard(null);
  var objetivo = dash.cuentas.filter(function (c) {
    if (lotes && lotes.length) return lotes.indexOf(c.clave) !== -1;
    if (tipo === 'mora') return c.mora > 0.009;
    return c.saldoConMora > 0.009; // recordatorio a todos con saldo
  });
  var enviados = [], sinCorreo = [];
  objetivo.forEach(function (c) {
    if (!c.email) { sinCorreo.push(c.lote); return; }
    try {
      var res = enviarEstadoCuenta(c.clave);
      enviados.push(res);
      Utilities.sleep(400); // respeta cuota de envío
    } catch (e) { sinCorreo.push(c.clave + ' (' + e + ')'); }
  });
  return { tipo: tipo, enviados: enviados.length, sinCorreo: sinCorreo, detalle: enviados };
}

function _emailShell(inner) {
  var B = AC_BRAND;
  return '<div style="font-family:Helvetica,Arial,sans-serif;color:' + B.ink + ';max-width:560px;margin:0 auto">' +
    '<div style="text-align:center;padding:8px 0 4px">' +
      '<img src="' + CONFIG.LOGO_PNG_URL + '" style="height:64px" alt="' + CONFIG.NEGOCIO + '"/></div>' +
    '<div style="height:3px;background:linear-gradient(90deg,' + B.teal + ',' + B.green + ' 60%,' + B.coral + ');border-radius:2px;margin:6px 0 16px"></div>' +
    '<div style="font-size:14px;line-height:1.55">' + inner + '</div>' +
    '<div style="margin-top:22px;padding-top:12px;border-top:1px solid ' + B.border + ';color:' + B.muted + ';font-size:12px;text-align:center">' +
      CONFIG.NEGOCIO + ' · "Todo comienza con un sueño"</div></div>';
}
