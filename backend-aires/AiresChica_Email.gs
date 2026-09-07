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
    var moraTxt = b.condonada ? '<span style="color:' + B.muted + '">condon.</span>'
      : (b.mora > 0.009 ? '<span style="color:' + B.coral + '">' + _money(b.mora) + '</span>' : '—');
    var bg = b.saldo > 0.009 ? '#FFF7F4' : '#ffffff';
    return '<tr style="background:' + bg + '">' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + '">' + b.label + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right">' + (b.cuota ? _money(b.cuota) : '—') + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right">' + moraTxt + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right">' + pagadoTxt + '</td>' +
      '<td style="padding:7px 10px;border-bottom:1px solid ' + B.border + ';text-align:right;color:' + saldoColor + ';font-weight:600">' + _money(b.saldo) + '</td>' +
      '</tr>';
  }).join('');

  var lotesInfo = est.lotes + (est.lotes > 1 ? ' lotes' : ' lote') +
    (est.cabanas ? ' · ' + est.cabanas + (est.cabanas > 1 ? ' cabañas' : ' cabaña') : '');

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
      '<th style="padding:9px 10px;text-align:right">Mora</th>' +
      '<th style="padding:9px 10px;text-align:right">Pagado</th>' +
      '<th style="padding:9px 10px;text-align:right">Saldo total</th>' +
    '</tr></thead><tbody>' + filas + '</tbody></table>' +
  '<div style="font-size:11px;color:' + B.muted + ';margin-top:6px">Saldo total del mes = saldo inicial + cuota del mes + recargo por mora del mes − pago recibido. La mora es un cargo único del 10% cuando la cuota del mes (de abril en adelante) no se paga dentro del mes.</div>' +

  // Totales
  '<table style="width:100%;border-collapse:collapse;margin-top:18px"><tr>' +
    '<td style="width:55%"></td>' +
    '<td style="vertical-align:top">' +
      (est.moraCargada > 0.009 ? _totRow('Cargos por mora del año', _money(est.moraCargada), B.coral, B) : '') +
      (est.saldoNeto < -0.009 ? _totRow('Crédito a favor', _money(-est.saldoNeto), B.ok, B) : '') +
      '<div style="display:flex;justify-content:space-between;padding:11px 12px;background:' + B.teal50 + ';border-radius:8px;margin-top:6px">' +
        '<span style="font-weight:700">SALDO TOTAL</span>' +
        '<span style="font-weight:800;font-size:16px;color:' + color + '">' + _money(est.saldoNeto) + '</span>' +
      '</div>' +
    '</td>' +
  '</tr></table>' +

  // Datos de pago
  '<div style="margin-top:24px;padding:14px 16px;border:1px solid ' + B.border + ';border-radius:8px;background:#fbfeff">' +
    '<div style="font-weight:700;color:' + B.teal700 + ';margin-bottom:4px">Datos para el pago</div>' +
    // La cuenta de cobro, no la configuración vieja: es la que el panel marca en
    // Opciones → Cuentas, y cambiarla ahí tiene que cambiarla aquí.
    '<div class="muted">' + _ctaCobro().banco + ' · ' + _ctaCobro().tipo + ' Nº ' + _ctaCobro().numero + '</div>' +
    '<div class="muted">A nombre de ' + _ctaCobro().titular + '</div>' +
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

/**
 * Los datos de la cuenta que RECIBE los pagos. Todo lo que le dice a un propietario
 * dónde pagar sale de aquí y de ningún otro lado: el instructivo, el bloque del PDF
 * y el párrafo del correo. Antes cada uno leía la configuración vieja
 * (cfg.banco/cuentaNum/...), que dejó de ser la verdad el día que las cuentas pasaron
 * a administrarse en Opciones → Cuentas: marcar Global Bank como cuenta de cobro no
 * cambiaba los correos, que seguían mandando a la gente al Banco General.
 *
 * cuentaDeCobro() ya cae en esa configuración vieja si la hoja de cuentas todavía no
 * existe, así que este cambio no puede dejar los correos sin datos de pago.
 */
function _ctaCobro() { return cuentaDeCobro(); }

