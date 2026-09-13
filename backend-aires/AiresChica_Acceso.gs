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
  // Igual que arriba: corre desde un disparador diario y no puede crear las hojas del
  // módulo en una copia que no lo contrató.
  if (typeof moduloActivo === 'function' && !moduloActivo('acceso')) {
    console.log('El módulo de acceso no está activo en esta copia. No hay nada que borrar.');
    return { ok: true, borradas: 0, motivo: 'el módulo de acceso no está activo' };
  }
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
    console.log('Borrar es irreversible. Si estás de acuerdo, elige ESTA en el');
    console.log('desplegable de arriba y ejecútala:  borrarFotosVencidasDeVerdad');
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
/**
 * Borra las fotos vencidas de verdad. Sin argumentos, para el editor.
 *
 * El botón «Ejecutar» no pasa argumentos, así que `borrarFotosVencidas(true)` no se
 * puede escribir en ningún sitio. La protección sigue en pie: hay que elegir a mano una
 * función con otro nombre, que dice lo que hace.
 */
function borrarFotosVencidasDeVerdad() {
  return borrarFotosVencidas(true);
}

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
  var filasVisitas = _sheetRows(ACC_SH.VISITAS);
  var visitas = filasVisitas.slice(-100).reverse().map(function (v) {
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
  // El padrón completo va en la respuesta, no sólo las unidades sin contactos: el
  // formulario de un contacto o de un permiso necesita escoger CUALQUIER unidad. El
  // panel lo sacaba de getPropietarios, que es una acción del módulo FINANCIERO — así
  // que una comunidad que sólo contrató el acceso se quedaba sin desplegable y leía
  // claves en bruto donde debería ver nombres.
  var unidades = [];
  try {
    (getPropietarios() || []).forEach(function (pr) {
      unidades.push({ clave: pr.clave, nombre: pr.nombre, lote: pr.lote });
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

  // Entradas que nadie cerró. Las de hoy son normales —esa gente está dentro— pero las
  // de hace días son un registro a medias, y no saber quién salió es no saber quién está.
  var dentro = _accDentroDe(filasVisitas, ACC_HORAS_ADENTRO);
  var colgadas = _accDentroDe(filasVisitas, 0).length - dentro.length;
  if (colgadas) {
    avisos.push({ tipo: 'aviso', texto: colgadas + ' entrada(s) de hace más de ' +
      ACC_HORAS_ADENTRO + ' horas sin salida anotada. No saber quién salió es no saber ' +
      'quién está adentro.' });
  }

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
    visitas: visitas, unidades: unidades, sinContactos: sinContactos, avisos: avisos,
    adentro: dentro.length, colgadas: colgadas, horasAdentro: ACC_HORAS_ADENTRO,
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

/* ─────────────── leer el documento de la foto ─────────────── */

// El primer intento va con el modelo barato, que es el que resuelve la inmensa mayoría:
// una cédula del Tribunal Electoral, derecha y enfocada, la lee sin despeinarse. El
// segundo sólo corre cuando el primero salió flojo, así que se paga en los casos
// difíciles y no en los setenta que entran bien cada día.
// Se resuelve al LLAMAR, no al cargar. Apps Script evalúa los archivos por orden y éste
// va antes que AiresChica_Comprobantes.gs, donde vive ANTHROPIC_MODEL: al cargar todavía
// vale undefined. Con una var de nivel superior el respaldo quedaba congelado, y cambiar
// el modelo en Comprobantes no movía el lector de cédulas — sin error y sin aviso.
function _accModelo1() {
  try { if (typeof ANTHROPIC_MODEL !== 'undefined' && ANTHROPIC_MODEL) return ANTHROPIC_MODEL; }
  catch (e) {}
  return 'claude-haiku-4-5';
}
var ACC_MODELO_CEDULA_2 = 'claude-sonnet-4-6';
var ACC_CONFIANZA_MIN   = 0.75;

/**
 * ¿Esta lectura hay que dudarla?
 *
 * La confianza que declara el modelo no basta: un documento que no esperaba puede
 * leerlo mal y quedarse convencido. Se miran además la FORMA de lo leído, que es lo
 * que delató el caso real que rompió esto — una permanencia provisional girada 90°
 * volvió como «PERLA PERLA», dos veces la misma palabra, y con el número sin un cero.
 * Un nombre así no existe, y comprobarlo no cuesta nada.
 */
function _accLecturaFloja(j) {
  if (!j) return true;
  if (!j.esCedula) return true;
  if ((Number(j.confianza) || 0) < ACC_CONFIANZA_MIN) return true;
  if (!_accNombrePlausible(j.visitante)) return true;
  if (!/\d/.test(String(j.cedula || ''))) return true;   // un documento sin dígitos no es un documento
  return false;
}

/**
 * ¿Esto tiene forma de nombre de persona?
 *
 * Dos palabras distintas, mínimo. Los dos disparates reales que ha soltado el lector
 * —«PERLA PERLA» y «PERLA MANCANELA PROVISONAL»— salen de que el modelo está leyendo
 * el TÍTULO del carné («PERMANENCIA PROVISIONAL») creyendo que es el nombre, porque la
 * foto está girada. De ahí que las palabras del encabezado descalifiquen: ningún
 * visitante se llama «Permanencia».
 */
var ACC_PALABRAS_DE_CARNE = ['permanencia', 'provisional', 'provisonal', 'republica', 'república',
  'panama', 'panamá', 'tribunal', 'electoral', 'migracion', 'migración', 'ministerio',
  'seguridad', 'publica', 'pública', 'nacional', 'servicio', 'pasaporte', 'nombre', 'apellido',
  'nacionalidad', 'firma', 'fecha', 'expedicion', 'expedición', 'expiracion', 'expiración'];

function _accNombrePlausible(nombre) {
  var palabras = String(nombre || '').trim().split(/\s+/)
    .filter(function (p) { return p.length > 1; });
  if (palabras.length < 2) return false;

  var distintas = {}, delCarne = 0;
  palabras.forEach(function (p) {
    var limpia = _accNombre(p);
    distintas[limpia] = true;
    if (ACC_PALABRAS_DE_CARNE.indexOf(limpia) >= 0) delCarne++;
  });
  // «PERLA PERLA»: repetir la misma palabra no es un nombre, es el modelo atascado.
  if (Object.keys(distintas).length < 2) return false;
  // Si una de cada tres palabras sale del encabezado del documento, no está leyendo un
  // nombre: está transcribiendo el cartón.
  if (delCarne * 3 >= palabras.length) return false;
  return true;
}

/**
 * Cuánto vale una lectura. Sirve para quedarse con la MEJOR de varias.
 *
 * Esto nació de un fallo tonto y caro: la versión anterior sólo aceptaba la segunda
 * lectura «si no era floja», así que cuando el modelo bueno devolvió el nombre perfecto
 * pero con 0.72 de confianza —por debajo del umbral— se descartó entera y se mantuvo la
 * del modelo barato, que traía un disparate. Tirar una lectura buena por no ser perfecta
 * y quedarse con una mala es lo contrario de lo que hay que hacer: la comparación es
 * entre las dos, no contra un ideal.
 */
function _accPuntosLectura(j) {
  if (!j) return 0;
  var n = 0;
  if (j.esCedula) n += 2;
  if (_accNombrePlausible(j.visitante)) n += 3;
  if (/\d/.test(String(j.cedula || ''))) n += 2;
  n += Math.max(0, Math.min(1, Number(j.confianza) || 0)) * 2;
  return n;
}

/**
 * Una pasada del modelo sobre la foto. Devuelve el JSON crudo o null.
 *
 * DEJA RASTRO DE CADA FORMA DE FALLAR. La primera versión devolvía null en cuatro
 * sitios distintos sin decir nada, y cuando falló de verdad en la garita no había
 * manera de saber cuál de los cuatro había sido: si Anthropic contestó un error, si
 * contestó algo que no era JSON, o si dijo que la foto no era un documento. Un null
 * mudo convierte cualquier diagnóstico en adivinanza.
 */
function _accPasadaCedula(b64, mime, modelo, key) {
  try {
    var r = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: modelo, max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text:
            'Un guardia de una garita en Panamá fotografió el documento de identidad de ' +
            'alguien que quiere entrar. Puede ser:\n' +
            '- una cédula del Tribunal Electoral de Panamá (número tipo 8-743-456, con guiones);\n' +
            '- un carné de residente o de PERMANENCIA PROVISIONAL del Servicio Nacional de ' +
            'Migración, que llevan los extranjeros: el número suele ser una cifra corrida y ' +
            'SIN guiones, y en el carné aparecen además la nacionalidad y el pasaporte;\n' +
            '- un pasaporte;\n' +
            '- una licencia de conducir.\n' +
            'La foto puede estar GIRADA de lado o boca abajo, con reflejos o sombras: gírala ' +
            'mentalmente y léela igual.\n\n' +
            'Responde ÚNICAMENTE con un JSON con esta forma exacta, sin explicar nada:\n' +
            '{"esCedula":true|false,"tipoDoc":"","visitante":"","cedula":"","confianza":0.0}\n' +
            '- esCedula: true sólo si de verdad es un documento de identidad.\n' +
            '- tipoDoc: "cedula", "permanencia", "pasaporte", "licencia" u "otro".\n' +
            '- visitante: el nombre completo tal como está impreso, con sus apellidos.\n' +
            '- cedula: el número identificador principal, copiado DÍGITO A DÍGITO tal como ' +
            'está impreso. Si lleva guiones, con sus guiones; si no lleva, sin ellos. No le ' +
            'añadas ni le quites ceros para que se parezca a otro formato.\n' +
            '- confianza: de 0 a 1, qué tan seguro estás de haber leído bien el número Y el ' +
            'nombre. Si hay reflejo, la foto está girada, borrosa o cortada, o el formato no ' +
            'te resulta familiar, BAJA la confianza en vez de adivinar. Una lectura dudosa ' +
            'declarada como dudosa sirve; una lectura mala declarada como buena, no.' }
        ] }]
      }),
      muteHttpExceptions: true
    });
    var codigo = r.getResponseCode();
    var cuerpo = r.getContentText();
    if (codigo !== 200) {
      _accApunte('HTTP ' + codigo + ' con ' + modelo + ' — ' + String(cuerpo).slice(0, 300));
      return null;
    }
    var data = JSON.parse(cuerpo);
    var txt = '';
    (data.content || []).forEach(function (c) { if (c.type === 'text') txt += String(c.text || ''); });
    var j = (typeof _parseJsonLoose === 'function') ? _parseJsonLoose(txt) : null;
    if (!j) {
      _accApunte(modelo + ' no devolvió JSON. Dijo: ' + String(txt).slice(0, 300));
      return null;
    }
    _accApunte(modelo + ' leyó: ' + JSON.stringify(j));
    return j;
  } catch (e) {
    _accApunte('excepción con ' + modelo + ' — ' + (e && e.message || e));
    return null;
  }
}

