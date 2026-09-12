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
  if (!garitas.length) console.log('· Sin garita registrada, ningún guardia puede usar el sistema: guardarGarita().');
  if (!unidades)       console.log('· Sin contactos, cada visita cae al celular del padrón, que no siempre es quien está en la casa.');
  if (!purga)          console.log('· Ley 81: instala el borrado automático de fotos con instalarBorradoDeFotos().');

  return { ok: true, activo: true, garitas: garitas.length, unidadesConContactos: unidades,
           purgaInstalada: !!purga };
}
