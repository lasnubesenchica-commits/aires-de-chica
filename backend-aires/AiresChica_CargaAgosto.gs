/**
 * Carga puntual de los GASTOS DE AGOSTO 2026 (Excel del cliente + 2 facturas).
 *
 * Diferencia con AiresChica_UpdateJulio.gs: aquella actualización REEMPLAZABA
 * pagos existentes, así que necesitaba duplicar las hojas antes de tocarlas.
 * Ésta sólo AGREGA diez renglones y no modifica ninguno, por lo que el rollback
 * no necesita respaldo: basta borrar las filas cuyo id empieza por 'CA26-G-'.
 * Menos maquinaria y menos que se puede romper.
 *
 * Los diez salen del archivo INFORME_DE_AGOSTO_2026.xlsx, cruzados contra los
 * 100 gastos ya registrados. Dos partidas del Excel NO están aquí porque ya
 * estaban en el sistema: la factura 628 del acueducto (B/.22.00, registrada el
 * 26/08) y los B/.290.00 de la plataforma contable (registrados el 25/08). Con
 * esas dos, agosto cierra en B/.1,520.14, que es el total del Excel.
 *
 * Uso: ejecutar `cargarAgosto2026()` una vez. Para deshacer:
 * `rollbackCargaAgosto2026()`. Es idempotente: si ya se aplicó, no duplica.
 */

var CA_PROP = 'AC_CARGA_AGO2026';   // marca de "ya aplicado"
var CA_PREF = 'CA26-G-';            // prefijo de los ids que inserta

/**
 * Los diez gastos de agosto: [categoria, proveedor, detalle, monto, tipo, dia].
 *
 * `dia` es el día de agosto con el que se registra. Casi todos van al 31 (el
 * Excel es un resumen de cierre de mes y no trae fecha por partida); la única
 * con fecha propia es la de las plantas, porque su factura electrónica la fija
 * en el 03/08.
 *
 * Las plantas acuáticas van a ACUEDUCTO, no a áreas comunes: el Excel dice que
 * son para purificar el agua de los estanques, así que es tratamiento de agua y
 * no ornato. Los B/.20.00 de sembrarlas van junto a ellas por la misma razón,
 * aunque Fernando López normalmente factura contra Calles.
 *
 * Los nombres de proveedor se escriben EXACTAMENTE como ya figuran en el
 * histórico (Más Móvil, Zoila Castrejón, Javier Della Cella…) para que no
 * aparezcan duplicados en los reportes por una tilde o una mayúscula.
 */
var CA_GASTOS = [
  ['Calles, senderos y áreas comunes', 'Fernando López',          'Contrato mantenimiento general agosto',        400.00, 'recurrente', 31],
  ['Baño comunal',                     'Zoila Castrejón',         'Limpieza baño comunal',                         45.00, 'recurrente', 31],
  ['Administración',                   'Doraida Castillo',        'Honorarios administración agosto',             110.00, 'recurrente', 31],
  ['Línea de crédito / préstamo',      'Doraida Castillo',        'Abono a préstamo',                             200.00, 'recurrente', 31],
  ['Calles, senderos y áreas comunes', 'Cornelio Sánchez',        'Abono a contrato de güira (septiembre)',       250.00, 'puntual',    31],
  ['Portón, luminarias y cámaras',     'Starlink',                'Servicio portón',                               45.45, 'recurrente', 31],
  ['Portón, luminarias y cámaras',     'Más Móvil',               'Servicio portón',                               10.70, 'recurrente', 31],
  ['Portón, luminarias y cámaras',     'Javier Della Cella',      'Nube cámaras portón (Google)',                  11.99, 'recurrente', 31],
  ['Acueducto',                        'Castillo Plants Company', 'Plantas acuáticas para estanques · fact. 1495', 115.00, 'puntual',     3],
  ['Acueducto',                        'Fernando López',          'Limpieza de estanques y siembra de plantas',    20.00, 'puntual',    31]
];

/**
 * Inserta los diez gastos de agosto. Idempotente por partida doble: la marca en
 * Script Properties Y la presencia de ids 'CA26-G-' en la hoja. Lo segundo cubre
 * el caso en que la propiedad se pierda (proyecto reclonado, propiedad borrada a
 * mano) y sin él la carga se duplicaría en silencio.
 *
 * @param {boolean} force  ignora la marca de "ya aplicado" (para reintentar tras un fallo a medias)
 */
