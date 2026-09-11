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

// La lista cerrada. Claude sólo puede devolver una de éstas; cualquier otra cosa cae
// en las palabras clave, y de ahí a un humano.
var BOT_ACCIONES = ['bot_saldo', 'bot_pagos', 'bot_detalle', 'bot_cuota', 'bot_comopago',
                    'bot_comprobante', 'bot_datos', 'bot_comunicado', 'bot_humano'];

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
  // «menú» es una orden, no una frase que interpretar: se atiende antes de gastar una
  // llamada al modelo, que además la clasificaría como cualquier otra cosa.
  if (/^\s*(menu|menú|opciones|ver opciones)\s*$/i.test(t)) return 'bot_opciones';
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
          'una de estas palabras, sin explicar nada:\n' +
          'saldo — pregunta cuánto debe o si está al día.\n' +
          'pagos — pregunta si le llegó un pago, o por los pagos que tiene registrados.\n' +
          'detalle — pide el estado de cuenta, el desglose o el PDF.\n' +
          'cuota — pregunta cuánto es la cuota, cuándo vence o cómo se calcula el recargo.\n' +
          'comopago — pregunta a qué cuenta pagar o cómo hacer el pago.\n' +
          'comprobante — dice que va a mandar o que ya mandó un comprobante.\n' +
          'datos — pregunta por su correo o su celular registrados, o quiere cambiarlos.\n' +
          'comunicado — pregunta por un aviso, una reunión o algo que pasó en la comunidad.\n' +
          'humano — reclama, no está de acuerdo con un cargo, pide un arreglo de pago, ' +
          'pregunta por el reglamento, o cualquier otra cosa.\n' +
          'saludo — sólo saluda o no se entiende qué necesita.\n' +
          'Ante cualquier duda, responde humano: es preferible que conteste una persona ' +
          'a que el sistema conteste otra cosa.',
        messages: [{ role: 'user', content: t.slice(0, 600) }]
      }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return deRespaldo;
    var j = JSON.parse(r.getContentText());
    var txt = '';
    (j.content || []).forEach(function (c) { if (c.type === 'text' && !txt) txt = String(c.text || ''); });
    var w = txt.toLowerCase().replace(/[^a-z]/g, '');
    if (w === 'saludo') return '';
    if (BOT_ACCIONES.indexOf('bot_' + w) >= 0) return 'bot_' + w;
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
  if (/^\s*(menu|opciones|ayuda|ver opciones)\s*$/.test(t)) return 'bot_opciones';
  if (/reclamo|no estoy de acuerdo|arreglo de pago|plazo|reglamento|junta|queja|reclam/.test(t)) return 'bot_humano';
  if (/estado de cuenta|desglose|detalle|pdf|documento/.test(t)) return 'bot_detalle';
  if (/mis datos|mi correo|mi email|mi celular|actualizar.*(datos|correo|celular)|cambiar.*(datos|correo|celular)/.test(t)) return 'bot_datos';
  if (/comunicado|aviso|reunion|asamblea|circular/.test(t)) return 'bot_comunicado';
  if (/a que cuenta|numero de cuenta|como pago|donde pago|a donde pago|a nombre de quien/.test(t)) return 'bot_comopago';
  if (/comprobante|recibo|le mando|les mando|adjunto/.test(t)) return 'bot_comprobante';
  if (/ya pague|le pague|les pague|hice el pago|hice la transferenc|deposit|les llego|recibieron|mis pagos|ultimos pagos/.test(t)) return 'bot_pagos';
  if (/cuanto es la cuota|cual es la cuota|cuando vence|vencimiento|fecha limite|recargo|como se calcula/.test(t)) return 'bot_cuota';
  if (/saldo|cuanto debo|cuanto es|deuda|debo|pendiente|mora|atrasad|al dia|adeud/.test(t)) return 'bot_saldo';
  return '';
}

/* ─────────────── lo que contesta ─────────────── */

function _botBoton(id, titulo) { return { type: 'reply', reply: { id: id, title: titulo } }; }

