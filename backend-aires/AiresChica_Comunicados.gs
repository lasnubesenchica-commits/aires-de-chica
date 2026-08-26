/**
 * COMUNICADOS A LA COMUNIDAD
 *
 * La administración escribe una vez y el mensaje sale por todos los canales que
 * estén habilitados. Hoy el canal real es el correo; el bot de WhatsApp que viene
 * después no necesita que se reescriba nada: lee de la MISMA cola de envíos
 * (hoja `Envios`) y marca lo que ya entregó.
 *
 * Piezas:
 *   COM_TIPOS            catálogo de tipos de comunicado, con su plantilla
 *   Comunicados (hoja)   un renglón por comunicado (borrador, programado, enviado)
 *   Envios (hoja)        un renglón por DESTINATARIO y CANAL — la cola y el acuse
 *
 * La hoja `Envios` es a propósito genérica (`tipo` + `refId`): hoy sólo la llenan
 * los comunicados, pero los estados de cuenta y el informe financiero pueden
 * escribir en ella cuando se sumen al bot, y el historial queda en un solo sitio.
 *
 * Enlaces personales: cada propietario tiene un token estable derivado de su clave
 * (`_acTokenDe`). Con él, y sin contraseña, puede ver un comunicado en el navegador,
 * ver el archivo de todos los que ha recibido, y confirmar de recibido. El mismo
 * token le servirá al bot para responder consultas del propietario.
 *
 * Nada de esto envía un solo correo si el interruptor maestro (`enviosActivos`)
 * está apagado. Ver AiresChica_Config.gs.
 */

var SH_COM    = 'Comunicados';
var SH_ENVIOS = 'Envios';

var COL_COM = ['id', 'creado', 'autor', 'tipo', 'prioridad', 'titulo', 'cuerpo', 'accion',
               'eventoFecha', 'eventoHora', 'lugar', 'limite', 'adjuntos', 'segmento', 'alcance',
               'canales', 'acuse', 'recordatorio', 'recordatorioEn',
               'estado', 'programadoPara', 'enviadoEn', 'enviadoPor',
               'destinatarios', 'enviados', 'sinDestino', 'errores', 'notas'];

var COL_ENVIOS = ['id', 'ts', 'tipo', 'refId', 'clave', 'nombre', 'canal', 'destino',
                  'estado', 'error', 'acuse', 'autor'];

/* ─────────────────────── catálogo de tipos ───────────────────────
 * Sale de revisar qué comunica de verdad la administración de una comunidad o un
 * PH: mantenimiento, incidencias, seguridad, obras, gobierno, plata, normas,
 * convivencia y consultas. Cada tipo trae una plantilla para no empezar de cero
 * y para que dos personas distintas redacten con el mismo formato.
 *
 *   campos: qué pide el redactor además del cuerpo
 *           'evento' = fecha y hora · 'lugar' · 'monto' · 'limite' = fecha tope
 *   individual: true = va a UN propietario (no es masivo)
 */
var COM_GRUPOS = [
  { id: 'mant', nombre: 'Mantenimiento',        icono: '🔧' },
  { id: 'inc',  nombre: 'Incidencias y daños',  icono: '⚠️' },
  { id: 'seg',  nombre: 'Seguridad',            icono: '🛡️' },
  { id: 'pro',  nombre: 'Mejoras y proyectos',  icono: '🏗️' },
  { id: 'gob',  nombre: 'Gobernanza',           icono: '🏛️' },
  { id: 'fin',  nombre: 'Financiero',           icono: '💵' },
  { id: 'nor',  nombre: 'Normas y convivencia', icono: '📋' },
  { id: 'com',  nombre: 'Comunidad y eventos',  icono: '🎉' },
  { id: 'con',  nombre: 'Consultas',            icono: '📊' }
];

