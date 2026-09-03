/**
 * REGISTRO DE CAMBIOS (bitácora de auditoría)
 *
 * Deja constancia de toda acción que MODIFICA datos: quién la hizo, cuándo, sobre
 * qué cuenta, y el valor antes y después. Las lecturas no se registran.
 *
 * El autor lo declara el panel en cada llamada (`autor` en el cuerpo del POST) y se
 * guarda en AC_AUTOR al entrar a doPost. OJO: es una identidad DECLARADA, no
 * autenticada — el sistema tiene una sola contraseña compartida, así que el registro
 * dice "quién dijo ser", no "quién demostró ser". Cuando exista multiusuario real,
 * basta con que _autor() lea la sesión en vez de lo que manda el panel.
 *
 * La bitácora nunca se edita ni se borra desde el panel: sólo se agregan renglones.
 */

var COL_REG = ['id', 'fecha', 'autor', 'accion', 'entidad', 'clave', 'propietario',
               'campo', 'antes', 'despues', 'monto', 'detalle', 'origen'];

// Autor de la acción en curso. Lo fija doPost con lo que manda el panel.
// Vacío significa que NO vino de una persona por el panel: es un trabajo automático
// (envío programado, captura de comprobantes, migración ejecutada desde el editor).
var AC_AUTOR = '';
function _autor() { return String(AC_AUTOR || '').trim() || 'Sistema (automático)'; }

/**
 * Acciones que NO exigen un autor humano: no tocan datos de la comunidad o son
 * parte del arranque del sistema. Todo lo demás sí lo exige.
 */
var REG_SIN_AUTOR = {
  ensureSheets: 1, seedInicial: 1, seedGastos2026: 1, seedRecurrentes: 1,
  actualizarJulio2026: 1, rollbackJulio2026: 1,
  descargarInformePL: 1, enviarInformePL: 1,
  capturarComprobantes: 1,
  // las consume el bot de WhatsApp, que no es una persona en el panel
  marcarEnvio: 1, previsualizarComunicado: 1
};

/**
 * Corta la operación si nadie se identificó.
 *
 * Va en el SERVIDOR a propósito: el panel ya pide el nombre, pero el panel se puede
 * saltar (un POST directo con el token bastaba para escribir de forma anónima). Sin
 * esto, la bitácora tendría huecos justo en los cambios que a alguien le conviniera
 * no firmar.
 */
function requireAutor(accion) {
  if (REG_SIN_AUTOR[accion]) return true;
  if (String(AC_AUTOR || '').trim()) return true;
  throw new Error('sin-autor');
}

// Etiquetas legibles de cada acción, para no depender del código en pantalla.
var REG_ACCIONES = {
  'pago.alta':        'Pago registrado',
  'pago.edita':       'Pago modificado',
  'pago.baja':        'Pago eliminado',
  'pago.constancia':  'Constancia de pago emitida',
  'prop.condona':     'Mora condonada',
  'prop.reactiva':    'Mora reactivada',
  'prop.edita':       'Propietario modificado',
  'prop.alta':        'Propietario agregado',
  'gasto.alta':       'Gasto registrado',
  'gasto.edita':      'Gasto modificado',
  'gasto.baja':       'Gasto eliminado',
  'ingreso.alta':     'Otro ingreso registrado',
  'ingreso.baja':     'Otro ingreso eliminado',
  'comprob.aplica':   'Comprobante aplicado',
  'comprob.rechaza':  'Comprobante rechazado',
  'config.edita':     'Opciones modificadas',
  'correo.envia':     'Estado de cuenta enviado',
  'usuario.alta':     'Usuario identificado',
  'usuario.mueve':    'Usuario movido de dispositivo',
  'usuario.libera':   'Nombre de usuario liberado',
  'usuario.alerta':   'Alerta de identidad enviada',
  'comunicado.crea':    'Comunicado creado',
  'comunicado.edita':   'Comunicado modificado',
  'comunicado.baja':    'Comunicado eliminado',
  'comunicado.envia':   'Comunicado enviado',
  'comunicado.reenvia': 'Comunicado reenviado',
  'comunicado.recuerda':'Recordatorio de comunicado enviado',
  'balance.alta':       'Partida del balance registrada',
  'balance.edita':      'Partida del balance modificada',
  'balance.baja':       'Partida del balance eliminada'
};

