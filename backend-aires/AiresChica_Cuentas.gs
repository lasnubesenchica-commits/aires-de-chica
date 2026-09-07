/**
 * Cuentas de la asociación — de dónde sale y a dónde entra cada balboa.
 *
 * Hasta ahora el sistema tenía UNA cuenta, guardada como cuatro campos sueltos
 * en la configuración (banco, cuentaTipo, cuentaNum, cuentaNombre). Servía
 * mientras sólo hubiera una: los correos decían dónde depositar, la constancia
 * decía a dónde llegó el dinero, y Comprobantes verificaba contra ella. Con dos
 * bancos abiertos a la vez, cada una de esas tres cosas pasa a ser una pregunta
 * distinta —¿dónde deben depositar? ¿a dónde llegó ESTE pago? ¿es válida ESTA
 * cuenta destino?— y cuatro campos sueltos ya no pueden responderlas.
 *
 * MIGRACIÓN SIN INTERVENCIÓN: la hoja se siembra sola, la primera vez que
 * alguien la lee, con la cuenta que hoy está en la configuración y marcada como
 * cuenta de cobro. Nadie tiene que reteclear nada y nada deja de funcionar
 * mientras tanto: `cuentaDeCobro()` cae de vuelta al config si la hoja estuviera
 * vacía o rota, así que el instructivo de pago nunca queda mudo.
 *
 * TRES CLASES DE CUENTA, no dos:
 *   banco      cuenta bancaria de la asociación (Banco General, Global Bank).
 *   porRendir  dinero de la asociación que está en manos de una persona —el caso
 *              real: propietarios que depositan en la cuenta personal de la
 *              administradora—. No es un banco de la asociación, pero es plata
 *              de la asociación y alguien la debe. Modelarla aquí es lo que
 *              permite acreditar al propietario sin inventar que el dinero entró
 *              a un banco donde no está; el día que se deposita, es un traspaso.
 *   El mismo mecanismo cubre el caso inverso (un gasto pagado con tarjeta
 *   personal): sale de `porRendir`, no del banco.
 *
 * INVARIANTE: hay exactamente UNA cuenta de cobro, y es de clase `banco`. No se
 * le puede decir a un propietario que deposite en una cuenta "por rendir".
 */

var SH_CUENTAS  = 'Cuentas';
var COL_CUENTAS = ['id', 'nombre', 'banco', 'tipo', 'numero', 'titular', 'clase',
                   'activa', 'esCobro', 'fondoInicial', 'orden', 'notas', 'creado'];

var CUENTA_CLASES = ['banco', 'porRendir'];

/**
 * Traspasos entre cuentas. NO son ingreso ni egreso: es la misma plata cambiando
 * de bolsillo, así que no tocan el resultado del período. Una sola fila con `de`
 * y `a` expresa el asiento completo —lo que sale de una entra en la otra— sin
 * montar un libro mayor de partida doble, que es lo que el criterio de caja +
 * patrimonio de este sistema evita a propósito.
 *
 * Consecuencia útil: como cada traspaso suma en una cuenta lo que resta en la
 * otra, el EFECTIVO TOTAL no cambia al introducirlos. Ninguna cifra ya
 * distribuida a la Junta se mueve; sólo se reparte entre cuentas.
 */
var SH_TRASPASOS  = 'Traspasos';
var COL_TRASPASOS = ['id', 'fecha', 'de', 'a', 'monto', 'referencia', 'notas', 'creado'];

/* ─────────────── lectura ─────────────── */