var COM_TIPOS = [
  /* ── Mantenimiento ── */
  { id: 'mant.programado', grupo: 'mant', nombre: 'Mantenimiento programado', prioridad: 'importante',
    campos: ['evento', 'lugar'],
    titulo: 'Mantenimiento programado',
    cuerpo: 'Estimados propietarios:\n\nLes informamos que se realizará un trabajo de mantenimiento en el área que se detalla a continuación.\n\n- **Trabajo:** \n- **Área afectada:** \n- **Duración estimada:** \n\nAgradecemos su comprensión por las molestias que esto pueda ocasionar.',
    accion: 'Tome sus previsiones para ese día.' },
  { id: 'mant.agua', grupo: 'mant', nombre: 'Corte o suspensión de agua', prioridad: 'importante',
    campos: ['evento'],
    titulo: 'Suspensión temporal del suministro de agua',
    cuerpo: 'Estimados propietarios:\n\nEl suministro de agua será suspendido temporalmente por trabajos en la red.\n\n- **Motivo:** \n- **Duración estimada:** \n\nEl servicio se restablecerá de forma progresiva.',
    accion: 'Le recomendamos almacenar agua suficiente antes de esa hora.' },
  { id: 'mant.luz', grupo: 'mant', nombre: 'Corte de energía eléctrica', prioridad: 'importante',
    campos: ['evento'],
    titulo: 'Suspensión temporal de energía eléctrica',
    cuerpo: 'Estimados propietarios:\n\nSe suspenderá el servicio de energía eléctrica por trabajos en la red.\n\n- **Motivo:** \n- **Duración estimada:** ',
    accion: 'Desconecte equipos sensibles antes del corte.' },
  { id: 'mant.areas', grupo: 'mant', nombre: 'Limpieza, poda o desbroce', prioridad: 'informativo',
    campos: ['evento', 'lugar'],
    titulo: 'Trabajos de limpieza y poda en áreas comunes',
    cuerpo: 'Estimados propietarios:\n\nSe realizarán trabajos de limpieza, poda y desbroce en las áreas comunes.\n\n- **Áreas a intervenir:** \n- **Personal a cargo:** ',
    accion: 'Le pedimos no estacionar en las áreas señalizadas ese día.' },
  { id: 'mant.fumigacion', grupo: 'mant', nombre: 'Fumigación o control de plagas', prioridad: 'importante',
    campos: ['evento', 'lugar'],
    titulo: 'Jornada de fumigación',
    cuerpo: 'Estimados propietarios:\n\nSe realizará una jornada de fumigación y control de plagas en las áreas comunes.\n\n- **Producto a utilizar:** \n- **Áreas a tratar:** ',
    accion: 'Mantenga a niños y mascotas fuera de las áreas tratadas durante las horas indicadas.' },
  { id: 'mant.vias', grupo: 'mant', nombre: 'Trabajos en calles y accesos', prioridad: 'importante',
    campos: ['evento', 'lugar'],
    titulo: 'Trabajos en calles y accesos',
    cuerpo: 'Estimados propietarios:\n\nSe intervendrán las calles y accesos que se detallan a continuación.\n\n- **Tramo afectado:** \n- **Vía alterna:** ',
    accion: 'Considere tiempo adicional en sus entradas y salidas.' },

  /* ── Incidencias ── */
  { id: 'inc.averia', grupo: 'inc', nombre: 'Avería o daño en curso', prioridad: 'urgente',
    campos: ['lugar'],
    titulo: 'Avería en las instalaciones',
    cuerpo: 'Estimados propietarios:\n\nInformamos que se ha presentado una avería que estamos atendiendo en este momento.\n\n- **Qué ocurrió:** \n- **Qué está afectado:** \n- **Acciones en curso:** \n- **Tiempo estimado de solución:** \n\nLes mantendremos informados.',
    accion: '' },
  { id: 'inc.restablecido', grupo: 'inc', nombre: 'Servicio restablecido', prioridad: 'informativo',
    campos: [],
    titulo: 'Servicio restablecido',
    cuerpo: 'Estimados propietarios:\n\nLes informamos que el servicio quedó **restablecido**.\n\n- **Causa de la falla:** \n- **Solución aplicada:** \n\nAgradecemos su paciencia durante la interrupción.',
    accion: 'Si en su lote persiste alguna falla, repórtelo a la administración.' },
  { id: 'inc.dano', grupo: 'inc', nombre: 'Daño a bienes comunes', prioridad: 'importante',
    campos: ['lugar'],
    titulo: 'Daño en áreas comunes',
    cuerpo: 'Estimados propietarios:\n\nSe registró un daño en un bien de uso común de la comunidad.\n\n- **Qué se dañó:** \n- **Cuándo se detectó:** \n- **Costo estimado de reparación:** \n\nLa reparación se atenderá con cargo al fondo de mantenimiento.',
    accion: 'Si tiene información sobre lo ocurrido, comuníquela a la administración.' },

  /* ── Seguridad ── */
  { id: 'seg.alerta', grupo: 'seg', nombre: 'Alerta de seguridad', prioridad: 'urgente',
    campos: ['lugar'],
    titulo: 'Alerta de seguridad',
    cuerpo: 'Estimados propietarios:\n\nLes alertamos sobre una situación de seguridad reportada en la comunidad.\n\n- **Qué ocurrió:** \n- **Dónde:** \n- **Cuándo:** \n\nLa administración ya tomó las medidas correspondientes.',
    accion: 'Extreme precauciones, mantenga sus accesos cerrados y reporte cualquier movimiento extraño.' },
  { id: 'seg.protocolo', grupo: 'seg', nombre: 'Control de acceso y visitantes', prioridad: 'importante',
    campos: [],
    titulo: 'Protocolo de acceso de visitantes y contratistas',
    cuerpo: 'Estimados propietarios:\n\nRecordamos el procedimiento para el ingreso de visitantes, contratistas y personal de servicio.\n\n- **Autorización previa:** \n- **Horarios permitidos:** \n- **Documentación requerida:** ',
    accion: 'Notifique a la administración antes de la llegada de sus visitantes o contratistas.' },
  { id: 'seg.clima', grupo: 'seg', nombre: 'Temporada de lluvias o clima', prioridad: 'importante',
    campos: [],
    titulo: 'Recomendaciones por temporada de lluvias',
    cuerpo: 'Estimados propietarios:\n\nAnte la temporada de lluvias, compartimos algunas recomendaciones preventivas.\n\n- Revise techos, canales y desagües de su lote.\n- Despeje ramas y árboles con riesgo de caída.\n- Verifique el estado de los taludes cercanos a su construcción.',
    accion: 'Reporte a la administración cualquier riesgo que detecte en áreas comunes.' },

  /* ── Proyectos ── */
  { id: 'pro.inicio', grupo: 'pro', nombre: 'Inicio de obra o mejora', prioridad: 'importante',
    campos: ['evento', 'lugar', 'monto'],
    titulo: 'Inicio de obra',
    cuerpo: 'Estimados propietarios:\n\nNos complace informar el inicio de una nueva mejora para la comunidad.\n\n- **Obra:** \n- **Contratista:** \n- **Duración estimada:** \n- **Inversión aprobada:** ',
    accion: 'Durante los trabajos le pedimos respetar la señalización del área.' },
  { id: 'pro.avance', grupo: 'pro', nombre: 'Avance de proyecto', prioridad: 'informativo',
    campos: [],
    titulo: 'Avance de obra',
    cuerpo: 'Estimados propietarios:\n\nCompartimos el avance de la obra en ejecución.\n\n- **Avance a la fecha:** \n- **Lo ejecutado:** \n- **Lo que sigue:** \n- **Fecha estimada de entrega:** ',
    accion: '' },
  { id: 'pro.entrega', grupo: 'pro', nombre: 'Entrega de mejora', prioridad: 'informativo',
    campos: ['lugar'],
    titulo: 'Nueva mejora entregada a la comunidad',
    cuerpo: 'Estimados propietarios:\n\nNos complace informar que la obra quedó **concluida y entregada** a la comunidad.\n\n- **Obra:** \n- **Inversión final:** \n- **Uso y cuidado:** ',
    accion: 'Ayúdenos a cuidarla: es de todos.' },

  /* ── Gobernanza ── */
  { id: 'gob.convocatoria', grupo: 'gob', nombre: 'Convocatoria a asamblea', prioridad: 'importante',
    campos: ['evento', 'lugar'], acuse: true,
    titulo: 'Convocatoria a Asamblea de Propietarios',
    cuerpo: 'Estimados propietarios:\n\nPor este medio se les **convoca formalmente** a la Asamblea de Propietarios de la comunidad.\n\n**Orden del día:**\n\n1. Verificación del quórum\n2. Lectura y aprobación del acta anterior\n3. Informe de la administración\n4. Informe financiero\n5. \n6. Puntos varios\n\nLa asistencia puede ser personal o mediante poder escrito dirigido a la administración.',
    accion: 'Confirme su asistencia respondiendo a este comunicado y confirme de recibido con el botón al pie.' },
  { id: 'gob.segunda', grupo: 'gob', nombre: 'Segunda convocatoria', prioridad: 'importante',
    campos: ['evento', 'lugar'], acuse: true,
    titulo: 'Segunda convocatoria a Asamblea de Propietarios',
    cuerpo: 'Estimados propietarios:\n\nAl no haberse alcanzado el quórum en la primera convocatoria, se convoca por **segunda vez** a la Asamblea de Propietarios, la cual sesionará con los propietarios presentes.\n\n**Orden del día:** el mismo de la convocatoria anterior.',
    accion: 'Su asistencia es determinante: en segunda convocatoria se decide con los presentes.' },
  { id: 'gob.acta', grupo: 'gob', nombre: 'Acta y acuerdos de asamblea', prioridad: 'informativo',
    campos: [],
    titulo: 'Acuerdos de la Asamblea de Propietarios',
    cuerpo: 'Estimados propietarios:\n\nCompartimos los acuerdos adoptados en la asamblea celebrada.\n\n**Acuerdos:**\n\n1. \n2. \n3. \n\nEl acta completa se adjunta a este comunicado.',
    accion: 'Revise el acta adjunta y comunique cualquier observación a la administración.' },
  { id: 'gob.junta', grupo: 'gob', nombre: 'Elección o cambio de junta', prioridad: 'importante',
    campos: [],
    titulo: 'Nueva Junta Directiva',
    cuerpo: 'Estimados propietarios:\n\nInformamos la conformación de la Junta Directiva para el período que inicia.\n\n- **Presidente:** \n- **Tesorero:** \n- **Secretario:** \n- **Vocales:** \n\nAgradecemos a la junta saliente por su gestión.',
    accion: '' },

  /* ── Financiero ── */
  { id: 'fin.informe', grupo: 'fin', nombre: 'Informe financiero', prioridad: 'informativo',
    campos: [],
    titulo: 'Informe financiero de la comunidad',
    cuerpo: 'Estimados propietarios:\n\nCompartimos el informe financiero del período, con el detalle de ingresos, egresos y el saldo del fondo de la asociación.\n\nEl informe completo se adjunta a este comunicado.',
    accion: 'Cualquier consulta sobre las cifras puede dirigirla a la administración.' },
  { id: 'fin.presupuesto', grupo: 'fin', nombre: 'Presupuesto aprobado', prioridad: 'importante',
    campos: ['monto'],
    titulo: 'Presupuesto aprobado',
    cuerpo: 'Estimados propietarios:\n\nInformamos el presupuesto aprobado para el período.\n\n- **Período:** \n- **Total presupuestado:** \n- **Principales partidas:** ',
    accion: '' },
  { id: 'fin.cuota', grupo: 'fin', nombre: 'Cambio en la cuota', prioridad: 'importante',
    campos: ['monto', 'limite'], acuse: true,
    titulo: 'Ajuste de la cuota de mantenimiento',
    cuerpo: 'Estimados propietarios:\n\nInformamos un ajuste en la cuota de mantenimiento, aprobado por la asamblea.\n\n- **Cuota anterior:** \n- **Nueva cuota:** \n- **Vigente a partir de:** \n- **Motivo del ajuste:** ',
    accion: 'Actualice el monto de su transferencia a partir del mes indicado.' },
  { id: 'fin.extraordinaria', grupo: 'fin', nombre: 'Cuota extraordinaria', prioridad: 'importante',
    campos: ['monto', 'limite'], acuse: true,
    titulo: 'Cuota extraordinaria aprobada',
    cuerpo: 'Estimados propietarios:\n\nLa asamblea aprobó una cuota extraordinaria destinada al fin que se detalla.\n\n- **Destino:** \n- **Monto por lote:** \n- **Forma de pago:** \n- **Fecha límite:** ',
    accion: 'Realice su aporte antes de la fecha límite, a la cuenta de la asociación.' },
  { id: 'fin.cuenta', grupo: 'fin', nombre: 'Cuenta bancaria de la asociación', prioridad: 'urgente',
    campos: [], acuse: true,
    titulo: 'Datos de la cuenta para el pago de cuotas',
    cuerpo: 'Estimados propietarios:\n\nRecordamos los **datos oficiales y únicos** de la cuenta para el pago de las cuotas de mantenimiento.\n\n- **Banco:** \n- **Tipo de cuenta:** \n- **Número:** \n- **A nombre de:** \n\n**La administración nunca le pedirá que transfiera a una cuenta distinta ni a una cuenta personal.** Ante cualquier mensaje que le indique lo contrario, verifique directamente con la administración antes de pagar.',
    accion: 'Verifique los datos guardados en su banca en línea antes de su próximo pago.' },

  /* ── Normas ── */
  { id: 'nor.reglamento', grupo: 'nor', nombre: 'Reglamento y normas', prioridad: 'importante',
    campos: [], acuse: true,
    titulo: 'Reglamento de la comunidad',
    cuerpo: 'Estimados propietarios:\n\nCompartimos el reglamento vigente de la comunidad y sus últimas actualizaciones.\n\n**Puntos destacados:**\n\n- \n- \n- ',
    accion: 'Lea el documento adjunto y confirme de recibido con el botón al pie.' },
  { id: 'nor.recordatorio', grupo: 'nor', nombre: 'Recordatorio de convivencia', prioridad: 'informativo',
    campos: [],
    titulo: 'Recordatorio de normas de convivencia',
    cuerpo: 'Estimados propietarios:\n\nCon el ánimo de mantener la buena convivencia, recordamos algunas normas de la comunidad.\n\n- **Horarios de construcción:** \n- **Ruido y música:** \n- **Manejo de basura:** \n- **Mascotas:** \n- **Uso de áreas comunes:** ',
    accion: 'Comparta estas normas con quienes visiten o alquilen su lote.' },
  { id: 'nor.construccion', grupo: 'nor', nombre: 'Normas de construcción', prioridad: 'importante',
    campos: [],
    titulo: 'Normas para obras y construcciones',
    cuerpo: 'Estimados propietarios:\n\nRecordamos las condiciones para ejecutar obras dentro de la comunidad.\n\n- **Aprobación previa de planos:** \n- **Horario permitido:** \n- **Manejo de escombros:** \n- **Responsabilidad por daños a áreas comunes:** ',
    accion: 'Notifique a la administración antes de iniciar cualquier obra en su lote.' },
  { id: 'nor.incumplimiento', grupo: 'nor', nombre: 'Aviso individual de incumplimiento', prioridad: 'importante',
    campos: ['limite'], individual: true, acuse: true,
    titulo: 'Aviso de incumplimiento del reglamento',
    cuerpo: 'Estimado(a) propietario(a):\n\nLe informamos que se registró en su lote una situación contraria al reglamento de la comunidad.\n\n- **Situación observada:** \n- **Fecha en que se observó:** \n- **Norma aplicable:** \n\nEste aviso tiene carácter informativo y busca resolver la situación de común acuerdo.',
    accion: 'Le solicitamos regularizar la situación antes de la fecha indicada, o comunicarse con la administración si considera que hay un error.' },

  /* ── Comunidad ── */
  { id: 'com.evento', grupo: 'com', nombre: 'Evento o actividad', prioridad: 'informativo',
    campos: ['evento', 'lugar', 'limite'],
    titulo: 'Actividad de la comunidad',
    cuerpo: 'Estimados propietarios:\n\nLos invitamos a nuestra próxima actividad comunitaria.\n\n- **Actividad:** \n- **Dirigida a:** \n- **Qué llevar:** ',
    accion: 'Confirme su asistencia antes de la fecha indicada.' },
  { id: 'com.jornada', grupo: 'com', nombre: 'Jornada comunitaria', prioridad: 'informativo',
    campos: ['evento', 'lugar'],
    titulo: 'Jornada comunitaria',
    cuerpo: 'Estimados propietarios:\n\nConvocamos a una jornada de trabajo comunitario.\n\n- **Objetivo:** \n- **Qué se necesita:** \n- **Duración estimada:** ',
    accion: 'Súmese con su familia: cada par de manos cuenta.' },
  { id: 'com.bienvenida', grupo: 'com', nombre: 'Bienvenida a nuevo propietario', prioridad: 'informativo',
    campos: [],
    titulo: 'Damos la bienvenida a un nuevo propietario',
    cuerpo: 'Estimados propietarios:\n\nNos complace dar la bienvenida a un nuevo miembro de nuestra comunidad.\n\nLe deseamos una excelente estadía y quedamos a su disposición para lo que necesite.',
    accion: '' },
  { id: 'com.saludo', grupo: 'com', nombre: 'Saludo o mensaje de temporada', prioridad: 'informativo',
    campos: [],
    titulo: 'Mensaje de la administración',
    cuerpo: 'Estimados propietarios:\n\n',
    accion: '' },

  /* ── Consultas ── */
  { id: 'con.encuesta', grupo: 'con', nombre: 'Consulta o encuesta', prioridad: 'informativo',
    campos: ['limite'],
    titulo: 'Consulta a los propietarios',
    cuerpo: 'Estimados propietarios:\n\nQueremos conocer su opinión antes de tomar una decisión sobre el siguiente tema.\n\n- **Tema:** \n- **Opciones a considerar:** \n\nSu respuesta no es vinculante, pero orienta a la administración y a la junta.',
    accion: 'Responda a este comunicado con su opinión antes de la fecha límite.' },

  /* ── General ── */
  { id: 'gen.aviso', grupo: 'com', nombre: 'Aviso general', prioridad: 'informativo',
    campos: [],
    titulo: '',
    cuerpo: 'Estimados propietarios:\n\n',
    accion: '' }
];