function _regSheet() {
  var ss = _ss();
  var sh = ss.getSheetByName(SH.REGISTRO);
  if (!sh) {
    sh = ss.insertSheet(SH.REGISTRO);
    sh.getRange(1, 1, 1, COL_REG.length).setValues([COL_REG]);
    sh.getRange(1, 1, 1, COL_REG.length).setFontWeight('bold')
      .setBackground('#0E8FB0').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Anota un cambio en la bitácora.
 *
 * Nunca debe tumbar la operación que la llama: si el registro falla (hoja bloqueada,
 * cuota de escritura), se traga el error. Perder un renglón de bitácora es malo;
 * perder el pago que el usuario acaba de guardar, peor.
 *
 * @param {string} accion   clave de REG_ACCIONES
 * @param {Object} d        { clave, propietario, campo, antes, despues, monto, detalle, origen }
 */
function _reg(accion, d) {
  try {
    d = d || {};
    var sh = _regSheet();
    var id = 'R' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
    sh.appendRow([
      id,
      new Date(),
      _autor(),
      String(accion || ''),
      String(d.entidad || (String(accion).split('.')[0] || '')),
      String(d.clave || ''),
      String(d.propietario || ''),
      String(d.campo || ''),
      (d.antes === undefined || d.antes === null) ? '' : String(d.antes),
      (d.despues === undefined || d.despues === null) ? '' : String(d.despues),
      (d.monto === undefined || d.monto === null || d.monto === '') ? '' : _round2(d.monto),
      String(d.detalle || ''),
      String(d.origen || '')
    ]);
    return id;
  } catch (e) {
    // se anota en el log de ejecución y se sigue: la bitácora no bloquea la operación
    try { console.warn('registro: no se pudo anotar ' + accion + ' — ' + e); } catch (_) {}
    return '';
  }
}

// Varias anotaciones de una sola escritura (una corrección que tocó fecha y monto,
// por ejemplo). Mucho más barato que llamar _reg() en bucle.
function _regBatch(filas) {
  if (!filas || !filas.length) return 0;
  try {
    var sh = _regSheet();
    var ahora = new Date(), autor = _autor(), base = new Date().getTime();
    var rows = filas.map(function (d, i) {
      return ['R' + (base + i) + '-' + Math.floor(Math.random() * 1000), ahora, autor,
        String(d.accion || ''), String(d.entidad || (String(d.accion).split('.')[0] || '')),
        String(d.clave || ''), String(d.propietario || ''), String(d.campo || ''),
        (d.antes === undefined || d.antes === null) ? '' : String(d.antes),
        (d.despues === undefined || d.despues === null) ? '' : String(d.despues),
        (d.monto === undefined || d.monto === null || d.monto === '') ? '' : _round2(d.monto),
        String(d.detalle || ''), String(d.origen || '')];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, COL_REG.length).setValues(rows);
    return rows.length;
  } catch (e) {
    try { console.warn('registro: lote no anotado — ' + e); } catch (_) {}
    return 0;
  }
}

/**
 * Lee la bitácora para el panel. Devuelve lo más reciente primero.
 * @param {Object} f  { desde:'AAAA-MM-DD', hasta:'AAAA-MM-DD', autor, accion, q, limite }
 */
function getRegistro(f) {
  f = f || {};
  var sh = _ss().getSheetByName(SH.REGISTRO);
  if (!sh || sh.getLastRow() < 2) return { filas: [], total: 0, autores: [], acciones: REG_ACCIONES };
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iof = {}; h.forEach(function (c, i) { iof[c] = i; });
  var limite = Math.min(Math.max(Number(f.limite) || 400, 1), 3000);
  var q = String(f.q || '').trim().toLowerCase();
  var desde = String(f.desde || '').trim(), hasta = String(f.hasta || '').trim();
  var autores = {}, out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var fecha = row[iof.fecha] instanceof Date ? row[iof.fecha] : new Date(row[iof.fecha]);
    var ymd = isNaN(fecha.getTime()) ? '' : Utilities.formatDate(fecha, CONFIG.TZ, 'yyyy-MM-dd');
    var autor = String(row[iof.autor] || '');
    if (autor) autores[autor] = 1;
    if (desde && ymd && ymd < desde) continue;
    if (hasta && ymd && ymd > hasta) continue;
    if (f.autor && autor !== f.autor) continue;
    if (f.accion && String(row[iof.accion]) !== f.accion) continue;
    if (q) {
      var blob = [row[iof.clave], row[iof.propietario], row[iof.campo], row[iof.antes],
                  row[iof.despues], row[iof.detalle]].join(' ').toLowerCase();
      if (blob.indexOf(q) < 0) continue;
    }
    out.push({
      id: String(row[iof.id] || ''), fecha: fecha, ymd: ymd,
      hora: isNaN(fecha.getTime()) ? '' : Utilities.formatDate(fecha, CONFIG.TZ, 'HH:mm'),
      autor: autor, accion: String(row[iof.accion] || ''),
      accionLbl: REG_ACCIONES[String(row[iof.accion] || '')] || String(row[iof.accion] || ''),
      entidad: String(row[iof.entidad] || ''), clave: String(row[iof.clave] || ''),
      propietario: String(row[iof.propietario] || ''), campo: String(row[iof.campo] || ''),
      antes: String(row[iof.antes] || ''), despues: String(row[iof.despues] || ''),
      monto: row[iof.monto] === '' ? null : (Number(row[iof.monto]) || 0),
      detalle: String(row[iof.detalle] || ''), origen: String(row[iof.origen] || '')
    });
  }
  var total = out.length;
  out.sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  return { filas: out.slice(0, limite), total: total,
           autores: Object.keys(autores).sort(), acciones: REG_ACCIONES };
}

/* ─────────────── punto de partida: los cambios del 18/08/2026 ───────────────
 * La bitácora empieza a llenarse sola desde ahora, pero los cambios de ayer se
 * hicieron antes de que existiera. Se cargan una vez, con su autora real, para que
 * el registro arranque completo y no con un hueco.
 *
 * Salen de comparar la copia del sheet del 15/08 12:05 con la versión posterior:
 * 5 pagos nuevos, 6 pagos modificados y 10 cambios en Propietarios.
 * Idempotente: si ya se cargaron, exige force.
 */
var REG_SEED_PROP = 'AC_REG_SEED_18AGO';

function seedRegistro18Ago(force) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(REG_SEED_PROP) && !force) {
    return { ok: false, yaCargado: true, msg: 'El punto de partida ya se cargó el ' + props.getProperty(REG_SEED_PROP) };
  }
  var AUTORA = 'Doraida Castillo';
  var T = function (h, m) { return new Date(2026, 7, 18, h, m, 0); };  // 18/08/2026 (hora nominal)

  // [accion, clave, propietario, campo, antes, despues, monto, detalle, origen]
  var F = [
    // ── 5 pagos nuevos ──
    ['pago.alta','L-7','Karlina Barrera / Josimar Guilbaud','','','',54.00,'Pago del 01/08/2026 · ref. Transferencia Bancaria','manual'],
    ['pago.alta','Q-16B','Armando Moreno','','','',147.00,'Pago del 05/08/2026 · ref. Deposito Bancario','manual'],
    ['pago.alta','L-14','Judith Araúz','','','',94.50,'Pago del 10/08/2026 · ref. Transferencia Bancaria','manual'],
    ['pago.alta','H-18A','Sali Perez','','','',270.00,'Pago del 10/08/2026 · ref. Transferencia Bancaria','manual'],
    ['pago.alta','Q-25','Cristian Howell','','','',148.50,'Pago del 14/08/2026 · ref. Transferencia Bancaria','manual'],
    // ── 6 pagos modificados ──
    ['pago.edita','L-6-CASTILLO','Alicia / Ibrahim Castillo','fecha','15/05/2026','01/06/2026','','Pago histórico de mayo (SEED-L-6-CASTILLO-May)','carga-inicial'],
    ['pago.edita','Q-19','Edda Rodriguez','monto','45.00','43.00',43.00,'Pago histórico de junio (SEED-Q-19-Jun)','carga-inicial'],
    ['pago.edita','H-35','Alfonso Castillo','monto','90.00','110.00',110.00,'Pago histórico de abril (SEED-H-35-Abr)','carga-inicial'],
    ['pago.edita','H-43A','Leonardo Herrera','fecha','15/03/2026','01/04/2026','','Pago histórico de marzo (SEED-H-43A-Mar)','carga-inicial'],
    ['pago.edita','H-46','Carlos Bennett / Ana S.','fecha y monto','15/05/2026 · 58.50','01/06/2026 · 45.00',45.00,'Pago histórico de mayo (SEED-H-46-May)','carga-inicial'],
    ['pago.edita','H-46','Carlos Bennett / Ana S.','fecha y monto','31/07/2026 · 103.50','02/07/2026 · 103.00',103.00,'Pago de la actualización de julio (UJ26-P-H-46)','upd-jul2026'],
    // ── 10 cambios en Propietarios ──
    ['prop.condona','Q-19','Edda Rodriguez','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','Q-6A','Kristina Lam','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','Q-6B','Esmeralda Tuy De Lam','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','Q-7','Annette Ayala','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','Q-11A','Ada Garúz','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','Q-19B','Jerlis Anchico','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','Q-20','Roberto De Leon L','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','H-42A','Odilinda Panezo','moraCondon','','2026-04','','Se perdona el recargo de abril 2026',''],
    ['prop.condona','H-18A','Sali Perez','moraCondon','','2026-07','','Se perdona el recargo de julio 2026',''],
    ['prop.edita','H-43A','Leonardo Herrera','inicioCobro','','2026-04','','La cuenta deja de facturar cuotas anteriores a abril 2026','']
  ];

  var sh = _regSheet();
  // La hora es NOMINAL: del 18/08 sólo se conoce la fecha, no la hora de cada cambio.
  // Se reparten de forma descendente para que, al ordenar el registro por más reciente,
  // la lista quede en el mismo orden del informe: pagos nuevos, luego pagos corregidos,
  // luego los cambios en propietarios.
  var rows = F.map(function (f, i) {
    return ['R18AGO-' + (i + 1), T(9, Math.min(59, (F.length - 1 - i) * 2)), AUTORA, f[0],
            String(f[0]).split('.')[0], f[1], f[2], f[3], f[4], f[5],
            (f[6] === '' ? '' : _round2(f[6])), f[7], f[8]];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, COL_REG.length).setValues(rows);
  props.setProperty(REG_SEED_PROP, Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm'));
  return { ok: true, filas: rows.length, autor: AUTORA,
           msg: 'Cargado el punto de partida: ' + rows.length + ' cambios del 18/08/2026 a nombre de ' + AUTORA + '.' };
}

// Deshace la carga del punto de partida (borra sólo los renglones R18AGO-*).
function rollbackSeedRegistro18Ago() {
  var sh = _ss().getSheetByName(SH.REGISTRO);
  if (!sh) return { ok: false, msg: 'No existe la hoja de registro.' };
  var vals = sh.getDataRange().getValues(), n = 0;
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][0]).indexOf('R18AGO-') === 0) { sh.deleteRow(r + 1); n++; }
  }
  PropertiesService.getScriptProperties().deleteProperty(REG_SEED_PROP);
  return { ok: true, eliminados: n };
}
