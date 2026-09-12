/**
 * Plantillas de WhatsApp — el texto, la validación y la subida a Meta.
 *
 * ── Por qué hacen falta ──────────────────────────────────────────────────────
 * Un texto libre por WhatsApp sólo se puede mandar dentro de las 24 horas siguientes
 * al último mensaje del propietario. Como el sistema escribe primero —el estado de
 * cuenta del día 5, un recordatorio, un comunicado—, esa ventana casi nunca está
 * abierta. Fuera de ella, lo único que Meta entrega es una PLANTILLA aprobada.
 *
 * Aprobar tarda: de unos minutos a varios días. Por eso esto se manda a revisión
 * antes de escribir el código que las usa, y no al revés.
 *
 * ── El texto vive aquí, no en Meta ───────────────────────────────────────────
 * Lo que se sube es exactamente lo que dice este archivo. Si hay que corregir una
 * coma, se corrige aquí, se sube otra vez con otro nombre y se retira la vieja: una
 * plantilla aprobada NO se puede editar sin volver a pasar por revisión.
 *
 * ── Reglas de Meta que este archivo respeta ──────────────────────────────────
 *   · Una variable no puede ir al principio ni al final del cuerpo.
 *   · Dos variables no pueden ir pegadas.
 *   · Se numeran {{1}}, {{2}}… sin saltos, y cada una necesita un ejemplo.
 *   · Cuerpo ≤ 1024 caracteres; encabezado y pie ≤ 60.
 * `validarPlantillas()` comprueba todo eso ANTES de gastar una petición a Meta,
 * porque Meta las rechaza sin decir cuál de las reglas se rompió.
 *
 * Propiedades del script que usa:
 *   META_WABA_ID  — la cuenta de WhatsApp Business (obligatoria aquí).
 *   META_APP_ID   — sólo para el ejemplo del PDF del estado de cuenta.
 */

var WA_PROP_APP = 'META_APP_ID';

/**
 * El pie va vacío, y es a propósito.
 *
 * Meta no admite variables en el pie, y las plantillas se aprueban una vez para TODA la
 * cuenta de WhatsApp Business, que es compartida por todas las comunidades. Es decir:
 * cualquier cosa escrita aquí la leen los propietarios de todos los PH. El nombre de una
 * comunidad concreta no puede ir.
 *
 * Y tampoco hace falta. Cada comunidad tiene su propio número, y el nombre visible es de
 * cada número, no de la cuenta: el propietario ve el nombre de SU administración en la
 * lista de chats antes de abrir el mensaje.
 *
 * Queda la tentación de firmar el producto — «Enviado con BalanceClip Lobby»—. No se
 * hace: es texto promocional dentro de una plantilla UTILITY, y Meta ya reclasificó
 * comunicado_aviso a MARKETING por su cuenta. Una plantilla MARKETING exige
 * consentimiento explícito y el propietario puede silenciarla; que eso le pase al estado
 * de cuenta, que es la columna vertebral del producto, no compensa una firma.
 */
var WA_PIE = '';

/**
 * Las cinco plantillas, en forma genérica.
 *
 * Ninguna nombra a una comunidad ni dice «lote»: el nombre del PH entra por variable y
 * la palabra de la unidad la compone quien llama, con _acUnidadDe(). Una sola aprobación
 * sirve para las veinte comunidades que caben en la cuenta.
 *
 * Todas se mandan como UTILITY: son avisos sobre la cuenta de una persona concreta,
 * no publicidad. Meta reclasifica por su cuenta si no está de acuerdo; el comunicado
 * es el que más riesgo tiene de acabar en MARKETING, y aun así funciona.
 */