// Los títulos no pasan de 20 caracteres: WhatsApp los corta sin avisar.
/**
 * El menú, como lista, al pie de CADA respuesta.
 *
 * WhatsApp tiene dos mensajes interactivos y no se mezclan. Los botones —hasta tres—
 * mandan una respuesta: un botón llamado «Ver opciones» obliga al sistema a contestar
 * con otro mensaje, y llegar al menú cuesta tres toques y deja un «Ver opciones»
 * suelto en la conversación. La lista, en cambio, abre el menú en el mismo momento.
 *
 * Por eso todo va por lista. Se pierde el toque único de «Mi saldo», que pasa a ser la
 * primera fila, y se gana que cualquier opción esté siempre a dos toques y que el
 * botón haga lo que dice.
 *
 * Enviar un comprobante NO está en el menú: recibirlos funciona —la gente manda la
 * foto igual, se invite o no, y si no se atendiera se perdería— pero no se ofrece
 * hasta que la administración quiera ese flujo abierto.
 */
function _botSecciones() {
  return [
    { title: 'Mi cuenta', rows: [
      { id: 'bot_saldo',    title: 'Mi saldo',               description: 'Cuánto debe hoy su lote' },
      { id: 'bot_pagos',    title: 'Mis últimos pagos',      description: 'Los pagos que le tenemos registrados' },
      { id: 'bot_detalle',  title: 'Estado de cuenta',       description: 'Le enviamos el PDF, mes por mes' },
      { id: 'bot_cuota',    title: 'Mi cuota y vencimiento', description: 'Cuánto es, cuándo vence y el recargo' }
    ] },
    { title: 'La comunidad', rows: [
      { id: 'bot_comunicado', title: 'Último comunicado',    description: 'El último aviso de la administración' }
    ] },
    { title: 'Ayuda', rows: [
      { id: 'bot_comopago', title: 'Cómo pago',              description: 'La cuenta de la Asociación y qué poner' },
      { id: 'bot_datos',    title: 'Mis datos',              description: 'El correo y el celular que tenemos suyos' },
      { id: 'bot_humano',   title: 'Hablar con alguien',     description: 'Le contesta la administración' }
    ] }
  ];
}

