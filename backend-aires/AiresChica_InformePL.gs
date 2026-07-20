/**
 * Informe Financiero (P&L) — PDF descargable y envío por correo a propietarios.
 *
 * Contenido: resumen ejecutivo (ingresos/egresos/resultado), fondo disponible,
 * resultado mes a mes, presupuesto vs ejecución, gastos por categoría (del
 * presupuesto) y estado de cobros/morosidad. Con logo y colores de la marca.
 *
 * descargarInformePL -> { base64, filename }  (para descargar en el navegador)
 * enviarInformePL    -> envía el PDF a los propietarios (respeta interruptor
 *                       maestro y modo prueba)
 */

var INF_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                 'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
var INF_MES3  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function _informePLData(anio, mesIni, mesFin) {
  anio = Number(anio) || (new Date()).getFullYear();
  mesIni = Math.max(1, Math.min(12, Number(mesIni) || 1));
  mesFin = Math.max(mesIni, Math.min(12, Number(mesFin) || 12));
  var g = getGastosData(anio);

  // rango: ingresos / egresos / resultado + mes a mes
  var ingreso = 0, egreso = 0, porMes = [];
  for (var m = mesIni; m <= mesFin; m++) {
    var im = g.ingresosPorMes[m - 1] || 0, em = g.porMes[m - 1] || 0;
    ingreso = _round2(ingreso + im); egreso = _round2(egreso + em);
    porMes.push({ mes: m, ingresos: _round2(im), egresos: _round2(em), resultado: _round2(im - em) });
  }
  var resultado = _round2(ingreso - egreso);

  // gastos por categoría (del presupuesto) en el rango
  var byCat = {};
  g.gastos.forEach(function (x) {
    var mm = (x.fecha instanceof Date ? x.fecha : new Date(x.fecha)).getMonth() + 1;
    if (mm >= mesIni && mm <= mesFin) {
      var c = String(x.categoria || '').trim() || '(sin categoría)';
      byCat[c] = _round2((byCat[c] || 0) + (Number(x.monto) || 0));
    }
  });
  var catList = Object.keys(byCat).map(function (c) { return { categoria: c, monto: byCat[c] }; })
    .filter(function (t) { return t.monto > 0; }).sort(function (a, b) { return b.monto - a.monto; });

  // presupuesto (anual) vs ejecución (en el rango)
  var presupVs = g.categorias.map(function (c) {
    var pres = _round2(g.presupuesto[c] || 0), eje = _round2(byCat[c] || 0);
    return { categoria: c, presupuestado: pres, ejecutado: eje, disponible: _round2(pres - eje),
             pct: pres > 0 ? _round2(eje / pres * 100) : (eje > 0 ? 100 : 0) };
  }).filter(function (t) { return t.presupuestado > 0 || t.ejecutado > 0; });
  var presupTotal = _round2(presupVs.reduce(function (s, t) { return s + t.presupuestado; }, 0));

  // fondo disponible = fondo inicial del año + resultado acumulado hasta mesFin
  var cfg = _cfg();
  var resYTD = 0;
  for (var mm2 = 1; mm2 <= mesFin; mm2++) resYTD = _round2(resYTD + (g.ingresosPorMes[mm2 - 1] || 0) - (g.porMes[mm2 - 1] || 0));
  var fondoInicial = _round2(cfg.fondoInicial || 0);

  var dash = buildDashboard(null);

  return {
    anio: anio, mesIni: mesIni, mesFin: mesFin,
    ingreso: ingreso, egreso: egreso, resultado: resultado, porMes: porMes,
    catList: catList, presupVs: presupVs, presupTotal: presupTotal,
    fondoInicial: fondoInicial, resYTD: _round2(resYTD), fondoDisponible: _round2(fondoInicial + resYTD),
    kpis: dash.kpis,
    cuenta: { banco: cfg.banco, tipo: cfg.cuentaTipo, num: cfg.cuentaNum, nombre: cfg.cuentaNombre }
  };
}