function _comTipo(id) {
  for (var i = 0; i < COM_TIPOS.length; i++) if (COM_TIPOS[i].id === id) return COM_TIPOS[i];
  return { id: 'gen.aviso', grupo: 'com', nombre: 'Aviso general', prioridad: 'informativo', campos: [] };
}

var COM_PRIORIDADES = {
  informativo: { nombre: 'Informativo', color: '#0E8FB0', etiqueta: '' },
  importante:  { nombre: 'Importante',  color: '#B7791F', etiqueta: 'IMPORTANTE' },
  urgente:     { nombre: 'Urgente',     color: '#C0392B', etiqueta: 'URGENTE' }
};

/* ─────────────────────── hojas ─────────────────────── */

function _comSheetOf(nombre, cols) {
  var ss = _ss();
  var sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
      .setBackground('#0E8FB0').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _comSheet()   { return _comSheetOf(SH_COM, COL_COM); }
function _envSheet()   { return _comSheetOf(SH_ENVIOS, COL_ENVIOS); }

// Índice de columnas por nombre, leyendo el encabezado real (tolera columnas
// agregadas a mano o en distinto orden).
function _comIdx(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var iof = {};
  h.forEach(function (c, i) { iof[c] = i; });
  return { iof: iof, n: h.length };
}

function _comFila(obj) {
  var sh = _comSheet(), ix = _comIdx(sh), row = new Array(ix.n).fill('');
  COL_COM.forEach(function (c) {
    if (ix.iof[c] === undefined) return;
    row[ix.iof[c]] = (obj[c] === undefined || obj[c] === null) ? '' : obj[c];
  });
  return row;
}

/* ─────────────────────── tokens personales ───────────────────────
 * Enlace estable por propietario, derivado de su clave y de un secreto que sólo
 * vive en Script Properties. No caduca, no se puede adivinar y no expone la clave.
 * Sirve para el "ver en el navegador", el archivo de comunicados y el acuse; y le
 * servirá al bot de WhatsApp para atender consultas del propietario.
 */
var COM_SECRET_PROP = 'AC_COM_SECRET';

function _acSecret() {
  var p = _props(), s = p.getProperty(COM_SECRET_PROP);
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(COM_SECRET_PROP, s); }
  return s;
}
function _acTokenDe(clave) {
  return _sha256Hex(_acSecret() + '|prop|' + String(clave || '').toUpperCase()).slice(0, 24);
}
// token -> propietario (68 cuentas: comparar todas sale barato y evita guardar el token)
function _acPropDeToken(token) {
  token = String(token || '').trim();
  if (token.length < 10) return null;
  var props = getPropietarios(true);
  for (var i = 0; i < props.length; i++) {
    if (_acTokenDe(props[i].clave) === token) return props[i];
  }
  return null;
}
function _comUrl() {
  var u = String(CONFIG.WEBAPP_URL || '').trim();
  if (u) return u;
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}
function _comLink(accion, params) {
  var u = _comUrl();
  if (!u) return '';
  var q = ['action=' + accion];
  Object.keys(params || {}).forEach(function (k) { q.push(k + '=' + encodeURIComponent(params[k])); });
  return u + '?' + q.join('&');
}