function _cuentasSheet() {
  var ss = _ss();
  var sh = ss.getSheetByName(SH_CUENTAS);
  if (!sh) {
    sh = ss.insertSheet(SH_CUENTAS);
    sh.getRange(1, 1, 1, COL_CUENTAS.length).setValues([COL_CUENTAS]);
    sh.getRange(1, 1, 1, COL_CUENTAS.length).setFontWeight('bold')
      .setBackground('#0E8FB0').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _cuentaFila(r) {
  return {
    id: String(r.id || '').trim(),
    nombre: String(r.nombre || '').trim(),
    banco: String(r.banco || '').trim(),
    tipo: String(r.tipo || '').trim(),
    numero: String(r.numero || '').trim(),
    titular: String(r.titular || '').trim(),
    clase: CUENTA_CLASES.indexOf(String(r.clase || '').trim()) >= 0 ? String(r.clase).trim() : 'banco',
    activa: !(String(r.activa).toLowerCase() === 'no' || r.activa === false),
    esCobro: (r.esCobro === true || String(r.esCobro).toLowerCase() === 'si'),
    fondoInicial: _round2(Number(r.fondoInicial) || 0),
    orden: Number(r.orden) || 0,
    notas: String(r.notas || '')
  };
}

/**
 * Todas las cuentas, ordenadas. Siembra la hoja la primera vez.
 * @param {boolean} incluirInactivas  por defecto sólo devuelve las activas
 */
function getCuentas(incluirInactivas) {
  ensureSheets();
  _cuentasSheet();
  var filas = _sheetRows(SH_CUENTAS);
  if (!filas.length) { _sembrarCuentas(); filas = _sheetRows(SH_CUENTAS); }
  var out = filas.map(_cuentaFila).filter(function (c) { return !!c.id; });
  if (!incluirInactivas) out = out.filter(function (c) { return c.activa; });
  out.sort(function (a, b) { return (a.orden - b.orden) || a.nombre.localeCompare(b.nombre); });
  return out;
}

/**
 * Siembra la hoja con la cuenta que ya está en la configuración. Se ejecuta una
 * sola vez —sólo si la hoja está vacía— para que la migración no dependa de que
 * alguien se acuerde de correr nada.
 *
 * El fondo inicial del config, que era uno solo para todo el sistema, pasa a ser
 * el de esta cuenta: hasta hoy era la única, así que todo ese saldo era suyo.
 */
function _sembrarCuentas() {
  var cfg = _cfg();
  var nombre = String(cfg.banco || 'Banco principal').trim();
  _cuentasSheet().appendRow([
    _cuentaIdNuevo(nombre), nombre, nombre,
    String(cfg.cuentaTipo || ''), String(cfg.cuentaNum || ''), String(cfg.cuentaNombre || ''),
    'banco', 'si', 'si', _round2(Number(cfg.fondoInicial) || 0), 10,
    'Creada automáticamente al migrar la cuenta única de Opciones.', new Date()
  ]);
}

/**
 * La cuenta donde los propietarios deben depositar. La usan el instructivo de
 * pago, los correos y la verificación de comprobantes.
 *
 * NUNCA lanza: si la hoja está vacía, rota o sin cuenta marcada, devuelve lo que
 * haya en la configuración. Un fallo aquí dejaría a los propietarios sin saber
 * dónde pagar, que es peor que un dato viejo.
 */
var _cuentaCobroCache = null;   // por ejecución: se resuelve una vez, no una por fila

function cuentaDeCobro() {
  if (_cuentaCobroCache) return _cuentaCobroCache;
  try {
    var cs = getCuentas();
    var marcada = null, primerBanco = null;
    cs.forEach(function (c) {
      if (c.clase !== 'banco') return;
      if (c.esCobro && !marcada) marcada = c;
      if (!primerBanco) primerBanco = c;
    });
    var c = marcada || primerBanco;
    if (c) { _cuentaCobroCache = c; return c; }
  } catch (e) {}
  // El respaldo NO se cachea: si la hoja aún no existe en esta ejecución pero se
  // crea a media corrida, la siguiente llamada debe encontrar la de verdad.
  var cfg = _cfg();
  return { id: '', nombre: String(cfg.banco || ''), banco: String(cfg.banco || ''),
    tipo: String(cfg.cuentaTipo || ''), numero: String(cfg.cuentaNum || ''),
    titular: String(cfg.cuentaNombre || ''), clase: 'banco', activa: true,
    esCobro: true, fondoInicial: 0, orden: 0, notas: '' };
}

/** Una cuenta por id. Devuelve null si no existe. */
function cuentaPorId(id) {
  id = String(id || '').trim();
  if (!id) return null;
  var cs = getCuentas(true);
  for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
  return null;
}

/**
 * Busca la cuenta a la que corresponde un número leído de un comprobante.
 * Reproduce la tolerancia que ya usaba `_verificarDestino` contra una sola
 * cuenta: número completo, uno contenido en el otro, o los últimos 3-4 dígitos
 * ("terminación de producto"). Devuelve null si no casa ninguna, y ojo: si casa
 * más de una, devuelve null también — dos cuentas que terminan igual no se
 * pueden distinguir, y adivinar sería peor que preguntar.
 */
function cuentaPorNumero(numero) {
  var n = String(numero || '').replace(/\D/g, '');
  if (!n) return null;
  var hits = getCuentas().filter(function (c) {
    var a = String(c.numero || '').replace(/\D/g, '');
    if (!a) return false;
    return (n === a) ||
           (n.length >= 5 && a.indexOf(n) >= 0) ||
           (a.length >= 5 && n.indexOf(a) >= 0) ||
           (n.length >= 3 && n.length <= 4 && a.slice(-n.length) === n);
  });
  return hits.length === 1 ? hits[0] : null;
}

/* ─────────────── escritura ─────────────── */

function _cuentaIdNuevo(nombre) {
  var base = _normTxt(nombre).toLowerCase().replace(/ +/g, '-').slice(0, 24) || 'cuenta';
  var usados = {};
  _sheetRows(SH_CUENTAS).forEach(function (r) { usados[String(r.id || '').trim()] = 1; });
  var id = base, n = 2;
  while (usados[id]) { id = base + '-' + n; n++; }
  return id;
}

/**
 * Alta o edición. Si viene `esCobro`, se la quita a las demás en la misma
 * pasada: la cuenta de cobro es una sola y dejar dos marcadas haría que el
 * instructivo de pago dependiera del orden de las filas.
 *
 * data: { id?, nombre, banco, tipo, numero, titular, clase, activa, esCobro,
 *         fondoInicial, orden, notas }
 */
function guardarCuenta(data) {
  ensureSheets();
  _cuentaCobroCache = null;
  data = data || {};
  var nombre = String(data.nombre || '').trim();
  if (!nombre) throw new Error('Ponle un nombre a la cuenta.');
  var clase = CUENTA_CLASES.indexOf(String(data.clase || '').trim()) >= 0
            ? String(data.clase).trim() : 'banco';
  var activa = !(data.activa === false || String(data.activa).toLowerCase() === 'no');
  var esCobro = (data.esCobro === true || String(data.esCobro).toLowerCase() === 'si');

  if (esCobro && clase !== 'banco') {
    throw new Error('La cuenta de cobro tiene que ser una cuenta bancaria: ' +
                    'no se le puede pedir a un propietario que deposite en una cuenta por rendir.');
  }
  if (esCobro && !activa) throw new Error('Una cuenta inactiva no puede ser la cuenta de cobro.');

  var sh = _cuentasSheet();
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iCobro = h.indexOf('esCobro');
  var id = String(data.id || '').trim();
  var fila = [
    id || _cuentaIdNuevo(nombre), nombre,
    String(data.banco || nombre).trim(), String(data.tipo || '').trim(),
    String(data.numero || '').trim(), String(data.titular || '').trim(),
    clase, (activa ? 'si' : 'no'), (esCobro ? 'si' : ''),
    _round2(Number(data.fondoInicial) || 0), Number(data.orden) || 0,
    String(data.notas || ''), new Date()
  ];

  var row = -1;
  if (id) for (var r = 1; r < vals.length; r++) if (String(vals[r][iId]).trim() === id) { row = r; break; }
  if (row >= 0) {
    fila[12] = vals[row][h.indexOf('creado')] || new Date();   // no se reescribe la fecha de alta
    sh.getRange(row + 1, 1, 1, COL_CUENTAS.length).setValues([fila]);
  } else {
    sh.appendRow(fila);
    row = sh.getDataRange().getValues().length - 1;
  }

  // exclusividad de la cuenta de cobro
  if (esCobro) {
    var v2 = sh.getDataRange().getValues();
    for (var k = 1; k < v2.length; k++) {
      if (k === row) continue;
      if (String(v2[k][iCobro]).toLowerCase() === 'si') sh.getRange(k + 1, iCobro + 1).setValue('');
    }
  }

  _reg(id ? 'cuenta.edita' : 'cuenta.alta', { entidad: 'cuenta', clave: fila[0],
    propietario: nombre, detalle: fila[2] + ' · ' + fila[3] + ' Nº ' + fila[4] +
      (esCobro ? ' · CUENTA DE COBRO' : '') });

  return { ok: true, id: fila[0], cuenta: _cuentaFila({
    id: fila[0], nombre: fila[1], banco: fila[2], tipo: fila[3], numero: fila[4],
    titular: fila[5], clase: fila[6], activa: fila[7], esCobro: fila[8],
    fondoInicial: fila[9], orden: fila[10], notas: fila[11] }) };
}

/** Marca cuál es la cuenta de cobro, sin tocar nada más de la cuenta. */
function marcarCuentaCobro(id) {
  ensureSheets();
  _cuentaCobroCache = null;
  var c = cuentaPorId(id);
  if (!c) throw new Error('No existe la cuenta ' + id + '.');
  if (c.clase !== 'banco') throw new Error('Sólo una cuenta bancaria puede ser la cuenta de cobro.');
  if (!c.activa) throw new Error('Esa cuenta está inactiva.');

  var sh = _cuentasSheet();
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iId = h.indexOf('id'), iCobro = h.indexOf('esCobro');
  var antes = '';
  for (var r = 1; r < vals.length; r++) {
    var esta = String(vals[r][iId]).trim() === id;
    if (String(vals[r][iCobro]).toLowerCase() === 'si' && !esta) antes = String(vals[r][iId]).trim();
    sh.getRange(r + 1, iCobro + 1).setValue(esta ? 'si' : '');
  }
  _reg('cuenta.cobro', { entidad: 'cuenta', clave: id, propietario: c.nombre,
    antes: antes, despues: id,
    detalle: 'Los propietarios pasan a depositar en ' + c.banco + ' Nº ' + c.numero });
  return { ok: true, id: id, cuenta: cuentaPorId(id) };
}

/**
 * Baja de una cuenta. Se niega si tiene movimientos: borrarla dejaría pagos y
 * gastos apuntando a una cuenta inexistente, y el saldo de esos movimientos no
 * tendría dónde sumarse. Para sacarla de circulación está `activa: false`, que
 * la esconde de los selectores sin perder su historia.
 */
function eliminarCuenta(id) {
  ensureSheets();
  id = String(id || '').trim();
  var c = cuentaPorId(id);
  if (!c) throw new Error('No existe la cuenta ' + id + '.');
  if (c.esCobro) throw new Error('Es la cuenta de cobro. Marca otra antes de eliminarla.');

  var usos = _cuentaUsos(id);
  if (usos.total > 0) {
    throw new Error('La cuenta "' + c.nombre + '" tiene ' + usos.pagos + ' pago(s), ' +
      usos.gastos + ' gasto(s) y ' + usos.traspasos + ' traspaso(s) registrados. ' +
      'No se puede borrar sin dejarlos huérfanos: márcala como inactiva.');
  }

  var sh = _cuentasSheet();
  var vals = sh.getDataRange().getValues();
  var iId = vals[0].map(function (x) { return String(x).trim(); }).indexOf('id');
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][iId]).trim() === id) { sh.deleteRow(r + 1); break; }
  }
  _reg('cuenta.baja', { entidad: 'cuenta', clave: id, propietario: c.nombre,
    detalle: c.banco + ' Nº ' + c.numero });
  return { ok: true, id: id };
}

