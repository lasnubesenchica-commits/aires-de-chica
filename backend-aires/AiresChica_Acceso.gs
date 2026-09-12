/**
 * Control de acceso — el núcleo (fase 3).
 *
 * ── Qué cubre este archivo ───────────────────────────────────────────────────
 * Las cuatro hojas del módulo, quién puede autorizar una visita de cada unidad,
 * quién es guardia, y el borrado de las fotos de cédula. La lectura de la cédula
 * y la autorización en vivo con botones son la fase 4 y van aparte: dependen de
 * que Meta apruebe `lobby_autorizacion_visita`, que ya está en revisión.
 *
 * ── Por qué los contactos NO son el padrón ───────────────────────────────────
 * El padrón tiene un celular por propietario, pero ese número es el de COBRO: a
 * quién se le manda el estado de cuenta. No es necesariamente quién está en la
 * casa a las nueve de la noche cuando llega un visitante.
 *
 * En el padrón de Aires de Chicá hay un caso que lo deja claro: el lote 14 tiene
 * cuatro propietarios distintos, y uno de ellos figura con un número de Estados
 * Unidos. Despertarla a ella para autorizar a alguien que está parado en la
 * garita de Chicá no sirve de nada.
 *
 * Por eso los contactos de acceso viven en su propia hoja: admiten al inquilino
 * que vive ahí y no es dueño, al cuidador, al hijo que sí contesta. Si una unidad
 * no tiene contactos cargados, se cae al celular del padrón — una copia recién
 * vendida tiene que funcionar el primer día, aunque sea a medias.
 *
 * ── Por qué un tope de cinco ─────────────────────────────────────────────────
 * Cada contacto que autoriza es un mensaje de WhatsApp por visita. Con diez, la
 * comunidad paga el doble y nadie se siente responsable de contestar. Cinco es el
 * tope que se acordó.
 *
 * ── Por qué el guardia usa el teléfono de la garita ──────────────────────────
 * El turno rota y los guardias renuncian. Con el número personal, el historial de
 * conversaciones se va con la persona y el relevo empieza sin nada. El número es
 * del puesto, no de quien lo ocupa.
 *
 * ── Ley 81 de 2019 ───────────────────────────────────────────────────────────
 * Una foto de cédula es un dato personal de un TERCERO que no es cliente de la
 * asociación y que nunca firmó nada. Se guarda 90 días y se borra sola. La fila
 * de la visita se queda —el registro de quién entró es legítimo y la comunidad lo
 * necesita— pero la imagen del documento no.
 *
 * Las hojas se crean sólo cuando el módulo está activo. Un PH que contrató nada
 * más lo financiero no tiene por qué encontrarse cuatro hojas vacías.
 */

var ACC_SH = {
  VISITAS:   'Visitas',
  AUTORIZ:   'Autorizaciones',
  GARITA:    'Garita',
  CONTACTOS: 'Contactos'
};

var ACC_COL_VISITAS = ['id', 'fecha', 'clave', 'lote', 'visitante', 'cedula', 'motivo',
                       'vehiculo', 'guardia', 'estado', 'autorizadoPor', 'autorizadoEn',
                       'fotoUrl', 'fotoBorrada', 'salida', 'notas', 'creado'];

var ACC_COL_AUTORIZ = ['id', 'clave', 'lote', 'visitante', 'cedula', 'desde', 'hasta',
                       'recurrente', 'dias', 'creadoPor', 'activo', 'notas', 'creado'];

var ACC_COL_GARITA  = ['id', 'nombre', 'celular', 'turno', 'activo', 'notas', 'creado'];

var ACC_COL_CONTAC  = ['id', 'clave', 'nombre', 'celular', 'rol', 'autoriza', 'orden',
                       'activo', 'notas', 'creado'];

var ACC_MAX_CONTACTOS = 5;      // cuántos pueden autorizar por unidad
var ACC_DIAS_FOTO     = 90;     // cuánto se guarda la foto de la cédula
var ACC_ROLES = ['propietario', 'inquilino', 'familiar', 'cuidador', 'otro'];
var ACC_ESTADOS = ['pendiente', 'autorizada', 'rechazada', 'sin-respuesta', 'preautorizada'];

/* ─────────────── hojas ─────────────── */

/**
 * Devuelve la hoja, creándola con su encabezado si no existe.
 *
 * A diferencia de ensureSheets(), esto corre bajo demanda: las hojas del módulo
 * de acceso sólo aparecen cuando alguien lo usa.
 */