function _waPlantillas() {
  return [
    {
      nombre: 'lobby_estado_cuenta',
      categoria: 'UTILITY',
      idioma: 'es',
      para: 'El envío del día 5. El PDF va en el encabezado, que es la única forma de ' +
            'adjuntarlo fuera de la ventana de 24 horas.',
      encabezado: { tipo: 'DOCUMENT' },
      cuerpo:
        'Hola {{1}}, le compartimos el estado de cuenta de {{2}} correspondiente al ' +
        '{{3}}, al cierre de {{4}}.\n' +
        '\n' +
        'Saldo pendiente a la fecha: B/. {{5}}\n' +
        '\n' +
        'El detalle mes por mes está en el documento adjunto. Si realizó un pago en los ' +
        'últimos días, es posible que todavía no aparezca registrado.\n' +
        '\n' +
        'Este mismo estado de cuenta le llegó también por correo. Si necesita aclarar algo, ' +
        'responda a este mensaje.',
      ejemplos: ['Ana Rosa Tejada', 'Aires de Chicá', 'lote Q-9', 'agosto de 2026', '245.00'],
      pie: WA_PIE
    },
    {
      nombre: 'lobby_recordatorio_saldo',
      categoria: 'UTILITY',
      idioma: 'es',
      para: 'Recordatorio de cuota pendiente. La cuenta de cobro va en variable a ' +
            'propósito: si la comunidad cambia de banco, la plantilla sigue sirviendo.',
      encabezado: null,
      // {{6}} repite el valor de {{3}}. Meta prohíbe reutilizar el mismo número dos
      // veces, y «indicando su número de unidad» no sirve: cada comunidad llama a la
      // suya de otra forma. Sale más barato pasar el dato dos veces que inventar un
      // rodeo que se lea mal en todas.
      cuerpo:
        'Hola {{1}}, le recordamos que en {{2}} el {{3}} mantiene un saldo pendiente de ' +
        'B/. {{4}} en su cuota de mantenimiento.\n' +
        '\n' +
        'Puede pagar por transferencia a {{5}}, indicando {{6}} en la descripción.\n' +
        '\n' +
        'Si ya realizó el pago, puede enviarnos el comprobante por este mismo medio.',
      ejemplos: ['Ana Rosa Tejada', 'Aires de Chicá', 'lote Q-9', '245.00',
                 'Global Bank, cuenta de ahorros N.º 12-345-6789 a nombre de la Asociación',
                 'lote Q-9'],
      pie: WA_PIE
    },
    {
      nombre: 'lobby_pago_registrado',
      categoria: 'UTILITY',
      idioma: 'es',
      para: 'Confirmación de que un pago quedó acreditado. Es la que más tranquiliza: ' +
            'hoy el propietario transfiere y no sabe si llegó.',
      encabezado: null,
      cuerpo:
        'Hola {{1}}, la administración de {{2}} registró su pago de B/. {{3}} para el ' +
        '{{4}} con fecha {{5}}.\n' +
        '\n' +
        'Su saldo pendiente queda en B/. {{6}}\n' +
        '\n' +
        'Gracias. Si algo no coincide con lo que usted pagó, respóndanos a este mensaje y ' +
        'lo revisamos.',
      ejemplos: ['Ana Rosa Tejada', 'Aires de Chicá', '245.00', 'lote Q-9',
                 '5 de septiembre de 2026', '0.00'],
      pie: WA_PIE
    },
    {
      nombre: 'lobby_comunicado',
      categoria: 'UTILITY',
      idioma: 'es',
      para: 'Comunicados de la administración. El enlace es el personal de cada ' +
            'propietario, el mismo que ya usa el correo, para que el acuse de lectura ' +
            'siga funcionando.',
      encabezado: { tipo: 'TEXT', texto: 'Comunicado de la administración' },
      cuerpo:
        'Hola {{1}}, la administración de {{2}} publicó un comunicado: {{3}}.\n' +
        '\n' +
        '{{4}}\n' +
        '\n' +
        'Puede leerlo completo aquí: {{5}}\n' +
        '\n' +
        'También se lo enviamos a su correo electrónico.',
      ejemplos: ['Ana Rosa Tejada', 'Aires de Chicá',
                 'Corte de agua programado para el jueves',
                 'El IDAAN informó que habrá suspensión del servicio el jueves 18 de 8:00 a. m. ' +
                 'a 2:00 p. m. Recomendamos almacenar agua la noche anterior.',
                 'https://admin.airesdechica.org/c/ejemplo'],
      pie: WA_PIE
    },
    {
      nombre: 'lobby_consulta_pendiente',
      categoria: 'UTILITY',
      idioma: 'es',
      para: 'NO va a propietarios: avisa a la administración de una consulta que el ' +
            'sistema no contesta. Hace falta como plantilla porque la ventana de 24 ' +
            'horas también corre para el celular de quien administra.',
      encabezado: null,
      cuerpo:
        'Consulta pendiente en el WhatsApp de {{1}}.\n' +
        '\n' +
        '{{2}} · {{3}}\n' +
        'Escribió: {{4}}\n' +
        '\n' +
        'Para contestarle directamente: {{5}}\n' +
        '\n' +
        'La consulta quedó anotada en la hoja WhatsApp del sistema.',
      ejemplos: ['Aires de Chicá', 'Lote Q-9', 'Ana Rosa Tejada',
                 '¿Cuánto debo de este mes?', 'https://wa.me/50761112233'],
      pie: WA_PIE
    },
    {
      nombre: 'lobby_autorizacion_visita',
      categoria: 'UTILITY',
      idioma: 'es',
      para: 'Módulo de acceso. La garita tiene un visitante delante y el propietario ' +
            'decide desde donde esté. Se manda a revisión antes de escribir el módulo: ' +
            'aprobar tarda días y no tiene sentido descubrirlo al final.',
      encabezado: null,
      // La cédula NO va aquí. La garita la registra, que para eso la pide; mandársela
      // al propietario es repartir el documento de identidad de un tercero a alguien
      // que no la necesita para decidir. El nombre y a dónde dice que va bastan.
      cuerpo:
        'Hola {{1}}, hay una visita en la entrada de {{2}}.\n' +
        '\n' +
        'Se identifica como {{3}} y dice que va al {{4}}.\n' +
        '\n' +
        'Si no responde en {{5}} minutos, la garita no la deja pasar.',
      ejemplos: ['Ana Rosa Tejada', 'Aires de Chicá', 'Luis Mendoza', 'lote Q-9', '2'],
      // El «no» va primero a propósito. En una lista vertical el primer botón es el que
      // se toca sin leer, y equivocarse hacia «no autorizo» cuesta una llamada;
      // equivocarse hacia «autorizo» mete a un desconocido en la comunidad.
      botones: [
        { id: 'acceso_no', texto: 'No autorizo' },
        { id: 'acceso_si', texto: 'Autorizo' }
      ],
      pie: WA_PIE
    }
  ];
}

