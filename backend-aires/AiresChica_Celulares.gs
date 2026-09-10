/**
 * Celulares del padrón: normalizarlos y reconocer a quién pertenecen.
 *
 * Es la fase 0 del bot de WhatsApp, y es bloqueante: el número de teléfono va a ser
 * la LLAVE DE IDENTIDAD del bot —alguien escribe y el sistema sabe de qué lote es sin
 * preguntárselo—, y eso sólo funciona si el número está guardado de una forma que la
 * API de WhatsApp entienda. Hoy el celular sólo se mira; nadie lo valida.
 *
 * El formato de la API es E.164: el signo +, el código de país y el número, sin
 * espacios ni guiones. Un móvil panameño son 8 dígitos que empiezan por 6, así que
 * 6090-9384 se guarda como +50760909384.
 *
 * Hay propietarios en España y Estados Unidos, así que los números de fuera son
 * legítimos y se conservan: lo que se descarta es lo que no se puede convertir.
 *
 * Funciones:
 *   normalizarCelular(raw)              — un número: qué es y qué tiene de malo
 *   revisarCelularesPropietarios()      — diagnóstico de TODO el padrón (para el editor)
 *   normalizarCelularesPropietarios(ap) — reescribe el padrón en E.164 (ensayo por defecto)
 *   propietarioPorCelular(tel)          — de quién es este número (la usará el bot)
 */

// Lotes que no se tocan por decisión del administrador. La normalización los deja
// como están y lo dice, en vez de saltárselos en silencio.
var CEL_INTOCABLES = ['L-4A', 'L-5'];

// Códigos de país que aparecen en el padrón. Sirven para reconocer un número que ya
// viene con su prefijo pero sin el +, que es como suele quedar al copiarlo.
var CEL_PAISES = [
  { cc: '507', nombre: 'Panamá',         largo: [8] },
  { cc: '34',  nombre: 'España',         largo: [9] },
  { cc: '1',   nombre: 'EE. UU./Canadá', largo: [10] }
];

/**
 * Qué es este número y, si no sirve, por qué.
 *
 * Devuelve { ok, e164, pais, por, visible, partes }. `visible` sustituye lo que no se
 * ve por su código: los espacios duros salen al copiar de un PDF o de WhatsApp y en la
 * celda no se distinguen de un espacio normal. `partes` trae los trozos cuando la
 * celda contiene más de un número, que es el caso que hay que preguntar y no adivinar.
 */
function normalizarCelular(raw) {
  var s = String(raw == null ? '' : raw);
  var visible = s.replace(/[^\x20-\x7E]/g, function (ch) {
    return '‹U+' + ('000' + ch.charCodeAt(0).toString(16).toUpperCase()).slice(-4) + '›';
  });
  var t = s.trim();
  if (!t) return { ok: false, e164: '', pais: '', por: 'está vacío', visible: visible, partes: [] };

  // Una celda con dos números no se puede resolver sola: cuál es el de WhatsApp lo
  // sabe el propietario, no el sistema.
  var partes = t.split(/[,;\/]|\s+y\s+|\s+ó\s+|\s+o\s+/i)
    .map(function (x) { return String(x).trim(); })
    .filter(function (x) { return /\d/.test(x); });
  if (partes.length > 1) {
    return { ok: false, e164: '', pais: '', partes: partes, visible: visible,
             por: 'hay ' + partes.length + ' números en la misma celda: hay que elegir cuál es el de WhatsApp' };
  }

  var masMas = /^\s*\+/.test(t);
  var d = t.replace(/\D/g, '');
  if (!d) return { ok: false, e164: '', pais: '', por: 'no tiene dígitos', visible: visible, partes: [] };

  // 1) Ya viene internacional, con + o sin él: se respeta su país.
  for (var i = 0; i < CEL_PAISES.length; i++) {
    var p = CEL_PAISES[i];
    if (d.indexOf(p.cc) !== 0) continue;
    var resto = d.slice(p.cc.length);
    if (p.largo.indexOf(resto.length) >= 0) {
      // Un panameño de 8 dígitos que empieza por 6 es móvil; los demás, fijos.
      if (p.cc === '507' && resto.charAt(0) !== '6') {
        return { ok: false, e164: '', pais: p.nombre, visible: visible, partes: [],
                 por: 'parece un teléfono fijo (' + resto + '), no un celular: WhatsApp no le llega' };
      }
      return { ok: true, e164: '+' + d, pais: p.nombre, por: '', visible: visible, partes: [] };
    }
  }

  // 2) Un móvil panameño escrito a la panameña: 8 dígitos que empiezan por 6.
  if (d.length === 8 && d.charAt(0) === '6' && !masMas) {
    return { ok: true, e164: '+507' + d, pais: 'Panamá', por: '', visible: visible, partes: [] };
  }
  if (d.length === 8 && !masMas) {
    return { ok: false, e164: '', pais: 'Panamá', visible: visible, partes: [],
             por: 'ocho dígitos pero no empieza por 6: parece un fijo, no un celular' };
  }
  if (d.length === 7 && !masMas) {
    return { ok: false, e164: '', pais: 'Panamá', visible: visible, partes: [],
             por: 'siete dígitos: es un fijo de los de antes, o le falta un dígito' };
  }
  return { ok: false, e164: '', pais: '', visible: visible, partes: [],
           por: 'no se reconoce como un número marcable (' + d.length + ' dígitos)' };
}