function _accSheet(nombre, cols) {
  var ss = _ss();
  var sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
      .setBackground('#B5731A').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // La cédula y el lote son CADENAS. Sin esto, Sheets convierte «8-123-456» en
    // una fecha y «6/7» en otra, y la bitácora deja de casar con nada.
    try {
      var iCed = cols.indexOf('cedula'), iCla = cols.indexOf('clave'), iLot = cols.indexOf('lote');
      [iCed, iCla, iLot].forEach(function (i) {
        if (i >= 0) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
    } catch (e) {}
  }
  return sh;
}

function _accHojas() {
  _accSheet(ACC_SH.CONTACTOS, ACC_COL_CONTAC);
  _accSheet(ACC_SH.GARITA,    ACC_COL_GARITA);
  _accSheet(ACC_SH.AUTORIZ,   ACC_COL_AUTORIZ);
  _accSheet(ACC_SH.VISITAS,   ACC_COL_VISITAS);
  return { ok: true, hojas: [ACC_SH.CONTACTOS, ACC_SH.GARITA, ACC_SH.AUTORIZ, ACC_SH.VISITAS] };
}

function _accId(pre) {
  return pre + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
}

function _accSi(v) { return String(v == null ? '' : v).trim().toLowerCase() === 'si'; }

/* ─────────────── contactos de una unidad ─────────────── */

/** Todos los contactos cargados, tal como están en la hoja. */
function getContactos(clave) {
  _accSheet(ACC_SH.CONTACTOS, ACC_COL_CONTAC);
  var filtro = String(clave == null ? '' : clave).trim();
  return _sheetRows(ACC_SH.CONTACTOS)
    .filter(function (r) { return !filtro || String(r.clave).trim() === filtro; })
    .map(function (r) {
      return {
        id: String(r.id || ''), clave: String(r.clave || '').trim(),
        nombre: String(r.nombre || '').trim(), celular: String(r.celular || '').trim(),
        rol: String(r.rol || 'otro').trim().toLowerCase(),
        autoriza: _accSi(r.autoriza), orden: Number(r.orden) || 99,
        activo: !(String(r.activo).trim().toLowerCase() === 'no'),
        notas: String(r.notas || '')
      };
    })
    .sort(function (a, b) { return a.orden - b.orden; });
}

/**
 * A quién se le pregunta cuando llega una visita para esta unidad, en orden.
 *
 * Si la unidad no tiene contactos cargados, cae al celular del padrón. Devuelve
 * `deRespaldo: true` en ese caso para que el panel pueda avisar: funcionar a
 * medias está bien el primer día, pero no para siempre.
 */
function contactosQueAutorizan(clave) {
  var lista = getContactos(clave).filter(function (c) {
    return c.activo && c.autoriza && c.celular;
  }).slice(0, ACC_MAX_CONTACTOS);

  if (lista.length) return { ok: true, clave: String(clave || ''), contactos: lista, deRespaldo: false };

  var prop = (typeof _findProp === 'function') ? _findProp(clave) : null;
  var cel = prop ? String(prop.celular || '').trim() : '';
  if (!cel) {
    return { ok: false, clave: String(clave || ''), contactos: [], deRespaldo: false,
             error: 'La unidad ' + clave + ' no tiene ningún contacto que pueda autorizar, ' +
                    'ni celular en el padrón.' };
  }
  return {
    ok: true, clave: String(clave || ''), deRespaldo: true,
    contactos: [{ id: '', clave: String(clave || ''), nombre: String(prop.nombre || ''),
                  celular: cel, rol: 'propietario', autoriza: true, orden: 1,
                  activo: true, notas: 'Del padrón; no hay contactos de acceso cargados.' }]
  };
}

/**
 * Da de alta o corrige un contacto.
 *
 * El tope de cinco se comprueba aquí y no en el panel: el panel es una cortesía,
 * la regla vive donde está el dato.
 */
function guardarContacto(d) {
  _accSheet(ACC_SH.CONTACTOS, ACC_COL_CONTAC);
  d = d || {};
  var clave = String(d.clave || '').trim();
  var nombre = String(d.nombre || '').trim();
  if (!clave) throw new Error('Falta la unidad.');
  if (!nombre) throw new Error('Ponle un nombre al contacto.');

  var rol = ACC_ROLES.indexOf(String(d.rol || '').trim().toLowerCase()) >= 0
          ? String(d.rol).trim().toLowerCase() : 'otro';
  var autoriza = (d.autoriza === true || _accSi(d.autoriza));
  var activo = !(d.activo === false || String(d.activo).trim().toLowerCase() === 'no');

  var cel = '';
  if (String(d.celular || '').trim()) {
    var n = (typeof normalizarCelular === 'function') ? normalizarCelular(d.celular) : { ok: true, e164: d.celular };
    if (!n.ok) throw new Error('Ese celular no se puede usar: ' + (n.por || 'no se entiende') + '.');
    cel = n.e164;
  }
  if (autoriza && !cel) throw new Error('Un contacto que autoriza necesita celular: se le pregunta por WhatsApp.');

  var id = String(d.id || '').trim();

  // El tope sólo cuenta a los que autorizan y están activos, y no se cuenta a sí
  // mismo cuando se está editando uno que ya existía.
  if (autoriza && activo) {
    var yaAutorizan = getContactos(clave).filter(function (c) {
      return c.activo && c.autoriza && c.id !== id;
    }).length;
    if (yaAutorizan >= ACC_MAX_CONTACTOS) {
      throw new Error('La unidad ' + clave + ' ya tiene ' + ACC_MAX_CONTACTOS +
        ' contactos que autorizan, que es el tope. Quita uno o déjalo sin autorizar.');
    }
  }

  var sh = _accSheet(ACC_SH.CONTACTOS, ACC_COL_CONTAC);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');

  var fila = [ id || _accId('CT'), clave, nombre, cel, rol,
               (autoriza ? 'si' : 'no'), Number(d.orden) || 1,
               (activo ? 'si' : 'no'), String(d.notas || ''), new Date() ];

  var row = -1;
  if (id) for (var r = 1; r < vals.length; r++) if (String(vals[r][iId]).trim() === id) { row = r; break; }
  if (row >= 0) {
    fila[9] = vals[row][h.indexOf('creado')] || new Date();   // no se reescribe el alta
    sh.getRange(row + 1, 1, 1, ACC_COL_CONTAC.length).setValues([fila]);
  } else {
    sh.appendRow(fila);
  }

  _reg(id ? 'contacto.edita' : 'contacto.alta', {
    entidad: 'contacto', clave: clave, propietario: nombre,
    detalle: rol + (autoriza ? ' · autoriza visitas' : ' · sólo se le avisa') +
             (activo ? '' : ' · inactivo')
  });
  return { ok: true, id: fila[0] };
}

function eliminarContacto(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el identificador del contacto.');
  var sh = _accSheet(ACC_SH.CONTACTOS, ACC_COL_CONTAC);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iCl = h.indexOf('clave'), iNo = h.indexOf('nombre');
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]).trim() === id) {
      var cl = String(vals[r][iCl] || ''), nb = String(vals[r][iNo] || '');
      sh.deleteRow(r + 1);
      _reg('contacto.baja', { entidad: 'contacto', clave: cl, propietario: nb,
        detalle: 'Contacto de acceso eliminado (' + id + ')' });
      return { ok: true, id: id };
    }
  }
  throw new Error('No se encontró el contacto ' + id + '.');
}

/* ─────────────── la garita ─────────────── */

function getGarita() {
  _accSheet(ACC_SH.GARITA, ACC_COL_GARITA);
  return _sheetRows(ACC_SH.GARITA).map(function (r) {
    return {
      id: String(r.id || ''), nombre: String(r.nombre || '').trim(),
      celular: String(r.celular || '').trim(), turno: String(r.turno || '').trim(),
      activo: !(String(r.activo).trim().toLowerCase() === 'no'),
      notas: String(r.notas || '')
    };
  });
}

function guardarGarita(d) {
  d = d || {};
  var nombre = String(d.nombre || '').trim();
  if (!nombre) throw new Error('Ponle un nombre al puesto: «Garita principal», «Garita trasera».');
  var n = (typeof normalizarCelular === 'function') ? normalizarCelular(d.celular) : { ok: true, e164: d.celular };
  if (!n.ok) throw new Error('El celular de la garita no se puede usar: ' + (n.por || 'no se entiende') + '.');

  var activo = !(d.activo === false || String(d.activo).trim().toLowerCase() === 'no');
  var id = String(d.id || '').trim();
  var sh = _accSheet(ACC_SH.GARITA, ACC_COL_GARITA);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');

  var fila = [ id || _accId('GA'), nombre, n.e164, String(d.turno || '').trim(),
               (activo ? 'si' : 'no'), String(d.notas || ''), new Date() ];

  var row = -1;
  if (id) for (var r = 1; r < vals.length; r++) if (String(vals[r][iId]).trim() === id) { row = r; break; }
  if (row >= 0) {
    fila[6] = vals[row][h.indexOf('creado')] || new Date();
    sh.getRange(row + 1, 1, 1, ACC_COL_GARITA.length).setValues([fila]);
  } else {
    sh.appendRow(fila);
  }

  _reg(id ? 'garita.edita' : 'garita.alta', { entidad: 'garita', clave: fila[0],
    propietario: nombre, detalle: n.e164 + (activo ? '' : ' · inactivo') });
  return { ok: true, id: fila[0] };
}

/**
 * ¿Este número es de una garita?
 *
 * Se compara en forma normalizada: en la hoja puede estar escrito «6981-2266» y
 * Meta manda «50769812266». Sin normalizar, un guardia real no sería reconocido
 * y el sistema lo trataría como un desconocido.
 */