/* ─────────────── validación local, antes de gastar una petición ─────────────── */

/**
 * Comprueba una plantilla contra las reglas de Meta. Devuelve la lista de problemas;
 * vacía significa que se puede subir.
 *
 * Merece la pena hacerlo aquí porque el rechazo de Meta llega como «INVALID_FORMAT»
 * sin decir qué regla se rompió, y cada intento fallido es una plantilla quemada: el
 * nombre queda ocupado y hay que inventar otro.
 */
function _waValidarPlantilla(def) {
  var males = [];
  var n = String(def.nombre || '');
  if (!/^[a-z0-9_]{1,512}$/.test(n)) {
    males.push('el nombre sólo admite minúsculas, números y guion bajo: «' + n + '»');
  }
  var cuerpo = String(def.cuerpo || '');
  if (!cuerpo) males.push('sin cuerpo');
  if (cuerpo.length > 1024) males.push('cuerpo de ' + cuerpo.length + ' caracteres (máximo 1024)');
  if (def.pie && String(def.pie).length > 60) males.push('pie de más de 60 caracteres');
  if (def.encabezado && def.encabezado.tipo === 'TEXT') {
    var h = String(def.encabezado.texto || '');
    if (!h) males.push('encabezado de texto vacío');
    if (h.length > 60) males.push('encabezado de más de 60 caracteres');
    if (/\{\{\d+\}\}/.test(h)) males.push('el encabezado lleva variables; aquí no se usan');
  }

  var vars = cuerpo.match(/\{\{\s*\d+\s*\}\}/g) || [];
  var nums = vars.map(function (v) { return Number(v.replace(/\D/g, '')); });
  for (var i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      males.push('las variables deben ir 1,2,3… sin saltos ni repeticiones (encontrado {{' +
                 nums[i] + '}} en la posición ' + (i + 1) + ')');
      break;
    }
  }
  var limpio = cuerpo.trim();
  if (/^\{\{\d+\}\}/.test(limpio)) males.push('el cuerpo empieza por una variable, y Meta lo rechaza');
  if (/\{\{\d+\}\}$/.test(limpio)) males.push('el cuerpo termina en una variable, y Meta lo rechaza');
  if (/\}\}\s*\{\{/.test(cuerpo)) males.push('hay dos variables pegadas, y Meta lo rechaza');

  var ej = def.ejemplos || [];
  if (ej.length !== nums.length) {
    males.push('hay ' + nums.length + ' variables y ' + ej.length + ' ejemplos: tiene que haber uno por variable');
  }
  ej.forEach(function (e, k) {
    if (!String(e || '').trim()) males.push('el ejemplo de {{' + (k + 1) + '}} está vacío');
  });

  // Botones de respuesta rápida. Meta admite hasta diez, pero en el teléfono sólo se
  // ven tres sin desplegar: una autorización que exige desplegar para decir que no es
  // una autorización que se contesta que sí por comodidad.
  var bot = def.botones || [];
  if (bot.length) {
    if (bot.length > 3) males.push('hay ' + bot.length + ' botones; más de tres no caben en pantalla');
    bot.forEach(function (b, k) {
      var t = String(b && b.texto || '');
      if (!t.trim()) males.push('el botón ' + (k + 1) + ' no tiene texto');
      if (t.length > 25) males.push('el botón «' + t + '» pasa de 25 caracteres');
      if (/\{\{\d+\}\}/.test(t)) males.push('el botón «' + t + '» lleva variables; aquí no se usan');
    });
  }
  return males;
}