/**
 * Deja un apunte de lo que pasó al leer un documento, en el registro y a mano.
 *
 * A mano —una propiedad del script— porque el registro de ejecuciones sólo se ve si
 * uno estaba mirando cuando ocurrió, y un fallo en la garita ocurre de noche. Se
 * guardan los últimos apuntes y los lee diagnosticarLecturaCedula() desde el editor.
 */
var ACC_APUNTES_PROP = 'ACC_LECTURA_APUNTES';

function _accApunte(msg) {
  var linea = new Date().toISOString().slice(11, 19) + ' · ' + msg;
  try { Logger.log('Acceso: ' + msg); } catch (e) {}
  try {
    var props = (typeof _waProps === 'function') ? _waProps() : PropertiesService.getScriptProperties();
    var previo = String(props.getProperty(ACC_APUNTES_PROP) || '');
    // Sólo los últimos, y cortos: una propiedad del script no es un archivo de registro.
    var lineas = (previo ? previo.split('\n') : []).concat([linea]).slice(-12);
    props.setProperty(ACC_APUNTES_PROP, lineas.join('\n').slice(-8000));
  } catch (e) {}
}

/**
 * Lee un documento de identidad fotografiado.
 *
 * Aquí NO hay con qué contrastar: el modelo es el que lee, y no existe un texto del
 * guardia donde comprobar lo que devolvió. De ahí las tres defensas:
 *
 *   1. La respuesta al guardia REPITE siempre lo leído y dice que salió de la foto. Él
 *      tiene el documento en la mano y le cuesta un segundo desmentirlo.
 *   2. Si la primera lectura sale floja se pide una segunda a un modelo mejor, y se
 *      QUEDA LA MEJOR DE LAS DOS — no «la segunda si es perfecta». Es el fallo que tuvo
 *      esto: el modelo bueno devolvió el nombre correcto con 0.72 de confianza, por
 *      debajo del umbral, y se descartó entero a favor de un disparate del barato.
 *   3. Que los dos lectores coincidan DÍGITO A DÍGITO en el número vale más que la
 *      confianza que cualquiera de ellos se declare a sí mismo: son dos lecturas
 *      independientes de la misma imagen. Si coinciden, la lectura pasa aunque la
 *      confianza sea tibia. Si discrepan, no pasa aunque sea alta.
 *   4. Si aun así queda floja, se marca `floja` y el guardia recibe un aviso de que NO
 *      se confíe y lo teclee. Leer mal en silencio es peor que no leer.
 */
function _accLeerCedulaFoto(blob, tipo) {
  var key = (typeof _anthropicKey === 'function') ? _anthropicKey() : '';
  if (!key) { _accApunte('no hay ANTHROPIC_API_KEY: no se puede leer ninguna foto.'); return null; }
  var mime = String(tipo || (blob && blob.getContentType && blob.getContentType()) || 'image/jpeg');
  if (mime.indexOf('image/') !== 0) { _accApunte('el adjunto no es una imagen, es ' + mime); return null; }

  var b64;
  try { b64 = Utilities.base64Encode(blob.getBytes()); }
  catch (e) { _accApunte('no se pudo codificar la imagen — ' + (e && e.message || e)); return null; }

  var lecturas = [_accPasadaCedula(b64, mime, _accModelo1(), key)];
  var reintento = false;
  if (_accLecturaFloja(lecturas[0]) && ACC_MODELO_CEDULA_2 &&
      ACC_MODELO_CEDULA_2 !== _accModelo1()) {
    lecturas.push(_accPasadaCedula(b64, mime, ACC_MODELO_CEDULA_2, key));
    reintento = true;
  }

  // La mejor de las que haya. En empate gana la última, que es la del modelo mejor.
  var j = null;
  lecturas.forEach(function (x) {
    if (_accPuntosLectura(x) >= _accPuntosLectura(j)) j = x;
  });

  if (!j) { _accApunte('ninguna de las pasadas devolvió nada legible.'); return null; }
  var nombre = String(j.visitante || '').trim();
  var numero = String(j.cedula || '').trim();
  if (!nombre && !numero) {
    _accApunte('no se sacó ni nombre ni número de la foto: ' + JSON.stringify(j));
    return null;
  }

  // ¿Coinciden los dos lectores en el número? Se compara normalizado, igual que todo lo
  // demás: «8-743-456» y «8743456» son el mismo documento.
  var numeros = lecturas.filter(function (x) { return x && String(x.cedula || '').trim(); })
                        .map(function (x) { return _accCedula(x.cedula); });
  var coinciden = numeros.length >= 2 && numeros[0] === numeros[1];
  var discrepan = numeros.length >= 2 && numeros[0] !== numeros[1];

  var floja = _accLecturaFloja(j);
  if (coinciden && _accNombrePlausible(nombre)) floja = false;
  if (discrepan) floja = true;
  if (discrepan) _accApunte('los dos lectores NO coinciden en el número: ' + numeros.join(' vs '));

  return { visitante: nombre, cedula: numero,
           tipoDoc: String(j.tipoDoc || '').trim().toLowerCase(),
           confianza: Number(j.confianza) || 0,
           floja: floja, discrepan: discrepan, reintento: reintento, deFoto: true };
}

/* ─────────────── la conversación con el guardia ─────────────── */

var ACC_BOT_SI  = 'acc_si_';      // el guardia dejó pasar
var ACC_BOT_NO  = 'acc_no_';      // el guardia no dejó pasar
var ACC_BOT_FIX = 'acc_fix_';     // el guardia va a teclear los datos buenos
var ACC_BOT_SAL = 'acc_sal_';     // el guardia anota que alguien salió
var ACC_BOT_MAS = 'acc_mas_';     // siguiente página de la lista de adentro
var ACC_CORRIGE_MIN = 15;         // minutos que se espera a que teclee la corrección

/**
 * Qué visita está esperando que este guardia la corrija.
 *
 * Sin esto, decirle «teclee usted el nombre y el número» era pedirle que rompiera la
 * bitácora: el texto que escribiera a continuación se tomaría como un anuncio NUEVO y
 * quedarían dos filas para la misma persona, una con los datos malos y otra con los
 * buenos, sin nada que las relacione. Tres meses después, eso son dos visitas.
 *
 * La intención la declara ÉL con un botón, en vez de adivinarla comparando parecidos:
 * un guardia puede perfectamente anunciar a otra persona treinta segundos después, y
 * confundir las dos cosas sería peor que no ofrecer la corrección.
 */
function _accEsperaCorreccion(tel, visitaId) {
  try {
    var c = CacheService.getScriptCache();
    var k = 'acc_corrige_' + String(tel).replace(/\D/g, '');
    if (visitaId === null) { c.remove(k); return ''; }
    if (visitaId) { c.put(k, String(visitaId), ACC_CORRIGE_MIN * 60); return String(visitaId); }
    return String(c.get(k) || '');
  } catch (e) { return ''; }
}

/**
 * Reescribe el nombre y el número de una visita ya anotada.
 *
 * No se borra la anterior ni se crea otra: es la MISMA visita, con el dato corregido y
 * constancia de que lo tecleó el guardia. Quien mire la bitácora tiene que poder ver
 * que ese dato pasó por un par de ojos.
 */