/** Cuántos movimientos apuntan a una cuenta (para no borrarla a ciegas). */
function _cuentaUsos(id) {
  id = String(id || '').trim();
  var n = { pagos: 0, gastos: 0, traspasos: 0 };
  [[SH.PAGOS, 'pagos'], [SH.GASTOS, 'gastos']].forEach(function (par) {
    var sh = _ss().getSheetByName(par[0]);
    if (!sh) return;
    var vals = sh.getDataRange().getValues();
    var i = vals[0].map(function (x) { return String(x).trim(); }).indexOf('cuenta');
    if (i < 0) return;
    for (var r = 1; r < vals.length; r++) if (String(vals[r][i]).trim() === id) n[par[1]]++;
  });
  var shT = _ss().getSheetByName(SH_TRASPASOS);
  if (shT) {
    var v = shT.getDataRange().getValues();
    var h = v[0].map(function (x) { return String(x).trim(); });
    var iDe = h.indexOf('de'), iA = h.indexOf('a');
    for (var k = 1; k < v.length; k++) {
      if (String(v[k][iDe]).trim() === id || String(v[k][iA]).trim() === id) n.traspasos++;
    }
  }
  n.total = n.pagos + n.gastos + n.traspasos;
  return n;
}

/* ─────────────── traspasos entre cuentas ─────────────── */

