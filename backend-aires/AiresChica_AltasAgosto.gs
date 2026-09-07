/**
 * Altas y pagos pendientes del informe de agosto 2026.
 *
 * Son las cuatro cosas del archivo del cliente que NO son gastos:
 *
 *   ALTAS  · H-14  Cecibel Agudo   (cuota + 1 cabaña, cobra desde septiembre)
 *          · L-7A  Marlene Valle   (nueva, cobra desde octubre)
 *
 *   PAGOS  · Q-12B Gabriel Rodríguez           B/.99.00
 *          · Q-19A Agustín Abrego / Maryi Caicedo  B/.45.00
 *
 * Los dos pagos NO son de los dos propietarios nuevos: son de cuentas que ya
 * existen. Ninguno de los nuevos tiene pago, porque a H-14 se le empieza a
 * cobrar en septiembre y a L-7A en octubre. Van juntos en este script sólo
 * porque salen del mismo archivo y del mismo cierre.
 *
 * OJO CON EL EFECTIVO: los dos pagos entraron a una cuenta PERSONAL de Doraida,
 * no al banco de la asociación. Registrarlos es lo correcto —el propietario
 * pagó y su estado de cuenta tiene que reflejarlo— pero suben el efectivo
 * derivado (fondo inicial + ingresos − egresos) en B/.144.00 sin que el banco se
 * haya movido. Con los B/.57.44 de Starlink y la nube —que salieron de tarjetas
 * personales y sí están como gasto— el efectivo derivado queda B/.86.56 POR
 * ENCIMA del saldo real del Banco General. Se resuelve de raíz cuando cada pago
 * y cada gasto lleve su cuenta bancaria; mientras tanto queda anotado aquí y en
 * las notas de cada pago.
 *
 * Uso: ejecutar `cargarAltasAgosto2026()` una vez. Para deshacer:
 * `rollbackAltasAgosto2026()`. Es idempotente: no duplica ni claves ni pagos.
 */

var AA_PROP = 'AC_ALTAS_AGO2026';   // marca de "ya aplicado"
var AA_PREF = 'AA26-P-';            // prefijo de los ids de pago que inserta
var AA_NOTA = 'Alta agosto 2026';   // marca en notas del propietario, para el rollback

/**
 * Los dos propietarios nuevos.
 *
 * La cuota NO se teclea: `addPropietario` la calcula con `cuotaDe()` a partir de
 * las cabañas y la configuración vigente (base 45.00 + 30% por cabaña). Así H-14
 * sale en 58.50 sin que este script fije el número, y si mañana cambia la base
 * no queda una cifra vieja escrita a mano.
 *
 * `inicioCobro` es lo que evita cobrarles meses en los que todavía no eran
 * propietarios: sin él, el libro les carga cuota desde enero.
 *
 * El residencial va escrito como ya está en la hoja ("El Higueron", sin tilde),
 * para que la clave se genere con el prefijo correcto y no aparezca un
 * residencial nuevo en los filtros.
 */
var AA_ALTAS = [
  { claveEsperada: 'H-14',
    nombre: 'Cecibel Agudo', residencial: 'El Higueron', lote: '14',
    email: 'cecibel_agudo@hotmail.com', celular: '6030-0008',   // los de sus cuentas H-6 y Q-18
    lotes: 1, cabanas: 1, inicioCobro: '2026-09',
    notas: AA_NOTA + ' · tercera cuenta de Cecibel Agudo (ya tiene H-6 y Q-18)' },
  { claveEsperada: 'L-7A',
    nombre: 'Marlene Valle', residencial: 'Los Laureles', lote: '7A',
    email: 'vallemarlen707@gmail.com', celular: '6300-6854',
    lotes: 1, cabanas: 0, inicioCobro: '2026-10',
    notas: AA_NOTA }
];

/**
 * Los dos pagos. Van contra cuentas QUE YA EXISTEN; el script se niega a
 * registrarlos si la clave no está, porque un pago con clave desconocida no
 * aparece en ningún estado de cuenta y se pierde de vista.
 *
 * Los montos cuadran con lo que cada cuenta debe al 31/08:
 *   Q-12B  90.00 de cuotas (julio y agosto) + 9.00 de recargo (mayo y julio) = 99.00
 *   Q-19A  45.00 de agosto (empezó a cobrarse en julio, y julio ya está pagado)
 */