function corregirVisita(id, d) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el identificador de la visita.');
  d = d || {};
  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== id) continue;
    var antes = String(vals[r][h.indexOf('visitante')] || '') + ' / ' +
                String(vals[r][h.indexOf('cedula')] || '');
    if (String(d.visitante || '').trim()) sh.getRange(r + 1, h.indexOf('visitante') + 1).setValue(String(d.visitante).trim());
    if (String(d.cedula || '').trim())    sh.getRange(r + 1, h.indexOf('cedula') + 1).setValue(String(d.cedula).trim());
    sh.getRange(r + 1, h.indexOf('notas') + 1)
      .setValue('Datos tecleados por el guardia. El lector había puesto: ' + antes);
    _reg('visita.corrige', { entidad: 'visita', clave: String(vals[r][h.indexOf('clave')] || ''),
      propietario: String(d.visitante || ''),
      detalle: 'Corregida a mano en la garita. Antes decía: ' + antes });
    return { ok: true, id: id, antes: antes };
  }
  throw new Error('No se encontró la visita ' + id + '.');
}

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
    if (id.indexOf(ACC_BOT_MAS) === 0) {
      return _accListaAdentro(tel, id.slice(ACC_BOT_MAS.length), '');
    }
    if (id.indexOf(ACC_BOT_SAL) === 0) {
      var rs = registrarSalida(id.slice(ACC_BOT_SAL.length), garita.nombre);
      if (rs.yaSalio) {
        enviarWhatsAppTexto(tel, String(rs.visitante || 'Esa visita') +
          ' ya tenía salida anotada: ' + rs.salida + '. No se cambió nada.');
        return { contesto: true, avisar: false };
      }
      enviarWhatsAppTexto(tel, '✅ Salió ' + String(rs.visitante || '') +
        (rs.duracion ? '.\nEstuvo ' + rs.duracion + ' adentro.' : '.'));
      // Y la lista otra vez, actualizada. Aquí sí compensa: la gente se va en tandas
      // —una familia, una cuadrilla— y el siguiente sale en dos minutos. En cambio no
      // se manda tras cada ENTRADA: serían cincuenta listas al día enterrando los
      // mensajes que sí hay que leer, y para cuando alguien saliera estaría vieja.
      if (visitasAdentro(ACC_HORAS_ADENTRO).length) return _accListaAdentro(tel, 0, '');
      return { contesto: true, avisar: false };
    }
    if (id.indexOf(ACC_BOT_FIX) === 0) {
      _accEsperaCorreccion(tel, id.slice(ACC_BOT_FIX.length));
      enviarWhatsAppTexto(tel,
        'Mándeme el nombre y el número tal como aparecen en el documento, por ejemplo:\n' +
        '«Georgina Martínez 1045031».\n\nCorrijo la visita que acabo de anotar; no se crea otra.');
      return { contesto: true, avisar: false };
    }
    if (id.indexOf(ACC_BOT_SI) === 0 || id.indexOf(ACC_BOT_NO) === 0) {
      var paso = id.indexOf(ACC_BOT_SI) === 0;
      var visitaId = id.slice(ACC_BOT_SI.length);
      resolverVisita(visitaId, paso ? 'autorizada' : 'rechazada', garita.nombre);
      _accEsperaCorreccion(tel, null);   // decidida: lo que escriba ya es otra cosa
      enviarWhatsAppTexto(tel, paso
        ? 'Anotado: entró. Queda en la bitácora a su nombre.'
        : 'Anotado: no entró. Queda en la bitácora a su nombre.');
      return { contesto: true, avisar: false };
    }
  }

  // 1a bis) La lista de quién está dentro.
  //
  // Va antes que la corrección y que cualquier lectura de texto: es una orden corta y
  // exacta, como «menú» en el resto del bot, y quien la escribe está preguntando otra
  // cosa. Si tenía una corrección a medias, se descarta — igual que «menú».
  if (tipo === 'text') {
    var mAd = /^\s*(?:adentro|dentro|salida|salidas|lista|qui[eé]nes? est[aá]n? (?:adentro|dentro))\b[\s?¿]*(.*)$/i
      .exec(String((msg.text && msg.text.body) || ''));
    if (mAd) {
      _accEsperaCorreccion(tel, null);
      return _accListaAdentro(tel, 0, mAd[1]);
    }
  }

  // 1b) ¿Es el texto con el que corrige una lectura que él mismo puso en duda?
  if (tipo === 'text') {
    var pendiente = _accEsperaCorreccion(tel);
    if (pendiente) {
      var buenos = _accLeerVisitaTexto((msg.text && msg.text.body) || '');
      if (!String(buenos.visitante || '').trim() && !String(buenos.cedula || '').trim()) {
        enviarWhatsAppTexto(tel,
          'No saqué de ahí ni nombre ni número. Mándemelo así: «Georgina Martínez 1045031».');
        return { contesto: true, avisar: false };
      }
      corregirVisita(pendiente, buenos);
      _accEsperaCorreccion(tel, null);

      // Con el dato bueno, la pregunta de si tiene permiso se vuelve a hacer: puede que
      // con la cédula corregida sí aparezca una autorización que antes no casaba.
      var deNuevo = autorizacionVigente('', buenos, new Date());
      if (deNuevo && deNuevo.firme) {
        resolverVisita(pendiente, 'preautorizada', garita.nombre);
        enviarWhatsAppTexto(tel,
          '✅ Corregido, y ASÍ SÍ TIENE PERMISO.\n\n' + String(buenos.visitante || '') +
          (buenos.cedula ? '\nDocumento ' + buenos.cedula : '') +
          '\n\nPermiso dejado por ' + _accDeQuien(deNuevo.autorizacion.clave) + '.' +
          _accVigencia(deNuevo.autorizacion));
        return { contesto: true, avisar: false };
      }
      _waEnviarBotones(tel,
        'Corregido. Queda anotado así:\n\n' + String(buenos.visitante || '(sin nombre)') +
        (buenos.cedula ? '\nDocumento ' + buenos.cedula : '') +
        '\n\nSigue sin haber autorización dejada para esta persona.',
        [_botBoton(ACC_BOT_SI + pendiente, 'Lo dejé pasar'),
         _botBoton(ACC_BOT_NO + pendiente, 'No lo dejé pasar')]);
      return { contesto: true, avisar: true };
    }
  }

  // 2) Los datos del visitante, de la foto o del texto.
  var datos = null, fotoUrl = '';
  if (tipo === 'image') {
    var media = _waBajarMedia((msg.image || {}).id);
    if (!media.ok) _accApunte('no se pudo bajar la foto de WhatsApp — ' + (media.error || ''));
    if (media.ok) {
      // La foto se guarda ANTES de leerla, y su id queda apuntado. Si la lectura falla,
      // diagnosticarLecturaCedula() puede volver a intentarlo sobre la misma imagen: la
      // URL que da WhatsApp caduca en minutos y sin esto el caso se pierde.
      fotoUrl = _accGuardarFoto(media.blob);
      datos = _accLeerCedulaFoto(media.blob, media.tipo);
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
    notas: datos.deFoto
      ? ('Documento leído de una foto' + (datos.tipoDoc ? ' (' + datos.tipoDoc + ')' : '') +
         (datos.floja ? ' — LECTURA DUDOSA, sin confirmar por el guardia.' : '.') +
         (datos.discrepan ? ' Los dos lectores no coincidieron en el número.' : ''))
      : ''
  });

  var quien = String(datos.visitante || '').trim() || 'Sin nombre';
  var ced = String(datos.cedula || '').trim();
  var leido = quien + (ced ? '\n' + _accEtiquetaDoc(datos.tipoDoc) + ' ' + ced : '');
  if (datos.floja) {
    // Se pone ARRIBA de todo y en mayúsculas. Un guardia lee la primera línea y actúa;
    // una advertencia al final del mensaje no la lee nadie a las nueve de la noche.
    leido = '⚠️ *NO ME FÍO DE ESTA LECTURA.* Toque «Corregir los datos» y tecléelos usted.\n\n' + leido +
            '\n_Es lo que creí leer, y puede estar mal._';
  } else if (datos.deFoto) {
    leido += '\n_Leído de la foto — confírmelo con el documento._';
  }

  // 4) La respuesta. Lo único que abre sin preguntar es una cédula que casa.
  if (hallado && hallado.firme) {
    // La CUENTA de quién hay dentro, no la lista. Una línea en un mensaje que ya se
    // manda, en vez de cincuenta listas al día enterrando lo que sí hay que leer.
    // Cuando la necesite de verdad, escribe «adentro» y la recibe fresca.
    enviarWhatsAppTexto(tel,
      '✅ PUEDE PASAR\n\n' + leido + '\n\nTiene permiso dejado por ' + deQuien + '.' +
      _accVigencia(hallado.autorizacion) + _accCuentaAdentro());
    return { contesto: true, avisar: false };
  }

  // Los botones. El de corregir sólo aparece cuando la lectura quedó en duda: si el dato
  // es bueno, ofrecer «corregir» invita a tocar lo que ya está bien. WhatsApp admite tres.
  var botones = [_botBoton(ACC_BOT_SI + visita.id, 'Lo dejé pasar'),
                 _botBoton(ACC_BOT_NO + visita.id, 'No lo dejé pasar')];
  if (datos.floja) botones.push(_botBoton(ACC_BOT_FIX + visita.id, 'Corregir los datos'));

  if (hallado) {
    _waEnviarBotones(tel,
      '⚠️ COINCIDE EL NOMBRE, NO LA CÉDULA\n\n' + leido + '\n\n' + deQuien + ' dejó permiso para ' +
      'alguien con ese nombre, pero sin cédula anotada, así que no puedo asegurar que sea la ' +
      'misma persona. Usted tiene el documento: decida y déjelo anotado.', botones);
    return { contesto: true, avisar: true };
  }

  // Sin permiso previo: se le pregunta a la casa, que es lo que la fase 4 desbloqueó.
  // Sólo se puede si se sabe A QUÉ unidad va; sin eso no hay a quién preguntarle.
  var destino = hallado ? hallado.autorizacion.clave : clave;
  if (destino) {
    var pregunta = preguntarALaCasa(visita.id, destino, datos);
    if (pregunta.ok) {
      _waEnviarBotones(tel,
        '📲 PREGUNTÁNDOLE A LA CASA\n\n' + leido + '\n\nAvisé a ' + pregunta.avisados.join(', ') +
        '. Le digo en cuanto contesten.\nSi en ' + ACC_MINUTOS_RESPUESTA +
        ' minutos nadie responde, no pasa.' +
        (pregunta.deRespaldo ? '\n\n_Se avisó al número del padrón: este ' + _acUnidad() +
          ' no tiene contactos de acceso cargados._' : ''),
        botones);
      return { contesto: true, avisar: false };
    }
    _waEnviarBotones(tel,
      '⛔ SIN PERMISO, Y NO PUDE AVISAR\n\n' + leido + '\n\n' + (pregunta.error || '') +
      ' Llame usted por el medio de siempre y déjelo anotado.', botones);
    return { contesto: true, avisar: true };
  }

  _waEnviarBotones(tel,
    '⛔ SIN PERMISO PREVIO\n\n' + leido + '\n\nNo hay autorización dejada para esta persona, y ' +
    'no me dijo a qué ' + _acUnidad() + ' va, así que no sé a quién preguntarle. Mándeme el ' +
    _acUnidad() + ' y le pregunto a la casa.', botones);
  return { contesto: true, avisar: true };
}

/**
 * Cómo se llama el número que se leyó.
 *
 * Decirle «Cédula 1045031» a un carné de permanencia provisional es llamarlo por un
 * nombre que no es, y el guardia —que tiene el documento delante— se queda sin saber
 * si el sistema entendió qué le mandó.
 */
function _accEtiquetaDoc(tipoDoc) {
  var t = String(tipoDoc || '').toLowerCase();
  if (t === 'permanencia') return 'Carné de permanencia';
  if (t === 'pasaporte')   return 'Pasaporte';
  if (t === 'licencia')    return 'Licencia';
  if (t === 'otro')        return 'Documento';
  return 'Cédula';
}

/** «L-14 · Judith Araúz», o la clave a secas si no está en el padrón. */
function _accDeQuien(clave) {
  var p = (typeof _findProp === 'function') ? _findProp(clave) : null;
  if (!p) return String(clave || 'la unidad');
  return (p.lote ? p.lote + ' · ' : '') + (p.nombre || clave);
}

/**
 * «3 adentro ahora» — la CUENTA, no la lista.
 *
 * Va pegada al mensaje que ya se manda, en vez de un mensaje aparte por cada entrada:
 * cincuenta listas al día enterrarían los avisos que sí hay que leer, y para cuando
 * alguien saliera estarían viejas. Cuando la necesite, el guardia escribe «adentro» y
 * la recibe fresca.
 *
 * La visita que acaba de entrar ya está contada: se anota antes de componer esto.
 */
function _accCuentaAdentro() {
  var n = 0;
  try { n = visitasAdentro(ACC_HORAS_ADENTRO).length; } catch (e) { return ''; }
  if (!n) return '';
  return '\n\n' + n + (n === 1 ? ' visita adentro ahora.' : ' visitas adentro ahora.');
}

/** « Vigente hasta el 31/12/2026.» o cadena vacía. */
function _accVigencia(a) {
  if (!a || !a.hasta) return '';
  return ' Vigente hasta el ' + _fechaCorta(a.hasta) + '.';
}

var ACC_CARPETA_FOTOS = 'Documentos de visitantes';

/**
 * Guarda la foto del documento en Drive y devuelve su enlace.
 *
 * En SU PROPIA carpeta, no en la de los comprobantes. Un comprobante es de un
 * propietario que sí firmó con la asociación; la foto del documento de un visitante es
 * de un tercero que no firmó nada y que además se borra a los 90 días. Mezclarlas
 * significa que quien tenga acceso a la contabilidad ve los documentos de identidad de
 * todo el que pasó por la garita, y que el borrado automático tenga que ir a buscar
 * entre archivos que no debe tocar.
 *
 * La carpeta se crea sola la primera vez. Si Drive falla, NO se guarda y no pasa nada:
 * la visita queda anotada igual. Perder la foto es molesto; perder el registro de quién
 * entró, no.
 */
var ACC_ULTIMA_FOTO_PROP = 'ACC_ULTIMA_FOTO';

function _accGuardarFoto(blob) {
  try {
    var it = DriveApp.getFoldersByName(ACC_CARPETA_FOTOS);
    var carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(ACC_CARPETA_FOTOS);
    var f = carpeta.createFile(blob.setName('doc-' + new Date().getTime() + '.jpg'));
    try {
      var props = (typeof _waProps === 'function') ? _waProps() : PropertiesService.getScriptProperties();
      props.setProperty(ACC_ULTIMA_FOTO_PROP, f.getId());
    } catch (e2) {}
    return f.getUrl();
  } catch (e) {
    _accApunte('no se pudo guardar la foto en Drive — ' + (e && e.message || e));
    return '';
  }
}