/** Revisa todas sin tocar Meta. Ejecútala antes que nada. */
function validarPlantillas() {
  var defs = _waPlantillas(), mal = 0;
  console.log('════ PLANTILLAS ════');
  defs.forEach(function (d) {
    var males = _waValidarPlantilla(d);
    if (!males.length) {
      console.log('✓ %s (%s, %s variables)', d.nombre, d.categoria, (d.ejemplos || []).length);
    } else {
      mal++;
      console.log('✗ %s', d.nombre);
      males.forEach(function (m) { console.log('    · %s', m); });
    }
  });
  console.log(mal ? '\n%s plantilla(s) con problemas: no se suben así.'
                  : '\nLas %s están listas para subir.', mal || defs.length);
  return { ok: !mal, total: defs.length, conProblemas: mal };
}

/* ─────────────── el ejemplo del documento ─────────────── */

/**
 * Meta exige un archivo de muestra para toda plantilla con encabezado de documento, y
 * ese archivo lo ve un revisor. Se le manda un PDF INVENTADO, no el estado de cuenta
 * de un propietario real: los saldos de la comunidad no tienen por qué salir de aquí.
 */
function _waPdfDeMuestra() {
  var html =
    '<div style="font-family:Georgia,serif;padding:36px;color:#152a30">' +
    '<div style="border-bottom:3px solid #0E8FB0;padding-bottom:12px;margin-bottom:18px">' +
    '<div style="font-size:11px;letter-spacing:2px;color:#0E8FB0">EJEMPLO · DATOS FICTICIOS</div>' +
    '<h1 style="font-size:22px;margin:6px 0 0">Estado de cuenta de mantenimiento</h1>' +
    '<div style="font-size:12px;color:#5B7883">Unidad Q-9 · al cierre de agosto de 2026</div></div>' +
    '<table style="width:100%;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:13px">' +
    '<tr><th style="text-align:left;padding:8px;border-bottom:2px solid #D3E6EC">Mes</th>' +
    '<th style="text-align:right;padding:8px;border-bottom:2px solid #D3E6EC">Cuota</th>' +
    '<th style="text-align:right;padding:8px;border-bottom:2px solid #D3E6EC">Pagado</th>' +
    '<th style="text-align:right;padding:8px;border-bottom:2px solid #D3E6EC">Saldo</th></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #D3E6EC">Junio 2026</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">45.00</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">45.00</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">0.00</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #D3E6EC">Julio 2026</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">45.00</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">0.00</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">45.00</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #D3E6EC">Agosto 2026</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">45.00</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">0.00</td>' +
    '<td style="text-align:right;padding:8px;border-bottom:1px solid #D3E6EC">45.00</td></tr>' +
    '</table>' +
    '<div style="margin-top:18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#086176">' +
    'Saldo pendiente: B/. 90.00</div>' +
    '<div style="margin-top:28px;font-size:11px;color:#5B7883">Documento de muestra para la revisión ' +
    'de la plantilla. No corresponde a ninguna persona ni a ninguna unidad real.</div></div>';
  return HtmlService.createHtmlOutput(html).getAs('application/pdf')
    .setName('EstadoCuenta_Ejemplo.pdf');
}