function _traspasosSheet() {
  var ss = _ss();
  var sh = ss.getSheetByName(SH_TRASPASOS);
  if (!sh) {
    sh = ss.insertSheet(SH_TRASPASOS);
    sh.getRange(1, 1, 1, COL_TRASPASOS.length).setValues([COL_TRASPASOS]);
    sh.getRange(1, 1, 1, COL_TRASPASOS.length).setFontWeight('bold')
      .setBackground('#0E8FB0').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getTraspasos() {
  ensureSheets();
  _traspasosSheet();
  return _sheetRows(SH_TRASPASOS).map(function (t) {
    var f = t.fecha instanceof Date ? t.fecha : new Date(t.fecha);
    return { id: String(t.id || ''), fecha: f, de: String(t.de || '').trim(),
      a: String(t.a || '').trim(), monto: _round2(t.monto),
      referencia: String(t.referencia || ''), notas: String(t.notas || '') };
  }).filter(function (t) { return t.id && !isNaN(t.fecha.getTime()); })
    .sort(function (a, b) { return b.fecha - a.fecha; });
}

/**
 * Registra un traspaso. Valida lo que de verdad puede romper el saldo:
 * que existan las dos cuentas, que no sean la misma y que el monto sea positivo.
 * Un traspaso a sí misma sumaría y restaría en la misma cuenta —inofensivo para
 * el total pero ruido puro—; uno con cuenta inexistente perdería el dinero.
 */
function registrarTraspaso(t) {
  ensureSheets();
  t = t || {};
  var monto = _round2(Number(t.monto) || 0);
  if (!(monto > 0)) throw new Error('Indica un monto mayor que cero.');
  var de = cuentaPorId(t.de), a = cuentaPorId(t.a);
  if (!de) throw new Error('No existe la cuenta de origen.');
  if (!a) throw new Error('No existe la cuenta de destino.');
  if (de.id === a.id) throw new Error('El origen y el destino son la misma cuenta.');

  var fecha = t.fecha instanceof Date ? t.fecha
            : (_fechaPagoDesdeISO(t.fecha) || new Date(t.fecha || _today()));
  var id = String(t.id || '').trim() || ('T' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000));
  _traspasosSheet().appendRow([id, fecha, de.id, a.id, monto,
    String(t.referencia || ''), String(t.notas || ''), new Date()]);

  _reg('traspaso.alta', { entidad: 'traspaso', clave: id, monto: monto,
    detalle: de.nombre + ' → ' + a.nombre +
      (t.referencia ? ' · ref. ' + t.referencia : '') });
  return { ok: true, id: id, de: de.nombre, a: a.nombre, monto: monto };
}

function eliminarTraspaso(id) {
  ensureSheets();
  id = String(id || '').trim();
  if (!id) throw new Error('Falta el id del traspaso.');
  var sh = _traspasosSheet();
  var vals = sh.getDataRange().getValues();
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][0]).trim() === id) {
      sh.deleteRow(r + 1);
      _reg('traspaso.baja', { entidad: 'traspaso', clave: id, monto: _round2(vals[r][4]),
        detalle: String(vals[r][2]) + ' → ' + String(vals[r][3]) });
      return { ok: true, id: id };
    }
  }
  throw new Error('Traspaso no encontrado: ' + id);
}