/* ─────────────────────── redacción → HTML / texto ─────────────────────── */

function _comEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _comInline(s) {
  return _comEsc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + AC_BRAND.teal + '">$1</a>');
}
/** Texto plano del redactor -> HTML. Soporta **negrita**, viñetas y listas numeradas. */
function _comCuerpoHTML(txt) {
  var bloques = String(txt || '').replace(/\r/g, '').split(/\n{2,}/);
  return bloques.map(function (b) {
    var lineas = b.split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lineas.length) return '';
    var vi = lineas.every(function (l) { return /^\s*[-•*]\s+/.test(l); });
    if (vi) return '<ul style="margin:0 0 12px;padding-left:20px;line-height:1.65">' +
      lineas.map(function (l) { return '<li>' + _comInline(l.replace(/^\s*[-•*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
    var nu = lineas.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); });
    if (nu) return '<ol style="margin:0 0 12px;padding-left:20px;line-height:1.65">' +
      lineas.map(function (l) { return '<li>' + _comInline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; }).join('') + '</ol>';
    return '<p style="margin:0 0 12px">' + lineas.map(_comInline).join('<br>') + '</p>';
  }).join('');
}
/** Mismo cuerpo, en texto plano: es lo que consumirá el bot de WhatsApp. */
function _comCuerpoTexto(txt) {
  return String(txt || '').replace(/\r/g, '').replace(/\*\*([^*]+)\*\*/g, '*$1*').trim();
}

function _comCuando(com) {
  var f = String(com.eventoFecha || '').trim(), h = String(com.eventoHora || '').trim();
  if (!f) return '';
  var p = f.split('-');
  var txt = p.length === 3 ? (Number(p[2]) + ' de ' + (AC_MESES_LARGO[Number(p[1]) - 1] || '') + ' de ' + p[0]) : f;
  return txt + (h ? ' · ' + h : '');
}

/** Un comunicado tal como lo verá un propietario: correo, página web y WhatsApp. */
function _comRender(com, prop) {
  var B = AC_BRAND;
  var tipo = _comTipo(com.tipo);
  var pri = COM_PRIORIDADES[com.prioridad] || COM_PRIORIDADES.informativo;
  var cuando = _comCuando(com);
  var token = prop ? _acTokenDe(prop.clave) : '';
  var urlVer = token ? _comLink('verComunicado', { id: com.id, t: token }) : '';
  var urlAcuse = (token && com.acuse) ? _comLink('acuseComunicado', { id: com.id, t: token }) : '';
  var urlArchivo = token ? _comLink('misComunicados', { t: token }) : '';
  var adj = String(com.adjuntos || '').split('\n').map(function (a) { return a.trim(); }).filter(String);

  var asunto = (pri.etiqueta ? '[' + pri.etiqueta + '] ' : '') +
    '[' + tipo.nombre + '] ' + (com.titulo || tipo.nombre) + ' — ' + CONFIG.NEGOCIO;

  var meta = '';
  if (cuando) meta += '<div style="margin:2px 0"><b>Cuándo:</b> ' + _comEsc(cuando) + '</div>';
  if (com.lugar) meta += '<div style="margin:2px 0"><b>Dónde:</b> ' + _comEsc(com.lugar) + '</div>';
  if (com.limite) meta += '<div style="margin:2px 0"><b>Fecha límite:</b> ' + _comEsc(com.limite) + '</div>';

  var inner =
    (pri.etiqueta
      ? '<div style="display:inline-block;padding:4px 12px;border-radius:20px;background:' + pri.color +
        ';color:#fff;font-size:11.5px;font-weight:700;letter-spacing:.06em;margin-bottom:10px">' + pri.etiqueta + '</div>'
      : '') +
    '<div style="font-size:11px;color:' + B.muted + ';text-transform:uppercase;letter-spacing:.06em">' +
      _comEsc(tipo.nombre) + '</div>' +
    '<h2 style="margin:4px 0 12px;font-size:19px;color:' + B.teal700 + '">' + _comEsc(com.titulo || tipo.nombre) + '</h2>' +
    (meta ? '<div style="margin:0 0 14px;padding:11px 13px;background:' + B.teal50 + ';border-radius:8px;font-size:13px">' + meta + '</div>' : '') +
    _comCuerpoHTML(com.cuerpo) +
    (com.accion
      ? '<div style="margin:16px 0 4px;padding:12px 14px;background:#fff;border-left:4px solid ' + B.coral +
        ';border-radius:6px;font-size:13.5px;line-height:1.55"><b style="color:' + B.coral + '">Lo que le pedimos:</b> ' +
        _comInline(com.accion) + '</div>'
      : '') +
    (adj.length
      ? '<div style="margin-top:16px"><div style="font-weight:700;font-size:13px;margin-bottom:5px">Documentos adjuntos</div>' +
        adj.map(function (a) {
          var partes = a.split('|');
          var url = partes[partes.length - 1].trim(), nom = partes.length > 1 ? partes[0].trim() : 'Ver documento';
          return '<div style="margin:3px 0">📎 <a href="' + _comEsc(url) + '" style="color:' + B.teal + '">' + _comEsc(nom) + '</a></div>';
        }).join('') + '</div>'
      : '') +
    (urlAcuse
      ? '<div style="margin-top:22px;text-align:center">' +
        '<a href="' + urlAcuse + '" style="display:inline-block;padding:11px 22px;background:' + B.teal +
        ';color:#fff;text-decoration:none;border-radius:9px;font-weight:700;font-size:14px">Confirmo que recibí este comunicado</a>' +
        '<div style="font-size:11.5px;color:' + B.muted + ';margin-top:6px">Un solo clic. Queda constancia de la fecha en que lo recibió.</div></div>'
      : '') +
    (urlVer
      ? '<div style="margin-top:18px;text-align:center;font-size:11.5px;color:' + B.muted + '">' +
        '<a href="' + urlVer + '" style="color:' + B.muted + '">Ver en el navegador</a> · ' +
        '<a href="' + urlArchivo + '" style="color:' + B.muted + '">Ver todos los comunicados</a></div>'
      : '');

  // WhatsApp: mismo contenido, sin HTML. El bot lo toma tal cual.
  var texto = (pri.etiqueta ? '*' + pri.etiqueta + '*\n' : '') +
    '*' + (com.titulo || tipo.nombre) + '*\n' +
    (cuando ? '🗓 ' + cuando + '\n' : '') +
    (com.lugar ? '📍 ' + com.lugar + '\n' : '') +
    '\n' + _comCuerpoTexto(com.cuerpo) +
    (com.accion ? '\n\n👉 ' + _comCuerpoTexto(com.accion) : '') +
    (adj.length ? '\n\n📎 ' + adj.map(function (a) { return a.split('|').pop().trim(); }).join('\n📎 ') : '') +
    (urlAcuse ? '\n\n✅ Confirmar de recibido: ' + urlAcuse : '') +
    (urlVer ? '\n\nVer en el navegador: ' + urlVer : '') +
    '\n\n— ' + CONFIG.NEGOCIO;

  return { asunto: asunto, html: _emailShell(inner), texto: texto, urlVer: urlVer, urlAcuse: urlAcuse };
}

/* ─────────────────────── destinatarios ───────────────────────
 * segmento: 'todos' | 'residencial' | 'cabanas' | 'manual' | 'individual'
 * alcance : lista separada por comas — residenciales o claves, según el segmento
 */
function _comDestinatarios(com) {
  var seg = String(com.segmento || 'todos');
  var alcance = String(com.alcance || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  var props = getPropietarios(false);   // sólo cuentas activas
  if (seg === 'residencial') {
    var res = {};
    alcance.forEach(function (r) { res[_normTxt(r)] = 1; });
    return props.filter(function (p) { return res[_normTxt(p.residencial)]; });
  }
  if (seg === 'cabanas') return props.filter(function (p) { return (Number(p.cabanas) || 0) > 0 || p.airbnb; });
  if (seg === 'manual' || seg === 'individual') {
    var cl = {};
    alcance.forEach(function (c) { cl[String(c).toUpperCase()] = 1; });
    return props.filter(function (p) { return cl[String(p.clave).toUpperCase()]; });
  }
  return props;
}

function _comCanales(com) {
  var c = String(com.canales || 'email').split(',').map(function (s) { return s.trim(); }).filter(String);
  return c.length ? c : ['email'];
}

/* ─────────────────────── CRUD ─────────────────────── */

function _comLee(id) {
  var sh = _comSheet();
  if (sh.getLastRow() < 2) return null;
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iof = {}; h.forEach(function (c, i) { iof[c] = i; });
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iof.id]) === String(id)) {
      var o = {}; h.forEach(function (c, i) { o[c] = vals[r][i]; });
      o._fila = r + 1;
      return o;
    }
  }
  return null;
}