function esGuardia(telefono) {
  var n = (typeof normalizarCelular === 'function') ? normalizarCelular(telefono) : null;
  var buscado = (n && n.ok) ? n.e164 : String(telefono || '').replace(/\D/g, '');
  if (!buscado) return null;
  var encontrado = null;
  getGarita().forEach(function (g) {
    if (!g.activo || encontrado) return;
    var m = (typeof normalizarCelular === 'function') ? normalizarCelular(g.celular) : null;
    var suyo = (m && m.ok) ? m.e164 : String(g.celular || '').replace(/\D/g, '');
    if (suyo && suyo === buscado) encontrado = g;
  });
  return encontrado;
}

/** El número tal como lo compara el sistema, venga escrito como venga. */
function _accTel(v) {
  var n = (typeof normalizarCelular === 'function') ? normalizarCelular(v) : null;
  return (n && n.ok) ? n.e164 : String(v || '').replace(/\D/g, '');
}

/**
 * Garitas cuyo número es ADEMÁS el de un residente.
 *
 * Pasa de verdad, y no es un error de nadie: al arrancar un piloto lo normal es que
 * el administrador ponga su propio número como garita para probar, y ese número ya
 * está en el padrón.
 *
 * El problema es que entonces es dos cosas a la vez, y esGuardia() se consulta
 * primero: mientras dure, a ese número el sistema lo trata como GUARDIA y deja de
 * contestarle su estado de cuenta. Quien lo sufra no va a relacionar una cosa con la
 * otra. Por eso se avisa desde el panel y desde el diagnóstico, en vez de dejar que
 * se descubra una noche cualquiera.
 *
 * No se bloquea: es una decisión legítima mientras se prueba. Sólo tiene que estar
 * a la vista.
 */
function _accGaritasDeResidente() {
  var suyos = {};
  try {
    (getPropietarios() || []).forEach(function (p) {
      var t = _accTel(p.celular);
      if (t) suyos[t] = (p.lote ? p.lote + ' · ' : '') + (p.nombre || p.clave);
    });
  } catch (e) {}
  getContactos('').forEach(function (c) {
    var t = _accTel(c.celular);
    if (t && !suyos[t]) suyos[t] = c.nombre + ' (' + c.clave + ')';
  });

  var choques = [];
  getGarita().forEach(function (g) {
    if (!g.activo) return;
    var t = _accTel(g.celular);
    if (t && suyos[t]) choques.push({ garita: g.nombre, celular: g.celular, quien: suyos[t] });
  });
  return choques;
}

/* ─────────────── Ley 81: las fotos de cédula no se quedan ─────────────── */

/**
 * Borra de Drive las fotos de cédula con más de 90 días y marca la fila.
 *
 * La visita NO se borra: saber quién entró y cuándo es legítimo y la comunidad lo
 * necesita. Lo que se borra es la imagen del documento de un tercero que nunca
 * firmó nada con la asociación.
 *
 * Pensada para un disparador diario. Sin argumentos dice qué haría y no borra:
 * está en el mismo desplegable que todo lo demás.
 */
function borrarFotosVencidas(confirmar) {
  _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) { console.log('No hay visitas registradas.'); return { ok: true, borradas: 0 }; }

  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iFecha = h.indexOf('fecha'), iUrl = h.indexOf('fotoUrl'), iBor = h.indexOf('fotoBorrada');
  var corte = new Date();
  corte.setDate(corte.getDate() - ACC_DIAS_FOTO);

  var vencidas = [];
  for (var r = 1; r < vals.length; r++) {
    var url = String(vals[r][iUrl] || '').trim();
    if (!url) continue;
    if (String(vals[r][iBor] || '').trim()) continue;
    var f = vals[r][iFecha];
    var d = (f instanceof Date) ? f : new Date(f);
    if (isNaN(d.getTime()) || d.getTime() > corte.getTime()) continue;
    vencidas.push({ fila: r + 1, url: url, fecha: d });
  }

  console.log('════ FOTOS DE CÉDULA ════');
  console.log('Se guardan %s días. Corte: %s', ACC_DIAS_FOTO, _fechaCorta(corte));
  console.log('Vencidas: %s', vencidas.length);
  if (!vencidas.length) return { ok: true, borradas: 0 };

  if (confirmar !== true) {
    console.log('');
    console.log('Borrar es irreversible. Si estás de acuerdo: borrarFotosVencidas(true)');
    console.log('Para que corra sola todos los días: instalarBorradoDeFotos()');
    return { ok: true, borradas: 0, seBorrarian: vencidas.length };
  }

  var n = 0, sinBorrar = [];
  vencidas.forEach(function (v) {
    // Marcar la fila sin haber borrado el archivo sería decir que la foto ya no
    // está cuando sigue en Drive. Es peor que no hacer nada: nadie vuelve a mirar
    // una fila que dice «borrada», y el dato del tercero se queda ahí para siempre.
    var id = _accIdDeDrive(v.url);
    if (!id) {
      sinBorrar.push({ fila: v.fila, por: 'la URL no lleva un id de Drive reconocible' });
      return;
    }
    try {
      DriveApp.getFileById(id).setTrashed(true);
      sh.getRange(v.fila, iBor + 1).setValue(new Date());
      sh.getRange(v.fila, iUrl + 1).setValue('');
      n++;
    } catch (e) {
      sinBorrar.push({ fila: v.fila, por: String(e && e.message || e) });
    }
  });

  console.log('✓ %s foto(s) borradas. Las visitas se quedan; las imágenes no.', n);
  if (sinBorrar.length) {
    console.log('');
    console.log('✗ %s NO se pudieron borrar y siguen en Drive:', sinBorrar.length);
    sinBorrar.forEach(function (x) { console.log('    fila %s — %s', x.fila, x.por); });
    console.log('  Sus filas quedan SIN marcar, para que el próximo intento vuelva por ellas.');
  }
  _reg('acceso.purga', { entidad: 'acceso', monto: n,
    detalle: 'Borradas ' + n + ' fotos de cédula con más de ' + ACC_DIAS_FOTO + ' días (Ley 81)' +
             (sinBorrar.length ? '. ' + sinBorrar.length + ' no se pudieron borrar y siguen en Drive.' : '.') });
  return { ok: true, borradas: n, sinBorrar: sinBorrar.length };
}

/** El id de un archivo dentro de una URL de Drive, en cualquiera de sus formas. */
function _accIdDeDrive(url) {
  var s = String(url || '');
  var m = /\/d\/([\w-]{20,})/.exec(s) || /[?&]id=([\w-]{20,})/.exec(s);
  return m ? m[1] : '';
}

/** Deja el borrado corriendo solo, una vez al día. */
function instalarBorradoDeFotos() {
  var ya = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'purgaDiariaDeFotos';
  });
  if (ya.length) { console.log('El borrado diario ya está instalado.'); return { ok: true, yaEstaba: true }; }
  ScriptApp.newTrigger('purgaDiariaDeFotos').timeBased().everyDays(1).atHour(3).create();
  console.log('✓ Instalado. Cada madrugada se borran las fotos de más de %s días.', ACC_DIAS_FOTO);
  return { ok: true };
}

/** Lo que ejecuta el disparador. Existe aparte para que borre sin preguntar. */
function purgaDiariaDeFotos() { return borrarFotosVencidas(true); }

/* ─────────────── diagnóstico ─────────────── */