/**
 * Sube el PDF de muestra y devuelve el «handle» que Meta pide como ejemplo.
 *
 * Va por la API de subida reanudable, que son dos llamadas: una abre la sesión y otra
 * manda los bytes. El token viaja siempre en la cabecera, nunca en la URL: una
 * excepción de UrlFetchApp imprime la URL entera en el registro.
 */
function _waHandleDeMuestra() {
  var app = String(_waProps().getProperty(WA_PROP_APP) || '').trim();
  var tok = _waToken();
  if (!app) return { ok: false, error: 'falta META_APP_ID en las propiedades del script' };
  if (!tok) return { ok: false, error: 'falta META_WHATSAPP_TOKEN' };
  var blob = _waPdfDeMuestra();
  var bytes = blob.getBytes();
  try {
    var r1 = UrlFetchApp.fetch(WA_GRAPH + '/' + app + '/uploads' +
      '?file_length=' + bytes.length + '&file_type=application%2Fpdf&file_name=ejemplo.pdf',
      { method: 'post', headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    var j1 = {}; try { j1 = JSON.parse(r1.getContentText()); } catch (e) {}
    if (r1.getResponseCode() !== 200 || !j1.id) {
      return { ok: false, error: 'no se pudo abrir la sesión de subida: ' +
        ((j1.error && j1.error.message) || r1.getContentText().slice(0, 200)) };
    }
    var r2 = UrlFetchApp.fetch(WA_GRAPH + '/' + j1.id, {
      method: 'post',
      headers: { Authorization: 'OAuth ' + tok, file_offset: '0' },
      contentType: 'application/pdf',
      payload: bytes,
      muteHttpExceptions: true
    });
    var j2 = {}; try { j2 = JSON.parse(r2.getContentText()); } catch (e) {}
    if (r2.getResponseCode() !== 200 || !j2.h) {
      return { ok: false, error: 'no se pudieron subir los bytes: ' +
        ((j2.error && j2.error.message) || r2.getContentText().slice(0, 200)) };
    }
    return { ok: true, handle: j2.h };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ─────────────── subida ─────────────── */

/** Traduce una definición de este archivo a la forma que espera Meta. */
function _waPlantillaPayload(def, handle) {
  var comps = [];
  if (def.encabezado && def.encabezado.tipo === 'TEXT') {
    comps.push({ type: 'HEADER', format: 'TEXT', text: def.encabezado.texto });
  } else if (def.encabezado && def.encabezado.tipo === 'DOCUMENT') {
    comps.push({ type: 'HEADER', format: 'DOCUMENT',
                 example: { header_handle: [handle] } });
  }
  comps.push({ type: 'BODY', text: def.cuerpo,
               example: { body_text: [def.ejemplos || []] } });
  if (def.pie) comps.push({ type: 'FOOTER', text: def.pie });
  if ((def.botones || []).length) {
    comps.push({ type: 'BUTTONS', buttons: def.botones.map(function (b) {
      return { type: 'QUICK_REPLY', text: b.texto };
    }) });
  }
  return { name: def.nombre, language: def.idioma || 'es',
           category: def.categoria || 'UTILITY', components: comps };
}

/**
 * Manda las plantillas a revisión. No envía ningún mensaje a nadie: crear una
 * plantilla y usarla son cosas distintas, y esto es sólo lo primero.
 *
 * Salta las que ya existen en la cuenta —el nombre es único y reintentar da un error
 * confuso— y valida antes de cada envío.
 */
function subirPlantillas() {
  var waba = String(_waProps().getProperty(WA_PROP_WABA) || '').trim();
  var tok = _waToken();
  if (!waba) { console.log('Falta META_WABA_ID en las propiedades del script.'); return { ok: false }; }
  if (!tok) { console.log('Falta META_WHATSAPP_TOKEN.'); return { ok: false }; }

  var v = validarPlantillas();
  if (!v.ok) { console.log('\nNo se sube nada hasta que estén todas bien.'); return { ok: false }; }

  var ya = {};
  var actuales = _waListarPlantillas();
  if (actuales.ok) actuales.lista.forEach(function (p) { ya[p.name] = p.status; });

  var defs = _waPlantillas(), handle = null, res = [];
  console.log('\n════ SUBIENDO ════');
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    if (ya[d.nombre]) {
      console.log('— %s: ya existe (%s), no se toca.', d.nombre, ya[d.nombre]);
      res.push({ nombre: d.nombre, saltada: true, estado: ya[d.nombre] });
      continue;
    }
    if (d.encabezado && d.encabezado.tipo === 'DOCUMENT' && !handle) {
      var h = _waHandleDeMuestra();
      if (!h.ok) {
        console.log('✗ %s: Meta pide un PDF de ejemplo y no se pudo subir — %s', d.nombre, h.error);
        console.log('  Las demás siguen; ésta se puede reintentar después.');
        res.push({ nombre: d.nombre, ok: false, error: h.error });
        continue;
      }
      handle = h.handle;
    }
    var r = _waCrearPlantilla(waba, tok, _waPlantillaPayload(d, handle));
    if (r.ok) {
      console.log('✓ %s — %s', d.nombre, r.estado || 'enviada a revisión');
    } else {
      console.log('✗ %s — %s', d.nombre, r.error);
    }
    res.push(r);
    Utilities.sleep(500);
  }
  console.log('\nMeta revisa cada una por su cuenta: de minutos a varios días.');
  console.log('Ejecuta verPlantillas() para ver en qué estado están.');
  return { ok: true, resultados: res };
}

function _waCrearPlantilla(waba, tok, payload) {
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + waba + '/message_templates', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + tok },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      return { ok: false, nombre: payload.name,
        error: (j.error && (j.error.error_user_msg || j.error.message)) ||
               r.getContentText().slice(0, 300) };
    }
    return { ok: true, nombre: payload.name, id: j.id, estado: j.status, categoria: j.category };
  } catch (e) {
    return { ok: false, nombre: payload.name, error: String(e && e.message || e) };
  }
}