function cargarAgosto2026(force) {
  ensureSheets();
  var props = PropertiesService.getScriptProperties();

  if (props.getProperty(CA_PROP) && !force) {
    return { ok: false, yaAplicado: true,
      msg: 'Los gastos de agosto YA fueron cargados. Para repetir: rollbackCargaAgosto2026() y volver a ejecutar.' };
  }
  var yaEnHoja = _caIdsEnHoja();
  if (yaEnHoja.length && !force) {
    return { ok: false, yaAplicado: true, idsEncontrados: yaEnHoja,
      msg: 'La hoja Gastos ya tiene ' + yaEnHoja.length + ' renglón(es) con id ' + CA_PREF +
           '. No se carga nada para no duplicar. Revisa, o corre rollbackCargaAgosto2026().' };
  }

  var insertados = [], total = 0;
  CA_GASTOS.forEach(function (g, i) {
    var id = _appendGasto({
      id: CA_PREF + (i + 1),
      fecha: new Date(2026, 7, g[5]),      // mes 7 = agosto
      categoria: g[0], proveedor: g[1], detalle: g[2],
      monto: g[3], tipo: g[4],
      notas: 'Carga agosto 2026 (Excel cliente)'
    });
    insertados.push({ id: id, categoria: g[0], proveedor: g[1], monto: g[3] });
    total = _round2(total + g[3]);
  });

  // Una entrada de bitácora por gasto: así el tab de Registro los muestra igual
  // que si se hubieran tecleado uno por uno, y se pueden auditar después.
  insertados.forEach(function (g) {
    _reg('gasto.alta', { entidad: 'gasto', clave: g.categoria, propietario: g.proveedor,
      monto: g.monto, detalle: 'Carga agosto 2026 · ' + g.id });
  });

  props.setProperty(CA_PROP, new Date().toISOString());
  return { ok: true, gastos: insertados.length, total: total, detalle: insertados,
    msg: 'Agosto cargado: ' + insertados.length + ' gastos por B/.' + total.toFixed(2) +
         '. Para deshacer: rollbackCargaAgosto2026().' };
}

/**
 * Deshace la carga borrando sólo las filas que ella insertó. Va de abajo hacia
 * arriba porque cada deleteRow corre las siguientes hacia arriba y de otro modo
 * se saltaría una.
 */
function rollbackCargaAgosto2026() {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.GASTOS);
  var vals = sh.getDataRange().getValues();
  var borradas = 0;
  for (var r = vals.length - 1; r >= 1; r--) {
    if (String(vals[r][0] || '').indexOf(CA_PREF) === 0) { sh.deleteRow(r + 1); borradas++; }
  }
  PropertiesService.getScriptProperties().deleteProperty(CA_PROP);
  return { ok: true, borradas: borradas,
    msg: borradas ? 'Se borraron ' + borradas + ' gastos de la carga de agosto.'
                  : 'No había gastos de la carga de agosto que borrar.' };
}

/** Estado de la carga, para verificar sin abrir la hoja. */
function estadoCargaAgosto() {
  ensureSheets();
  var ids = _caIdsEnHoja();
  return {
    aplicado: !!PropertiesService.getScriptProperties().getProperty(CA_PROP),
    fecha: PropertiesService.getScriptProperties().getProperty(CA_PROP) || '',
    enHoja: ids.length,
    esperados: CA_GASTOS.length,
    total: _round2(CA_GASTOS.reduce(function (s, g) { return s + g[3]; }, 0))
  };
}

function _caIdsEnHoja() {
  var sh = _ss().getSheetByName(SH.GASTOS);
  if (!sh) return [];
  var vals = sh.getDataRange().getValues(), out = [];
  for (var r = 1; r < vals.length; r++) {
    var id = String(vals[r][0] || '');
    if (id.indexOf(CA_PREF) === 0) out.push(id);
  }
  return out;
}

/**
 * OPCIONAL — no la llama `cargarAgosto2026()`. Corrige el proveedor del gasto de
 * B/.22.00 (factura 628 del acueducto), que quedó como 'ELIAS CASTILLO' cuando la
 * factura dice Elías Martínez (Emartinez Solutions, RUC 8-805-1742) y el histórico
 * ya tiene nueve gastos suyos bajo 'Elías Martínez'. Sin esto queda un proveedor
 * fantasma que parte sus totales en dos en los reportes.
 *
 * Se dejó aparte a propósito: modifica un renglón existente, que es otra cosa que
 * agregar diez. Ejecutarla sólo si se confirma que es la misma persona.
 */
function corregirProveedorFactura628() {
  ensureSheets();
  var sh = _ss().getSheetByName(SH.GASTOS);
  var vals = sh.getDataRange().getValues();
  var h = vals[0].map(function (x) { return String(x).trim(); });
  var iProv = h.indexOf('proveedor'), iMonto = h.indexOf('monto'), iDet = h.indexOf('detalle');
  var cambiadas = [];
  for (var r = 1; r < vals.length; r++) {
    var prov = String(vals[r][iProv] || '').trim();
    if (_normTxt(prov) !== _normTxt('ELIAS CASTILLO')) continue;
    if (_round2(vals[r][iMonto]) !== 22.00) continue;
    sh.getRange(r + 1, iProv + 1).setValue('Elías Martínez');
    cambiadas.push({ fila: r + 1, antes: prov, ahora: 'Elías Martínez', detalle: String(vals[r][iDet] || '') });
  }
  cambiadas.forEach(function (c) {
    _reg('gasto.edita', { entidad: 'gasto', clave: 'Acueducto', propietario: 'Elías Martínez',
      monto: 22, detalle: 'Proveedor corregido: "' + c.antes + '" → "Elías Martínez" (fact. 628)' });
  });
  return { ok: true, cambiadas: cambiadas.length, detalle: cambiadas,
    msg: cambiadas.length ? 'Proveedor corregido en ' + cambiadas.length + ' renglón(es).'
                          : 'No se encontró el gasto de B/.22.00 con proveedor ELIAS CASTILLO.' };
}