/** Qué falta para que el módulo de acceso sirva. */
function diagnosticarAcceso() {
  console.log('════ CONTROL DE ACCESO ════');

  var activo = (typeof moduloActivo === 'function') ? moduloActivo('acceso') : true;
  console.log('Módulo            : %s', activo ? 'contratado' : '✗ NO contratado por esta comunidad');
  if (!activo) {
    console.log('');
    console.log('Con el módulo apagado, el servidor rechaza sus acciones y el panel');
    console.log('esconde su pestaña. Se enciende con configurarCliente({ MODULOS: ... }).');
    return { ok: false, activo: false };
  }

  _accHojas();
  var garitas = getGarita().filter(function (g) { return g.activo; });
  var contactos = getContactos('');
  var autorizan = {};
  contactos.forEach(function (c) {
    if (c.activo && c.autoriza && c.celular) autorizan[c.clave] = (autorizan[c.clave] || 0) + 1;
  });
  var unidades = Object.keys(autorizan).length;

  console.log('Garitas activas   : %s', garitas.length || '✗ ninguna');
  garitas.forEach(function (g) { console.log('    %s · %s', g.nombre, g.celular); });
  console.log('Contactos cargados: %s, en %s unidad(es)', contactos.length, unidades);

  var plantilla = 'lobby_autorizacion_visita';
  console.log('Plantilla en vivo : %s (fase 4; hay que verla APROBADA en verPlantillas())', plantilla);

  var conFoto = 0;
  try {
    conFoto = _sheetRows(ACC_SH.VISITAS).filter(function (v) { return String(v.fotoUrl || '').trim(); }).length;
  } catch (e) {}
  var purga = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'purgaDiariaDeFotos';
  }).length;
  console.log('Fotos de cédula   : %s guardadas · borrado diario %s',
    conFoto, purga ? 'instalado' : '✗ SIN INSTALAR');

  console.log('');
  _accGaritasDeResidente().forEach(function (ch) {
    console.log('· «%s» usa el número de %s. Mientras sea garita, a ese número el sistema', ch.garita, ch.quien);
    console.log('  lo trata como GUARDIA y deja de contestarle su estado de cuenta.');
  });
  if (!garitas.length) console.log('· Sin garita registrada, ningún guardia puede usar el sistema: guardarGarita().');
  if (!unidades)       console.log('· Sin contactos, cada visita cae al celular del padrón, que no siempre es quien está en la casa.');
  if (!purga)          console.log('· Ley 81: instala el borrado automático de fotos con instalarBorradoDeFotos().');

  return { ok: true, activo: true, garitas: garitas.length, unidadesConContactos: unidades,
           purgaInstalada: !!purga };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * AUTORIZACIONES · el pre-registro y la búsqueda
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Una autorización es un permiso que el residente deja puesto ANTES de que el
 * visitante llegue: «el jueves viene Juan Pérez», «el jardinero entra los martes».
 * Cuando el visitante se presenta, el sistema busca aquí antes de molestar a nadie.
 *
 * ── Por qué la cédula manda sobre el nombre ──────────────────────────────────
 * Si el residente registró la cédula, tiene que coincidir la cédula. «Juan Pérez»
 * hay muchos, y el guardia tiene el documento en la mano: comparar nombres cuando
 * existe un número que comparar sería regalar la entrada.
 *
 * Cuando el residente sólo dejó el nombre —que es lo normal, casi nadie sabe la
 * cédula de quien va a visitarlo— se compara por nombre y la respuesta lo DICE.
 * El guardia merece saber si la coincidencia fue firme o floja.
 */

var ACC_DIAS_SEMANA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];   // getDay(): 0 = domingo

/**
 * Cédula comparable: sin espacios, guiones ni puntos, en mayúsculas.
 *
 * En Panamá la misma cédula se escribe «8-123-456», «8 123 456» y «08-0123-0456»
 * según quién la teclee. Comparar en crudo haría que el jardinero de siempre
 * quedara fuera por un guion.
 */
function _accCedula(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Nombre comparable: sin tildes, sin dobles espacios, en minúsculas. */
function _accNombre(v) {
  return String(v == null ? '' : v).toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Fecha al mediodía local, para que ningún desfase la mueva de día.
 *
 * «No hay fecha» tiene que salir como null. Sin esta primera línea no lo hacía:
 * `new Date(null)` NO es una fecha inválida, es el 1 de enero de 1970 —en Panamá,
 * el 31 de diciembre de 1969—, así que una autorización sin vencimiento volvía con
 * un «hasta» de 1969. Vencida desde hace medio siglo, y encima el panel dejaba de
 * contarla entre las que no vencen nunca, que es justo el aviso que importa.
 */
function _accDia(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0);
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

/**
 * Fecha en AAAA-MM-DD, o cadena vacía si no hay fecha.
 *
 * Vacío y no «—»: esto va a un <input type="date"> del panel, y un guion ahí sería
 * una fecha inválida que el navegador descarta en silencio. `_fechaCorta` es para
 * enseñarle una fecha a una persona; esto es para devolvérsela al formulario.
 */
function _accISO(v) {
  var d = _accDia(v);
  if (!d || isNaN(d.getTime())) return '';
  var m = d.getMonth() + 1, x = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (x < 10 ? '0' : '') + x;
}

/** Fecha y hora para la bitácora. Vacío si no hay nada, no «—». */
function _accFechaHora(v) {
  if (!(v instanceof Date) || isNaN(v.getTime())) return '';
  return Utilities.formatDate(v, CONFIG.TZ, 'dd/MM/yyyy HH:mm');
}

function getAutorizaciones(clave) {
  _accSheet(ACC_SH.AUTORIZ, ACC_COL_AUTORIZ);
  var filtro = String(clave == null ? '' : clave).trim();
  return _sheetRows(ACC_SH.AUTORIZ)
    .filter(function (r) { return !filtro || String(r.clave).trim() === filtro; })
    .map(function (r) {
      return {
        id: String(r.id || ''), clave: String(r.clave || '').trim(),
        lote: String(r.lote || '').trim(),
        visitante: String(r.visitante || '').trim(), cedula: String(r.cedula || '').trim(),
        desde: _accDia(r.desde), hasta: _accDia(r.hasta),
        recurrente: _accSi(r.recurrente),
        dias: String(r.dias || '').toUpperCase().split(/[,\s]+/).filter(function (x) { return !!x; }),
        creadoPor: String(r.creadoPor || ''),
        activo: !(String(r.activo).trim().toLowerCase() === 'no'),
        notas: String(r.notas || '')
      };
    });
}

/**
 * Deja puesto un permiso. `desde` vacío significa desde hoy.
 *
 * `hasta` vacío es un permiso SIN vencimiento, que es lo que hace falta para el
 * jardinero de todos los martes. Tiene su riesgo y por eso el diagnóstico los
 * cuenta aparte: un permiso que nadie recuerda haber dado es la forma más común
 * de que una comunidad pierda el control de quién entra.
 */
function guardarAutorizacion(d) {
  _accSheet(ACC_SH.AUTORIZ, ACC_COL_AUTORIZ);
  d = d || {};
  var clave = String(d.clave || '').trim();
  var visitante = String(d.visitante || '').trim();
  if (!clave) throw new Error('Falta la unidad que autoriza.');
  if (!visitante) throw new Error('Falta el nombre del visitante.');

  var desde = _accDia(d.desde) || _accDia(new Date());
  var hasta = d.hasta ? _accDia(d.hasta) : null;
  if (d.hasta && !hasta) throw new Error('La fecha «hasta» no se entiende. Se espera AAAA-MM-DD.');
  if (hasta && hasta.getTime() < desde.getTime()) {
    throw new Error('La autorización terminaría antes de empezar: revisa las fechas.');
  }

  var recurrente = (d.recurrente === true || _accSi(d.recurrente));
  var dias = String(d.dias || '').toUpperCase().split(/[,\s]+/)
    .filter(function (x) { return ACC_DIAS_SEMANA.indexOf(x) >= 0; });
  if (recurrente && !dias.length) {
    throw new Error('Una autorización recurrente necesita días: L, M, X, J, V, S o D.');
  }

  var id = String(d.id || '').trim();
  var sh = _accSheet(ACC_SH.AUTORIZ, ACC_COL_AUTORIZ);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');

  var prop = (typeof _findProp === 'function') ? _findProp(clave) : null;
  var fila = [ id || _accId('AU'), clave, (prop ? String(prop.lote || '') : String(d.lote || '')),
               visitante, String(d.cedula || '').trim(), desde, (hasta || ''),
               (recurrente ? 'si' : 'no'), dias.join(','),
               String(d.creadoPor || ''),
               (d.activo === false || String(d.activo).trim().toLowerCase() === 'no') ? 'no' : 'si',
               String(d.notas || ''), new Date() ];

  var row = -1;
  if (id) for (var r = 1; r < vals.length; r++) if (String(vals[r][iId]).trim() === id) { row = r; break; }
  if (row >= 0) {
    fila[12] = vals[row][h.indexOf('creado')] || new Date();
    sh.getRange(row + 1, 1, 1, ACC_COL_AUTORIZ.length).setValues([fila]);
  } else {
    sh.appendRow(fila);
  }

  _reg(id ? 'autorizacion.edita' : 'autorizacion.alta', {
    entidad: 'autorizacion', clave: clave, propietario: visitante,
    detalle: (recurrente ? 'Recurrente ' + dias.join(',') : 'Puntual') +
             ' · desde ' + _fechaCorta(desde) + (hasta ? ' hasta ' + _fechaCorta(hasta) : ' SIN vencimiento') +
             (d.cedula ? ' · cédula ' + d.cedula : ' · sin cédula')
  });
  return { ok: true, id: fila[0] };
}

function eliminarAutorizacion(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el identificador de la autorización.');
  var sh = _accSheet(ACC_SH.AUTORIZ, ACC_COL_AUTORIZ);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iCl = h.indexOf('clave'), iVi = h.indexOf('visitante');
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]).trim() === id) {
      var cl = String(vals[r][iCl] || ''), vi = String(vals[r][iVi] || '');
      sh.deleteRow(r + 1);
      _reg('autorizacion.baja', { entidad: 'autorizacion', clave: cl, propietario: vi,
        detalle: 'Autorización retirada (' + id + ')' });
      return { ok: true, id: id };
    }
  }
  throw new Error('No se encontró la autorización ' + id + '.');
}

