/**
 * Actualización puntual de JULIO 2026 con la data del Excel del cliente.
 *
 * 100% REVERSIBLE: antes de tocar nada, duplica las hojas `Pagos` y `Gastos`
 * a hojas de respaldo (`Pagos_BAK_jul2026`, `Gastos_BAK_jul2026`). El rollback
 * restaura exactamente desde esas hojas. Además, todo lo insertado se marca
 * con origen 'upd-jul2026' e id 'UJ26-…'.
 *
 * Reglas acordadas:
 *  - NO se tocan los lotes L-4A ni L-5 (quedan como están: comprobantes reales).
 *  - Se reemplazan los 9 pagos SEED "Histórico Jul" (parciales) por la cifra
 *    completa del cliente por propietario.
 *  - Se agregan los 11 gastos de julio y el aporte único de la promotora (enero).
 *
 * Uso: ejecutar `actualizarJulio2026()` una vez (o desde el panel). Para
 * deshacer: `rollbackJulio2026()`.
 */

var UJ_TAG  = 'upd-jul2026';
var UJ_PROP = 'AC_UPD_JUL2026';   // marca de "ya aplicado"
var UJ_BAK  = '_BAK_jul2026';

// Cobros de julio (clave, monto) resueltos del Excel del cliente. EXCLUYE L-4A y L-5.
var UJ_COBROS = [
  ['H-10',45],['H-11',45],['H-15',72],['H-22',45],['H-27',45],['H-28',45],['H-29A',45],
  ['H-39',45],['H-4',45],['H-41A',45],['H-42A',45],['H-46',103.5],['H-6',45],['H-8',45],
  ['L-12',45],['L-15',180],['L-16',45],['L-17',45],['L-18A',90],['L-2',45],['L-6-FOUCHARD',90],
  ['L-7',45],['L-9',122.8],['Q-10',90],['Q-11A',45],['Q-13A',58.5],['Q-14',225],['Q-18',45],
  ['Q-19',80],['Q-19A',45],['Q-20',94.5],['Q-22',189],['Q-26',45],['Q-28',45],['Q-5',45],
  ['Q-6A',144],['Q-6B',144],['Q-7',90],['Q-8',45],['Q-9',45]
];

// Gastos de julio: [categoria, proveedor, detalle, monto]
var UJ_GASTOS = [
  ['Calles, senderos y áreas comunes','Fernando López','Contrato mantenimiento general',350],
  ['Calles, senderos y áreas comunes','Cornelio Sánchez','Saldo contrato',1000],
  ['Baño comunal','Zoila Castrejón','Limpieza baño comunal',45],
  ['Administración','Doraida Castillo','Honorarios administración',250],
  ['Línea de crédito / préstamo','Doraida Castillo','Abono a préstamo',200],
  ['Gastos legales','Alma Karina Alonso Escala','Trámite DGI',130],
  ['Portón, luminarias y cámaras','Elías Martinez','Abono trabajos portón',445],
  ['Portón, luminarias y cámaras','Starlink','Servicio portón',45.45],
  ['Portón, luminarias y cámaras','Más Móvil','Servicio portón (17/jul)',10.70],
  ['Portón, luminarias y cámaras','Javier Della Cella','Nube portón',11.99],
  ['Banca en línea','Banco General','Banca en línea',5.35]
];

var UJ_APORTE = 1000; // Promotora - aporte único (enero)