function _comEscribe(fila, campos) {
  var sh = _comSheet(), ix = _comIdx(sh);
  Object.keys(campos).forEach(function (k) {
    if (ix.iof[k] === undefined) return;
    sh.getRange(fila, ix.iof[k] + 1).setValue(campos[k]);
  });
}

/**
 * Crea o actualiza un comunicado. Un comunicado ENVIADO ya no se edita: es la
 * constancia de lo que se le mandó a la gente, y reescribirlo dejaría el archivo
 * y el correo diciendo cosas distintas.
 */
function guardarComunicado(d) {
  d = d || {};
  var tipo = _comTipo(d.tipo);
  var titulo = String(d.titulo || '').trim();
  var cuerpo = String(d.cuerpo || '').trim();
  if (!titulo) throw new Error('El comunicado necesita un título.');
  if (!cuerpo) throw new Error('El comunicado necesita un mensaje.');

  var campos = {
    tipo: tipo.id,
    prioridad: (COM_PRIORIDADES[d.prioridad] ? d.prioridad : (tipo.prioridad || 'informativo')),
    titulo: titulo,
    cuerpo: cuerpo,
    accion: String(d.accion || '').trim(),
    eventoFecha: String(d.eventoFecha || '').trim(),
    eventoHora: String(d.eventoHora || '').trim(),
    lugar: String(d.lugar || '').trim(),
    limite: String(d.limite || '').trim(),
    adjuntos: String(d.adjuntos || '').trim(),
    segmento: String(d.segmento || 'todos'),
    alcance: (d.alcance instanceof Array) ? d.alcance.join(',') : String(d.alcance || ''),
    canales: (d.canales instanceof Array) ? d.canales.join(',') : String(d.canales || 'email'),
    acuse: d.acuse ? 1 : '',
    recordatorio: d.recordatorio ? 1 : '',
    programadoPara: String(d.programadoPara || '').trim(),
    notas: String(d.notas || '').trim()
  };
  campos.estado = campos.programadoPara ? 'programado' : 'borrador';
  campos.destinatarios = _comDestinatarios(campos).length;

  var id = String(d.id || '').trim();
  if (id) {
    var actual = _comLee(id);
    if (!actual) throw new Error('El comunicado ya no existe.');
    if (String(actual.estado) === 'enviado') throw new Error('Un comunicado ya enviado no se puede modificar.');
    _comEscribe(actual._fila, campos);
    _reg('comunicado.edita', { entidad: 'comunicado', clave: id, campo: 'comunicado',
      detalle: tipo.nombre + ' · ' + titulo });
  } else {
    id = 'C' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 100);
    campos.id = id;
    campos.creado = new Date();
    campos.autor = _autor();
    campos.enviados = 0; campos.sinDestino = 0; campos.errores = 0;
    _comSheet().appendRow(_comFila(campos));
    _reg('comunicado.crea', { entidad: 'comunicado', clave: id, campo: 'comunicado',
      detalle: tipo.nombre + ' · ' + titulo + ' · ' + campos.destinatarios + ' destinatario(s)' });
  }
  // El comunicado ya quedó guardado: si falta autorizar los triggers, se avisa pero
  // no se tumba el guardado (igual que en guardarConfig).
  var aviso = null;
  if (campos.estado === 'programado') {
    try { _comAsegurarTrigger(); }
    catch (e) {
      aviso = 'El comunicado quedó programado, pero para que salga solo hay que ejecutar una vez ' +
              'activarNotificaciones() en el editor de Apps Script (autoriza los permisos).';
    }
  }
  return { ok: true, id: id, estado: campos.estado, destinatarios: campos.destinatarios, aviso: aviso };
}

/** Sólo se borran borradores y programados: lo enviado es historia y no se toca. */
function eliminarComunicado(id) {
  var com = _comLee(id);
  if (!com) throw new Error('El comunicado ya no existe.');
  if (String(com.estado) === 'enviado') throw new Error('Un comunicado ya enviado no se puede eliminar: es la constancia de lo que se envió.');
  _comSheet().deleteRow(com._fila);
  _reg('comunicado.baja', { entidad: 'comunicado', clave: id, campo: 'comunicado',
    detalle: String(com.titulo || '') });
  return { ok: true, id: id };
}

/* ─────────────────────── envío ─────────────────────── */