/** El saldo, compuesto por el código. Sin adornos y sin prometer nada. */
function _botTextoSaldo(est) {
  var saldo = Number(est.saldoConMora) || 0;
  var credito = Number(est.creditoAFavor) || 0;
  var l = [];
  l.push('*Lote ' + est.lote + '* · ' + est.nombre);
  if (saldo > 0.009) {
    l.push('\uD83D\uDCB3 Saldo pendiente: *B/. ' + saldo.toFixed(2) + '*');
    var mora = Number(est.mora) || 0;
    if (mora > 0.009) l.push('(incluye B/. ' + mora.toFixed(2) + ' de recargo por mora)');
  } else if (credito > 0.009) {
    l.push('\u2705 Está al día, y tiene B/. ' + credito.toFixed(2) + ' a favor.');
  } else {
    l.push('\u2705 Está al día. No tiene saldo pendiente.');
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

  if (accion === 'bot_opciones') return _botOpciones(tel);
  if (accion === 'bot_saldo') return _botContestaSaldo(tel, claves);
  if (accion === 'bot_pagos') return _botUltimosPagos(tel, claves);
  if (accion === 'bot_detalle') return _botMandaEstado(tel, claves);
  if (accion === 'bot_cuota') return _botCuota(tel, claves);
  if (accion === 'bot_comunicado') return _botComunicado(tel, info.clave);
  if (accion === 'bot_comopago') return _botComoPago(tel, claves);
  if (accion === 'bot_datos') return _botDatos(tel, claves);
  if (accion === 'bot_comprobante') return _botPideComprobante(tel);
  if (accion === 'bot_comprobante_recibido') return _botRecibeComprobante(tel, info, msg);
  if (accion === 'bot_humano') return _botPasaAHumano(tel);
  return _botSaluda(tel, info);
}

function _botSaluda(tel, info) {
  var nombre = String(info.nombre || '').split(' ')[0];
  _botDice(tel, (nombre ? 'Hola ' + nombre + '. ' : 'Hola. ') +
    'Le contesta el sistema de la Asociación de Aires de Chicá. ¿En qué le ayudamos?');
  return { contesto: true, avisar: false };
}

/**
 * La única forma de contestar: el texto, y el menú siempre debajo. Quien escribe no
 * necesita recordar nada ni volver atrás.
 */
function _botDice(tel, texto) {
  return _waEnviarLista(tel, texto, 'Ver opciones', _botSecciones());
}

/** Cuando alguien escribe «menú» a secas. */
function _botOpciones(tel) {
  _botDice(tel, '¿En qué le ayudamos?');
  return { contesto: true, avisar: false };
}

/**
 * «5 de septiembre de 2026».
 *
 * Los meses salen del mismo sitio que el correo, pero ahí están en mayúscula porque
 * encabezan títulos. En medio de una frase van en minúscula, que es como se escriben
 * en español.
 */
function _botMes(i) { return String(AC_MESES_LARGO[i] || '').toLowerCase(); }

function _botFecha(d) {
  var f = (d instanceof Date) ? d : new Date(d);
  if (isNaN(f.getTime())) return String(d || '');
  return f.getDate() + ' de ' + _botMes(f.getMonth()) + ' de ' + f.getFullYear();
}

/** «15 ago» — en una lista de pagos el año se dice una vez, en el título. */
function _botFechaCorta(d) {
  var f = (d instanceof Date) ? d : new Date(d);
  if (isNaN(f.getTime())) return String(d || '');
  return f.getDate() + ' ' + _botMes(f.getMonth()).slice(0, 3);
}

/**
 * Recorta una lista de renglones para que el cuerpo quepa en el mensaje.
 *
 * WhatsApp corta a 1024 caracteres sin avisar, y lo que se pierde es el final: el
 * total y la frase de qué hacer si falta un pago. Mejor quitar los pagos más viejos
 * y decir cuántos quedaron fuera.
 */
function _botCabe(cabecera, renglones, cola, limite) {
  limite = limite || 950;
  var fijo = [cabecera].concat(cola).join('\n').length + 2;
  var fuera = 0;
  while (renglones.join('\n').length + fijo > limite && renglones.length > 1) {
    renglones.pop();
    fuera++;
  }
  if (fuera) renglones.push('… y ' + fuera + ' pago(s) más. Pida su estado de cuenta para verlos todos.');
  return [cabecera].concat(renglones, cola).join('\n');
}

/**
 * Los últimos pagos registrados.
 *
 * Contesta «¿les llegó mi transferencia?», que es la pregunta con más ansiedad detrás
 * y que hasta ahora sólo se respondía de refilón mirando el saldo.
 */
function _botUltimosPagos(tel, claves) {
  var anio = (typeof CONFIG === 'object' && Number(CONFIG.ANIO_ACTUAL)) || new Date().getFullYear();
  var bloques = [];

  claves.forEach(function (c) {
    try {
      var est = getEstadoCuentaByKey(c);
      var todos = (est.pagosHistorial || []).slice().sort(function (a, b) {
        return new Date(b.fecha) - new Date(a.fecha);
      });
      var delAnio = todos.filter(function (p) {
        return new Date(p.fecha).getFullYear() === anio;
      });
      var cab = '\uD83E\uDDFE *Pagos del ' + anio + '* \u2014 Lote ' + est.lote;

      if (!delAnio.length) {
        var l = ['Sin pagos registrados este a\u00f1o.'];
        if (todos.length) l.push('El \u00faltimo que consta es del ' + _botFecha(todos[0].fecha) + '.');
        bloques.push([cab].concat(l).join('\n'));
        return;
      }

      var total = 0;
      var renglones = delAnio.map(function (p) {
        total += Number(p.monto) || 0;
        return '\u2705 ' + _botFechaCorta(p.fecha) + '  \u2014  B/. ' + (Number(p.monto) || 0).toFixed(2) +
               (p.referencia ? '  \u00b7  ref. ' + p.referencia : '');
      });
      var cola = ['', '\uD83D\uDCB0 *Total ' + anio + ': B/. ' + total.toFixed(2) + '*'];
      bloques.push(_botCabe(cab, renglones, cola, Math.floor(900 / claves.length)));
    } catch (e) { Logger.log('Bot pagos ' + c + ': ' + (e && e.message || e)); }
  });

  if (!bloques.length) return _botPasaAHumano(tel);

  _botDice(tel, bloques.join('\n\n') +
    '\n\nSi hizo un pago que no aparece aqu\u00ed, env\u00edenos el comprobante y lo registramos.');
  return { contesto: true, avisar: false };
}

/**
 * La cuota, el vencimiento y el recargo.
 *
 * No sólo informa: casi todo reclamo por un recargo empieza en que la regla nunca se
 * dijo. Los números salen de la configuración, no escritos a mano aquí.
 */
function _botCuota(tel, claves) {
  var partes = [];
  claves.forEach(function (c) {
    try {
      var est = getEstadoCuentaByKey(c);
      var l = ['\uD83D\uDCC5 *Lote ' + est.lote + '* \u2014 cuota de B/. ' +
               (Number(est.cuota) || 0).toFixed(2) + ' al mes.'];
      if (est.fechaVencimiento) {
        l.push('La cuota del mes vence el ' + _botFecha(est.fechaVencimiento) + '.');
      }
      var pct = Number(est.moraPct) || 0;
      if (pct > 0) {
        l.push('Pasada esa fecha se aplica un recargo por mora del ' + pct + '% ' +
               (est.moraBase === 'pendiente' ? 'sobre el saldo pendiente.' : 'sobre la cuota del mes.'));
      }
      partes.push(l.join('\n'));
    } catch (e) { Logger.log('Bot cuota ' + c + ': ' + (e && e.message || e)); }
  });
  if (!partes.length) return _botPasaAHumano(tel);
  _botDice(tel, partes.join('\n\n'));
  return { contesto: true, avisar: false };
}

/** La cuenta de cobro y qué escribir para que el pago se reconozca solo. */
function _botComoPago(tel, claves) {
  var cta = (typeof _ctaCobro === 'function') ? _ctaCobro() : null;
  if (!cta || !cta.numero) return _botPasaAHumano(tel);
  var buzon = (typeof CONFIG === 'object' && CONFIG.COMPROBANTES_EMAIL) || '';

  // El mismo lote que lleva el correo, para que el paso 3 diga qué escribir y no
  // «su número de lote» en abstracto.
  var lotes = [];
  (claves || []).forEach(function (c) {
    try { var e = getEstadoCuentaByKey(c); if (e.lote) lotes.push(String(e.lote)); }
    catch (err) {}
  });
  var loteTxt = (lotes.length === 1) ? ' ' + lotes[0]
              : (lotes.length > 1 ? ' (' + lotes.join(' o ') + ', según cuál esté pagando)' : '');

  var l = ['\uD83C\uDFE6 *Cómo registrar su pago por banca en línea*',
           '',
           '1. Entre a su banca en línea (web o app) y elija *Transferencias*.',
           '2. Elija o agregue como beneficiario la cuenta de ' + cta.titular + ':',
           '   ' + cta.banco + ' · ' + cta.tipo + ' N.º ' + cta.numero,
           '3. Indique el *monto* de su cuota y, en la *descripción o concepto*, escriba su ' +
           'número de lote' + loteTxt + '.'];
  if (buzon) {
    l.push('4. En el campo de *correo electrónico para enviar el comprobante*, agregue:');
    l.push('   ' + buzon);
    l.push('5. Revise los datos y *confirme* la transferencia.');
    l.push('');
    l.push('¿Por qué el paso 4? Al incluir ese correo, el comprobante de su pago llega ' +
           'automáticamente a la administración y su cuota se registra sin que usted tenga ' +
           'que enviarlo por otro medio. Si no lo agrega, su pago podría no reflejarse a tiempo.');
  } else {
    l.push('4. Revise los datos y *confirme* la transferencia.');
  }
  _botDice(tel, l.join('\n'));
  return { contesto: true, avisar: false };
}

/**
 * El último comunicado que le tocaba a esta persona.
 *
 * Se comprueba que estuviera entre sus destinatarios: un comunicado dirigido a un
 * residencial concreto no se le enseña a quien no vive ahí. El enlace es el personal,
 * el mismo del correo, así que el acuse de lectura sigue contando.
 */
function _botComunicado(tel, clave) {
  try {
    var lista = (typeof getComunicados === 'function') ? getComunicados(40) : [];
    var mios = lista.filter(function (c) {
      if (String(c.estado) !== 'enviado') return false;
      try {
        return _comDestinatarios(c).some(function (p) {
          return String(p.clave).toUpperCase() === String(clave).toUpperCase();
        });
      } catch (e) { return false; }
    }).sort(function (a, b) { return String(b.enviadoEn).localeCompare(String(a.enviadoEn)); });

    if (!mios.length) {
      enviarWhatsAppTexto(tel, 'Por ahora no hay ningún comunicado publicado para su lote.');
      return { contesto: true, avisar: false };
    }
    var c = mios[0];
    var enlace = '';
    try { enlace = _comLink('verComunicado', { id: c.id, t: _acTokenDe(clave) }); } catch (e) {}
    var l = ['\uD83D\uDCE2 *' + c.titulo + '*'];
    // enviadoEn viene «2026-09-02 10:00»; en un mensaje eso se lee como una máquina.
    if (c.enviadoEn) l.push(_botFecha(String(c.enviadoEn).slice(0, 10) + 'T00:00:00'));
    l.push('');
    l.push(String(c.cuerpo || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400));
    if (enlace) { l.push(''); l.push('Leerlo completo: ' + enlace); }
    _botDice(tel, l.join('\n'));
    return { contesto: true, avisar: false };
  } catch (e) {
    Logger.log('Bot comunicado: ' + (e && e.message || e));
    return _botPasaAHumano(tel);
  }
}

/**
 * Los datos de contacto que tenemos suyos.
 *
 * Esto no edita nada, y aun así vale por sí solo: convierte a cada propietario en el
 * corrector de su propia ficha. Un correo mal escrito es un estado de cuenta que no
 * llega y nadie se entera hasta el envío masivo.
 */
function _botDatos(tel, claves) {
  var l = [], vistos = {};
  claves.forEach(function (c) {
    try {
      var est = getEstadoCuentaByKey(c);
      if (vistos[est.email + '|' + est.celular]) return;
      vistos[est.email + '|' + est.celular] = 1;
      l.push('\uD83D\uDC64 *Lote ' + est.lote + '* · ' + est.nombre);
      l.push('Correo: ' + (est.email || '— no tenemos ninguno —'));
      l.push('Celular: ' + (est.celular || '— no tenemos ninguno —'));
      l.push('');
    } catch (e) { Logger.log('Bot datos ' + c + ': ' + (e && e.message || e)); }
  });
  if (!l.length) return _botPasaAHumano(tel);
  l.push('Si algo está mal o cambió, toque «Hablar con alguien» y lo corregimos. ' +
         'Su estado de cuenta se envía a ese correo.');
  _botDice(tel, l.join('\n'));
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
  _botDice(tel, texto);
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
 * Mensaje de lista: hasta 10 filas en secciones, frente a las 3 de los botones.
 *
 * Los límites de WhatsApp se aplican aquí y no se dejan a su criterio: corta títulos
 * a 24 y descripciones a 72 sin avisar, y se pasa de 10 filas devolviendo un error
 * que no dice cuál sobra.
 */
function _waEnviarLista(telefono, texto, textoBoton, secciones) {
  var token = _waToken(), phoneId = _waPhoneId();
  if (!token || !phoneId) return { ok: false, error: 'Faltan META_WHATSAPP_TOKEN o META_PHONE_ID.' };
  var n = normalizarCelular(telefono);
  if (!n.ok) return { ok: false, error: 'Número no utilizable: ' + n.por };

  var quedan = 10, secs = [];
  (secciones || []).forEach(function (s) {
    if (quedan <= 0) return;
    var filas = (s.rows || []).slice(0, quedan).map(function (r) {
      var f = { id: String(r.id).slice(0, 200), title: String(r.title).slice(0, 24) };
      if (r.description) f.description = String(r.description).slice(0, 72);
      return f;
    });
    if (!filas.length) return;
    quedan -= filas.length;
    secs.push({ title: String(s.title || '').slice(0, 24), rows: filas });
  });
  if (!secs.length) return { ok: false, error: 'La lista no tiene ninguna fila.' };

  try {
    var r = UrlFetchApp.fetch(WA_GRAPH + '/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ messaging_product: 'whatsapp', to: n.e164.replace('+', ''),
        type: 'interactive',
        interactive: { type: 'list', body: { text: String(texto).slice(0, 1024) },
                       action: { button: String(textoBoton || 'Ver opciones').slice(0, 20),
                                 sections: secs } } }),
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
                texto: String(texto).slice(0, 300), estado: 'enviado', nota: 'menú' });
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