function _waListarPlantillas() {
  var waba = String(_waProps().getProperty(WA_PROP_WABA) || '').trim();
  var tok = _waToken();
  if (!waba || !tok) return { ok: false, error: 'faltan META_WABA_ID o META_WHATSAPP_TOKEN', lista: [] };
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + waba + '/message_templates' +
      '?fields=name,language,status,category,rejected_reason&limit=100',
      { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      return { ok: false, error: (j.error && j.error.message) || r.getContentText().slice(0, 200), lista: [] };
    }
    return { ok: true, lista: j.data || [] };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), lista: [] };
  }
}

/* ─────────────── retirar las plantillas de antes del producto ─────────────── */

/**
 * Las cinco primeras plantillas nombraban a Aires de Chicá en el pie y hablaban de
 * «lotes». Sirvieron mientras había una sola comunidad; en la cuenta compartida del
 * producto son un estorbo.
 */
var WA_PLANTILLAS_VIEJAS = {
  'estado_cuenta_mensual': 'lobby_estado_cuenta',
  'recordatorio_saldo':    'lobby_recordatorio_saldo',
  'pago_registrado':       'lobby_pago_registrado',
  'comunicado_aviso':      'lobby_comunicado',
  'consulta_pendiente':    'lobby_consulta_pendiente'
};

/**
 * Borra de Meta las plantillas viejas, UNA VEZ que su reemplazo está aprobado.
 *
 * Borrar una plantilla es irreversible y deja de poder enviarse en el acto. Por eso
 * esto no borra nada por su cuenta: sin argumento sólo dice qué haría, y no toca una
 * vieja mientras su reemplazo no esté APPROVED. Hacerlo al revés dejaría a la
 * comunidad sin poder mandar el estado de cuenta del día 5 hasta que Meta aprobara,
 * que puede tardar días.
 */