/**
 * Saldo de cada cuenta a una fecha:
 *
 *   fondoInicial + pagos recibidos − gastos pagados + traspasos entrantes − salientes
 *
 * Los traspasos suman en una cuenta exactamente lo que restan en la otra, así que
 * el TOTAL es el mismo efectivo que el sistema calculaba antes de existir las
 * cuentas. Introducir todo esto no mueve ninguna cifra ya publicada; sólo la parte.
 */
function saldosPorCuenta(hasta) {
  ensureSheets();
  var corte = hasta ? new Date(hasta) : null;
  if (corte) corte.setHours(23, 59, 59, 999);
  var dentro = function (f) {
    var d = f instanceof Date ? f : new Date(f);
    return !isNaN(d.getTime()) && (!corte || d.getTime() <= corte.getTime());
  };

  var cs = getCuentas(true);
  var acc = {};
  cs.forEach(function (c) {
    acc[c.id] = { id: c.id, nombre: c.nombre, banco: c.banco, numero: c.numero,
      clase: c.clase, activa: c.activa, esCobro: c.esCobro,
      fondoInicial: c.fondoInicial, ingresos: 0, egresos: 0, entra: 0, sale: 0, saldo: 0 };
  });
  // Un movimiento con cuenta desconocida o vacía no se puede repartir, pero
  // tampoco puede desaparecer: va a "(sin asignar)" para que el total siga
  // cuadrando y el problema se vea en vez de esconderse.
  var SIN = '(sin asignar)';
  var bolsa = function (id) {
    id = String(id || '').trim();
    if (acc[id]) return acc[id];
    if (!acc[SIN]) acc[SIN] = { id: SIN, nombre: SIN, banco: '', numero: '', clase: 'banco',
      activa: true, esCobro: false, fondoInicial: 0, ingresos: 0, egresos: 0, entra: 0, sale: 0, saldo: 0 };
    return acc[SIN];
  };

  _sheetRows(SH.PAGOS).forEach(function (p) {
    if (!dentro(p.fecha)) return;
    bolsa(p.cuenta).ingresos += Number(p.monto) || 0;
  });
  _sheetRows(SH.GASTOS).forEach(function (g) {
    if (!dentro(g.fecha)) return;
    bolsa(g.cuenta).egresos += Number(g.monto) || 0;
  });
  getTraspasos().forEach(function (t) {
    if (!dentro(t.fecha)) return;
    bolsa(t.de).sale += t.monto;
    bolsa(t.a).entra += t.monto;
  });

  var lista = Object.keys(acc).map(function (k) {
    var c = acc[k];
    c.ingresos = _round2(c.ingresos); c.egresos = _round2(c.egresos);
    c.entra = _round2(c.entra); c.sale = _round2(c.sale);
    c.saldo = _round2(c.fondoInicial + c.ingresos - c.egresos + c.entra - c.sale);
    return c;
  }).filter(function (c) {
    // una cuenta inactiva y en cero no le aporta nada a la vista
    return c.activa || c.saldo !== 0 || c.ingresos || c.egresos || c.entra || c.sale;
  });

  return {
    asOf: corte ? _balISO(corte) : '',
    cuentas: lista,
    total: _round2(lista.reduce(function (s, c) { return s + c.saldo; }, 0)),
    sinAsignar: !!acc[SIN]
  };
}

/** Lo que el panel necesita para pintar la sección de Opciones. */
function getCuentasData() {
  var cs = getCuentas(true);
  var cobro = cuentaDeCobro();
  return {
    cuentas: cs.map(function (c) {
      var u = _cuentaUsos(c.id);
      return Object.assign({}, c, { usos: u, borrable: u.total === 0 && !c.esCobro });
    }),
    cobroId: cobro.id || '',
    clases: CUENTA_CLASES
  };
}