/**
 * Por qué no se leyó la última foto. Se ejecuta desde el editor, sin argumentos.
 *
 * Imprime los apuntes de lo que pasó y, si la foto se llegó a guardar, la vuelve a
 * pasar por los dos modelos enseñando la respuesta de cada uno. Sin esto, un fallo de
 * noche en la garita sólo deja «No pude leer esa foto» y a nadie a quien preguntarle.
 */
function diagnosticarLecturaCedula() {
  console.log('════ LECTURA DE DOCUMENTOS ════');

  var props;
  try { props = (typeof _waProps === 'function') ? _waProps() : PropertiesService.getScriptProperties(); }
  catch (e) { props = null; }

  console.log('Modelo 1 (siempre) : %s', _accModelo1());
  console.log('Modelo 2 (si falla): %s', ACC_MODELO_CEDULA_2);
  console.log('Confianza mínima   : %s', ACC_CONFIANZA_MIN);
  console.log('Clave de Anthropic : %s',
    ((typeof _anthropicKey === 'function') && _anthropicKey()) ? 'puesta' : '✗ FALTA');

  var apuntes = props ? String(props.getProperty(ACC_APUNTES_PROP) || '') : '';
  console.log('');
  console.log('── qué pasó en los últimos intentos ──');
  console.log(apuntes || '(no hay apuntes: todavía no se ha intentado leer ninguna foto)');

  var id = props ? String(props.getProperty(ACC_ULTIMA_FOTO_PROP) || '') : '';
  if (!id) {
    console.log('');
    console.log('No hay ninguna foto guardada que reintentar. Mándale una al bot desde la');
    console.log('garita y vuelve a ejecutar esto.');
    return { ok: true, apuntes: apuntes, foto: '' };
  }

  console.log('');
  console.log('── reintento sobre la última foto guardada ──');
  var blob;
  try { blob = DriveApp.getFileById(id).getBlob(); }
  catch (e) {
    console.log('✗ No se pudo abrir la foto %s — %s', id, (e && e.message || e));
    return { ok: false, error: String(e) };
  }

  var key = _anthropicKey();
  var b64 = Utilities.base64Encode(blob.getBytes());
  var mime = blob.getContentType() || 'image/jpeg';
  [_accModelo1(), ACC_MODELO_CEDULA_2].forEach(function (m) {
    var j = _accPasadaCedula(b64, mime, m, key);
    console.log('%s → %s', m, j ? JSON.stringify(j) : 'nada (mira los apuntes de arriba)');
    if (j) console.log('    ¿floja? %s', _accLecturaFloja(j) ? 'SÍ, no se daría por buena' : 'no');
  });

  return { ok: true, foto: id };
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

/* ═══════════════════════════════════════════════════════════════════════════
 * FASE 4 · preguntarle a la casa, en vivo
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hasta aquí, una visita sin permiso previo terminaba en «llame usted por el medio de
 * siempre». Con lobby_autorizacion_visita aprobada, el sistema puede escribirle al
 * residente aunque él no haya escrito primero, que era lo único que faltaba.
 *
 * ── Cómo se ata la respuesta a la visita ─────────────────────────────────────
 * Los botones de una plantilla llevan un identificador FIJO —acceso_si y acceso_no—
 * que se define al aprobarla y no admite nada variable. Así que cuando vuelve un
 * «acceso_si» no trae consigo a qué visita se refiere: hay que buscarla por el número
 * de quien contestó, entre las unidades que esa persona puede autorizar.
 *
 * De ahí que la confirmación al residente REPITA el nombre del visitante. Si contestó
 * por la visita equivocada —porque llegaron dos seguidas— tiene que poder verlo en el
 * acto, no enterarse mañana.
 *
 * ── El reloj ─────────────────────────────────────────────────────────────────
 * La plantilla promete que si no contesta en X minutos, la garita no lo deja pasar.
 * Eso obliga a cumplirlo: un disparador cierra las que nadie contestó y se lo dice al
 * guardia. Prometer un plazo y no cerrarlo deja al guardia esperando una respuesta que
 * no va a llegar.
 */

var ACC_MINUTOS_RESPUESTA = 10;   // lo que se le promete al residente en la plantilla
var ACC_PLANTILLA_VISITA  = 'lobby_autorizacion_visita';

/**
 * Le pregunta a la casa. Devuelve a quién se le escribió.
 *
 * Se escribe a TODOS los que autorizan, no al primero: a las nueve de la noche el que
 * contesta es el que tiene el teléfono a mano, y encadenar intentos de uno en uno con
 * un plazo de por medio significa que el guardia espera de más por nada.
 */
function preguntarALaCasa(visitaId, clave, datos) {
  var quienes = contactosQueAutorizan(clave);
  if (!quienes.ok || !quienes.contactos.length) {
    _accApunte('no hay a quién preguntarle en ' + clave + ': ' + (quienes.error || ''));
    return { ok: false, avisados: [], error: quienes.error || 'No hay a quién preguntarle.' };
  }

  var negocio = (typeof CONFIG !== 'undefined' && CONFIG.NEGOCIO) || 'la comunidad';
  var destino = _acUnidad() + ' ' + clave;
  var visitante = String(datos.visitante || '').trim() || 'una persona sin identificar';

  var avisados = [], fallos = [];
  quienes.contactos.forEach(function (c) {
    var r = enviarPlantillaWhatsApp(c.celular, ACC_PLANTILLA_VISITA,
      [String(c.nombre || '').split(' ')[0] || 'vecino', negocio, visitante, destino,
       String(ACC_MINUTOS_RESPUESTA)],
      { nota: 'visita ' + visitaId });
    if (r.ok) avisados.push(c.nombre);
    else fallos.push(c.nombre + ': ' + r.error);
  });

  if (fallos.length) _accApunte('no se pudo avisar a ' + fallos.join(' | '));
  return { ok: !!avisados.length, avisados: avisados, fallos: fallos,
           deRespaldo: !!quienes.deRespaldo };
}

/**
 * La visita que esta persona puede contestar ahora mismo.
 *
 * Se busca entre las unidades que autoriza, y se coge la más reciente que siga
 * pendiente. Si no autoriza en ninguna, se mira el padrón: un propietario cuyo número
 * está sólo ahí también recibe la pregunta, porque contactosQueAutorizan() cae a ese
 * número cuando la unidad no tiene contactos cargados.
 */
function _accVisitaPendienteDe(telefono) {
  var buscado = _accTel(telefono);
  if (!buscado) return null;

  var suyas = {};
  getContactos('').forEach(function (c) {
    if (c.activo && c.autoriza && _accTel(c.celular) === buscado) suyas[c.clave] = true;
  });
  try {
    (getPropietarios() || []).forEach(function (p) {
      if (_accTel(p.celular) === buscado) suyas[p.clave] = true;
    });
  } catch (e) {}
  if (!Object.keys(suyas).length) return null;

  var limite = new Date().getTime() - ACC_MINUTOS_RESPUESTA * 60 * 1000;
  var hallada = null;
  _sheetRows(ACC_SH.VISITAS).forEach(function (v) {
    if (String(v.estado || '') !== 'pendiente') return;
    if (!suyas[String(v.clave || '').trim()]) return;
    var cuando = (v.fecha instanceof Date) ? v.fecha.getTime() : 0;
    if (cuando < limite) return;                 // ya se le pasó el plazo
    if (!hallada || cuando > hallada.cuando) hallada = { fila: v, cuando: cuando };
  });
  return hallada ? hallada.fila : null;
}

/**
 * Lo que contesta el bot cuando un RESIDENTE toca «Autorizo» o «No autorizo».
 *
 * Devuelve null si el mensaje no era eso, para que el bot siga su camino normal.
 */
function _botRespuestaDeAcceso(tel, msg) {
  var i = msg.interactive || {};
  var b = i.button_reply || i.list_reply || {};
  var id = String(b.id || (msg.button && msg.button.payload) || '');
  if (id !== 'acceso_si' && id !== 'acceso_no') return null;

  var visita = _accVisitaPendienteDe(tel);
  if (!visita) {
    enviarWhatsAppTexto(tel,
      'Gracias. Esa visita ya está resuelta —o se pasó el plazo de ' + ACC_MINUTOS_RESPUESTA +
      ' minutos y la garita ya decidió—, así que su respuesta no cambia nada. ' +
      'Si hace falta, llame a la garita.');
    return { contesto: true, avisar: true };
  }

  var paso = (id === 'acceso_si');
  var quien = identificarPorCelular(tel);
  var nombre = (quien && quien.nombre) || 'el residente';
  resolverVisitaPorResidente(String(visita.id), paso ? 'autorizada' : 'rechazada', nombre);

  // El nombre del visitante se REPITE. Si llegaron dos seguidas y contestó por la que
  // no era, tiene que poder verlo ahora y no mañana.
  enviarWhatsAppTexto(tel, paso
    ? '✅ Autorizado. Le aviso a la garita para que deje pasar a ' + String(visita.visitante || '') + '.'
    : '⛔ No autorizado. Le aviso a la garita para que NO deje pasar a ' + String(visita.visitante || '') + '.');

  _accAvisarGarita(visita, paso
    ? '✅ AUTORIZADA por ' + nombre + '\n\n' + String(visita.visitante || '') +
      ' puede pasar al ' + _acUnidad() + ' ' + String(visita.clave || '') + '.'
    : '⛔ NO AUTORIZADA por ' + nombre + '\n\n' + String(visita.visitante || '') +
      ' NO puede pasar. Si insiste, es cosa de la administración, no suya.');
  return { contesto: true, avisar: false };
}

/** Como resolverVisita, pero dejando dicho que lo decidió la casa y no el guardia. */
function resolverVisitaPorResidente(id, estado, quien) {
  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== String(id).trim()) continue;
    sh.getRange(r + 1, h.indexOf('estado') + 1).setValue(estado);
    sh.getRange(r + 1, h.indexOf('autorizadoPor') + 1).setValue('Residente · ' + String(quien || ''));
    sh.getRange(r + 1, h.indexOf('autorizadoEn') + 1).setValue(new Date());
    _reg('visita.resuelve', { entidad: 'visita', clave: String(vals[r][h.indexOf('clave')] || ''),
      propietario: String(vals[r][h.indexOf('visitante')] || ''),
      detalle: estado + ' · lo decidió la casa desde WhatsApp (' + String(quien || '') + ')' });
    return { ok: true, id: id, estado: estado };
  }
  throw new Error('No se encontró la visita ' + id + '.');
}

/** Le escribe a la garita que anunció esta visita. */
function _accAvisarGarita(visita, texto) {
  var nombre = String(visita.guardia || '').trim();
  var destino = null;
  getGarita().forEach(function (g) {
    if (g.activo && (!nombre || g.nombre === nombre) && !destino) destino = g;
  });
  if (!destino) { _accApunte('no se pudo avisar a la garita: ninguna activa.'); return false; }
  enviarWhatsAppTexto(destino.celular, texto);
  return true;
}

/**
 * Cierra las visitas que nadie contestó dentro del plazo y se lo dice al guardia.
 *
 * Existe porque la plantilla PROMETE el plazo. Dejar una visita en «pendiente» para
 * siempre es tener al guardia esperando una respuesta que ya no va a llegar, y una
 * bitácora que dentro de un mes no distingue «nadie contestó» de «se quedó a medias».
 */