var AA_PAGOS = [
  { id: AA_PREF + 'Q12B', clave: 'Q-12B', monto: 99.00, mesAplicado: '2026-08',
    notas: 'Depositado en cuenta personal de Doraida (informe agosto 2026) · 90.00 cuotas jul-ago + 9.00 recargo' },
  { id: AA_PREF + 'Q19A', clave: 'Q-19A', monto: 45.00, mesAplicado: '2026-08',
    notas: 'Depositado en cuenta personal de Doraida (informe agosto 2026) · cuota de agosto' }
];

/**
 * Da de alta a los dos propietarios y registra los dos pagos.
 *
 * @param {boolean} force  ignora la marca de "ya aplicado" (para reintentar tras un fallo a medias)
 */
function cargarAltasAgosto2026(force) {
  ensureSheets();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(AA_PROP) && !force) {
    return { ok: false, yaAplicado: true,
      msg: 'Las altas y pagos de agosto YA se cargaron. Para repetir: rollbackAltasAgosto2026() y volver a ejecutar.' };
  }

  var altas = [], pagos = [], avisos = [];

  // ── 1) propietarios ────────────────────────────────────────────────────────
  // Se comprueba la clave ANTES de llamar a addPropietario: si ya existe, esa
  // función no falla, le pone sufijo ("H-14-2") y crearía una cuenta duplicada
  // silenciosa, que es peor que no crear nada.
  AA_ALTAS.forEach(function (a) {
    if (_aaExisteClave(a.claveEsperada)) {
      avisos.push('La cuenta ' + a.claveEsperada + ' ya existe: no se creó de nuevo.');
      return;
    }
    var r = addPropietario({
      nombre: a.nombre, residencial: a.residencial, lote: a.lote,
      email: a.email, celular: a.celular,
      lotes: a.lotes, cabanas: a.cabanas,
      inicioCobro: a.inicioCobro, notas: a.notas
    });
    if (r.clave !== a.claveEsperada) {
      avisos.push('ATENCIÓN: ' + a.nombre + ' se creó como ' + r.clave +
                  ' y se esperaba ' + a.claveEsperada + '. Revísalo.');
    }
    altas.push({ clave: r.clave, nombre: r.nombre, cuota: r.cuota, desde: a.inicioCobro });
    _reg('prop.alta', { entidad: 'propietario', clave: r.clave, propietario: r.nombre,
      monto: r.cuota, detalle: 'Alta agosto 2026 · cobra desde ' + a.inicioCobro });
  });

  // ── 2) pagos ───────────────────────────────────────────────────────────────
  var idsPago = _aaIdsPagoEnHoja();
  AA_PAGOS.forEach(function (p) {
    if (idsPago.indexOf(p.id) >= 0) {
      avisos.push('El pago ' + p.id + ' (' + p.clave + ') ya estaba registrado: no se duplicó.');
      return;
    }
    if (!_aaExisteClave(p.clave)) {
      avisos.push('ATENCIÓN: no existe la cuenta ' + p.clave + '. Su pago de B/.' +
                  p.monto.toFixed(2) + ' NO se registró para que no quede huérfano.');
      return;
    }
    appendPago({
      id: p.id, clave: p.clave, monto: p.monto,
      fecha: new Date(2026, 7, 31),        // mes 7 = agosto
      origen: 'manual', mesAplicado: p.mesAplicado, notas: p.notas
    });
    pagos.push({ id: p.id, clave: p.clave, monto: p.monto });
    _reg('pago.alta', { entidad: 'pago', clave: p.clave, monto: p.monto,
      detalle: 'Informe agosto 2026 · depositado en cuenta personal de Doraida' });
  });

  props.setProperty(AA_PROP, new Date().toISOString());
  var totalPagos = _round2(pagos.reduce(function (s, p) { return s + p.monto; }, 0));
  return { ok: true,
    altas: altas.length, propietarios: altas,
    pagos: pagos.length, totalPagos: totalPagos, detallePagos: pagos,
    avisos: avisos,
    efectivo: 'Los B/.' + totalPagos.toFixed(2) + ' entraron a una cuenta personal de Doraida, ' +
              'no al banco de la asociación: el efectivo derivado queda por encima del saldo bancario real.',
    msg: altas.length + ' propietario(s) y ' + pagos.length + ' pago(s) por B/.' + totalPagos.toFixed(2) +
         '. Para deshacer: rollbackAltasAgosto2026().' };
}