/**
 * ¿Este visitante tiene permiso para esta unidad, en este momento?
 *
 * Devuelve la autorización y CÓMO coincidió, o null. Quien llama tiene que poder
 * decirle al guardia si el permiso era firme —cédula contra cédula— o flojo.
 *
 * Si no se pasa `clave`, busca en todas las unidades: el guardia normalmente tiene
 * la cédula pero no sabe a qué casa va el visitante.
 */
function autorizacionVigente(clave, visita, cuando) {
  visita = visita || {};
  var dia = _accDia(cuando) || _accDia(new Date());
  var cedBuscada = _accCedula(visita.cedula);
  var nomBuscado = _accNombre(visita.visitante || visita.nombre);
  if (!cedBuscada && !nomBuscado) return null;

  var candidatas = getAutorizaciones(clave).filter(function (a) {
    if (!a.activo) return false;
    if (a.desde && dia.getTime() < a.desde.getTime()) return false;
    if (a.hasta && dia.getTime() > a.hasta.getTime()) return false;
    if (a.recurrente && a.dias.length &&
        a.dias.indexOf(ACC_DIAS_SEMANA[dia.getDay()]) < 0) return false;
    return true;
  });

  // La cédula manda. Sólo si la autorización no la tiene se compara por nombre.
  var porCedula = null, porNombre = null;
  candidatas.forEach(function (a) {
    var suCed = _accCedula(a.cedula);
    if (suCed) {
      if (cedBuscada && suCed === cedBuscada && !porCedula) porCedula = a;
      return;   // con cédula registrada, el nombre no basta
    }
    if (nomBuscado && _accNombre(a.visitante) === nomBuscado && !porNombre) porNombre = a;
  });

  if (porCedula) return { autorizacion: porCedula, coincidencia: 'cedula', firme: true };
  if (porNombre) return { autorizacion: porNombre, coincidencia: 'nombre', firme: false };
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Lo que el panel necesita, en una sola llamada
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Contactos, garitas, autorizaciones y las últimas visitas, más lo que falta.
 *
 * Va todo junto porque la pestaña se pinta de una vez: cuatro llamadas separadas
 * a un Apps Script son cuatro arranques en frío y un segundo largo de espera.
 *
 * `avisos` es lo que el panel tiene que poner arriba en rojo. Las unidades sin
 * contactos importan más de lo que parece: el día que llegue una visita para una
 * de ellas, el mensaje se va al número de cobro del padrón, que puede estar en
 * otro país.
 */
function getAccesoData(clave) {
  _accHojas();

  var contactos = getContactos(clave || '');
  var garitas = getGarita();
  var autorizaciones = getAutorizaciones(clave || '').map(function (a) {
    return {
      id: a.id, clave: a.clave, lote: a.lote, visitante: a.visitante, cedula: a.cedula,
      // En ISO, no en dd/MM/yyyy: estas dos fechas vuelven al panel para EDITARSE, y un
      // <input type="date"> sólo entiende AAAA-MM-DD. Formatear aquí obligaría al panel a
      // deshacerlo para poder pintarlas en el formulario.
      desde: _accISO(a.desde), hasta: _accISO(a.hasta),
      recurrente: a.recurrente, dias: a.dias, creadoPor: a.creadoPor,
      activo: a.activo, notas: a.notas,
      vigente: !!autorizacionVigente(a.clave,
        { cedula: a.cedula, visitante: a.visitante }, new Date())
    };
  });

  // Las últimas cien, de la más reciente a la más vieja. Con 50 visitas diarias,
  // devolver la hoja entera sería medio megabyte en cada apertura de la pestaña.
  var visitas = _sheetRows(ACC_SH.VISITAS).slice(-100).reverse().map(function (v) {
    return {
      // Con hora: en una bitácora de entradas, saber que alguien entró «el 12/09» y no a
      // qué hora no sirve para nada cuando hay que reconstruir una noche.
      id: String(v.id || ''), fecha: _accFechaHora(v.fecha),
      clave: String(v.clave || ''), lote: String(v.lote || ''),
      visitante: String(v.visitante || ''), cedula: String(v.cedula || ''),
      motivo: String(v.motivo || ''), vehiculo: String(v.vehiculo || ''),
      guardia: String(v.guardia || ''), estado: String(v.estado || ''),
      autorizadoPor: String(v.autorizadoPor || ''),
      tieneFoto: !!String(v.fotoUrl || '').trim(),
      salida: _accFechaHora(v.salida)
    };
  });

  // Qué unidades del padrón se quedarían sin a quién preguntar.
  var conContacto = {};
  contactos.forEach(function (c) {
    if (c.activo && c.autoriza && c.celular) conContacto[c.clave] = true;
  });
  var sinContactos = [];
  try {
    (getPropietarios() || []).forEach(function (pr) {
      if (!conContacto[pr.clave]) sinContactos.push({ clave: pr.clave, nombre: pr.nombre });
    });
  } catch (e) {}

  var avisos = [];
  if (!garitas.filter(function (g) { return g.activo; }).length) {
    avisos.push({ tipo: 'error', texto: 'No hay ninguna garita registrada. Sin eso, ningún guardia puede usar el sistema.' });
  }
  if (sinContactos.length) {
    avisos.push({ tipo: 'aviso', texto: sinContactos.length + ' ' + _acPlural(_acUnidad()) +
      ' sin contactos de acceso. Sus visitas se preguntarán al celular del padrón, que es el de cobro.' });
  }
  _accGaritasDeResidente().forEach(function (ch) {
    avisos.push({ tipo: 'aviso', texto: 'El número de «' + ch.garita + '» (' + ch.celular +
      ') es también el de ' + ch.quien + '. Mientras esté puesto como garita, el sistema lo ' +
      'trata como GUARDIA: a ese número deja de contestarle su estado de cuenta.' });
  });

  var sinVencer = autorizaciones.filter(function (a) { return a.activo && !a.hasta; }).length;
  if (sinVencer) {
    avisos.push({ tipo: 'aviso', texto: sinVencer + ' autorización(es) sin fecha de vencimiento. ' +
      'Un permiso que nadie recuerda haber dado es la forma más común de perder el control de quién entra.' });
  }
  var purga = 0;
  try {
    purga = ScriptApp.getProjectTriggers().filter(function (t) {
      return t.getHandlerFunction() === 'purgaDiariaDeFotos';
    }).length;
  } catch (e) {}
  if (!purga) {
    avisos.push({ tipo: 'error', texto: 'El borrado automático de fotos de cédula no está instalado. ' +
      'Ley 81: no es opcional. Se instala con instalarBorradoDeFotos() desde el editor.' });
  }

  return {
    unidad: _acUnidad(), unidadPlural: _acPlural(_acUnidad()),
    maxContactos: ACC_MAX_CONTACTOS, diasFoto: ACC_DIAS_FOTO,
    roles: ACC_ROLES, diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    contactos: contactos, garitas: garitas, autorizaciones: autorizaciones,
    visitas: visitas, sinContactos: sinContactos, avisos: avisos,
    purgaInstalada: !!purga
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA LLEGADA · el guardia anuncia un visitante
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El guardia escribió primero, así que todo esto ocurre DENTRO de la ventana de 24
 * horas de WhatsApp: se le puede contestar con texto y con botones sin ninguna
 * plantilla aprobada. La plantilla hace falta para lo OTRO —escribirle al residente,
 * que no ha escrito— y eso es la fase 4.
 *
 * ── La regla, la misma que en el resto del bot ───────────────────────────────
 * El modelo entiende; el código responde. Claude saca el nombre y la cédula del
 * mensaje o de la foto; el código busca en la hoja y compone la respuesta.
 *
 * Y hay un candado más que en el resto del bot: de lo que Claude devuelve leyendo un
 * TEXTO, no se usa nada que no aparezca en lo que el guardia escribió. Una cédula
 * inventada en una garita es alguien entrando con el permiso de otro, y a esa hora
 * nadie lo va a verificar.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 * No abre nada por su cuenta cuando la coincidencia es floja. Si el permiso guardado
 * trae cédula y la cédula casa, dice que puede pasar. Si sólo casa el nombre, LO DICE
 * y la decisión se la deja al guardia, que tiene el documento en la mano. Y si no hay
 * permiso, dice que no hay permiso: todavía no puede preguntarle a la casa, y fingir
 * que está preguntando sería peor que callarse.
 */

/**
 * Deja anotada una visita. Se registra SIEMPRE, se autorice o no.
 *
 * Una visita rechazada o sin respuesta es justo la que después hace falta poder
 * mirar. Guardar sólo las que entraron dejaría la bitácora contando media historia.
 */
function registrarVisita(d) {
  _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  d = d || {};
  var visitante = String(d.visitante || '').trim();
  var cedula = String(d.cedula || '').trim();
  if (!visitante && !cedula) throw new Error('Una visita necesita al menos el nombre o la cédula.');

  var clave = String(d.clave || '').trim();
  var prop = (clave && typeof _findProp === 'function') ? _findProp(clave) : null;
  var estado = ACC_ESTADOS.indexOf(String(d.estado || '')) >= 0 ? String(d.estado) : 'pendiente';
  var quien = String(d.autorizadoPor || '');

  var fila = [ _accId('VI'), new Date(), clave,
               (prop ? String(prop.lote || '') : String(d.lote || '')),
               visitante, cedula, String(d.motivo || ''), String(d.vehiculo || ''),
               String(d.guardia || ''), estado, quien, (quien ? new Date() : ''),
               String(d.fotoUrl || ''), '', '', String(d.notas || ''), new Date() ];
  _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS).appendRow(fila);

  _reg('visita.registra', { entidad: 'visita', clave: clave, propietario: visitante,
    detalle: estado + (cedula ? ' · cédula ' + cedula : ' · sin cédula') +
             (quien ? ' · ' + quien : '') });
  return { ok: true, id: fila[0], estado: estado, clave: clave, visitante: visitante, cedula: cedula };
}

/**
 * De un lote a su clave. Devuelve '' si no es una sola.
 *
 * El lote 14 de este padrón tiene CUATRO propietarios distintos. Elegir uno al azar
 * para colgarle la visita sería inventarse un dato; con más de uno se devuelve vacío y
 * la autorización se busca en todas las unidades, que es lo que ya sabe hacer.
 */
function _accClavePorLote(lote) {
  var buscado = String(lote || '').trim().toUpperCase().replace(/^(LOTE|CASA)\s*/i, '');
  if (!buscado) return '';
  var hallados = [];
  try {
    (getPropietarios() || []).forEach(function (p) {
      if (String(p.lote || '').trim().toUpperCase() === buscado) hallados.push(p.clave);
      else if (String(p.clave || '').trim().toUpperCase() === buscado) hallados.push(p.clave);
    });
  } catch (e) {}
  var unicos = hallados.filter(function (c, i) { return hallados.indexOf(c) === i; });
  return unicos.length === 1 ? unicos[0] : '';
}

/**
 * ¿Esto que devolvió el modelo estaba de verdad en lo que escribió el guardia?
 *
 * Se compara sin tildes, sin mayúsculas y sin puntuación, igual que _accNombre. Que el
 * modelo devuelva «Juan Pérez» donde el guardia tecleó «juan perez» no es inventarse
 * nada: es escribirlo bien, y así es como conviene que quede en la bitácora. Lo que no
 * puede colarse son letras que no estaban.
 */
function _accVieneDelTexto(valor, texto) {
  var limpiar = function (s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]/g, '');
  };
  var v = limpiar(valor);
  return !!v && limpiar(texto).indexOf(v) >= 0;
}