function cerrarVisitasSinRespuesta() {
  // Un disparador corre pase lo que pase, y _accSheet CREA la hoja si no está. En un PH
  // que no contrató el acceso eso le planta cuatro hojas vacías en su cálculo — justo lo
  // que el módulo promete no hacer. Se comprueba aquí porque aquí no hay enrutador que
  // lo filtre: el reloj de Google llama directo.
  if (typeof moduloActivo === 'function' && !moduloActivo('acceso')) {
    return { ok: true, cerradas: 0, motivo: 'el módulo de acceso no está activo' };
  }
  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { ok: true, cerradas: 0 };
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iEs = h.indexOf('estado'), iFe = h.indexOf('fecha');
  var limite = new Date().getTime() - ACC_MINUTOS_RESPUESTA * 60 * 1000;
  var cerradas = 0;

  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iEs] || '') !== 'pendiente') continue;
    var f = vals[r][iFe];
    if (!(f instanceof Date) || f.getTime() >= limite) continue;
    // Sólo las que de verdad se preguntaron: una visita sin unidad nunca se preguntó a
    // nadie, y marcarla «sin respuesta» sería culpar a un residente que no fue avisado.
    if (!String(vals[r][h.indexOf('clave')] || '').trim()) continue;

    sh.getRange(r + 1, iEs + 1).setValue('sin-respuesta');
    cerradas++;
    var visita = {};
    h.forEach(function (k, i) { visita[k] = vals[r][i]; });
    _accAvisarGarita(visita,
      '⏰ NADIE CONTESTÓ\n\nPasaron los ' + ACC_MINUTOS_RESPUESTA + ' minutos y el ' +
      _acUnidad() + ' ' + String(visita.clave || '') + ' no respondió por ' +
      String(visita.visitante || '') + '. Según lo que se le dijo a la casa, NO pasa.');
    _reg('visita.resuelve', { entidad: 'visita', clave: String(visita.clave || ''),
      propietario: String(visita.visitante || ''),
      detalle: 'sin-respuesta · nadie contestó en ' + ACC_MINUTOS_RESPUESTA + ' minutos' });
  }
  if (cerradas) console.log('Cerradas %s visita(s) que nadie contestó.', cerradas);
  return { ok: true, cerradas: cerradas };
}

/** Instala el disparador que cierra las visitas sin respuesta. Sin argumentos. */
function instalarCierreDeVisitas() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cerrarVisitasSinRespuesta') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cerrarVisitasSinRespuesta').timeBased().everyMinutes(5).create();
  console.log('✓ Instalado. Cada 5 minutos se cierran las visitas que nadie contestó');
  console.log('  y se le avisa a la garita. El plazo que se le promete a la casa es de');
  console.log('  %s minutos, así que una visita se cierra entre los %s y los %s.',
    ACC_MINUTOS_RESPUESTA, ACC_MINUTOS_RESPUESTA, ACC_MINUTOS_RESPUESTA + 5);
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * EL PROPIETARIO SE GESTIONA LO SUYO, DESDE WHATSAPP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hasta aquí, cargar contactos de acceso y dejar permisos era cosa del panel, o sea
 * de la administración. Con setenta unidades eso significa que no se carga nunca: el
 * padrón de Aires de Chicá lleva 71 unidades sin un solo contacto, y no es descuido de
 * nadie — es que hacerlo por otro, uno a uno, no lo hace nadie.
 *
 * ── Esto es lo primero que el bot ESCRIBE ────────────────────────────────────
 * El resto del bot lee: dice saldos, manda estados de cuenta, recibe comprobantes y
 * avisa. No aplica pagos ni toca el padrón, y eso no cambia. Pero aquí un mensaje de
 * WhatsApp modifica datos, y además datos de SEGURIDAD: quién puede abrirle la puerta
 * a un desconocido. De ahí las verjas de abajo, que son más estrictas que las del
 * saldo y no menos.
 *
 * ── Quién puede gestionar ────────────────────────────────────────────────────
 * SÓLO el número del padrón, y sólo cuando es el de un dueño único de esa unidad.
 *
 *   · Un número que aparece en unidades de dueños DISTINTOS no gestiona nada. Para
 *     las cifras ya se le negaba —enseñarle el saldo de otro—; aquí sería peor:
 *     podría añadirse a sí mismo como autorizante de una casa que no es suya.
 *   · Un contacto de acceso TAMPOCO gestiona, aunque autorice visitas. El inquilino
 *     puede abrirle a quien llegue hoy; lo que no puede es nombrar a otros cinco que
 *     abran mañana. Eso es del dueño.
 *
 * ── Qué no puede hacer por aquí ──────────────────────────────────────────────
 * Un permiso SIN vencimiento —el jardinero de todos los martes para siempre— se queda
 * en el panel. Desde WhatsApp todo caduca, y se le dice cuándo. Un permiso que nadie
 * recuerda haber dado es la forma más común de perder el control de quién entra, y
 * dar esa herramienta por un mensaje de dos líneas es pedirlo.
 */

var ACC_DIAS_PERMISO_BOT = 90;   // lo que dura un permiso dejado por WhatsApp
var ACC_RES_MIN = 10;            // minutos que se recuerda una conversación a medias

/**
 * ¿Puede este número gestionar el acceso, y de qué unidades?
 *
 * Devuelve `{ ok, claves, nombre }` o `{ ok:false, por }` con el motivo en claro, que
 * es lo que se le va a decir.
 */
function _accPuedeGestionar(telefono) {
  if (typeof identificarPorCelular !== 'function') return { ok: false, por: 'sin-padron', claves: [] };
  var q = identificarPorCelular(telefono);
  if (q.motivo === 'varios-duenos') return { ok: false, por: 'varios-duenos', claves: [] };
  if (!q.prop) return { ok: false, por: 'no-esta-en-el-padron', claves: [] };
  var claves = (q.claves && q.claves.length) ? q.claves : [q.prop.clave];
  return { ok: true, claves: claves, nombre: String(q.prop.nombre || '') };
}

/**
 * ¿Quién puede DEJAR UN PERMISO, y para qué unidades?
 *
 * Más ancho que _accPuedeGestionar a propósito, y la distinción importa:
 *
 *   · Nombrar a quien autoriza es estructural — le da a una persona un poder que dura.
 *     Eso es del dueño y de nadie más.
 *   · Dejar un permiso a un visitante es exactamente lo que un autorizante ya hace a
 *     las nueve de la noche cuando la garita le pregunta, sólo que por adelantado.
 *     Negárselo sería decirle «puede abrirle la puerta ahora, pero no puede avisar de
 *     que viene». No tiene sentido: hace al residente llamar a la administración para
 *     algo que él ya está autorizado a decidir.
 *
 * Un contacto puede autorizar aunque su número esté en unidades de dueños distintos:
 * que el dueño lo haya cargado a mano en SU unidad es un permiso explícito, y no
 * depende de lo que diga el padrón sobre ese número.
 */
function _accPuedeAutorizar(telefono) {
  var claves = {}, nombre = '';
  var dueno = _accPuedeGestionar(telefono);
  if (dueno.ok) {
    dueno.claves.forEach(function (c) { claves[c] = true; });
    nombre = dueno.nombre;
  }
  var t = _accTel(telefono);
  getContactos('').forEach(function (c) {
    if (c.activo && c.autoriza && t && _accTel(c.celular) === t) {
      claves[c.clave] = true;
      if (!nombre) nombre = c.nombre;
    }
  });
  var lista = Object.keys(claves);
  if (!lista.length) return { ok: false, por: dueno.por || 'no-autoriza', claves: [] };
  return { ok: true, claves: lista, nombre: nombre, esDueno: !!dueno.ok };
}