/**
 * Deshace la carga. Los pagos se borran por id. Los propietarios sólo se borran
 * si los creó este script (llevan la marca en notas) Y no tienen ningún pago
 * registrado: borrar una cuenta con pagos dejaría esos pagos apuntando a una
 * clave inexistente, que es exactamente el problema que el alta evita.
 */
function rollbackAltasAgosto2026() {
  ensureSheets();
  var ss = _ss();

  var shP = ss.getSheetByName(SH.PAGOS);
  var vp = shP.getDataRange().getValues();
  var pagosBorrados = 0;
  for (var r = vp.length - 1; r >= 1; r--) {
    if (String(vp[r][0] || '').indexOf(AA_PREF) === 0) { shP.deleteRow(r + 1); pagosBorrados++; }
  }

  // qué claves conservan pagos DESPUÉS de borrar los de este script
  var vp2 = shP.getDataRange().getValues(), conPagos = {};
  for (var i = 1; i < vp2.length; i++) conPagos[String(vp2[i][2] || '').trim()] = true;

  var shO = ss.getSheetByName(SH.PROP);
  var vo = shO.getDataRange().getValues();
  var h = vo[0].map(function (x) { return String(x).trim(); });
  var iClave = h.indexOf('clave'), iNotas = h.indexOf('notas');
  var propsBorrados = [], conservados = [];
  for (var j = vo.length - 1; j >= 1; j--) {
    var clave = String(vo[j][iClave] || '').trim();
    if (String(vo[j][iNotas] || '').indexOf(AA_NOTA) !== 0) continue;
    if (conPagos[clave]) { conservados.push(clave); continue; }
    shO.deleteRow(j + 1);
    propsBorrados.push(clave);
  }

  PropertiesService.getScriptProperties().deleteProperty(AA_PROP);
  return { ok: true, pagosBorrados: pagosBorrados, propietariosBorrados: propsBorrados,
    conservados: conservados,
    msg: 'Se borraron ' + pagosBorrados + ' pago(s) y ' + propsBorrados.length + ' propietario(s).' +
         (conservados.length ? ' Se CONSERVARON ' + conservados.join(', ') +
          ' porque ya tienen pagos registrados; bórralos a mano si de verdad quieres.' : '') };
}

/** Estado de la carga, para verificar sin abrir la hoja. */
function estadoAltasAgosto() {
  ensureSheets();
  return {
    aplicado: !!PropertiesService.getScriptProperties().getProperty(AA_PROP),
    fecha: PropertiesService.getScriptProperties().getProperty(AA_PROP) || '',
    claves: AA_ALTAS.map(function (a) {
      return { clave: a.claveEsperada, existe: _aaExisteClave(a.claveEsperada) };
    }),
    pagosEnHoja: _aaIdsPagoEnHoja(),
    totalPagos: _round2(AA_PAGOS.reduce(function (s, p) { return s + p.monto; }, 0))
  };
}

function _aaExisteClave(clave) {
  var sh = _ss().getSheetByName(SH.PROP);
  if (!sh) return false;
  var vals = sh.getDataRange().getValues();
  var iClave = vals[0].map(function (x) { return String(x).trim(); }).indexOf('clave');
  var buscada = String(clave).trim().toUpperCase();
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][iClave] || '').trim().toUpperCase() === buscada) return true;
  }
  return false;
}

function _aaIdsPagoEnHoja() {
  var sh = _ss().getSheetByName(SH.PAGOS);
  if (!sh) return [];
  var vals = sh.getDataRange().getValues(), out = [];
  for (var r = 1; r < vals.length; r++) {
    var id = String(vals[r][0] || '');
    if (id.indexOf(AA_PREF) === 0) out.push(id);
  }
  return out;
}