function _envAppend(filas) {
  if (!filas.length) return;
  var sh = _envSheet(), ix = _comIdx(sh);
  var rows = filas.map(function (f) {
    var row = new Array(ix.n).fill('');
    COL_ENVIOS.forEach(function (c) {
      if (ix.iof[c] === undefined) return;
      row[ix.iof[c]] = (f[c] === undefined || f[c] === null) ? '' : f[c];
    });
    return row;
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, ix.n).setValues(rows);
}

/**
 * Envía un comunicado.
 *
 * - Respeta el interruptor maestro: con los envíos apagados no sale nada.
 * - En MODO PRUEBA manda una sola copia a la dirección de prueba y NO marca el
 *   comunicado como enviado: la idea es ver cómo queda, no gastar el disparo.
 * - Los canales distintos del correo (WhatsApp) se encolan en `Envios` como
 *   pendientes; el bot los recoge con getEnviosPendientes() y los marca al entregar.
 */
function enviarComunicado(id, opts) {
  opts = opts || {};
  var cfg = _cfg();
  var com = _comLee(id);
  if (!com) throw new Error('El comunicado ya no existe.');
  if (String(com.estado) === 'enviado' && !opts.reenviar) {
    throw new Error('Este comunicado ya fue enviado el ' + _fmtFecha(com.enviadoEn) + '.');
  }
  if (!cfg.enviosActivos) {
    return { pausado: true, motivo: 'Envíos pausados (interruptor maestro apagado en Opciones).' };
  }

  var destinos = _comDestinatarios(com);
  if (opts.claves && opts.claves.length) {
    var sel = {}; opts.claves.forEach(function (c) { sel[String(c).toUpperCase()] = 1; });
    destinos = destinos.filter(function (p) { return sel[String(p.clave).toUpperCase()]; });
  }
  if (!destinos.length) throw new Error('El comunicado no tiene destinatarios.');

  var canales = _comCanales(com);
  var prueba = !!(cfg.modoPrueba && cfg.correoPrueba);
  var ahora = new Date(), autor = _autor();
  var enviados = 0, sinDestino = 0, errores = 0, log = [];

  destinos.forEach(function (p, i) {
    var r = _comRender(com, p);

    // ── correo ──
    if (canales.indexOf('email') >= 0) {
      var destino = prueba ? cfg.correoPrueba : String(p.email || '').trim();
      // En modo prueba basta UNA copia: 68 correos idénticos a la misma dirección
      // no prueban nada y queman la cuota diaria de envío.
      if (prueba && i > 0) {
        log.push({ id: 'E' + ahora.getTime() + '-' + i, ts: ahora, tipo: 'comunicado', refId: com.id,
          clave: p.clave, nombre: p.nombre, canal: 'email', destino: String(p.email || ''),
          estado: 'omitido', error: 'modo prueba', acuse: '', autor: autor });
      } else if (!destino) {
        sinDestino++;
        log.push({ id: 'E' + ahora.getTime() + '-' + i, ts: ahora, tipo: 'comunicado', refId: com.id,
          clave: p.clave, nombre: p.nombre, canal: 'email', destino: '',
          estado: 'sin-destino', error: 'propietario sin correo', acuse: '', autor: autor });
      } else {
        try {
          GmailApp.sendEmail(destino, (prueba ? '[PRUEBA→' + p.email + '] ' : '') + r.asunto,
            r.texto, { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: r.html });
          enviados++;
          log.push({ id: 'E' + ahora.getTime() + '-' + i, ts: new Date(), tipo: 'comunicado', refId: com.id,
            clave: p.clave, nombre: p.nombre, canal: 'email', destino: destino,
            estado: 'enviado', error: prueba ? 'modo prueba' : '', acuse: '', autor: autor });
          Utilities.sleep(300);   // respeta la cuota de envío de Gmail
        } catch (e) {
          errores++;
          log.push({ id: 'E' + ahora.getTime() + '-' + i, ts: new Date(), tipo: 'comunicado', refId: com.id,
            clave: p.clave, nombre: p.nombre, canal: 'email', destino: destino,
            estado: 'error', error: String(e && e.message || e), acuse: '', autor: autor });
        }
      }
    }

    // ── WhatsApp: se encola, lo entrega el bot ──
    if (canales.indexOf('whatsapp') >= 0 && !prueba) {
      var cel = String(p.celular || '').replace(/[^\d+]/g, '');
      log.push({ id: 'W' + ahora.getTime() + '-' + i, ts: ahora, tipo: 'comunicado', refId: com.id,
        clave: p.clave, nombre: p.nombre, canal: 'whatsapp', destino: cel,
        estado: cel ? 'pendiente' : 'sin-destino', error: cel ? '' : 'propietario sin celular',
        acuse: '', autor: autor });
    }
  });

  _envAppend(log);

  if (prueba) {
    _reg('comunicado.envia', { entidad: 'comunicado', clave: com.id, campo: 'prueba',
      detalle: 'Modo prueba: 1 copia a ' + cfg.correoPrueba + ' · ' + String(com.titulo || '') });
    return { prueba: true, enviados: enviados, destino: cfg.correoPrueba, destinatarios: destinos.length,
             motivo: 'Modo prueba activo: se envió una sola copia a ' + cfg.correoPrueba + '. El comunicado sigue pendiente de enviar.' };
  }

  var acum = function (campo, mas) { return (Number(com[campo]) || 0) + mas; };
  _comEscribe(com._fila, {
    estado: 'enviado',
    enviadoEn: opts.reenviar ? com.enviadoEn : ahora,
    enviadoPor: opts.reenviar ? com.enviadoPor : autor,
    destinatarios: _comDestinatarios(com).length,
    enviados: acum('enviados', enviados),
    sinDestino: acum('sinDestino', sinDestino),
    errores: acum('errores', errores)
  });

  _reg(opts.reenviar ? 'comunicado.reenvia' : 'comunicado.envia', {
    entidad: 'comunicado', clave: com.id, campo: _comTipo(com.tipo).nombre,
    detalle: String(com.titulo || '') + ' · ' + enviados + ' por correo' +
      (canales.indexOf('whatsapp') >= 0 ? ' · ' + destinos.length + ' en cola de WhatsApp' : '') +
      (sinDestino ? ' · ' + sinDestino + ' sin correo' : '') +
      (errores ? ' · ' + errores + ' con error' : '')
  });

  return { ok: true, id: com.id, enviados: enviados, sinDestino: sinDestino, errores: errores,
           destinatarios: destinos.length, whatsapp: canales.indexOf('whatsapp') >= 0 ? destinos.length : 0 };
}

/** Reenvía sólo a las cuentas indicadas (las que fallaron o no tenían correo). */
function reenviarComunicado(id, claves) {
  if (!claves || !claves.length) throw new Error('Elige a quién reenviar.');
  return enviarComunicado(id, { reenviar: true, claves: claves });
}

/**
 * Prueba explícita a una dirección: NO depende del interruptor maestro ni del modo
 * prueba, igual que la prueba del estado de cuenta. Sirve para ver el formato antes
 * de escribirle a la comunidad.
 */
function enviarPruebaComunicado(id, email) {
  email = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Ingresa un correo válido.');
  var com = _comLee(id);
  if (!com) throw new Error('El comunicado ya no existe.');
  var muestra = _comDestinatarios(com)[0] || getPropietarios(false)[0];
  var r = _comRender(com, muestra);
  GmailApp.sendEmail(email, '[PRUEBA] ' + r.asunto, r.texto,
    { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: r.html });
  return { enviado: true, email: email, muestra: muestra ? muestra.nombre : '' };
}

/** Vista previa para el panel: no envía nada. */
function previsualizarComunicado(d) {
  var com = d || {};
  if (!com.id && !com.titulo) throw new Error('Nada que previsualizar.');
  if (com.id && !com.titulo) com = _comLee(com.id) || com;
  var muestra = _comDestinatarios(com)[0] || getPropietarios(false)[0];
  var r = _comRender(com, muestra);
  return { asunto: r.asunto, html: r.html, texto: r.texto,
           destinatarios: _comDestinatarios(com).length,
           muestra: muestra ? (muestra.nombre + ' · ' + muestra.clave) : '' };
}

/* ─────────────────────── programados y recordatorios ─────────────────────── */

function _comAsegurarTrigger() {
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'despacharComunicados'; });
  if (!hay) ScriptApp.newTrigger('despacharComunicados').timeBased().everyHours(1).create();
}
function _comQuitarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'despacharComunicados') ScriptApp.deleteTrigger(t);
  });
}

/**
 * Corre cada hora mientras haya algo pendiente:
 *   - envía los comunicados programados cuya hora ya pasó;
 *   - manda el recordatorio de los que tienen evento en menos de 48 horas.
 * Cuando no queda nada pendiente se quita el trigger solo.
 */
function despacharComunicados() {
  var filas = _sheetRows(SH_COM), ahora = new Date(), hechos = [], quedan = 0;
  filas.forEach(function (c) {
    if (String(c.estado) === 'programado') {
      var t = _comFechaHora(c.programadoPara);
      if (t && t <= ahora) {
        try { hechos.push({ id: c.id, r: enviarComunicado(c.id, {}) }); }
        catch (e) { hechos.push({ id: c.id, error: String(e && e.message || e) }); }
      } else { quedan++; }
      return;
    }
    if (String(c.estado) === 'enviado' && c.recordatorio && !c.recordatorioEn && c.eventoFecha) {
      var ev = _comFechaHora(c.eventoFecha + (c.eventoHora ? ' ' + c.eventoHora : ' 08:00'));
      if (!ev) return;
      var faltan = (ev - ahora) / 3600000;
      if (faltan > 0 && faltan <= 48) {
        try {
          var r = _comRecordatorio(c);
          hechos.push({ id: c.id, recordatorio: r });
        } catch (e) { hechos.push({ id: c.id, error: String(e && e.message || e) }); }
      } else if (faltan > 48) { quedan++; }
    }
  });
  if (!quedan) _comQuitarTrigger();
  return { revisados: filas.length, hechos: hechos, pendientes: quedan };
}

// 'yyyy-MM-dd HH:mm' o 'yyyy-MM-ddTHH:mm' -> Date en la zona de Panamá
function _comFechaHora(s) {
  s = String(s || '').trim().replace('T', ' ');
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                  m[4] ? Number(m[4]) : 8, m[5] ? Number(m[5]) : 0, 0);
}