/** La conversación a medias de este propietario. `null` la borra. */
function _accCharla(tel, obj) {
  var k = 'acc_res_' + String(tel).replace(/\D/g, '');
  try {
    var c = CacheService.getScriptCache();
    if (obj === null) { c.remove(k); return null; }
    if (obj) { c.put(k, JSON.stringify(obj), ACC_RES_MIN * 60); return obj; }
    var v = c.get(k);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

/** Fecha de caducidad de un permiso dejado por WhatsApp. */
function _accHasta() {
  var d = new Date();
  d.setDate(d.getDate() + ACC_DIAS_PERMISO_BOT);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

/* ─────────────── la conversación con el propietario ─────────────── */

var ACC_RES_QUIEN   = 'bot_acc_quien';     // «Quién autoriza mis visitas»
var ACC_RES_PERMISO = 'bot_acc_permiso';   // «Dejar un permiso»
var ACC_RES_QUITA   = 'bot_acc_quita_';    // quitar un contacto o un permiso
var ACC_RES_SI      = 'bot_acc_si';        // confirmar lo que se va a guardar
var ACC_RES_NO      = 'bot_acc_no';
var ACC_RES_UNIDAD  = 'bot_acc_unidad_';   // elegir unidad cuando tiene varias

/**
 * Todo lo que el propietario puede hacer con su acceso. Devuelve null si el mensaje
 * no era para aquí, y entonces el bot sigue su camino normal.
 */
function _botGestionAcceso(tel, msg, accion) {
  accion = String(accion || '');
  var charla = _accCharla(tel);
  var esTexto = String(msg.type || '') === 'text';
  var texto = esTexto ? String((msg.text && msg.text.body) || '').trim() : '';

  var mio = (accion === ACC_RES_QUIEN || accion === ACC_RES_PERMISO ||
             accion.indexOf(ACC_RES_QUITA) === 0 || accion === ACC_RES_SI ||
             accion === ACC_RES_NO || accion.indexOf(ACC_RES_UNIDAD) === 0);
  if (!mio && !(charla && esTexto)) return null;

  // «menú» sale de aquí siempre: quedarse atrapado en un formulario es la peor forma
  // de usar un bot, y quien escribe eso está pidiendo salir.
  if (esTexto && /^\s*(menu|menú|salir|cancelar)\s*$/i.test(texto)) {
    _accCharla(tel, null);
    _botDice(tel, 'Listo, lo dejamos ahí. ¿En qué le ayudamos?');
    return { contesto: true, avisar: false };
  }

  // Nombrar autorizantes es del dueño; dejar un permiso lo puede hacer cualquiera que
  // ya autorice visitas de esa unidad.
  var deContactos = (accion === ACC_RES_QUIEN) ||
                    (charla && charla.que === 'contacto') ||
                    (accion.indexOf(ACC_RES_QUITA + 'c|') === 0) ||
                    (accion.indexOf(ACC_RES_QUITA + 'C|') === 0);
  var puede = deContactos ? _accPuedeGestionar(tel) : _accPuedeAutorizar(tel);
  if (!puede.ok) {
    _accCharla(tel, null);
    if (puede.por === 'varios-duenos') {
      enviarWhatsAppTexto(tel,
        'Este número figura en más de ' + _acUn() + ' ' + _acUnidad() + ' a nombre de personas ' +
        'distintas, así que por aquí no podemos dejarle cambiar quién autoriza las visitas. ' +
        'La administración lo hace por usted.');
    } else {
      enviarWhatsAppTexto(tel, deContactos
        ? 'Cambiar QUIÉN autoriza las visitas sólo lo hace el propietario, desde el número que ' +
          'tenemos en el padrón. Usted sí puede dejar permisos a visitantes: toque «Dejar un ' +
          'permiso» en el menú.'
        : 'Para esto hace falta ser el propietario, o estar cargado como contacto que autoriza ' +
          'las visitas de una ' + _acUnidad() + '. Si cree que debería estarlo, pídaselo al dueño.');
    }
    return { contesto: true, avisar: true };
  }

  if (accion === ACC_RES_NO) {
    _accCharla(tel, null);
    _botDice(tel, 'No se guardó nada.');
    return { contesto: true, avisar: false };
  }

  // ¿De qué unidad hablamos? Con una sola no se pregunta.
  if (accion.indexOf(ACC_RES_UNIDAD) === 0 && charla) {
    charla.clave = accion.slice(ACC_RES_UNIDAD.length);
    _accCharla(tel, charla);
    return _accSeguir(tel, charla, puede);
  }

  if (accion === ACC_RES_QUIEN || accion === ACC_RES_PERMISO) {
    var nueva = { que: (accion === ACC_RES_QUIEN ? 'contacto' : 'permiso'),
                  clave: puede.claves.length === 1 ? puede.claves[0] : '' };
    _accCharla(tel, nueva);
    if (!nueva.clave) return _accPreguntarUnidad(tel, puede);
    return _accSeguir(tel, nueva, puede);
  }

  if (accion.indexOf(ACC_RES_QUITA) === 0) return _accQuitar(tel, accion.slice(ACC_RES_QUITA.length), puede);
  if (accion === ACC_RES_SI) return _accGuardarLoDicho(tel, charla, puede);

  // Un texto suelto: o es el dato que se le pidió, o no hay conversación viva.
  if (charla && esTexto) return _accRecibirDato(tel, charla, texto, puede);
  return null;
}

/**
 * El atajo: alguien que autoriza manda una cédula, sin pasar por el menú.
 *
 * Es como de verdad se usa esto. A un residente le escriben «mañana va Juan, cédula
 * 8-123-456», lo reenvía al bot y ya está; obligarle a abrir un menú de diez opciones
 * para algo que cabe en una línea es pedirle que no lo use.
 *
 * NO escribe nada: propone, y se guarda sólo si toca el botón. Y dice cómo salirse, que
 * un mensaje que alguien mandó con otra intención —«mi cédula es…»— no puede acabar en
 * un permiso de entrada.
 *
 * Devuelve null si esto no era un atajo, y el bot sigue su camino.
 */
function _botAtajoPermiso(tel, msg) {
  if (String(msg.type || '') !== 'text') return null;
  if (_accCharla(tel)) return null;                       // ya hay una conversación viva
  var texto = String((msg.text && msg.text.body) || '').trim();
  var ced = _accCedulaEnTexto(texto);
  if (!ced) return null;

  var puede = _accPuedeAutorizar(tel);
  if (!puede.ok) return null;                             // no autoriza: no es asunto suyo

  var clave = puede.claves.length === 1 ? puede.claves[0] : '';
  var d = _accLeerVisitaTexto(texto);
  var nombre = String(d.visitante || '').trim();

  var charla = { que: 'permiso', clave: clave, cedula: ced, nombre: nombre };

  if (!clave) {                                           // autoriza en varias unidades
    charla.paso = 'espera-permiso';
    _accCharla(tel, charla);
    return _accPreguntarUnidad(tel, puede);
  }
  if (!nombre) {
    charla.paso = 'espera-permiso';
    _accCharla(tel, charla);
    enviarWhatsAppTexto(tel,
      'Veo la cédula ' + ced + '. ¿Cómo se llama quien viene?\n\n' +
      'Si no era eso lo que buscaba, escriba «menú».');
    return { contesto: true, avisar: false };
  }

  charla.paso = 'confirma-permiso';
  _accCharla(tel, charla);
  var hasta = _accHasta();
  _waEnviarBotones(tel,
    '¿Le dejo permiso de entrada?\n\n*' + nombre + '*\nCédula ' + ced + '\n' +
    _acUnidadCap() + ' ' + clave + '\n\nVale hasta el ' + _fechaCorta(hasta) + '.' +
    '\n\n_Si buscaba otra cosa, toque No._',
    [_botBoton(ACC_RES_SI, 'Sí, dejarlo'), _botBoton(ACC_RES_NO, 'No')]);
  return { contesto: true, avisar: false };
}

/** Con varias unidades a su nombre hay que saber de cuál habla. */
function _accPreguntarUnidad(tel, puede) {
  var filas = puede.claves.slice(0, 10).map(function (c) {
    return { id: ACC_RES_UNIDAD + c, title: String(c).slice(0, 24),
             description: _accDeQuien(c).slice(0, 72) };
  });
  _waEnviarLista(tel, '¿De cuál de sus ' + _acPlural(_acUnidad()) + ' hablamos?',
    'Elegir', [{ title: _acUnidadCap(), rows: filas }]);
  return { contesto: true, avisar: false };
}

function _acUnidadCap() {
  var u = _acUnidad();
  return u.charAt(0).toUpperCase() + u.slice(1);
}

/** Enseña lo que hay y pide lo que falta. */
function _accSeguir(tel, charla, puede) {
  var clave = charla.clave;
  if (charla.que === 'contacto') {
    var cs = getContactos(clave).filter(function (c) { return c.activo; });
    var quedan = ACC_MAX_CONTACTOS - cs.filter(function (c) { return c.autoriza; }).length;
    var lista = cs.length
      ? cs.map(function (c) { return '· ' + c.nombre + (c.autoriza ? ' — ' + c.celular : ' (no autoriza)'); }).join('\n')
      : '(todavía ninguno: hoy sus visitas se le preguntan a este mismo número)';

    var cuerpo = 'Quién puede autorizar las visitas del ' + _acUnidad() + ' ' + clave + ':\n\n' + lista +
      '\n\nPuede tener hasta ' + ACC_MAX_CONTACTOS + '. ' +
      (quedan > 0
        ? 'Para agregar a alguien, mándeme su nombre y su celular en un mensaje. Por ejemplo:\n' +
          '«Carlos Pérez 6000-1111»'
        : 'Ya está en el tope; quite a uno para agregar otro.');

    var botones = [];
    if (cs.length) botones.push(_botBoton(ACC_RES_QUITA + 'c|' + clave, 'Quitar a alguien'));
    if (botones.length) _waEnviarBotones(tel, cuerpo, botones);
    else enviarWhatsAppTexto(tel, cuerpo);
    charla.paso = 'espera-contacto';
    _accCharla(tel, charla);
    return { contesto: true, avisar: false };
  }

  var as = getAutorizaciones(clave).filter(function (a) { return a.activo; });
  var lp = as.length
    ? as.map(function (a) { return '· ' + a.visitante + (a.cedula ? ' — ' + a.cedula : ' (sin cédula)'); }).join('\n')
    : '(ninguno todavía)';
  var txt = 'Permisos dejados para el ' + _acUnidad() + ' ' + clave + ':\n\n' + lp +
    '\n\nPara dejar uno nuevo, mándeme el nombre de quien va a visitarle y su cédula si la sabe:\n' +
    '«Juan Pérez 8-123-456»\n\n' +
    'Sin la cédula, la garita sólo puede comparar el nombre, y así se lo dirá al guardia.';
  var bs = [];
  if (as.length) bs.push(_botBoton(ACC_RES_QUITA + 'a|' + clave, 'Quitar un permiso'));
  if (bs.length) _waEnviarBotones(tel, txt, bs);
  else enviarWhatsAppTexto(tel, txt);
  charla.paso = 'espera-permiso';
  _accCharla(tel, charla);
  return { contesto: true, avisar: false };
}

/**
 * Lo que el propietario tecleó. Se lee con el mismo candado que el anuncio del
 * guardia: de lo que devuelve el modelo no se usa nada que no estuviera escrito.
 */
function _accRecibirDato(tel, charla, texto, puede) {
  var d = _accLeerVisitaTexto(texto);
  var nombre = String(d.visitante || '').trim();
  var cel = '';
  var ced = String(d.cedula || '').trim();

  if (charla.paso === 'espera-contacto') {
    // Para un contacto lo que hace falta es el CELULAR, no la cédula.
    var m = /(\+?\d[\d\s\-()]{6,})/.exec(texto);
    cel = m ? m[1].trim() : '';
    if (!nombre) nombre = texto.replace(/(\+?\d[\d\s\-()]{6,})/, '').replace(/[,;]/g, ' ').trim();
    if (!nombre || !cel) {
      enviarWhatsAppTexto(tel,
        'Me falta ' + (!nombre ? 'el nombre' : 'el celular') + '. Mándemelo así:\n' +
        '«Carlos Pérez 6000-1111»');
      return { contesto: true, avisar: false };
    }
    var n = normalizarCelular(cel);
    if (!n.ok) {
      enviarWhatsAppTexto(tel, 'Ese celular no se puede usar: ' + (n.por || 'no se entiende') +
        '. Mándemelo otra vez.');
      return { contesto: true, avisar: false };
    }
    charla.nombre = nombre; charla.celular = n.e164; charla.paso = 'confirma-contacto';
    _accCharla(tel, charla);
    _waEnviarBotones(tel,
      '¿Guardo esto?\n\n*' + nombre + '*\n' + n.e164 + '\n' + _acUnidadCap() + ' ' + charla.clave +
      '\n\nCuando llegue una visita para usted, se le preguntará también a este número.',
      [_botBoton(ACC_RES_SI, 'Sí, guardar'), _botBoton(ACC_RES_NO, 'No')]);
    return { contesto: true, avisar: false };
  }

  if (charla.paso === 'espera-permiso') {
    if (!nombre) {
      enviarWhatsAppTexto(tel,
        'No saqué de ahí el nombre del visitante. Mándemelo así:\n«Juan Pérez 8-123-456»');
      return { contesto: true, avisar: false };
    }
    // Lo que ya venía en la charla NO se pisa con el vacío de este mensaje. El atajo
    // guarda la cédula del primer mensaje y luego pregunta el nombre: sobrescribirla
    // con lo que trae la respuesta —que sólo trae el nombre— la perdía por el camino.
    charla.nombre = nombre;
    if (ced) charla.cedula = ced;
    charla.cedula = String(charla.cedula || '');
    charla.paso = 'confirma-permiso';
    _accCharla(tel, charla);
    var hasta = _accHasta();
    var cedFinal = charla.cedula;
    _waEnviarBotones(tel,
      '¿Dejo el permiso?\n\n*' + nombre + '*\n' + (cedFinal ? 'Cédula ' + cedFinal : '_sin cédula_') +
      '\n' + _acUnidadCap() + ' ' + charla.clave +
      '\n\nVale hasta el ' + _fechaCorta(hasta) + '. Después hay que volver a dejarlo.' +
      (cedFinal ? '' : '\n\nSin cédula, el guardia sabrá que la coincidencia es sólo por el nombre.'),
      [_botBoton(ACC_RES_SI, 'Sí, dejarlo'), _botBoton(ACC_RES_NO, 'No')]);
    return { contesto: true, avisar: false };
  }
  return null;
}

/** Escribe lo que se acaba de confirmar. */
function _accGuardarLoDicho(tel, charla, puede) {
  if (!charla || !charla.clave) { _accCharla(tel, null); return null; }
  // Cinturón: la unidad de la charla tiene que seguir siendo suya. La charla vive en
  // una caché de diez minutos y lo que se escribe con ella es de seguridad.
  if (puede.claves.indexOf(charla.clave) < 0) {
    _accCharla(tel, null);
    enviarWhatsAppTexto(tel, 'Esa ' + _acUnidad() + ' no figura a su nombre. No se guardó nada.');
    return { contesto: true, avisar: true };
  }

  try {
    if (charla.paso === 'confirma-contacto') {
      guardarContacto({ clave: charla.clave, nombre: charla.nombre, celular: charla.celular,
                        rol: 'otro', autoriza: true, activo: true, orden: 1,
                        notas: 'Cargado por el propietario desde WhatsApp.' });
      _accCharla(tel, null);
      enviarWhatsAppTexto(tel, '✅ Guardado. A *' + charla.nombre +
        '* se le preguntará cuando llegue una visita para su ' + _acUnidad() + '.');
      return { contesto: true, avisar: false };
    }
    if (charla.paso === 'confirma-permiso') {
      var hasta = _accHasta();
      guardarAutorizacion({ clave: charla.clave, visitante: charla.nombre, cedula: charla.cedula,
                            desde: new Date(), hasta: hasta, creadoPor: puede.nombre,
                            activo: true, notas: 'Dejado por el propietario desde WhatsApp.' });
      _accCharla(tel, null);
      enviarWhatsAppTexto(tel, '✅ Listo. *' + charla.nombre + '* puede entrar sin que le llamemos, ' +
        'hasta el ' + _fechaCorta(hasta) + '.\n\nAbajo le dejo un mensaje para reenviarle, con ' +
        'la dirección y cómo llegar.');
      // Aparte, y sin nada alrededor: así se reenvía entero de un toque.
      enviarWhatsAppTexto(tel, _accMensajeParaVisitante(charla.nombre, charla.clave, hasta));
      return { contesto: true, avisar: false };
    }
  } catch (e) {
    _accCharla(tel, null);
    enviarWhatsAppTexto(tel, 'No pude guardarlo: ' + (e && e.message || e));
    return { contesto: true, avisar: true };
  }
  return null;
}

/**
 * El mensaje que el residente le REENVÍA a su visitante.
 *
 * ── Por qué reenviado y no directo ───────────────────────────────────────────
 * Mandárselo el sistema directamente parecía lo obvio, y es lo que no se hace:
 *
 *   · No tenemos su número. Una autorización guarda nombre y cédula, no celular.
 *   · El visitante es un tercero que nunca firmó nada con la asociación, y su número
 *     nos lo daría OTRA persona. Escribirle por iniciativa nuestra no es lo mismo que
 *     guardarle la cédula por seguridad: es contacto sin su consentimiento. La misma
 *     Ley 81 que obliga a borrar la foto a los 90 días.
 *   · Meta exige consentimiento para las plantillas. Un visitante que no lo esperaba la
 *     reporta como spam y la calidad del WABA cae — y ese WABA es UNO para todas las
 *     comunidades. Un número bloqueado no afecta a una: las afecta a todas.
 *   · Y un dígito mal tecleado le diría a un desconocido que la garita lo va a dejar
 *     pasar, con la dirección incluida.
 *
 * Reenviado, el consentimiento es del residente por definición: él decide a quién se
 * lo manda, desde su propia conversación. Mismo contenido, sin nada de lo anterior.
 *
 * Va como mensaje aparte y sin adornos, para que se reenvíe entero de un toque.
 */
function _accMensajeParaVisitante(nombre, clave, hasta) {
  var negocio = (typeof CONFIG !== 'undefined' && CONFIG.NEGOCIO) || 'la comunidad';
  var quien = _accDeQuien(clave);
  var t = 'Está autorizado para entrar a ' + negocio + '.\n\n' +
          'Visitante: ' + String(nombre || '') + '\n' +
          'Lo autoriza: ' + quien + '\n' +
          'Válido hasta el ' + _fechaCorta(hasta) + '\n\n' +
          'Presente su cédula en la garita.';

  var dir  = (typeof CONFIG !== 'undefined' && CONFIG.DIRECCION) || '';
  var maps = (typeof CONFIG !== 'undefined' && CONFIG.MAPS_URL) || '';
  var waze = (typeof CONFIG !== 'undefined' && CONFIG.WAZE_URL) || '';
  if (dir || maps || waze) {
    t += '\n\n📍 Cómo llegar';
    if (dir)  t += '\n' + dir;
    if (maps) t += '\nMaps: ' + maps;
    if (waze) t += '\nWaze: ' + waze;
  }
  return t;
}

/** Quitar: se enseña la lista y se quita de un toque. */
function _accQuitar(tel, resto, puede) {
  var partes = String(resto).split('|');
  var tipo = partes[0], clave = partes[1] || '';

  // Segundo toque: viene el id concreto.
  if (tipo === 'C' || tipo === 'A') {
    var id = partes[1] || '';
    try {
      if (tipo === 'C') { _accSoloSuyo(getContactos(''), id, puede); eliminarContacto(id); }
      else { _accSoloSuyo(getAutorizaciones(''), id, puede); eliminarAutorizacion(id); }
      enviarWhatsAppTexto(tel, '✅ Quitado.');
    } catch (e) {
      enviarWhatsAppTexto(tel, 'No pude quitarlo: ' + (e && e.message || e));
    }
    _accCharla(tel, null);
    return { contesto: true, avisar: false };
  }

  // Primer toque: la lista.
  if (puede.claves.indexOf(clave) < 0) return null;
  var filas = (tipo === 'c'
    ? getContactos(clave).filter(function (c) { return c.activo; })
        .map(function (c) { return { id: ACC_RES_QUITA + 'C|' + c.id, title: c.nombre.slice(0, 24),
                                     description: (c.celular || '').slice(0, 72) }; })
    : getAutorizaciones(clave).filter(function (a) { return a.activo; })
        .map(function (a) { return { id: ACC_RES_QUITA + 'A|' + a.id, title: a.visitante.slice(0, 24),
                                     description: (a.cedula || 'sin cédula').slice(0, 72) }; })
  ).slice(0, 10);

  if (!filas.length) { enviarWhatsAppTexto(tel, 'No hay nada que quitar.'); return { contesto: true, avisar: false }; }
  _waEnviarLista(tel, '¿Cuál quito?', 'Ver', [{ title: 'Toque uno', rows: filas }]);
  return { contesto: true, avisar: false };
}

/**
 * Que la fila que va a borrarse sea de una unidad suya.
 *
 * Los identificadores viajan dentro del botón, y un botón es un dato que vuelve del
 * teléfono de alguien: no se borra nada sin comprobar de quién era.
 */
function _accSoloSuyo(filas, id, puede) {
  var suya = null;
  filas.forEach(function (f) { if (f.id === id) suya = f; });
  if (!suya) throw new Error('Ya no existe.');
  if (puede.claves.indexOf(suya.clave) < 0) throw new Error('Eso no es de una ' + _acUnidad() + ' suya.');
  return suya;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA SALIDA · cerrar el registro
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La columna `salida` existía desde el primer día y NADA la escribía: la bitácora
 * decía siempre «—». Un registro de entradas que nunca se cierra contesta media
 * pregunta — sabe quién entró y no sabe quién sigue dentro, que es justo lo que hace
 * falta a las dos de la mañana, o cuando alguien pregunta por un carro que lleva
 * cuatro horas estacionado.
 *
 * ── Por qué por lista y no escribiendo ───────────────────────────────────────
 * El guardia no va a teclear «salió Juan Pérez» cuatro horas después, con el nombre
 * bien escrito. Pide la lista de quién está dentro y toca uno. De paso, esa misma
 * lista es la respuesta a «¿quién hay adentro?», que es la pregunta que de verdad se
 * hace. Una sola función para las dos cosas.
 *
 * ── Qué cuenta como «dentro» ─────────────────────────────────────────────────
 * Sólo lo que el registro dice que ENTRÓ: autorizada o preautorizada, y sin salida
 * anotada. Una visita «pendiente» no se pone en la lista aunque el guardia la haya
 * dejado pasar de hecho: el sistema no sabe que entró, y ponerla ahí sería afirmar
 * algo que nadie confirmó.
 */

var ACC_HORAS_ADENTRO = 24;   // hasta cuándo una entrada sin salida es «de ahora»

function _accEntro(estado) {
  var e = String(estado || '');
  return e === 'autorizada' || e === 'preautorizada';
}

/**
 * Quién sigue dentro. `horas` acota a las entradas recientes; sin acotar, todas.
 *
 * Las de hace tres días no se enseñan al guardia —son ruido en su lista, y casi
 * siempre significan que nadie anotó la salida— pero no se borran ni se dan por
 * cerradas: salen aparte, como lo que son, un registro a medias.
 */
function visitasAdentro(horas) {
  _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  return _accDentroDe(_sheetRows(ACC_SH.VISITAS), horas);
}

/**
 * Lo mismo, sobre filas ya leídas.
 *
 * Existe porque el panel necesitaba tres cosas de la misma hoja —las últimas cien, los
 * que están dentro y los que quedaron sin cerrar— y las pedía por separado: tres
 * lecturas completas de la hoja de visitas en cada carga. Con unos miles de filas eso
 * se nota, y crece cada día que pasa.
 */
function _accDentroDe(filas, horas) {
  var corte = horas ? (new Date().getTime() - horas * 3600 * 1000) : 0;
  return filas
    .filter(function (v) {
      if (!_accEntro(v.estado)) return false;
      if (String(v.salida || '').trim() || v.salida instanceof Date) return false;
      if (!corte) return true;
      return (v.fecha instanceof Date) && v.fecha.getTime() >= corte;
    })
    .map(function (v) {
      return { id: String(v.id || ''), visitante: String(v.visitante || ''),
               cedula: String(v.cedula || ''), clave: String(v.clave || ''),
               lote: String(v.lote || ''), fecha: v.fecha,
               desde: (v.fecha instanceof Date) ? _accFechaHora(v.fecha) : '',
               guardia: String(v.guardia || '') };
    })
    .reverse();   // el último que entró, primero
}


/** «2 h 15 min», para decirle al guardia cuánto estuvo dentro. */
function _accDuracion(entrada, salida) {
  if (!(entrada instanceof Date)) return '';
  var min = Math.round((salida.getTime() - entrada.getTime()) / 60000);
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return min + ' min';
  var h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}

/**
 * Anota que alguien salió.
 *
 * No cambia el estado: quien entró autorizado sigue habiendo entrado autorizado. Lo
 * único que se añade es cuándo se fue.
 */
function registrarSalida(id, guardia) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el identificador de la visita.');
  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iSal = h.indexOf('salida'), iFe = h.indexOf('fecha');

  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== id) continue;
    if (vals[r][iSal] instanceof Date) {
      return { ok: false, yaSalio: true, id: id,
               visitante: String(vals[r][h.indexOf('visitante')] || ''),
               salida: _accFechaHora(vals[r][iSal]) };
    }
    var ahora = new Date();
    sh.getRange(r + 1, iSal + 1).setValue(ahora);
    var dur = _accDuracion(vals[r][iFe], ahora);
    _reg('visita.salida', { entidad: 'visita', clave: String(vals[r][h.indexOf('clave')] || ''),
      propietario: String(vals[r][h.indexOf('visitante')] || ''),
      detalle: 'Salida anotada' + (dur ? ' · estuvo ' + dur : '') +
               (guardia ? ' · ' + guardia : '') });
    return { ok: true, id: id, visitante: String(vals[r][h.indexOf('visitante')] || ''),
             duracion: dur, salida: _accFechaHora(ahora) };
  }
  throw new Error('No se encontró la visita ' + id + '.');
}

/**
 * La lista de quién está dentro, para que el guardia toque al que salió.
 *
 * ── El tope de diez ──────────────────────────────────────────────────────────
 * WhatsApp admite DIEZ filas por lista, sumando todas las secciones. La primera
 * versión enseñaba las diez últimas y decía «de 15» — o sea, que a los cinco
 * restantes no había forma de anotarles la salida. Un tope que se anuncia sigue
 * siendo un tope: en una comunidad con una fiesta dentro, esos cinco son justo los
 * que van a salir.
 *
 * Con más de diez se enseñan NUEVE y la décima fila es «Ver más». Cuesta una fila y
 * llega a todos. El punto de partida viaja dentro del identificador del botón, así
 * que no hace falta recordar nada entre mensajes.
 *
 * Y se puede filtrar escribiendo: «adentro juan» enseña sólo los que casan. Con
 * treinta personas dentro es más rápido que pasar tres páginas.
 */
function _accListaAdentro(tel, desde, filtro) {
  desde = Number(desde) || 0;
  filtro = String(filtro || '').trim();

  var todos = visitasAdentro(ACC_HORAS_ADENTRO);
  var dentro = todos;
  if (filtro) {
    var f = _accNombre(filtro);
    dentro = todos.filter(function (v) {
      return _accNombre(v.visitante).indexOf(f) >= 0 ||
             _accNombre(v.lote || v.clave).indexOf(f) >= 0;
    });
  }

  if (!todos.length) {
    enviarWhatsAppTexto(tel,
      'No hay nadie adentro con entrada anotada en las últimas ' + ACC_HORAS_ADENTRO + ' horas.');
    return { contesto: true, avisar: false };
  }
  if (!dentro.length) {
    enviarWhatsAppTexto(tel,
      'Nadie de los ' + todos.length + ' que están adentro casa con «' + filtro + '».\n' +
      'Escriba «adentro» a secas para verlos todos.');
    return { contesto: true, avisar: false };
  }

  // Con más de diez, la última fila se gasta en «Ver más».
  var quedan = dentro.length - desde;
  var cabenTodas = quedan <= 10;
  var pagina = dentro.slice(desde, desde + (cabenTodas ? 10 : 9));

  var filas = pagina.map(function (v) {
    return { id: ACC_BOT_SAL + v.id,
             title: String(v.visitante || 'Sin nombre').slice(0, 24),
             description: ((v.lote || v.clave) ? _acUnidadCap() + ' ' + (v.lote || v.clave) + ' · ' : '') +
                          'entró ' + v.desde };
  });
  if (!cabenTodas) {
    var restantes = dentro.length - (desde + 9);
    filas.push({ id: ACC_BOT_MAS + (desde + 9), title: 'Ver más',
                 description: 'Quedan ' + restantes + ' por mostrar' });
  }

  var cab;
  if (filtro) {
    cab = dentro.length + ' de ' + todos.length + ' casan con «' + filtro + '».';
  } else {
    cab = dentro.length + (dentro.length === 1 ? ' visita adentro' : ' visitas adentro') + '.';
  }
  cab += '\nToque a quien acaba de salir.';
  if (!cabenTodas || desde) {
    cab += '\n\n_Mostrando ' + (desde + 1) + '–' + (desde + pagina.length) + ' de ' + dentro.length + '._';
  }
  if (!filtro && dentro.length > 10) {
    cab += '\nTambién puede escribir «adentro» y un nombre para buscar.';
  }

  _waEnviarLista(tel, cab, 'Ver quién está', [{ title: 'Adentro ahora', rows: filas }]);
  return { contesto: true, avisar: false };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LO QUE LA ADMINISTRACIÓN PUEDE ARREGLAR DESDE EL PANEL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hasta aquí el panel veía la bitácora entera y no podía tocar una sola fila. Eso
 * dejaba dos promesas sin cumplir: el panel avisa de «2 entradas sin salida anotada»
 * y no daba forma de cerrarlas, y las visitas que quedaron en «pendiente» hace días
 * se quedaban ahí para siempre ensuciando el registro.
 *
 * ── Lo que SÍ, y lo que NO ───────────────────────────────────────────────────
 * Se puede: anotar una salida que el guardia olvidó, cerrar una pendiente vieja, y
 * corregir un nombre o una cédula mal leídos.
 *
 * NO se puede AUTORIZAR una entrada desde el panel, y no es un olvido. El guardia
 * tiene el documento en la mano; quien mira el panel no ve a nadie. Autorizar desde
 * aquí es autorizar a alguien que no se ve, fiándose de lo que leyó el sistema — es
 * una decisión distinta y más floja, y si algún día hace falta tendrá su propio botón
 * diciendo que el guardia no estaba disponible, no este.
 *
 * ── La atribución es el producto ─────────────────────────────────────────────
 * Todo lo de aquí queda como «Administración · <quien>», nunca como si lo hubiera
 * hecho el guardia. Dentro de tres meses, la diferencia entre «lo decidió quien tenía
 * el documento delante» y «lo arregló la administración desde la oficina» es toda la
 * conversación.
 */

/** Quién está usando el panel, para firmar lo que cambia. */
function _accQuienPanel() {
  var a = '';
  try { a = String(typeof AC_AUTOR !== 'undefined' ? AC_AUTOR : '').trim(); } catch (e) {}
  return 'Administración · ' + (a || 'sin identificar');
}

/**
 * Anota una salida que el guardia olvidó.
 *
 * Sólo sobre una visita que CONSTA que entró. Anotarle la salida a una «pendiente»
 * o a una «rechazada» afirmaría que entró, que es justo lo que el registro no dice.
 */
function anotarSalidaDesdePanel(id) {
  var v = _accBuscarVisita(id);
  if (!_accEntro(v.estado)) {
    throw new Error('Esa visita está como «' + v.estado + '»: el registro no dice que ' +
      'entrara, así que no se le puede anotar una salida. Ciérrala primero si nadie contestó.');
  }
  var r = registrarSalida(id, _accQuienPanel());
  if (r.yaSalio) throw new Error('Ya tenía salida anotada: ' + r.salida + '.');
  return r;
}

/**
 * Cierra una visita que quedó pendiente y que ya nadie va a decidir.
 *
 * Sólo a «sin-respuesta» o «rechazada»: las dos formas de decir que no entró. Desde el
 * panel NO se puede poner «autorizada» — ver arriba.
 */
var ACC_CIERRES_PANEL = ['sin-respuesta', 'rechazada'];

function cerrarVisitaDesdePanel(id, estado) {
  estado = String(estado || 'sin-respuesta');
  if (ACC_CIERRES_PANEL.indexOf(estado) < 0) {
    throw new Error('Desde el panel una visita sólo se puede cerrar como ' +
      ACC_CIERRES_PANEL.join(' o ') + '. Autorizar una entrada lo hace quien tiene el ' +
      'documento delante, no el panel.');
  }
  var v = _accBuscarVisita(id);
  if (v.estado !== 'pendiente') {
    throw new Error('Esa visita ya está como «' + v.estado + '»; sólo se cierran las pendientes.');
  }

  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== String(id).trim()) continue;
    sh.getRange(r + 1, h.indexOf('estado') + 1).setValue(estado);
    sh.getRange(r + 1, h.indexOf('autorizadoPor') + 1).setValue(_accQuienPanel());
    sh.getRange(r + 1, h.indexOf('autorizadoEn') + 1).setValue(new Date());
    _reg('visita.resuelve', { entidad: 'visita', clave: String(v.clave || ''),
      propietario: String(v.visitante || ''),
      detalle: estado + ' · cerrada desde el panel, nadie la decidió a tiempo' });
    return { ok: true, id: id, estado: estado };
  }
  throw new Error('No se encontró la visita ' + id + '.');
}