function retirarPlantillasViejas(confirmar) {
  var r = _waListarPlantillas();
  if (!r.ok) { console.log('✗ %s', r.error); return { ok: false }; }

  var estado = {};
  r.lista.forEach(function (p) { estado[p.name] = p.status; });

  var listas = [], esperando = [], noEstan = [];
  Object.keys(WA_PLANTILLAS_VIEJAS).forEach(function (vieja) {
    var nueva = WA_PLANTILLAS_VIEJAS[vieja];
    if (!estado[vieja]) { noEstan.push(vieja); return; }
    if (estado[nueva] === 'APPROVED') listas.push({ vieja: vieja, nueva: nueva });
    else esperando.push({ vieja: vieja, nueva: nueva, estado: estado[nueva] || 'sin subir' });
  });

  console.log('════ PLANTILLAS VIEJAS ════');
  noEstan.forEach(function (v) { console.log('· %s — ya no está en Meta', v); });
  esperando.forEach(function (x) {
    console.log('⏳ %s — se queda: su reemplazo %s está en «%s»', x.vieja, x.nueva, x.estado);
  });
  listas.forEach(function (x) { console.log('%s %s — reemplazada por %s',
    confirmar === true ? '→' : '·', x.vieja, x.nueva); });

  if (!listas.length) {
    console.log('\nNo hay ninguna que se pueda retirar todavía.');
    return { ok: true, retiradas: 0, esperando: esperando.length };
  }
  if (confirmar !== true) {
    console.log('\nSe pueden retirar %s. Borrarlas es irreversible.', listas.length);
    console.log('Si estás de acuerdo: retirarPlantillasViejas(true)');
    return { ok: true, retiradas: 0, seRetirarian: listas.length };
  }

  var waba = String(_waProps().getProperty(WA_PROP_WABA) || '').trim();
  var tok = _waToken();
  var hechas = 0;
  console.log('');
  listas.forEach(function (x) {
    var res = _waBorrarPlantilla(waba, tok, x.vieja);
    console.log(res.ok ? '✓ retirada %s' : '✗ %s — %s', x.vieja, res.error || '');
    if (res.ok) hechas++;
    Utilities.sleep(400);
  });
  console.log('\n%s retirada(s).', hechas);
  return { ok: true, retiradas: hechas, esperando: esperando.length };
}