/**
 * Cédulas panameñas tal como se escriben: 8-123-456, E-8-12345, N-19-1234, 4-AV-12,
 * PE-123-456. También un pasaporte suelto, que es lo que trae un extranjero.
 */
function _accCedulaEnTexto(texto) {
  var m = /\b((?:[A-Z]{1,2}-)?\d{1,2}-[A-Z0-9]{1,6}-\d{1,6})\b/i.exec(String(texto || ''));
  return m ? m[1].toUpperCase() : '';
}

/**
 * Saca nombre y cédula de lo que escribió el guardia.
 *
 * Claude entiende el español real de una garita —«viene juan perez cedula 8-123-456
 * pa la 14», sin tildes y con faltas— pero NADA de lo que devuelve se usa si no
 * aparece en el mensaje. Si el modelo se inventa una cédula, se descarta y se cae a
 * la expresión regular, que sólo puede encontrar lo que está escrito.
 *
 * Sin clave de API funciona igual, peor: la cédula por expresión regular y el nombre
 * por lo que quede. Una garita no puede quedarse sin sistema porque Anthropic tenga
 * un mal día.
 */
function _accLeerVisitaTexto(texto) {
  var t = String(texto || '').trim();
  var base = { visitante: '', cedula: _accCedulaEnTexto(t), lote: '', motivo: '', vehiculo: '' };
  if (!t) return base;

  var key = (typeof _anthropicKey === 'function') ? _anthropicKey() : '';
  if (!key) return base;

  try {
    var r = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: 200,
        system:
          'Un guardia de una garita en Panamá anuncia por WhatsApp a un visitante que ' +
          'acaba de llegar. Extrae los datos y responde ÚNICAMENTE con un JSON con esta ' +
          'forma exacta, sin explicar nada:\n' +
          '{"visitante":"","cedula":"","lote":"","motivo":"","vehiculo":""}\n' +
          'Reglas:\n' +
          '- visitante: el nombre de quien llega, tal como está escrito. "" si no lo dice.\n' +
          '- cedula: la cédula o pasaporte, con sus guiones, tal como está escrito. "" si no.\n' +
          '- lote: el lote, casa o apartamento al que va (ej. "14", "H-43B"). "" si no lo dice.\n' +
          '- motivo: a qué viene, en dos o tres palabras. "" si no lo dice.\n' +
          '- vehiculo: placa, color o modelo si lo menciona. "" si no.\n' +
          'NO inventes nada. Si un dato no está en el mensaje, déjalo vacío.',
        messages: [{ role: 'user', content: t.slice(0, 600) }]
      }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return base;
    var data = JSON.parse(r.getContentText());
    var txt = '';
    (data.content || []).forEach(function (c) { if (c.type === 'text') txt += String(c.text || ''); });
    var j = (typeof _parseJsonLoose === 'function') ? _parseJsonLoose(txt) : null;
    if (!j) return base;

    // El candado: cada campo se acepta sólo si estaba en el mensaje del guardia.
    var out = { visitante: '', cedula: base.cedula, lote: '', motivo: '', vehiculo: '' };
    ['visitante', 'cedula', 'lote', 'motivo', 'vehiculo'].forEach(function (k) {
      var v = String(j[k] || '').trim();
      if (v && _accVieneDelTexto(v, t)) out[k] = v;
    });
    // Si el modelo no dio cédula pero la expresión regular sí, manda la regular.
    if (!out.cedula) out.cedula = base.cedula;
    return out;
  } catch (e) {
    Logger.log('Acceso: Claude falló leyendo el anuncio — ' + (e && e.message || e));
    return base;
  }
}