/**
 * Instructivo para el propietario: cómo pagar por banca en línea, con énfasis en
 * agregar el correo de comprobantes@ para que el pago se registre automáticamente.
 * Va al final del cuerpo del correo.
 *
 * No nombra el banco DEL PROPIETARIO: cada uno tiene el suyo y el instructivo se le
 * manda a todos. El único banco que aparece es el de la cuenta que recibe.
 */
function _instructivoPago(loteTxt) {
  var B = AC_BRAND, cta = _ctaCobro();
  var comp = CONFIG.COMPROBANTES_EMAIL;
  return '<div style="margin-top:22px;padding:16px 18px;border:1px solid ' + B.border + ';border-radius:10px;background:' + B.teal50 + '">' +
    '<div style="font-weight:700;color:' + B.teal700 + ';font-size:14px;margin-bottom:10px">Cómo registrar su pago por banca en línea</div>' +
    '<ol style="margin:0;padding-left:18px;line-height:1.65">' +
      '<li>Ingrese a su <b>banca en línea</b> (página web o app móvil) y seleccione <b>Transferencias</b>.</li>' +
      '<li>Elija o agregue como beneficiario la cuenta de <b>' + cta.titular + '</b>:<br>' +
        cta.banco + ' · ' + cta.tipo + ' N.º <b>' + cta.numero + '</b>.</li>' +
      '<li>Indique el <b>monto</b> de su cuota y, en la <b>descripción / concepto</b>, escriba su número de <b>lote ' + loteTxt + '</b>.</li>' +
      '<li>En el campo de <b>correo electrónico para enviar el comprobante</b>, agregue:<br>' +
        '<span style="display:inline-block;margin-top:4px;padding:4px 10px;background:#fff;border:1px solid ' + B.teal + ';border-radius:6px;font-weight:700;color:' + B.teal700 + '">' + comp + '</span></li>' +
      '<li>Revise los datos y <b>confirme</b> la transferencia.</li>' +
    '</ol>' +
    '<div style="margin-top:12px;padding:11px 13px;background:#fff;border-left:4px solid ' + B.coral + ';border-radius:6px;font-size:12.5px;line-height:1.55">' +
      '¿Por qué es importante agregar <b>' + comp + '</b>? Al incluir ese correo, el comprobante de su pago llega <b>automáticamente</b> a la administración y su cuota se registra sin que usted tenga que enviarlo por otro medio. ' +
      '<b style="color:' + B.coral + '">Si no lo agrega, su pago podría no reflejarse a tiempo.</b>' +
    '</div>' +
  '</div>';
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
 * permiso de envío de correo. Google mostrará la pantalla de consentimiento
 * (ahora pide acceso a Gmail porque usamos GmailApp); acéptala. Envía un
 * correo de prueba a tu correo de prueba (o al ADMIN_EMAIL si no hay uno).
 *
 * IMPORTANTE: usamos GmailApp (no MailApp) porque el correo sale por el mismo
 * camino que un correo enviado a mano desde Gmail. En cuentas de Workspace
 * nuevas, Gmail RECHAZA el correo de MailApp (Apps Script) pero SÍ acepta el
 * de GmailApp. Verificado con el Email Log Search.
 */
function autorizarCorreo() {
  var cfg = _cfg();
  var to = (cfg.modoPrueba && cfg.correoPrueba) ? cfg.correoPrueba : CONFIG.ADMIN_EMAIL;
  Logger.log('modoPrueba=%s | correoPrueba="%s" | enviosActivos=%s', cfg.modoPrueba, cfg.correoPrueba, cfg.enviosActivos);
  Logger.log('>>> Enviando correo de prueba (GmailApp) a: %s', to);
  Logger.log('Cuota diaria de correo restante: %s', MailApp.getRemainingDailyQuota());
  GmailApp.sendEmail(to, 'Prueba de autorización — ' + CONFIG.NEGOCIO,
    'El permiso de envío de correo quedó autorizado correctamente.',
    {
      name: CONFIG.NEGOCIO,
      replyTo: CONFIG.REPLY_TO,
      htmlBody: _emailShell('<p>✅ El permiso de envío de correo quedó autorizado correctamente.</p>' +
        '<p>Ya puedes usar el botón <b>“Enviar por correo”</b> desde el panel.</p>')
    });
  Logger.log('Enviado. Revisa la bandeja (y spam) de: %s', to);
  return 'Correo de prueba enviado a ' + to + '. Revisa la bandeja (y la carpeta de spam).';
}

/* ─────────────── correos ─────────────── */

/**
 * Cuerpo HTML del correo de estado de cuenta.
 *
 * El adjunto y el instructivo de pago son siempre los mismos; lo que cambia es la
 * ENTRADA, según por qué se está escribiendo. Un aviso preventivo, una confirmación de
 * pago y un aviso de mora no pueden empezar con el mismo párrafo: el propietario los
 * lee distinto y en el preventivo lo importante es la fecha límite, no el saldo.
 *
 * contexto: 'pago' | 'estado' | 'preaviso' | 'mora' | '' (genérico)
 */
function _cuerpoEstado(est, contexto) {
  var B = AC_BRAND, cfg = _cfg();
  var saldoTxt = est.saldoConMora > 0.009
    ? 'Su saldo pendiente es <b style="color:' + B.coral + '">' + _money(est.saldoConMora) + '</b>' +
      (est.mora > 0.009 ? ' (incluye ' + _money(est.mora) + ' de mora)' : '') + '.'
    : 'Su cuenta está <b style="color:' + B.ok + '">al día</b>. ¡Gracias!';

  var hoy = new Date();
  var mesNombre = AC_MESES_LARGO[hoy.getMonth()];
  var ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  var mesCerrado = AC_MESES_LARGO[(hoy.getMonth() + 11) % 12];
  var pendMes = Number(est.pendienteMes) || 0;

  var entrada;
  if (contexto === 'pago') {
    entrada =
      '<p style="padding:12px 14px;background:#EAF7EF;border-left:4px solid ' + B.ok + ';border-radius:6px">' +
        '<b style="color:' + B.ok + '">Recibimos su pago.</b> Ya quedó registrado y aplicado a su cuenta.</p>' +
      '<p>Adjuntamos su estado de cuenta actualizado (Lote ' + est.lote + ', ' + est.residencial + ') para que verifique cómo se aplicó.</p>' +
      '<p>' + saldoTxt + '</p>';
  } else if (contexto === 'preaviso') {
    entrada =
      '<p>Le escribimos para <b>ayudarle a evitar el recargo por mora</b>.</p>' +
      '<p style="padding:12px 14px;background:#FFF7F4;border-left:4px solid ' + B.coral + ';border-radius:6px">' +
        'La cuota de <b>' + mesNombre + '</b> vence el <b>' + ultimoDia + ' de ' + mesNombre + '</b>' +
        (pendMes > 0.009 ? ' y aún tiene <b>' + _money(pendMes) + '</b> por cubrir' : '') + '. ' +
        'Si no se cubre dentro del mes, a partir del día 1 se aplica un <b>recargo del ' + cfg.moraPct + '%</b> sobre la cuota.</p>' +
      '<p>Si ya realizó su pago en estos días, por favor ignore este mensaje: puede que aún no se haya reflejado.</p>';
  } else if (contexto === 'mora') {
    entrada =
      '<p>Estimado(a) <b>' + est.nombre + '</b>, su cuenta registra <b>cuotas vencidas</b> (Lote ' + est.lote + ', ' + est.residencial + ').</p>' +
      '<p>' + saldoTxt + '</p>' +
      '<p>Le agradecemos regularizar su situación. Si necesita coordinar un arreglo de pago, escríbanos: con gusto lo conversamos.</p>';
  } else if (contexto === 'estado') {
    entrada =
      '<p>Estimado(a) <b>' + est.nombre + '</b>,</p>' +
      '<p>Adjuntamos su <b>estado de cuenta de mantenimiento</b> al cierre de <b>' + mesCerrado + '</b> ' +
        '(Lote ' + est.lote + ', ' + est.residencial + ').</p>' +
      '<p>' + saldoTxt + '</p>';
  } else {
    entrada =
      '<p>Estimado(a) <b>' + est.nombre + '</b>,</p>' +
      '<p>Adjuntamos su estado de cuenta de mantenimiento actualizado (Lote ' + est.lote + ', ' + est.residencial + ').</p>' +
      '<p>' + saldoTxt + '</p>';
  }

  var mostrarCuenta = (contexto !== 'pago') && (est.saldoConMora > 0.009 || contexto === 'preaviso');
  return _emailShell(
    entrada +
    (mostrarCuenta ?
      '<p style="margin-top:14px">Puede realizar su pago a:<br>' + _ctaCobro().banco + ' · ' + _ctaCobro().tipo +
      ' Nº ' + _ctaCobro().numero + '<br>' + _ctaCobro().titular + '</p>' : '') +
    _instructivoPago(est.lote)
  );
}

// Asunto según por qué se escribe. Se mantiene el lote al final: es como los
// propietarios encuentran su correo cuando buscan.
function _asuntoEstado(est, contexto) {
  var hoy = new Date();
  var mesCerrado = AC_MESES_LARGO[(hoy.getMonth() + 11) % 12];
  if (contexto === 'pago')     return 'Confirmación de pago recibido — ' + CONFIG.NEGOCIO + ' — Lote ' + est.lote;
  if (contexto === 'preaviso') return 'Su cuota de ' + AC_MESES_LARGO[hoy.getMonth()] + ' vence este mes — ' + CONFIG.NEGOCIO + ' — Lote ' + est.lote;
  if (contexto === 'mora')     return 'Cuotas pendientes de pago — ' + CONFIG.NEGOCIO + ' — Lote ' + est.lote;
  if (contexto === 'estado')   return 'Estado de cuenta al cierre de ' + mesCerrado + ' — ' + CONFIG.NEGOCIO + ' — Lote ' + est.lote;
  return 'Estado de cuenta — ' + CONFIG.NEGOCIO + ' — Lote ' + est.lote;
}

/**
 * Envía una PRUEBA del estado de cuenta a un correo del administrador, para
 * verificar el formato antes de enviar a todos. Usa una cuenta de muestra (con
 * mora si tipo='mora', si no con saldo). Es un envío explícito a una dirección
 * dada, así que NO depende del interruptor maestro ni del modo prueba.
 */
function enviarPruebaEstado(email, tipo, clave) {
  email = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ingresa un correo válido.');
  var est = null;
  clave = String(clave || '').trim();
  if (clave) { try { est = getEstadoCuentaByKey(clave); } catch (e) {} } // propietario elegido en el dropdown
  if (!est) {
    // Sin selección válida, se busca una cuenta que ILUSTRE ese aviso: no sirve probar
    // el preaviso con alguien que ya pagó, ni el de mora con alguien al día.
    var dash = buildDashboard(null);
    var muestra = null;
    if (tipo === 'mora') dash.cuentas.forEach(function (c) { if (!muestra && (c.mesesMora || 0) > 0) muestra = c; });
    if (tipo === 'preaviso') dash.cuentas.forEach(function (c) { if (!muestra && (Number(c.pendienteMes) || 0) > 0.009) muestra = c; });
    if (!muestra) dash.cuentas.forEach(function (c) { if (!muestra && c.saldoConMora > 0.009) muestra = c; });
    if (!muestra) muestra = dash.cuentas[0];
    if (!muestra) throw new Error('No hay propietarios para generar la muestra.');
    est = getEstadoCuentaByKey(muestra.clave);
  }
  var pdf = estadoCuentaPDF(est);
  var asunto = '[PRUEBA] ' + _asuntoEstado(est, tipo);
  GmailApp.sendEmail(email, asunto,
    'Correo de prueba (verificación de formato).',
    { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: _cuerpoEstado(est, tipo), attachments: [pdf] });
  return { enviado: true, email: email, muestra: est.nombre, lote: est.lote, tipo: tipo };
}

/**
 * Aviso a la administración de que un estado de cuenta salió.
 *
 * Va como correo APARTE y no como copia oculta del que recibe el propietario: es un
 * mensaje distinto —dice qué se envió, a quién y con qué resultado—, y así el
 * propietario tampoco ve que hay terceros en su correo. Lleva el MISMO adjunto que
 * recibió él, no uno regenerado: si mañana el saldo cambia, la copia sigue siendo
 * prueba de lo que se mandó ese día.
 *
 * Nunca interrumpe el envío al propietario: si esto falla, el correo importante ya
 * salió y el fallo se reporta en el resultado.
 */
function _copiaAdminEstado(est, contexto, pdf, envio, monto) {
  var cfg = _cfg();
  var lista = _listaCorreos(cfg.copiaAdmin);
  if (!lista.length) return { enviada: false, motivo: 'Sin copia configurada' };
  var B = AC_BRAND;
  var prueba = !!envio.prueba;
  var cuando = Utilities.formatDate(new Date(), CONFIG.TZ, "d 'de' MMMM 'de' yyyy, h:mm a");
  // En modo prueba al propietario NO le llegó nada. Decir "se envió a X" sería falso
  // justamente en el correo que existe para dejar constancia de lo enviado.
  var titular = prueba
    ? '<p style="padding:12px 14px;background:#E8F6FA;border-left:4px solid ' + B.teal + ';border-radius:6px">' +
        '<b>🧪 Modo prueba — al propietario no le llegó nada.</b><br>' +
        'Este estado de cuenta se redirigió a <b>' + envio.email + '</b>. ' +
        'Con el modo prueba apagado habría salido a <b>' + (est.email || '(sin correo)') + '</b>.</p>'
    : '<p style="padding:12px 14px;background:#EAF7EF;border-left:4px solid ' + B.ok + ';border-radius:6px">' +
        (contexto === 'pago'
          ? 'Se registró un pago' + (monto > 0.009 ? ' de <b>' + _money(monto) + '</b>' : '') +
            ' y se envió al propietario su <b>estado de cuenta actualizado</b>.'
          : 'Se envió al propietario su <b>estado de cuenta</b>.') +
        '</p>';

  var filas = [
    ['Propietario', est.nombre],
    ['Lote', est.lote + ' · ' + est.residencial],
    ['Enviado a', envio.email],
    ['Fecha y hora', cuando],
    ['Motivo del envío', _motivoEnvio(contexto)],
    ['Saldo tras el envío', _money(est.saldoConMora) + (est.mora > 0.009 ? ' (incluye ' + _money(est.mora) + ' de mora)' : '')]
  ];
  var tabla = '<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:13px">' +
    filas.map(function (f) {
      return '<tr><td style="padding:7px 0;color:' + B.muted + ';border-bottom:1px solid ' + B.border + '">' + f[0] + '</td>' +
             '<td style="padding:7px 0;text-align:right;font-weight:600;border-bottom:1px solid ' + B.border + '">' + f[1] + '</td></tr>';
    }).join('') + '</table>';

  var asunto = (prueba ? '[PRUEBA] ' : '') + 'Copia · Estado de cuenta enviado a ' + est.nombre + ' — Lote ' + est.lote;
  try {
    GmailApp.sendEmail(lista.join(','), asunto,
      'Copia para la administración: se envió el estado de cuenta de ' + est.nombre + ' (Lote ' + est.lote + ').', {
        name: CONFIG.NEGOCIO,
        replyTo: CONFIG.REPLY_TO,
        htmlBody: _emailShell(titular + tabla +
          '<p style="margin-top:16px;color:' + B.muted + ';font-size:12px">' +
          'Se adjunta el mismo PDF que recibió el propietario. Este aviso es sólo para la ' +
          'administración; el propietario no sabe que se envió.</p>'),
        attachments: [pdf]
      });
    return { enviada: true, a: lista };
  } catch (e) {
    return { enviada: false, a: lista, error: String(e && e.message || e) };
  }
}

function _motivoEnvio(contexto) {
  if (contexto === 'pago')     return 'Pago registrado';
  if (contexto === 'preaviso') return 'Aviso antes de que venza la cuota';
  if (contexto === 'mora')     return 'Aviso de cuotas vencidas';
  if (contexto === 'estado')   return 'Estado de cuenta mensual';
  return 'Envío manual desde el panel';
}

/**
 * @param {string} clave     lote del propietario
 * @param {string} contexto  'pago' | 'estado' | 'preaviso' | 'mora' | ''
 * @param {Object} [opts]    { sinCopia: no avisar a la administración (los envíos
 *                             masivos mandan UN resumen en vez de una copia por
 *                             propietario), monto: el pago que originó el envío }
 */
function enviarEstadoCuenta(clave, contexto, opts) {
  opts = opts || {};
  var cfg = _cfg();
  if (!cfg.enviosActivos) return { enviado: false, motivo: 'Envíos pausados (interruptor maestro apagado).', clave: clave };
  var est = getEstadoCuentaByKey(clave);
  // Modo prueba: todo correo se redirige a la dirección de prueba (sin avisar a los propietarios).
  var prueba = !!(cfg.modoPrueba && cfg.correoPrueba);
  var destino = prueba ? cfg.correoPrueba : est.email;
  if (!destino) return { enviado: false, motivo: 'Propietario sin correo', clave: clave, lote: est.lote };
  var pdf = estadoCuentaPDF(est);
  var asunto = (prueba ? '[PRUEBA→' + est.email + '] ' : '') + _asuntoEstado(est, contexto);
  var cuerpo = _cuerpoEstado(est, contexto);
  // GmailApp (no MailApp): sale por el camino normal de Gmail, que las cuentas
  // nuevas de Workspace sí entregan (MailApp era rechazado por Gmail).
  GmailApp.sendEmail(destino, asunto, 'Adjuntamos su estado de cuenta de mantenimiento. Ver la versión con formato en su cliente de correo.', {
    name: CONFIG.NEGOCIO,
    replyTo: CONFIG.REPLY_TO,
    htmlBody: cuerpo,
    attachments: [pdf]
  });
  var res = { enviado: true, clave: clave, lote: est.lote, email: destino, prueba: prueba, destinatarioReal: est.email, saldo: est.saldoConMora };
  // La copia va DESPUÉS y aparte: el envío al propietario ya está hecho y no puede
  // deshacerse porque el aviso interno falle.
  if (!opts.sinCopia) res.copia = _copiaAdminEstado(est, contexto, pdf, res, Number(opts.monto) || 0);
  return res;
}

/**
 * Un solo resumen a la administración tras un envío masivo, en vez de una copia por
 * propietario. Sesenta estados de cuenta son sesenta correos con PDF: llenarían el
 * buzón y consumirían la cuota diaria de Gmail sin decir nada que no diga esta lista.
 */
function _copiaAdminResumen(titulo, enviados, sinCorreo) {
  var lista = _listaCorreos(_cfg().copiaAdmin);
  if (!lista.length) return { enviada: false, motivo: 'Sin copia configurada' };
  var B = AC_BRAND;
  var cuando = Utilities.formatDate(new Date(), CONFIG.TZ, "d 'de' MMMM 'de' yyyy, h:mm a");
  var prueba = enviados.length && enviados[0].prueba;
  var filas = enviados.map(function (e) {
    return '<tr><td style="padding:6px 0;border-bottom:1px solid ' + B.border + '">Lote ' + e.lote + '</td>' +
           '<td style="padding:6px 0;border-bottom:1px solid ' + B.border + ';color:' + B.muted + ';font-size:12px">' + e.email + '</td>' +
           '<td style="padding:6px 0;text-align:right;border-bottom:1px solid ' + B.border + '">' + _money(e.saldo || 0) + '</td></tr>';
  }).join('');
  try {
    GmailApp.sendEmail(lista.join(','), (prueba ? '[PRUEBA] ' : '') + 'Copia · ' + titulo + ' — ' + enviados.length + ' propietarios',
      titulo + ': ' + enviados.length + ' enviados.', {
        name: CONFIG.NEGOCIO,
        replyTo: CONFIG.REPLY_TO,
        htmlBody: _emailShell(
          '<p><b>' + titulo + '</b><br><span style="color:' + B.muted + '">' + cuando + '</span></p>' +
          (prueba ? '<p style="padding:10px 12px;background:#E8F6FA;border-left:4px solid ' + B.teal +
                    ';border-radius:6px"><b>🧪 Modo prueba — a los propietarios no les llegó nada.</b></p>' : '') +
          '<p>Se enviaron <b>' + enviados.length + '</b> estados de cuenta.</p>' +
          '<table style="width:100%;border-collapse:collapse;font-size:13px">' + filas + '</table>' +
          (sinCorreo && sinCorreo.length
            ? '<p style="margin-top:14px;color:' + B.coral + '"><b>Sin enviar (' + sinCorreo.length + '):</b> ' +
              sinCorreo.join(', ') + '</p>' : '') +
          '<p style="margin-top:16px;color:' + B.muted + ';font-size:12px">Los envíos masivos no llevan adjunto en la copia: ' +
          'cada estado de cuenta está en el panel, en la ficha del propietario.</p>')
      });
    return { enviada: true, a: lista, total: enviados.length };
  } catch (e) {
    return { enviada: false, a: lista, error: String(e && e.message || e) };
  }
}

/**
 * Envío por lotes del estado de cuenta. El `tipo` decide DOS cosas: a quién se le
 * escribe y con qué entrada se le escribe.
 *
 *   'estado'   → a TODOS los propietarios activos. Es el compromiso del contrato:
 *                el estado de cuenta del mes cerrado, también a quien está al día.
 *   'preaviso' → sólo a quien aún no cubre la cuota del MES EN CURSO. Preventivo:
 *                todavía está a tiempo de pagar sin recargo.
 *   'mora'     → sólo a quien acumula >= N cuotas vencidas (moraAvisoMeses).
 *   'mensual'  → a todo el que tenga saldo. Es el botón manual del panel.
 *
 * `lotes` (opcional) fuerza la lista de cuentas y se salta el filtro.
 */
function enviarRecordatorios(tipo, lotes) {
  if (!_cfg().enviosActivos) return { enviados: 0, pausado: true, sinCorreo: [], motivo: 'Envíos pausados (interruptor maestro apagado).' };
  tipo = tipo || 'mensual';
  var dash = buildDashboard(null);
  var minMeses = Math.max(1, Number(_cfg().moraAvisoMeses) || 2);
  var objetivo = dash.cuentas.filter(function (c) {
    if (lotes && lotes.length) return lotes.indexOf(c.clave) !== -1;
    if (tipo === 'estado') return true;
    // preaviso: la cuota de este mes existe y no está cubierta del todo
    if (tipo === 'preaviso') return (Number(c.cuotaMes) || 0) > 0.009 && (Number(c.pendienteMes) || 0) > 0.009;
    // aviso de mora: solo a quien tenga >= N meses de mora (deja de recibir al bajar a N-1)
    if (tipo === 'mora') return (c.mesesMora || 0) >= minMeses;
    return c.saldoConMora > 0.009; // recordatorio a todos con saldo
  });
  var enviados = [], sinCorreo = [];
  objetivo.forEach(function (c) {
    if (!c.email) { sinCorreo.push(c.lote); return; }
    try {
      // sinCopia: un envío masivo manda UN resumen al final, no una copia por cabeza.
      var res = enviarEstadoCuenta(c.clave, tipo, { sinCopia: true });
      enviados.push(res);
      Utilities.sleep(400); // respeta cuota de envío
    } catch (e) { sinCorreo.push(c.clave + ' (' + e + ')'); }
  });
  var res = { tipo: tipo, objetivo: objetivo.length, enviados: enviados.length, sinCorreo: sinCorreo, detalle: enviados };
  if (enviados.length) res.copia = _copiaAdminResumen(_motivoEnvio(tipo), enviados, sinCorreo);
  // Los envíos masivos automáticos dejan constancia: si un mes no salieron, se ve aquí.
  if (!lotes) {
    _reg('correo.envia', { entidad: 'correo', campo: tipo,
      detalle: 'Envío automático «' + tipo + '»: ' + enviados.length + ' de ' + objetivo.length +
        (sinCorreo.length ? ' · ' + sinCorreo.length + ' sin correo' : '') });
  }
  return res;
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