function actualizarJulio2026(force) {
  var ss = _ss();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(UJ_PROP) && !force) {
    return { ok: false, yaAplicado: true,
      msg: 'La actualización de julio YA fue aplicada. Ejecuta rollbackJulio2026() antes de repetir.' };
  }

  // 1) RESPALDO — duplica Pagos y Gastos a hojas _BAK_jul2026
  ['Pagos', 'Gastos'].forEach(function (n) {
    var old = ss.getSheetByName(n + UJ_BAK);
    if (old) ss.deleteSheet(old);
    ss.getSheetByName(n).copyTo(ss).setName(n + UJ_BAK);
  });

  // 2) borrar los 9 pagos SEED "Histórico Jul" (parciales; NO 4A/5)
  var seedBorrados = _ujBorrarSeedJul();

  // 3) cobros del cliente (excepto 4A/5)
  var nP = 0, totP = 0;
  UJ_COBROS.forEach(function (c) {
    appendPago({ id: 'UJ26-P-' + c[0], clave: c[0], monto: c[1], fecha: new Date(2026, 6, 31),
      origen: UJ_TAG, mesAplicado: '2026-07', notas: 'Actualización julio (Excel cliente)' });
    nP++; totP += c[1];
  });

  // 4) aporte único de la promotora (enero)
  appendPago({ id: 'UJ26-P-PROMOTORA', clave: 'APORTE', lote: '', nombre: 'Promotora (aporte único)',
    monto: UJ_APORTE, fecha: new Date(2026, 0, 31), origen: UJ_TAG, mesAplicado: '2026-01',
    notas: 'Aporte único de la promotora (Excel cliente)' });

  // 5) gastos de julio
  var nG = 0, totG = 0;
  UJ_GASTOS.forEach(function (g, i) {
    _appendGasto({ id: 'UJ26-G-' + (i + 1), fecha: new Date(2026, 6, 31), categoria: g[0],
      proveedor: g[1], detalle: g[2], monto: g[3], tipo: 'puntual',
      notas: 'Actualización julio (Excel cliente)' });
    nG++; totG += g[3];
  });

  props.setProperty(UJ_PROP, new Date().toISOString());
  return { ok: true,
    cobros: nP, totalCobros: _round2(totP),
    aportePromotora: UJ_APORTE,
    gastos: nG, totalGastos: _round2(totG),
    seedJulReemplazados: seedBorrados,
    respaldo: 'Pagos' + UJ_BAK + ' + Gastos' + UJ_BAK,
    msg: 'Julio actualizado. Para deshacer: rollbackJulio2026().' };
}

function _ujBorrarSeedJul() {
  var sh = _ss().getSheetByName(SH.PAGOS);
  var data = sh.getDataRange().getValues();  // [id,fecha,clave,lote,nombre,monto,ref,origen,...]
  var del = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var id = String(data[i][0] || ''), clave = String(data[i][2] || ''), origen = String(data[i][7] || '');
    if (/-Jul$/.test(id) && origen === 'carga-inicial' && clave !== 'L-4A' && clave !== 'L-5') {
      sh.deleteRow(i + 1); del++;
    }
  }
  return del;
}

function rollbackJulio2026() {
  var ss = _ss();
  var props = PropertiesService.getScriptProperties();
  var restaurado = [];
  ['Pagos', 'Gastos'].forEach(function (n) {
    var bak = ss.getSheetByName(n + UJ_BAK);
    if (!bak) return;
    var sh = ss.getSheetByName(n);
    sh.clearContents();
    var v = bak.getDataRange().getValues();
    sh.getRange(1, 1, v.length, v[0].length).setValues(v);
    ss.deleteSheet(bak);
    restaurado.push(n);
  });
  props.deleteProperty(UJ_PROP);
  if (!restaurado.length) {
    return { ok: false, msg: 'No hay respaldo de julio para restaurar (¿ya se hizo rollback o nunca se aplicó?).' };
  }
  return { ok: true, restaurado: restaurado,
    msg: 'Sistema restaurado exactamente al estado previo a la actualización de julio.' };
}

// estado para el panel
function estadoUpdateJulio() {
  var props = PropertiesService.getScriptProperties();
  var ss = _ss();
  return {
    aplicado: !!props.getProperty(UJ_PROP),
    aplicadoEn: props.getProperty(UJ_PROP) || '',
    hayRespaldo: !!ss.getSheetByName('Pagos' + UJ_BAK)
  };
}