function _informePLHtml(D, nota) {
  var B = AC_BRAND;
  var GREEN = '#1E8E5A';
  var periodo = (D.mesIni === 1 && D.mesFin === 12) ? ('Año ' + D.anio)
              : (INF_MESES[D.mesIni - 1] + ' – ' + INF_MESES[D.mesFin - 1] + ' ' + D.anio);
  var pos = D.resultado >= -0.009;
  var resCol = pos ? GREEN : B.coral;
  var fecha = Utilities.formatDate(new Date(), CONFIG.TZ, "dd/MM/yyyy");
  var k = D.kpis;

  function stat(label, val, color, sub) {
    return '<td style="width:33%;padding:0 6px" valign="top">' +
      '<div style="border:1px solid ' + B.border + ';border-top:3px solid ' + (color || B.teal) + ';border-radius:8px;padding:12px 14px">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:' + B.muted + ';font-weight:700">' + label + '</div>' +
        '<div style="font-size:20px;font-weight:800;color:' + (color || B.ink) + ';margin-top:3px">' + val + '</div>' +
        (sub ? '<div style="font-size:10.5px;color:' + B.muted + ';margin-top:2px">' + sub + '</div>' : '') +
      '</div></td>';
  }
  function secTitle(t) {
    return '<div style="font-size:14px;font-weight:800;color:' + B.teal700 + ';margin:22px 0 8px;padding-bottom:5px;border-bottom:2px solid ' + B.teal50 + '">' + t + '</div>';
  }
  function th(t, align) { return '<th style="background:' + B.teal + ';color:#fff;padding:7px 9px;text-align:' + (align || 'left') + ';font-size:11px">' + t + '</th>'; }
  function td(t, align, extra) { return '<td style="padding:6px 9px;border-bottom:1px solid ' + B.border + ';text-align:' + (align || 'left') + ';font-size:11.5px;' + (extra || '') + '">' + t + '</td>'; }
  // barra de ejecución a prueba del motor de PDF de Apps Script: ese motor
  // descarta los colores de fondo, pero SÍ respeta el color de texto (los montos
  // en verde/rojo lo confirman). Por eso la barra se dibuja con bloques de texto
  // llenos (█): la parte ejecutada en color y el resto en gris claro.
  function bar(pct, over) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    var col = B.teal;         // un solo color de barra, el del logo de Aires de Chicá
    var trackCol = '#F2F6F8'; // pista muy clara para que el avance se note
    var SEG = 14;
    var fill = over ? SEG : Math.max(0, Math.min(SEG, Math.round(SEG * p / 100)));
    var full = '', track = '', i;
    for (i = 0; i < fill; i++) full += '█';
    for (i = 0; i < SEG - fill; i++) track += '█';
    return '<span style="font-family:Arial,sans-serif;font-size:12px;letter-spacing:-0.5px;white-space:nowrap">' +
      (full ? '<span style="color:' + col + '">' + full + '</span>' : '') +
      (track ? '<span style="color:' + trackCol + '">' + track + '</span>' : '') + '</span>';
  }
  // celda "% ejec." = barra + texto del porcentaje, en un layout de tabla
  function barCell(pct, over) {
    var pc = over ? B.coral : B.muted, wght = over ? 'font-weight:700;' : '';
    return '<table cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td valign="middle">' + bar(pct, over) + '</td>' +
      '<td valign="middle" style="padding-left:7px;font-size:10.5px;color:' + pc + ';' + wght + 'white-space:nowrap">' + pct + '%</td>' +
      '</tr></table>';
  }

  // Resumen
  var resumen = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate"><tr>' +
    stat('Ingresos (cobros)', _money(D.ingreso), B.teal) +
    stat('Egresos (gastos)', _money(D.egreso), B.coral) +
    stat(pos ? 'Superávit del período' : 'Déficit del período', _money(D.resultado), resCol, 'Ingresos − Egresos') +
    '</tr></table>';

  // Fondo disponible a la fecha (KPI destacado arriba, si hay fondo inicial)
  var fondoTop = '';
  if (D.fondoInicial > 0.009) {
    fondoTop = '<table width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 4px"><tr>' +
      '<td style="border:1px solid ' + B.border + ';border-left:5px solid ' + B.teal + ';border-radius:8px;background:' + B.teal50 + ';padding:12px 16px">' +
        '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
          '<td valign="middle"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:' + B.muted + ';font-weight:700">Fondo disponible a la fecha</div>' +
          '<div style="font-size:10.5px;color:' + B.muted + ';margin-top:2px">Fondo inicial del año (' + _money(D.fondoInicial) + ') + Resultado acumulado (' + _money(D.resYTD) + ')</div></td>' +
          '<td valign="middle" align="right"><span style="font-size:23px;font-weight:800;color:' + B.teal700 + '">' + _money(D.fondoDisponible) + '</span></td>' +
        '</tr></table>' +
      '</td></tr></table>';
  }

  // Mes a mes
  var acc = 0;
  var mesRows = D.porMes.map(function (r) {
    acc = _round2(acc + r.resultado);
    var rc = r.resultado >= 0 ? GREEN : B.coral, ac = acc >= 0 ? GREEN : B.coral;
    return '<tr>' + td(INF_MESES[r.mes - 1]) + td(_money(r.ingresos), 'right') + td(_money(r.egresos), 'right') +
      td(_money(r.resultado), 'right', 'color:' + rc + ';font-weight:700') + td(_money(acc), 'right', 'color:' + ac) + '</tr>';
  }).join('');
  var mesTabla = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>' +
    th('Mes') + th('Ingresos', 'right') + th('Egresos', 'right') + th('Resultado', 'right') + th('Acumulado', 'right') + '</tr>' +
    mesRows +
    '<tr>' + td('<b>TOTAL</b>', 'left', 'border-top:2px solid ' + B.teal) + td('<b>' + _money(D.ingreso) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td('<b>' + _money(D.egreso) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td('<b style="color:' + resCol + '">' + _money(D.resultado) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td('<b style="color:' + resCol + '">' + _money(D.resultado) + '</b>', 'right', 'border-top:2px solid ' + B.teal) + '</tr></table>';

  // Presupuesto vs ejecución
  var presRows = D.presupVs.map(function (t) {
    var over = t.ejecutado > t.presupuestado + 0.009 && t.presupuestado > 0;
    return '<tr>' + td(t.categoria) + td(_money(t.presupuestado), 'right') + td('<b>' + _money(t.ejecutado) + '</b>', 'right') +
      td(_money(t.disponible), 'right', t.disponible < -0.009 ? 'color:' + B.coral : '') +
      td(barCell(t.pct, over), 'left') + '</tr>';
  }).join('');
  var presTabla = D.presupVs.length ? ('<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>' +
    th('Categoría') + th('Presupuesto', 'right') + th('Ejecutado', 'right') + th('Disponible', 'right') + th('% ejec.') + '</tr>' +
    presRows +
    '<tr>' + td('<b>TOTAL</b>', 'left', 'border-top:2px solid ' + B.teal) + td('<b>' + _money(D.presupTotal) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td('<b>' + _money(D.egreso) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td('<b>' + _money(_round2(D.presupTotal - D.egreso)) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td(D.presupTotal > 0 ? Math.round(D.egreso / D.presupTotal * 100) + '%' : '—', 'left', 'border-top:2px solid ' + B.teal) + '</tr></table>') :
    '<div style="color:' + B.muted + ';font-size:12px">Sin presupuesto cargado para este año.</div>';

  // Gastos por categoría
  var catRows = D.catList.map(function (t) {
    return '<tr>' + td(t.categoria) + td(_money(t.monto), 'right', 'font-weight:700') +
      td((D.egreso > 0 ? Math.round(t.monto / D.egreso * 1000) / 10 : 0) + '%', 'right') + '</tr>';
  }).join('');
  var catTabla = D.catList.length ? ('<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>' +
    th('Categoría') + th('Monto', 'right') + th('% del gasto', 'right') + '</tr>' + catRows +
    '<tr>' + td('<b>TOTAL EGRESOS</b>', 'left', 'border-top:2px solid ' + B.teal) + td('<b>' + _money(D.egreso) + '</b>', 'right', 'border-top:2px solid ' + B.teal) +
      td('<b>100%</b>', 'right', 'border-top:2px solid ' + B.teal) + '</tr></table>') :
    '<div style="color:' + B.muted + ';font-size:12px">Sin gastos en el período.</div>';

  // Estado de cobros
  var cobros = '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate"><tr>' +
    stat('Cuentas al día', k.alDia, B.teal) +
    stat('Morosos', k.morosos, B.coral, 'Con cuota(s) vencida(s)') +
    stat('% Recaudación (año)', k.tasaRecaudacionAnual + '%', GREEN) +
    '</tr><tr><td colspan="3" style="height:8px"></td></tr><tr>' +
    stat('Por cobrar (cuotas)', _money(k.carteraVencida), B.ink) +
    stat('Mora acumulada', _money(k.moraAcumulada), B.coral) +
    stat('Total por cobrar', _money(k.saldoTotalConMora), B.coral) +
    '</tr></table>' +
    '<div style="font-size:10.5px;color:' + B.muted + ';margin-top:6px">Estado de cobros a la fecha de emisión del informe.</div>';

  // Nota
  var notaHtml = (nota && String(nota).trim()) ?
    ('<div style="margin-top:20px;border-left:4px solid ' + B.teal + ';background:#fbfeff;padding:11px 14px;font-size:12px">' +
      '<b style="color:' + B.teal700 + '">Nota de la administración</b><br>' + String(nota).replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>') : '';

  return '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;background:#fff">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;color:' + B.ink + ';max-width:720px;margin:0 auto;padding:24px 26px">' +
      '<table width="100%"><tr>' +
        '<td valign="middle"><img src="' + CONFIG.LOGO_PNG_URL + '" style="height:56px" alt="' + CONFIG.NEGOCIO + '"/></td>' +
        '<td valign="middle" align="right">' +
          '<div style="font-size:22px;font-weight:800;color:' + B.teal + '">Informe Financiero</div>' +
          '<div style="font-size:13px;color:' + B.muted + '">' + CONFIG.NEGOCIO + ' · ' + periodo + '</div>' +
          '<div style="font-size:10.5px;color:' + B.muted + '">Emitido el ' + fecha + '</div>' +
        '</td></tr></table>' +
      '<div style="height:4px;background:linear-gradient(90deg,' + B.teal + ',' + B.green + ' 60%,' + B.coral + ');margin:14px 0 8px;border-radius:2px"></div>' +
      fondoTop +
      secTitle('Resumen ejecutivo') + resumen +
      secTitle('Resultado mes a mes') + mesTabla +
      secTitle('Presupuesto vs ejecución') + presTabla +
      secTitle('Gastos por categoría') + catTabla +
      secTitle('Estado de cobros') + cobros +
      notaHtml +
      '<div style="margin-top:22px;padding-top:12px;border-top:1px solid ' + B.border + ';color:' + B.muted + ';font-size:11px">' +
        '<b>Cuenta para aportes:</b> ' + D.cuenta.banco + ' · ' + D.cuenta.tipo + ' Nº ' + D.cuenta.num + ' · ' + D.cuenta.nombre + '</div>' +
      '<div style="text-align:center;color:' + B.muted + ';font-size:11px;margin-top:14px">' + CONFIG.NEGOCIO + ' · "Todo comienza con un sueño"</div>' +
    '</div></body></html>';
}

function _informePLPdf(anio, mesIni, mesFin, nota) {
  var D = _informePLData(anio, mesIni, mesFin);
  var html = _informePLHtml(D, nota);
  var per = (D.mesIni === 1 && D.mesFin === 12) ? ('' + D.anio) : (INF_MES3[D.mesIni - 1] + '-' + INF_MES3[D.mesFin - 1] + '-' + D.anio);
  var blob = HtmlService.createHtmlOutput(html).getAs('application/pdf')
    .setName('InformeFinanciero_' + per + '.pdf');
  return blob;
}

function descargarInformePL(anio, mesIni, mesFin, nota) {
  var blob = _informePLPdf(anio, mesIni, mesFin, nota);
  return { base64: Utilities.base64Encode(blob.getBytes()), filename: blob.getName() };
}

// Envío trimestral automático: corre por trigger mensual pero solo actúa en
// los meses de cierre de trimestre (ene, abr, jul, oct) y envía el informe del
// trimestre recién cerrado. Respeta el interruptor maestro y el modo prueba.
function informeTrimestral() {
  var cfg = _cfg();
  if (!cfg.notifInformeTrim || !cfg.enviosActivos) return { enviados: 0, motivo: 'trimestral desactivado o envíos pausados' };
  var now = new Date();
  var m = now.getMonth() + 1, anio = now.getFullYear();
  var mesIni, mesFin;
  if (m === 1) { anio -= 1; mesIni = 10; mesFin = 12; }   // Q4 del año anterior
  else if (m === 4) { mesIni = 1; mesFin = 3; }           // Q1
  else if (m === 7) { mesIni = 4; mesFin = 6; }           // Q2
  else if (m === 10) { mesIni = 7; mesFin = 9; }          // Q3
  else return { enviados: 0, motivo: 'no es mes de cierre de trimestre' };
  return enviarInformePL(anio, mesIni, mesFin, '');
}

function enviarInformePL(anio, mesIni, mesFin, nota) {
  var cfg = _cfg();
  if (!cfg.enviosActivos) return { enviados: 0, pausado: true, motivo: 'Envíos pausados (interruptor maestro apagado).' };
  var blob = _informePLPdf(anio, mesIni, mesFin, nota);
  var D = _informePLData(anio, mesIni, mesFin);
  var periodo = (D.mesIni === 1 && D.mesFin === 12) ? ('Año ' + D.anio) : (INF_MESES[D.mesIni - 1] + '–' + INF_MESES[D.mesFin - 1] + ' ' + D.anio);
  var asunto = 'Informe Financiero ' + periodo + ' — ' + CONFIG.NEGOCIO;
  var cuerpo = _emailShell(
    '<p>Estimado propietario,</p>' +
    '<p>Adjuntamos el <b>Informe Financiero</b> de ' + CONFIG.NEGOCIO + ' correspondiente a <b>' + periodo + '</b>, con el resumen de ingresos y gastos, la ejecución del presupuesto y el estado de cobros.</p>' +
    ((nota && String(nota).trim()) ? '<p style="border-left:3px solid ' + AC_BRAND.teal + ';padding-left:10px;color:' + AC_BRAND.ink + '">' + String(nota).replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>' : '') +
    '<p style="color:' + AC_BRAND.muted + ';font-size:12px">Cualquier consulta, con gusto la atendemos.</p>');

  var prueba = !!(cfg.modoPrueba && cfg.correoPrueba);
  if (prueba) {
    GmailApp.sendEmail(cfg.correoPrueba, '[PRUEBA] ' + asunto, 'Informe financiero adjunto.',
      { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: cuerpo, attachments: [blob] });
    return { prueba: true, enviados: 1, destino: cfg.correoPrueba };
  }

  var props = getPropietarios(); // activos
  var enviados = 0, sinCorreo = [];
  props.forEach(function (p) {
    if (!p.email) { sinCorreo.push(p.lote); return; }
    try {
      GmailApp.sendEmail(p.email, asunto, 'Informe financiero adjunto. Ver la versión con formato en su cliente de correo.',
        { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: cuerpo, attachments: [blob] });
      enviados++;
      Utilities.sleep(300);
    } catch (e) { sinCorreo.push(p.clave + ' (' + e + ')'); }
  });
  return { enviados: enviados, sinCorreo: sinCorreo };
}