/**
 * Lee una cédula fotografiada.
 *
 * Aquí NO hay con qué contrastar: el modelo es el que lee, y no existe un texto del
 * guardia donde comprobar lo que devolvió. Por eso la respuesta al guardia repite
 * siempre lo que se leyó y dice que salió de la foto — él tiene el documento en la
 * mano y le cuesta un segundo desmentirlo. Un sistema que lee mal en silencio es peor
 * que uno que no lee.
 */
function _accLeerCedulaFoto(blob, tipo) {
  var key = (typeof _anthropicKey === 'function') ? _anthropicKey() : '';
  if (!key) return null;
  var mime = String(tipo || (blob && blob.getContentType && blob.getContentType()) || 'image/jpeg');
  if (mime.indexOf('image/') !== 0) return null;

  try {
    var b64 = Utilities.base64Encode(blob.getBytes());
    var r = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: 200,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text:
            'Es la foto de un documento de identidad, normalmente una cédula panameña. ' +
            'Responde ÚNICAMENTE con un JSON con esta forma exacta, sin explicar nada:\n' +
            '{"esCedula":true|false,"visitante":"","cedula":"","confianza":0.0}\n' +
            '- esCedula: true sólo si de verdad es un documento de identidad o pasaporte.\n' +
            '- visitante: el nombre completo tal como está impreso.\n' +
            '- cedula: el número, con sus guiones, tal como está impreso.\n' +
            '- confianza: de 0 a 1, qué tan seguro estás de haber leído bien el número.\n' +
            'Si la foto está borrosa o cortada, baja la confianza en vez de adivinar.' }
        ] }]
      }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return null;
    var data = JSON.parse(r.getContentText());
    var txt = '';
    (data.content || []).forEach(function (c) { if (c.type === 'text') txt += String(c.text || ''); });
    var j = (typeof _parseJsonLoose === 'function') ? _parseJsonLoose(txt) : null;
    if (!j || !j.esCedula) return null;
    return { visitante: String(j.visitante || '').trim(),
             cedula: String(j.cedula || '').trim(),
             confianza: Number(j.confianza) || 0, deFoto: true };
  } catch (e) {
    Logger.log('Acceso: Claude falló leyendo la cédula — ' + (e && e.message || e));
    return null;
  }
}

/* ─────────────── la conversación con el guardia ─────────────── */

var ACC_BOT_SI = 'acc_si_';      // el guardia dejó pasar
var ACC_BOT_NO = 'acc_no_';      // el guardia no dejó pasar

/**
 * Todo lo que el bot le contesta a un guardia.
 *
 * Devuelve el mismo `{contesto, avisar}` que el resto del bot, para que el aviso a la
 * administración siga funcionando igual.
 */