/**
 * Corrige el nombre o la cédula de una visita ya anotada.
 *
 * Se puede sobre una visita cerrada, a diferencia de la corrección del guardia, que
 * sólo vale en los quince minutos siguientes y antes de decidir. Si esa bitácora acaba
 * delante de un abogado o de la policía, un dato mal leído tiene que poder arreglarse —
 * y tiene que verse que se arregló, y qué decía antes.
 */
function corregirVisitaDesdePanel(id, datos) {
  datos = datos || {};
  var nombre = String(datos.visitante || '').trim();
  var ced = String(datos.cedula || '').trim();
  if (!nombre && !ced) throw new Error('No hay nada que corregir: manda el nombre o la cédula.');
  var v = _accBuscarVisita(id);

  var sh = _accSheet(ACC_SH.VISITAS, ACC_COL_VISITAS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id');
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iId]).trim() !== String(id).trim()) continue;
    var antes = String(vals[r][h.indexOf('visitante')] || '') + ' / ' +
                String(vals[r][h.indexOf('cedula')] || '');
    if (nombre) sh.getRange(r + 1, h.indexOf('visitante') + 1).setValue(nombre);
    if (ced)    sh.getRange(r + 1, h.indexOf('cedula') + 1).setValue(ced);
    var notaVieja = String(vals[r][h.indexOf('notas')] || '');
    sh.getRange(r + 1, h.indexOf('notas') + 1).setValue(
      (notaVieja ? notaVieja + ' | ' : '') +
      'Corregida por ' + _accQuienPanel() + ' el ' + _accFechaHora(new Date()) +
      '. Antes decía: ' + antes);
    _reg('visita.corrige', { entidad: 'visita', clave: String(v.clave || ''),
      propietario: nombre || String(v.visitante || ''),
      detalle: 'Corregida desde el panel. Antes decía: ' + antes });
    return { ok: true, id: id, antes: antes };
  }
  throw new Error('No se encontró la visita ' + id + '.');
}

/** Una visita por su identificador, o error. */
function _accBuscarVisita(id) {
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el identificador de la visita.');
  var hallada = null;
  _sheetRows(ACC_SH.VISITAS).forEach(function (v) {
    if (String(v.id || '').trim() === id) hallada = v;
  });
  if (!hallada) throw new Error('No se encontró la visita ' + id + '.');
  return hallada;
}