/**
 * DIAGNÓSTICO — ejecuta esto en el editor de Apps Script.
 *
 * Dice qué celulares del padrón no sirven para WhatsApp y por qué, ANTES de montar
 * nada. Escribe en el log porque el editor no muestra el valor de retorno.
 */
function revisarCelularesPropietarios() {
  var props = getPropietarios();
  var bien = [], malos = [], sin = [], fuera = {};
  props.forEach(function (p) {
    var n = normalizarCelular(p.celular);
    if (n.ok) { bien.push({ p: p, n: n }); fuera[n.pais] = (fuera[n.pais] || 0) + 1; return; }
    (String(p.celular || '').trim() ? malos : sin).push({ p: p, n: n });
  });

  console.log('════ CELULARES DEL PADRÓN ════');
  console.log('Revisados: %s · listos para WhatsApp: %s · hay que corregir: %s · sin celular: %s',
    props.length, bien.length, malos.length, sin.length);
  console.log('Por país: %s', Object.keys(fuera).map(function (k) { return k + ' ' + fuera[k]; }).join(' · ') || '—');

  var cambian = bien.filter(function (x) { return String(x.p.celular).trim() !== x.n.e164; });
  console.log('\nDe los que sirven, %s están escritos de otra forma y se reescribirían al normalizar.', cambian.length);
  cambian.slice(0, 8).forEach(function (x) {
    console.log('   %s · %s   «%s»  →  %s', x.p.clave, x.p.nombre, x.p.celular, x.n.e164);
  });
  if (cambian.length > 8) console.log('   … y %s más.', cambian.length - 8);

  if (malos.length) {
    console.log('\n──── HAY QUE CORREGIRLOS A MANO ────');
    malos.forEach(function (m) {
      console.log('\n%s · %s · Lote %s', m.p.clave, m.p.nombre, m.p.lote);
      console.log('   guardado : «%s»', m.n.visible);
      console.log('   problema : %s', m.n.por);
      if (m.n.partes && m.n.partes.length > 1) console.log('   opciones : %s', m.n.partes.join('   |   '));
    });
    console.log('\nCorrígelos en Propietarios → ficha del propietario → Celular.');
    console.log('Los ‹U+00A0› son espacios duros: salen al copiar de PDF o WhatsApp y no se ven.');
  }
  if (sin.length) {
    console.log('\n──── SIN CELULAR (el bot no podrá escribirles ni reconocerlos) ────');
    sin.forEach(function (m) { console.log('   %s · %s · Lote %s', m.p.clave, m.p.nombre, m.p.lote); });
  }

  // Dos propietarios con el mismo número: el bot no sabría de cuál de los dos es el
  // mensaje. Pasa de verdad —un matrimonio con dos lotes— y hay que decidirlo antes.
  var porNum = {};
  bien.forEach(function (x) { (porNum[x.n.e164] = porNum[x.n.e164] || []).push(x.p); });
  var repes = Object.keys(porNum).filter(function (k) { return porNum[k].length > 1; });
  if (repes.length) {
    console.log('\n──── EL MISMO NÚMERO EN VARIOS LOTES ────');
    console.log('El bot no puede saber por cuál de ellos pregunta quien escribe.');
    repes.forEach(function (k) {
      console.log('   %s  →  %s', k, porNum[k].map(function (p) { return p.clave + ' (' + p.nombre + ')'; }).join(' · '));
    });
  }
  if (!malos.length && !sin.length && !repes.length && !cambian.length) {
    console.log('\nTodo el padrón está listo para WhatsApp.');
  }

  return { total: props.length, listos: bien.length, porNormalizar: cambian.length,
    malos: malos.map(function (m) { return { clave: m.p.clave, nombre: m.p.nombre,
      guardado: m.n.visible, problema: m.n.por, opciones: m.n.partes }; }),
    sinCelular: sin.map(function (m) { return m.p.clave; }),
    repetidos: repes.map(function (k) { return { numero: k, claves: porNum[k].map(function (p) { return p.clave; }) }; }) };
}