function _botGuardia(tel, garita, msg) {
  var tipo = String(msg.type || '');

  // 1) ¿Viene a cerrar una visita que el sistema ya le había puesto en duda?
  if (tipo === 'interactive' || tipo === 'button') {
    var i = msg.interactive || {};
    var b = i.button_reply || i.list_reply || {};
    var id = String(b.id || (msg.button && msg.button.payload) || '');
    if (id.indexOf(ACC_BOT_SI) === 0 || id.indexOf(ACC_BOT_NO) === 0) {
      var paso = id.indexOf(ACC_BOT_SI) === 0;
      var visitaId = id.slice(ACC_BOT_SI.length);
      resolverVisita(visitaId, paso ? 'autorizada' : 'rechazada', garita.nombre);
      enviarWhatsAppTexto(tel, paso
        ? 'Anotado: entró. Queda en la bitácora a su nombre.'
        : 'Anotado: no entró. Queda en la bitácora a su nombre.');
      return { contesto: true, avisar: false };
    }
  }

  // 2) Los datos del visitante, de la foto o del texto.
  var datos = null, fotoUrl = '';
  if (tipo === 'image') {
    var media = _waBajarMedia((msg.image || {}).id);
    if (media.ok) {
      datos = _accLeerCedulaFoto(media.blob, media.tipo);
      fotoUrl = _accGuardarFoto(media.blob);
    }
    if (!datos) {
      enviarWhatsAppTexto(tel,
        'No pude leer esa foto. Mándeme el nombre y la cédula escritos, por ejemplo:\n' +
        '«Juan Pérez 8-123-456 va a la ' + _acUnidad() + ' 14».');
      return { contesto: true, avisar: true };
    }
  } else if (tipo === 'text') {
    datos = _accLeerVisitaTexto((msg.text && msg.text.body) || '');
  } else {
    enviarWhatsAppTexto(tel,
      'Por aquí puede anunciar una visita: mándeme la foto de la cédula, o el nombre y la ' +
      'cédula escritos.');
    return { contesto: true, avisar: true };
  }

  if (!String(datos.visitante || '').trim() && !String(datos.cedula || '').trim()) {
    enviarWhatsAppTexto(tel,
      'No entendí a quién anuncia. Mándeme el nombre y la cédula, por ejemplo:\n' +
      '«Juan Pérez 8-123-456 va a la ' + _acUnidad() + ' 14».');
    return { contesto: true, avisar: false };
  }

  // 3) ¿Hay un permiso dejado de antemano?
  var clave = _accClavePorLote(datos.lote);
  var hallado = autorizacionVigente(clave, datos, new Date());
  var deQuien = hallado ? _accDeQuien(hallado.autorizacion.clave) : '';

  var visita = registrarVisita({
    clave: hallado ? hallado.autorizacion.clave : clave,
    lote: datos.lote, visitante: datos.visitante, cedula: datos.cedula,
    motivo: datos.motivo, vehiculo: datos.vehiculo, guardia: garita.nombre,
    estado: (hallado && hallado.firme) ? 'preautorizada' : 'pendiente',
    autorizadoPor: (hallado && hallado.firme) ? ('Permiso de ' + deQuien) : '',
    fotoUrl: fotoUrl,
    notas: datos.deFoto ? 'Cédula leída de una foto.' : ''
  });

  var quien = String(datos.visitante || '').trim() || 'Sin nombre';
  var ced = String(datos.cedula || '').trim();
  var leido = quien + (ced ? '\nCédula ' + ced : '') +
              (datos.deFoto ? '\n_Leído de la foto — confírmelo con el documento._' : '');

  // 4) La respuesta. Lo único que abre sin preguntar es una cédula que casa.
  if (hallado && hallado.firme) {
    enviarWhatsAppTexto(tel,
      '✅ PUEDE PASAR\n\n' + leido + '\n\nTiene permiso dejado por ' + deQuien + '.' +
      _accVigencia(hallado.autorizacion));
    return { contesto: true, avisar: false };
  }

  if (hallado) {
    _waEnviarBotones(tel,
      '⚠️ COINCIDE EL NOMBRE, NO LA CÉDULA\n\n' + leido + '\n\n' + deQuien + ' dejó permiso para ' +
      'alguien con ese nombre, pero sin cédula anotada, así que no puedo asegurar que sea la ' +
      'misma persona. Usted tiene el documento: decida y déjelo anotado.',
      [_botBoton(ACC_BOT_SI + visita.id, 'Lo dejé pasar'),
       _botBoton(ACC_BOT_NO + visita.id, 'No lo dejé pasar')]);
    return { contesto: true, avisar: true };
  }

  _waEnviarBotones(tel,
    '⛔ SIN PERMISO PREVIO\n\n' + leido + '\n\nNo hay ninguna autorización dejada para esta ' +
    'persona. Todavía no puedo preguntarle a la casa desde aquí: llame usted por el medio de ' +
    'siempre y déjelo anotado.',
    [_botBoton(ACC_BOT_SI + visita.id, 'Lo dejé pasar'),
     _botBoton(ACC_BOT_NO + visita.id, 'No lo dejé pasar')]);
  return { contesto: true, avisar: true };
}

/** «L-14 · Judith Araúz», o la clave a secas si no está en el padrón. */
function _accDeQuien(clave) {
  var p = (typeof _findProp === 'function') ? _findProp(clave) : null;
  if (!p) return String(clave || 'la unidad');
  return (p.lote ? p.lote + ' · ' : '') + (p.nombre || clave);
}

/** « Vigente hasta el 31/12/2026.» o cadena vacía. */
function _accVigencia(a) {
  if (!a || !a.hasta) return '';
  return ' Vigente hasta el ' + _fechaCorta(a.hasta) + '.';
}

/**
 * Guarda la foto de la cédula en Drive y devuelve su enlace.
 *
 * Va a la misma carpeta que los comprobantes si está configurada. Si no hay carpeta,
 * NO se guarda y no pasa nada: la visita queda anotada igual. Perder la foto es
 * molesto; perder el registro de quién entró, no.
 */
function _accGuardarFoto(blob) {
  try {
    var id = (typeof CONFIG !== 'undefined' && CONFIG.VOUCHER_FOLDER_ID) || '';
    if (!id) return '';
    var carpeta = DriveApp.getFolderById(id);
    var f = carpeta.createFile(blob.setName('cedula-' + new Date().getTime() + '.jpg'));
    return f.getUrl();
  } catch (e) {
    Logger.log('Acceso: no se pudo guardar la foto — ' + (e && e.message || e));
    return '';
  }
}

/**
 * Cierra una visita con lo que decidió el guardia.
 *
 * Lo que se anota es lo que PASÓ, no lo que el sistema recomendó: si el guardia dejó
 * entrar a alguien sin permiso, eso es justo lo que la bitácora tiene que decir.
 */
function resolverVisita(id, estado, guardia) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el identificador de la visita.');
  if (ACC_ESTADOS.indexOf(String(estado)) < 0) throw new Error('Estado desconocido: ' + estado);

  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iEs = h.indexOf('estado'),
      iPor = h.indexOf('autorizadoPor'), iEn = h.indexOf('autorizadoEn');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== id) continue;
    sh.getRange(r + 1, iEs + 1).setValue(estado);
    sh.getRange(r + 1, iPor + 1).setValue('Guardia · ' + String(guardia || ''));
    sh.getRange(r + 1, iEn + 1).setValue(new Date());
    _reg('visita.resuelve', { entidad: 'visita', clave: String(vals[r][h.indexOf('clave')] || ''),
      propietario: String(vals[r][h.indexOf('visitante')] || ''),
      detalle: estado + ' · lo decidió el guardia de ' + String(guardia || '') });
    return { ok: true, id: id, estado: estado };
  }
  throw new Error('No se encontró la visita ' + id + '.');
}