/** Recordatorio corto de un comunicado con evento próximo. */
function _comRecordatorio(c) {
  var cfg = _cfg();
  if (!cfg.enviosActivos) return { pausado: true };
  var com = _comLee(c.id);
  if (!com) return { ok: false };
  var recordatorio = {};
  Object.keys(com).forEach(function (k) { recordatorio[k] = com[k]; });
  recordatorio.titulo = 'Recordatorio: ' + String(com.titulo || '');
  recordatorio.cuerpo = 'Estimados propietarios:\n\nLes recordamos que **' +
    String(com.titulo || '') + '** está programado para **' + _comCuando(com) + '**' +
    (com.lugar ? ', en ' + com.lugar : '') + '.\n\n' +
    (com.accion ? com.accion : '');
  recordatorio.acuse = '';
  var destinos = _comDestinatarios(com), n = 0, autor = 'Sistema (automático)', log = [];
  var prueba = !!(cfg.modoPrueba && cfg.correoPrueba);
  destinos.forEach(function (p, i) {
    var destino = prueba ? cfg.correoPrueba : String(p.email || '').trim();
    if (!destino || (prueba && i > 0)) return;
    var r = _comRender(recordatorio, p);
    try {
      GmailApp.sendEmail(destino, r.asunto, r.texto,
        { name: CONFIG.NEGOCIO, replyTo: CONFIG.REPLY_TO, htmlBody: r.html });
      n++;
      log.push({ id: 'R' + new Date().getTime() + '-' + i, ts: new Date(), tipo: 'recordatorio',
        refId: com.id, clave: p.clave, nombre: p.nombre, canal: 'email', destino: destino,
        estado: 'enviado', error: '', acuse: '', autor: autor });
      Utilities.sleep(300);
    } catch (e) { /* se anota abajo como error del lote */ }
  });
  _envAppend(log);
  _comEscribe(com._fila, { recordatorioEn: new Date() });
  _reg('comunicado.recuerda', { entidad: 'comunicado', clave: com.id,
    detalle: 'Recordatorio automático · ' + String(com.titulo || '') + ' · ' + n + ' correo(s)' });
  return { ok: true, enviados: n };
}

/* ─────────────────────── lectura para el panel ─────────────────────── */

function getComunicados(limite) {
  limite = Math.min(Math.max(Number(limite) || 60, 1), 400);
  var filas = _sheetRows(SH_COM).map(function (c) {
    var t = _comTipo(c.tipo);
    return {
      id: String(c.id || ''),
      creado: c.creado instanceof Date ? Utilities.formatDate(c.creado, CONFIG.TZ, 'yyyy-MM-dd HH:mm') : String(c.creado || ''),
      autor: String(c.autor || ''),
      tipo: t.id, tipoNombre: t.nombre, grupo: t.grupo,
      prioridad: String(c.prioridad || 'informativo'),
      titulo: String(c.titulo || ''), cuerpo: String(c.cuerpo || ''), accion: String(c.accion || ''),
      eventoFecha: String(c.eventoFecha || ''), eventoHora: String(c.eventoHora || ''),
      lugar: String(c.lugar || ''), limite: String(c.limite || ''), adjuntos: String(c.adjuntos || ''),
      segmento: String(c.segmento || 'todos'), alcance: String(c.alcance || ''),
      canales: String(c.canales || 'email'), acuse: !!c.acuse, recordatorio: !!c.recordatorio,
      estado: String(c.estado || 'borrador'),
      programadoPara: String(c.programadoPara || ''),
      enviadoEn: c.enviadoEn instanceof Date ? Utilities.formatDate(c.enviadoEn, CONFIG.TZ, 'yyyy-MM-dd HH:mm') : String(c.enviadoEn || ''),
      enviadoPor: String(c.enviadoPor || ''),
      destinatarios: Number(c.destinatarios) || 0,
      enviados: Number(c.enviados) || 0,
      sinDestino: Number(c.sinDestino) || 0,
      errores: Number(c.errores) || 0,
      notas: String(c.notas || '')
    };
  });
  // acuses y estado por canal, de una sola pasada por la hoja de envíos
  var porCom = {};
  _sheetRows(SH_ENVIOS).forEach(function (e) {
    var k = String(e.refId || '');
    if (!porCom[k]) porCom[k] = { acuses: 0, pendientesWA: 0, enviadosWA: 0 };
    if (e.acuse) porCom[k].acuses++;
    if (String(e.canal) === 'whatsapp') {
      if (String(e.estado) === 'pendiente') porCom[k].pendientesWA++;
      if (String(e.estado) === 'enviado') porCom[k].enviadosWA++;
    }
  });
  filas.forEach(function (f) {
    var x = porCom[f.id] || {};
    f.acuses = x.acuses || 0;
    f.waPendientes = x.pendientesWA || 0;
    f.waEnviados = x.enviadosWA || 0;
  });
  filas.sort(function (a, b) { return String(b.creado).localeCompare(String(a.creado)); });

  return {
    comunicados: filas.slice(0, limite),
    total: filas.length,
    tipos: COM_TIPOS.map(function (t) {
      return { id: t.id, grupo: t.grupo, nombre: t.nombre, prioridad: t.prioridad || 'informativo',
               campos: t.campos || [], individual: !!t.individual, acuse: !!t.acuse,
               titulo: t.titulo || '', cuerpo: t.cuerpo || '', accion: t.accion || '' };
    }),
    grupos: COM_GRUPOS,
    residenciales: _comResidenciales(),
    propietarios: getPropietarios(false).map(function (p) {
      return { clave: p.clave, nombre: p.nombre, lote: p.lote, residencial: p.residencial,
               email: p.email, celular: String(p.celular || ''),
               cabanas: Number(p.cabanas) || 0, airbnb: !!p.airbnb };
    }),
    envios: { activos: !!_cfg().enviosActivos, modoPrueba: !!_cfg().modoPrueba, correoPrueba: _cfg().correoPrueba }
  };
}

function _comResidenciales() {
  var m = {};
  getPropietarios(false).forEach(function (p) {
    var r = String(p.residencial || '').trim();
    if (r) m[r] = (m[r] || 0) + 1;
  });
  return Object.keys(m).sort().map(function (r) { return { nombre: r, cuentas: m[r] }; });
}

/** Detalle de un comunicado: a quién se le mandó, por qué canal y quién acusó. */
function getComunicadoDetalle(id) {
  var com = _comLee(id);
  if (!com) throw new Error('El comunicado ya no existe.');
  var props = {};
  getPropietarios(true).forEach(function (p) { props[String(p.clave).toUpperCase()] = p; });
  var envios = _sheetRows(SH_ENVIOS)
    .filter(function (e) { return String(e.refId) === String(id); })
    .map(function (e) {
      var o = {
        id: String(e.id || ''),
        ts: e.ts instanceof Date ? Utilities.formatDate(e.ts, CONFIG.TZ, 'dd/MM/yyyy HH:mm') : String(e.ts || ''),
        clave: String(e.clave || ''), nombre: String(e.nombre || ''),
        canal: String(e.canal || ''), destino: String(e.destino || ''),
        estado: String(e.estado || ''), error: String(e.error || ''),
        acuse: e.acuse instanceof Date ? Utilities.formatDate(e.acuse, CONFIG.TZ, 'dd/MM/yyyy HH:mm') : String(e.acuse || '')
      };
      // Mientras el bot no exista, cada pendiente de WhatsApp se puede mandar a mano
      // desde el panel: el enlace lleva el texto ya armado y el enlace personal.
      if (o.canal === 'whatsapp' && o.destino) {
        var pw = props[o.clave.toUpperCase()];
        var num = o.destino.replace(/[^\d]/g, '');
        if (num.length === 8) num = '507' + num;   // celular panameño sin código de país
        o.waUrl = 'https://wa.me/' + num + '?text=' + encodeURIComponent(_comRender(com, pw).texto);
      }
      return o;
    });
  var muestra = _comDestinatarios(com)[0];
  var r = _comRender(com, muestra);
  return { id: String(id), envios: envios, asunto: r.asunto, html: r.html, texto: r.texto,
           titulo: String(com.titulo || ''), estado: String(com.estado || '') };
}

/* ─────────────────────── cola para el bot de WhatsApp ───────────────────────
 * El bot no necesita saber nada de comunicados: pide lo pendiente de su canal,
 * recibe el texto ya armado y el destino, y avisa qué entregó. El mismo camino
 * servirá para los estados de cuenta y el informe financiero cuando se sumen.
 */