/**
 * Reescribe los celulares del padrón en E.164.
 *
 * ENSAYO POR DEFECTO: sin argumentos sólo dice qué haría. Para escribir de verdad hay
 * que llamarla con `true`, a propósito — es una escritura sobre datos de 71 personas y
 * no debe poder dispararse por descuido desde el desplegable del editor.
 *
 * Sólo toca los que ya son válidos y están escritos de otra forma. Lo que no se puede
 * convertir se deja intacto y sale en el diagnóstico: adivinar un teléfono es peor que
 * dejarlo mal, porque un número inventado le escribe a un desconocido.
 */
function normalizarCelularesPropietarios(aplicar) {
  var props = getPropietarios();
  var cambios = [], intocados = [];
  props.forEach(function (p) {
    var actual = String(p.celular || '').trim();
    var n = normalizarCelular(actual);
    if (!n.ok || actual === n.e164) return;
    if (CEL_INTOCABLES.indexOf(String(p.clave).toUpperCase()) >= 0) {
      intocados.push({ clave: p.clave, de: actual, a: n.e164 });
      return;
    }
    cambios.push({ clave: p.clave, nombre: p.nombre, de: actual, a: n.e164 });
  });

  console.log('════ NORMALIZAR CELULARES ════');
  console.log(aplicar ? 'MODO REAL: se escriben los cambios.'
                      : 'ENSAYO: no se escribe nada. Llama a normalizarCelularesPropietarios(true) para aplicar.');
  console.log('A cambiar: %s de %s propietarios.', cambios.length, props.length);
  cambios.forEach(function (c) { console.log('   %s · %s   «%s»  →  %s', c.clave, c.nombre, c.de, c.a); });
  if (intocados.length) {
    console.log('\nNo se tocan por decisión del administrador (%s):', CEL_INTOCABLES.join(', '));
    intocados.forEach(function (c) { console.log('   %s   «%s»  habría quedado  %s', c.clave, c.de, c.a); });
  }

  if (!aplicar) return { ensayo: true, aCambiar: cambios, intocados: intocados };

  var hechos = 0, fallos = [];
  cambios.forEach(function (c) {
    try { actualizarPropietario(c.clave, { celular: c.a }); hechos++; }
    catch (e) { fallos.push(c.clave + ': ' + String(e && e.message || e)); }
  });
  console.log('\nEscritos: %s · fallidos: %s', hechos, fallos.length);
  fallos.forEach(function (f) { console.log('   ✗ %s', f); });
  try {
    _reg('propietario.edita', { entidad: 'propietario', campo: 'celular',
      detalle: 'Normalización a E.164 para WhatsApp: ' + hechos + ' celulares reescritos' +
               (fallos.length ? ' · ' + fallos.length + ' fallidos' : '') });
  } catch (e) {}
  return { ensayo: false, escritos: hechos, fallos: fallos, intocados: intocados };
}

/**
 * De quién es este número. Es la puerta de entrada del bot: con esto responde sólo a
 * quien está en el padrón, y sólo con lo de SU lote.
 *
 * Compara en E.164, así que da igual cómo venga escrito el número que manda Meta
 * (llega sin el +) y cómo esté guardado en la hoja.
 *
 * Devuelve null cuando no hay nadie, y también cuando hay MÁS DE UNO: dos lotes con el
 * mismo número no se pueden distinguir, y contestarle a uno de los dos al azar sería
 * enseñarle a alguien el saldo de otro. El bot tiene que preguntar en ese caso.
 */
function propietarioPorCelular(tel) {
  var n = normalizarCelular(String(tel || '').replace(/^\+?/, '+'));
  if (!n.ok) {
    // Meta entrega el número sin el +; si no casó, se reintenta como internacional.
    n = normalizarCelular('+' + String(tel || '').replace(/\D/g, ''));
    if (!n.ok) return null;
  }
  var hits = [];
  getPropietarios().forEach(function (p) {
    var q = normalizarCelular(p.celular);
    if (q.ok && q.e164 === n.e164) hits.push(p);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Como propietarioPorCelular, pero diciendo por qué no hubo respuesta. Para el bot. */
function identificarPorCelular(tel) {
  var n = normalizarCelular('+' + String(tel || '').replace(/\D/g, ''));
  if (!n.ok) return { prop: null, motivo: 'numero-ilegible', e164: '' };
  var hits = [];
  getPropietarios().forEach(function (p) {
    var q = normalizarCelular(p.celular);
    if (q.ok && q.e164 === n.e164) hits.push(p);
  });
  if (hits.length === 1) return { prop: hits[0], motivo: '', e164: n.e164 };
  if (hits.length > 1) return { prop: null, motivo: 'varios-lotes', e164: n.e164,
    claves: hits.map(function (p) { return p.clave; }) };
  return { prop: null, motivo: 'no-esta-en-el-padron', e164: n.e164 };
}