function _waBorrarPlantilla(waba, tok, nombre) {
  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + waba + '/message_templates?name=' +
      encodeURIComponent(nombre), {
        method: 'delete', headers: { Authorization: 'Bearer ' + tok },
        muteHttpExceptions: true });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      return { ok: false, error: (j.error && (j.error.error_user_msg || j.error.message)) ||
                                 r.getContentText().slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** En qué estado está cada plantilla. APPROVED es la única que sirve para enviar. */
function verPlantillas() {
  var r = _waListarPlantillas();
  if (!r.ok) { console.log('✗ %s', r.error); return r; }
  if (!r.lista.length) {
    console.log('No hay ninguna plantilla creada todavía. Ejecuta subirPlantillas().');
    return r;
  }
  console.log('════ PLANTILLAS EN META ════');
  r.lista.forEach(function (p) {
    console.log('%s  %s · %s · %s%s',
      p.status === 'APPROVED' ? '✓' : (p.status === 'REJECTED' ? '✗' : '⏳'),
      p.name, p.language, p.status,
      p.category ? ' · ' + p.category : '');
    if (p.rejected_reason && p.rejected_reason !== 'NONE') {
      console.log('    motivo del rechazo: %s', p.rejected_reason);
    }
  });
  var listas = r.lista.filter(function (p) { return p.status === 'APPROVED'; }).length;
  console.log('\n%s de %s aprobadas.', listas, r.lista.length);
  return r;
}

/* ─────────────── envío por plantilla ─────────────── */

/**
 * Manda una plantilla aprobada. Es lo único que Meta entrega fuera de la ventana de 24
 * horas, y por eso todo envío que empieza el sistema —el del día 5, un recordatorio, un
 * aviso a la administración— pasa por aquí.
 *
 * Los parámetros van EN ORDEN: el primero es {{1}}. Si sobran o faltan, Meta responde
 * 132000 y no dice cuántos esperaba, así que se comprueba antes contra la definición.
 *
 * opts.documentoId — id de un archivo ya subido a Meta, para las plantillas cuyo
 * encabezado es un documento. No admite enlaces: el estado de cuenta no sale a ninguna
 * URL pública.
 */
function enviarPlantillaWhatsApp(telefono, plantilla, params, opts) {
  opts = opts || {};
  // El editor de Apps Script deja ejecutar cualquier función del proyecto, y ésta sin
  // argumentos devolvía un error que nadie veía: el registro quedaba en «started /
  // completed» y parecía que había funcionado.
  if (!telefono || !plantilla) {
    console.log('Esta función manda UNA plantilla ya aprobada y necesita a quién y cuál.');
    console.log('  enviarPlantillaWhatsApp("6981-2266", "lobby_recordatorio_saldo", [...])');
    console.log('');
    console.log('Si lo que quieres es mandarlas a revisión, elige «subirPlantillas» en el');
    console.log('desplegable de arriba. Para verlas antes, «verTextoPlantillas».');
    return { ok: false, error: 'Faltan el número o el nombre de la plantilla.' };
  }
  var token = _waToken(), phoneId = _waPhoneId();
  if (!token || !phoneId) return { ok: false, error: 'Faltan META_WHATSAPP_TOKEN o META_PHONE_ID.' };

  var def = null;
  _waPlantillas().forEach(function (d) { if (d.nombre === plantilla) def = d; });
  if (!def) return { ok: false, error: 'No existe la plantilla «' + plantilla + '» en el sistema.' };
  params = params || [];
  var esperados = (def.ejemplos || []).length;
  if (params.length !== esperados) {
    return { ok: false, error: 'La plantilla «' + plantilla + '» lleva ' + esperados +
             ' valores y se le pasaron ' + params.length + '.' };
  }
  if (def.encabezado && def.encabezado.tipo === 'DOCUMENT' && !opts.documentoId) {
    return { ok: false, error: 'La plantilla «' + plantilla + '» lleva un documento y no se le pasó ninguno.' };
  }

  var n = normalizarCelular(telefono);
  if (!n.ok) return { ok: false, error: 'Número no utilizable: ' + n.por };

  var comps = [];
  if (def.encabezado && def.encabezado.tipo === 'DOCUMENT') {
    comps.push({ type: 'header', parameters: [{ type: 'document',
      document: { id: String(opts.documentoId), filename: opts.nombreArchivo || 'documento.pdf' } }] });
  }
  comps.push({ type: 'body', parameters: params.map(function (v) {
    // Meta rechaza saltos de línea y tabulaciones dentro de un parámetro.
    return { type: 'text', text: String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ') };
  }) });

  // Cada botón de respuesta rápida lleva su propio identificador. Sin esto, lo que
  // vuelve en el webhook es el TEXTO del botón, y decidir si alguien entra comparando
  // cadenas en español —tildes, mayúsculas, un cambio de redacción— es frágil de más
  // para lo que se está decidiendo.
  (def.botones || []).forEach(function (b, i) {
    comps.push({ type: 'button', sub_type: 'quick_reply', index: String(i),
                 parameters: [{ type: 'payload', payload: String(b.id) }] });
  });

  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ messaging_product: 'whatsapp', to: n.e164.replace('+', ''),
        type: 'template',
        template: { name: plantilla, language: { code: def.idioma || 'es' }, components: comps } }),
      muteHttpExceptions: true
    });
    var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() !== 200) {
      var err = (j.error && (j.error.error_user_msg || j.error.message)) || r.getContentText().slice(0, 200);
      _waAnotar({ direccion: 'sale', telefono: n.e164, tipo: 'template',
                  texto: plantilla, estado: 'error', nota: err });
      return { ok: false, error: err, codigo: (j.error && j.error.code) || r.getResponseCode() };
    }
    var mid = (j.messages && j.messages[0] && j.messages[0].id) || '';
    _waAnotar({ id: mid, direccion: 'sale', telefono: n.e164, tipo: 'template',
                texto: plantilla, estado: 'enviado', nota: opts.nota || '' });
    return { ok: true, id: mid };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/** Muestra en el registro cómo se verá cada plantilla, con los ejemplos puestos. */
function verTextoPlantillas() {
  _waPlantillas().forEach(function (d) {
    var t = d.cuerpo;
    (d.ejemplos || []).forEach(function (e, i) {
      t = t.replace(new RegExp('\\{\\{' + (i + 1) + '\\}\\}', 'g'), e);
    });
    console.log('════ %s ════', d.nombre);
    console.log('(%s · %s)', d.categoria, d.para);
    if (d.encabezado) {
      console.log('[%s]', d.encabezado.tipo === 'DOCUMENT'
        ? 'adjunto: el estado de cuenta en PDF' : d.encabezado.texto);
    }
    console.log(t);
    if (d.pie) console.log('— %s', d.pie);
    console.log('');
  });
}