function getEnviosPendientes(canal, limite) {
  canal = String(canal || 'whatsapp');
  limite = Math.min(Math.max(Number(limite) || 50, 1), 200);
  var props = {};
  getPropietarios(true).forEach(function (p) { props[String(p.clave).toUpperCase()] = p; });
  var coms = {};
  var out = [];
  _sheetRows(SH_ENVIOS).forEach(function (e) {
    if (out.length >= limite) return;
    if (String(e.canal) !== canal || String(e.estado) !== 'pendiente') return;
    var refId = String(e.refId || '');
    if (!coms[refId]) coms[refId] = _comLee(refId);
    var com = coms[refId];
    if (!com) return;
    var p = props[String(e.clave).toUpperCase()];
    var r = _comRender(com, p);
    out.push({ envioId: String(e.id || ''), tipo: String(e.tipo || ''), refId: refId,
               clave: String(e.clave || ''), nombre: String(e.nombre || ''),
               destino: String(e.destino || ''), texto: r.texto, url: r.urlVer });
  });
  return { canal: canal, pendientes: out.length, envios: out };
}

/** El bot confirma (o reporta) lo que entregó. */
function marcarEnvio(envioId, estado, error) {
  var sh = _envSheet();
  if (sh.getLastRow() < 2) throw new Error('No hay envíos registrados.');
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iof = {}; h.forEach(function (c, i) { iof[c] = i; });
  estado = (['enviado', 'error', 'sin-destino', 'omitido'].indexOf(String(estado)) >= 0) ? String(estado) : 'enviado';
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iof.id]) !== String(envioId)) continue;
    sh.getRange(r + 1, iof.estado + 1).setValue(estado);
    sh.getRange(r + 1, iof.ts + 1).setValue(new Date());
    if (iof.error !== undefined) sh.getRange(r + 1, iof.error + 1).setValue(String(error || ''));
    return { ok: true, id: envioId, estado: estado };
  }
  throw new Error('No se encontró el envío ' + envioId + '.');
}

/* ─────────────────────── páginas públicas (token personal) ───────────────────────
 * Sin contraseña y sin cuenta de Google: el enlace lleva el token del propietario.
 * Son SÓLO comunicados — nunca cifras de cobranza de la comunidad.
 */

function _comPagina(titulo, inner) {
  var B = AC_BRAND;
  var html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + _comEsc(titulo) + ' — ' + CONFIG.NEGOCIO + '</title></head>' +
    '<body style="margin:0;background:#F3F8FA;font-family:Helvetica,Arial,sans-serif;color:' + B.ink + '">' +
    '<div style="max-width:620px;margin:0 auto;padding:24px 16px 40px">' +
    '<div style="background:#fff;border:1px solid ' + B.border + ';border-radius:14px;padding:22px 22px 26px">' +
    inner + '</div>' +
    '<div style="text-align:center;color:' + B.muted + ';font-size:11.5px;margin-top:14px">' +
    CONFIG.NEGOCIO + ' · "Todo comienza con un sueño"</div></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(titulo + ' — ' + CONFIG.NEGOCIO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function _comPaginaError(msg) {
  return _comPagina('Enlace no válido',
    '<h2 style="margin:0 0 8px;color:' + AC_BRAND.teal700 + '">Enlace no válido</h2>' +
    '<p style="color:' + AC_BRAND.muted + ';line-height:1.6">' + _comEsc(msg) + '</p>');
}

/** «Ver en el navegador» — el comunicado tal cual, con el enlace personal. */
function verComunicadoWeb(id, token) {
  var p = _acPropDeToken(token);
  if (!p) return _comPaginaError('El enlace no corresponde a ningún propietario. Solicite uno nuevo a la administración.');
  var com = _comLee(id);
  if (!com) return _comPaginaError('Este comunicado ya no está disponible.');
  var r = _comRender(com, p);
  return _comPagina(String(com.titulo || 'Comunicado'), r.html);
}

/** Archivo personal: todos los comunicados que le llegaron a ese propietario. */
function misComunicadosWeb(token) {
  var p = _acPropDeToken(token);
  if (!p) return _comPaginaError('El enlace no corresponde a ningún propietario. Solicite uno nuevo a la administración.');
  var B = AC_BRAND;
  var mios = {};
  _sheetRows(SH_ENVIOS).forEach(function (e) {
    if (String(e.clave).toUpperCase() !== String(p.clave).toUpperCase()) return;
    var k = String(e.refId || '');
    if (!mios[k] || (e.acuse && !mios[k].acuse)) mios[k] = { acuse: e.acuse };
  });
  var filas = _sheetRows(SH_COM)
    .filter(function (c) { return String(c.estado) === 'enviado' && mios[String(c.id)]; })
    .sort(function (a, b) { return new Date(b.enviadoEn) - new Date(a.enviadoEn); });

  var lista = filas.length ? filas.map(function (c) {
    var t = _comTipo(c.tipo);
    var pri = COM_PRIORIDADES[c.prioridad] || COM_PRIORIDADES.informativo;
    var url = _comLink('verComunicado', { id: c.id, t: _acTokenDe(p.clave) });
    var ac = mios[String(c.id)].acuse;
    return '<a href="' + url + '" style="display:block;text-decoration:none;color:inherit;border:1px solid ' + B.border +
      ';border-radius:10px;padding:12px 14px;margin-bottom:9px">' +
      '<div style="font-size:11px;color:' + B.muted + ';text-transform:uppercase;letter-spacing:.05em">' +
        _comEsc(t.nombre) + ' · ' + (c.enviadoEn ? _fmtFecha(c.enviadoEn) : '') +
        (pri.etiqueta ? ' · <span style="color:' + pri.color + ';font-weight:700">' + pri.etiqueta + '</span>' : '') +
        (ac ? ' · <span style="color:' + B.ok + '">recibido ✓</span>' : '') + '</div>' +
      '<div style="font-weight:700;color:' + B.teal700 + ';margin-top:3px">' + _comEsc(c.titulo) + '</div></a>';
  }).join('') : '<p style="color:' + B.muted + '">Todavía no hay comunicados en su archivo.</p>';

  return _comPagina('Mis comunicados',
    '<div style="font-size:11px;color:' + B.muted + ';text-transform:uppercase;letter-spacing:.06em">Archivo de comunicados</div>' +
    '<h2 style="margin:4px 0 2px;color:' + B.teal700 + '">' + _comEsc(p.nombre) + '</h2>' +
    '<div style="color:' + B.muted + ';font-size:13px;margin-bottom:16px">' + _comEsc(p.residencial) + ' · Lote ' + _comEsc(p.lote) + '</div>' +
    lista);
}

/** Acuse de recibo: un clic, con constancia de la fecha. */
function acuseComunicadoWeb(id, token) {
  var p = _acPropDeToken(token);
  if (!p) return _comPaginaError('El enlace no corresponde a ningún propietario.');
  var com = _comLee(id);
  if (!com) return _comPaginaError('Este comunicado ya no está disponible.');
  var B = AC_BRAND;
  var sh = _envSheet(), vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iof = {}; h.forEach(function (c, i) { iof[c] = i; });
  var marcado = false, yaEstaba = '';
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iof.refId]) !== String(id)) continue;
    if (String(vals[r][iof.clave]).toUpperCase() !== String(p.clave).toUpperCase()) continue;
    if (vals[r][iof.acuse]) { yaEstaba = _fmtFecha(vals[r][iof.acuse]); marcado = true; break; }
    sh.getRange(r + 1, iof.acuse + 1).setValue(new Date());
    marcado = true;
    break;
  }
  // Llegó por un canal que no dejó renglón (reenvío manual): se anota igual.
  if (!marcado) {
    _envAppend([{ id: 'A' + new Date().getTime(), ts: new Date(), tipo: 'comunicado', refId: String(id),
      clave: p.clave, nombre: p.nombre, canal: 'acuse', destino: '', estado: 'enviado',
      error: '', acuse: new Date(), autor: 'Propietario' }]);
  }
  return _comPagina('Recibido',
    '<div style="text-align:center;padding:10px 0">' +
    '<div style="font-size:44px">✅</div>' +
    '<h2 style="margin:8px 0 6px;color:' + B.teal700 + '">Gracias, quedó registrado</h2>' +
    '<p style="color:' + B.muted + ';line-height:1.6">Confirmamos que usted recibió el comunicado ' +
    '<b>«' + _comEsc(com.titulo) + '»</b>' + (yaEstaba ? ' — ya lo había confirmado el ' + yaEstaba : '') + '.</p>' +
    '<a href="' + _comLink('misComunicados', { t: token }) + '" style="display:inline-block;margin-top:12px;padding:10px 20px;background:' +
    B.teal + ';color:#fff;text-decoration:none;border-radius:9px;font-weight:700">Ver todos mis comunicados</a></div>');
}
