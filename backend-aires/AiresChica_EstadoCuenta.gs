/**
 * Motor de estado de cuenta.
 *
 * Regla de cobro (confirmada con el cliente):
 *   cuota mensual = 45.00 * lotes + 13.50 * cabañas
 *   mora = 10% mensual sobre el saldo de cada cuota morosa, sólo a partir de abril 2026.
 *   La cuota vence a fin de mes; se vuelve morosa el mes siguiente.
 *
 * Los pagos se aplican en cascada (waterfall) al saldo más antiguo primero,
 * empezando por el saldo arrastrado de 2025.
 */

function _asOfDate(asOf) {
  if (asOf) { var d = new Date(asOf); if (!isNaN(d.getTime())) return d; }
  return _today();
}

function _moraDesdeIdx() {
  var parts = String(_cfg().moraDesde).split('-');
  return Number(parts[0]) * 12 + Number(parts[1]); // año*12 + mes(1-12)
}

// meses de atraso de una cuota del mes `monthIdx1` (1-12) del año `year`, respecto a asOf.
// La cuota vence fin de mes -> primer mes de mora es el siguiente.
function _mesesAtraso(year, month1, asOf) {
  var idxDue = year * 12 + month1;
  var idxNow = asOf.getFullYear() * 12 + (asOf.getMonth() + 1);
  return Math.max(0, idxNow - idxDue);
}

function _finDeMes(year, month1) { return new Date(year, month1, 0); } // último día del mes

/**
 * Calcula el estado de cuenta de un propietario.
 * @return {Object} desglose por cuota + totales + KPIs de la cuenta.
 */
function calcEstado(prop, pagosArr, asOf) {
  asOf = _asOfDate(asOf);
  var cfg = _cfg();
  var moraPct = cfg.moraPct / 100;
  var cuota = cuotaDe(prop);
  var year = CONFIG.ANIO_ACTUAL;
  var mesActual = (asOf.getFullYear() > year) ? 12 : (asOf.getMonth() + 1);
  var moraDesde = _moraDesdeIdx();

  // saldo inicial 2025: positivo = deuda arrastrada; negativo = crédito a favor.
  var saldo2025 = _round2(Number(prop.saldo2025) || 0);
  var deuda2025 = saldo2025 > 0 ? saldo2025 : 0;
  var credito2025 = saldo2025 < 0 ? -saldo2025 : 0;

  // mes en que empieza a pagar cuota (compró el lote este año).
  //   vacío -> paga todo el año (mes 1); >año actual -> aún no paga (13).
  var mesInicio = 1;
  if (prop.inicioCobro) {
    var _ic = String(prop.inicioCobro).split('-');
    var _iy = Number(_ic[0]), _im = Number(_ic[1]);
    if (_iy === year) mesInicio = Math.min(12, Math.max(1, _im || 1));
    else if (_iy > year) mesInicio = 13;
  }

  // 1) buckets facturados, del más antiguo al más nuevo
  var buckets = [];
  if (deuda2025 > 0) {
    buckets.push({ label: 'Saldo 2025', year: 2025, month: 12, monto: deuda2025, tipo: 'saldo2025' });
  }
  for (var m = mesInicio; m <= mesActual; m++) {
    buckets.push({ label: AC_MESES_LARGO[m - 1], year: year, month: m, monto: cuota, tipo: 'cuota' });
  }

  // 2) total pagado y aplicación en cascada.
  //    El crédito a favor de 2025 se suma al dinero disponible y cubre las
  //    cuotas más antiguas primero (se va consumiendo mes a mes).
  var totalPagado = 0;
  (pagosArr || []).forEach(function (p) { totalPagado += Number(p.monto) || 0; });
  totalPagado = _round2(totalPagado);

  var rem = _round2(totalPagado + credito2025), facturado = 0, moraTotal = 0, saldoTotal = 0;
  var oldestUnpaid = null, bucketMes = null; // bucketMes = cuota del mes de corte (para "cobros del mes")
  buckets.forEach(function (b) {
    facturado += b.monto;
    var aplicado = Math.min(rem, b.monto);
    b.pagado = _round2(aplicado);
    b.saldo = _round2(b.monto - aplicado);
    rem = _round2(rem - aplicado);
    // mora: sólo cuotas >= abril 2026 con saldo pendiente
    b.mora = 0;
    var idxBucket = b.year * 12 + b.month;
    if (b.saldo > 0 && idxBucket >= moraDesde && b.tipo === 'cuota') {
      var ml = _mesesAtraso(b.year, b.month, asOf);
      b.mesesAtraso = ml;
      b.mora = _round2(b.saldo * moraPct * ml);
      moraTotal += b.mora;
    }
    if (b.saldo > 0) {
      saldoTotal += b.saldo;
      if (!oldestUnpaid) oldestUnpaid = b;
    }
    if (b.tipo === 'cuota' && b.month === mesActual) bucketMes = b;
  });

  // cobertura de la cuota del MES DE CORTE (cubierta = pagos + crédito aplicados en cascada)
  var pendienteMes = bucketMes ? bucketMes.saldo : 0;
  var cubiertoMes = bucketMes ? _round2(bucketMes.monto - bucketMes.saldo) : 0;
  var estadoMes;
  if (!bucketMes) estadoMes = 'na';                                    // no factura este mes (ingresó después / futuro)
  else if (pendienteMes <= 0.009) estadoMes = 'pagado';               // cubierta (aunque sea con crédito)
  else if (pendienteMes < bucketMes.monto - 0.009) estadoMes = 'parcial';
  else estadoMes = 'pendiente';

  saldoTotal = _round2(saldoTotal);
  moraTotal = _round2(moraTotal);
  var creditoAFavor = _round2(rem);
  var saldoConMora = _round2(saldoTotal + moraTotal);

  // 3) aging (días de la cuota vencida más antigua)
  var diasVencido = 0, aging = '0';
  if (oldestUnpaid) {
    var vence = _finDeMes(oldestUnpaid.year, oldestUnpaid.month);
    diasVencido = Math.max(0, Math.floor((asOf - vence) / 86400000));
  }
  if (diasVencido <= 0) aging = 'al-dia';
  else if (diasVencido <= 30) aging = '0-30';
  else if (diasVencido <= 60) aging = '31-60';
  else if (diasVencido <= 90) aging = '61-90';
  else aging = '90+';

  var estado = 'Al día';
  if (saldoConMora > 0.009) estado = (diasVencido > 0 ? 'Moroso' : 'Pendiente');

  var venceProx = _finDeMes(year, Math.min(12, mesActual)); // próximo vencimiento del mes en curso

  // 4) desglose MENSUAL (caja real): cuota del mes + lo efectivamente pagado ese mes
  //    calendario + saldo acumulado. Es la vista que coincide con el Excel del cliente.
  var pagosMes = {}, vouchersMes = {};
  (pagosArr || []).forEach(function (p) {
    var d = new Date(p.fecha);
    if (d.getFullYear() === year) {
      var mi = d.getMonth() + 1;
      pagosMes[mi] = _round2((pagosMes[mi] || 0) + (Number(p.monto) || 0));
      if (p.comprobanteUrl) (vouchersMes[mi] = vouchersMes[mi] || []).push(p.comprobanteUrl);
    }
  });
  var mensual = [], acum = saldo2025;
  if (acum !== 0) mensual.push({ label: acum < 0 ? 'Saldo a favor 2025' : 'Saldo 2025', cuota: 0, pagado: 0, saldo: acum, vouchers: [] });
  for (var mm = mesInicio; mm <= mesActual; mm++) {
    var pg = _round2(pagosMes[mm] || 0);
    acum = _round2(acum + cuota - pg);
    mensual.push({ label: AC_MESES_LARGO[mm - 1], cuota: cuota, pagado: pg, saldo: acum, vouchers: vouchersMes[mm] || [] });
  }

  return {
    clave: prop.clave, lote: prop.lote, loteNum: prop.loteNum,
    residencial: prop.residencial, nombre: prop.nombre,
    email: prop.email, celular: prop.celular,
    cuota: cuota, lotes: prop.lotes, cabanas: prop.cabanas, airbnb: !!prop.airbnb,
    inicioCobro: prop.inicioCobro || '',
    cuotaMes: (mesInicio <= mesActual ? cuota : 0), // 0 si aún no empieza a pagar
    cubiertoMes: cubiertoMes, pendienteMes: pendienteMes, estadoMes: estadoMes,
    buckets: buckets, mensual: mensual,
    facturado: _round2(facturado),
    pagado: totalPagado,
    saldo: saldoTotal,
    mora: moraTotal,
    saldoConMora: saldoConMora,
    creditoAFavor: creditoAFavor,
    diasVencido: diasVencido,
    aging: aging,
    estado: estado,
    fechaVencimiento: venceProx,
    asOf: asOf
  };
}

function getEstadoCuentaByKey(clave) {
  var prop = _findProp(clave);
  if (!prop) throw new Error('No existe la cuenta ' + clave);
  var pagosC = getPagosByClave(clave);
  var est = calcEstado(prop, pagosC, null);
  est.pagosHistorial = pagosC.map(function (p) {
    return { fecha: p.fecha, monto: p.monto, origen: p.origen, referencia: p.referencia, notas: p.notas };
  }).sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
  return est;
}

/* ─────────────── Dashboard / KPIs ─────────────── */

function buildDashboard(asOf) {
  asOf = _asOfDate(asOf);
  var props = getPropietarios();
  var pagos = getPagos();
  var pagosByClave = {};
  pagos.forEach(function (p) { (pagosByClave[p.clave] = pagosByClave[p.clave] || []).push(p); });

  var year = CONFIG.ANIO_ACTUAL;
  var mesActual = (asOf.getFullYear() > year) ? 12 : (asOf.getMonth() + 1);

  var cuentas = props.map(function (p) {
    var e = calcEstado(p, pagosByClave[p.clave] || [], asOf);
    return e;
  });

  // KPIs
  var totalFacturado = 0, totalPagado = 0, carteraVencida = 0, moraAcum = 0;
  var aging = { 'al-dia': 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  var agingMonto = { 'al-dia': 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  var morosos = 0, pendientes = 0, alDia = 0;
  var facturadoMes = 0, pagadoMes = 0;

  cuentas.forEach(function (e) {
    totalFacturado += e.facturado;
    totalPagado += e.pagado;
    carteraVencida += e.saldo;
    moraAcum += e.mora;
    aging[e.aging] = (aging[e.aging] || 0) + 1;
    agingMonto[e.aging] = _round2((agingMonto[e.aging] || 0) + e.saldoConMora);
    if (e.diasVencido > 0) morosos++;               // cuota(s) vencida(s)
    else if (e.saldoConMora > 0.009) pendientes++;  // sólo el mes en curso, aún no vencido
    else alDia++;
    // recaudación del mes en curso (excluye a quien aún no empieza a pagar)
    facturadoMes += e.cuotaMes;
  });

  // pagado del mes en curso (por fecha de pago)
  pagos.forEach(function (p) {
    var d = new Date(p.fecha);
    if (d.getFullYear() === year && (d.getMonth() + 1) === mesActual) pagadoMes += Number(p.monto) || 0;
  });

  var topMorosos = cuentas.filter(function (e) { return e.saldoConMora > 0.009; })
    .sort(function (a, b) { return b.saldoConMora - a.saldoConMora; })
    .slice(0, 10)
    .map(function (e) {
      return { clave: e.clave, lote: e.lote, nombre: e.nombre, residencial: e.residencial,
               saldo: e.saldo, mora: e.mora, saldoConMora: e.saldoConMora,
               diasVencido: e.diasVencido, aging: e.aging };
    });

  var porResidencial = {};
  cuentas.forEach(function (e) {
    var r = porResidencial[e.residencial] = porResidencial[e.residencial] ||
      { residencial: e.residencial, cuentas: 0, facturado: 0, pagado: 0, saldo: 0, mora: 0 };
    r.cuentas++; r.facturado += e.facturado; r.pagado += e.pagado; r.saldo += e.saldo; r.mora += e.mora;
  });
  Object.keys(porResidencial).forEach(function (k) {
    var r = porResidencial[k];
    r.facturado = _round2(r.facturado); r.pagado = _round2(r.pagado);
    r.saldo = _round2(r.saldo); r.mora = _round2(r.mora);
  });

  return {
    negocio: CONFIG.NEGOCIO,
    asOf: asOf,
    mesActual: AC_MESES_LARGO[mesActual - 1],
    anio: year,
    kpis: {
      cuentas: cuentas.length,
      alDia: alDia,
      morosos: morosos,
      pendientes: pendientes,
      tasaMorosidad: cuentas.length ? _round2(morosos / cuentas.length * 100) : 0,
      totalFacturado: _round2(totalFacturado),
      totalPagado: _round2(totalPagado),
      carteraVencida: _round2(carteraVencida),
      moraAcumulada: _round2(moraAcum),
      saldoTotalConMora: _round2(carteraVencida + moraAcum),
      facturadoMes: _round2(facturadoMes),
      pagadoMes: _round2(pagadoMes),
      tasaRecaudacionMes: facturadoMes ? _round2(pagadoMes / facturadoMes * 100) : 0,
      tasaRecaudacionAnual: totalFacturado ? _round2(totalPagado / totalFacturado * 100) : 0
    },
    aging: aging,
    agingMonto: agingMonto,
    topMorosos: topMorosos,
    porResidencial: Object.keys(porResidencial).map(function (k) { return porResidencial[k]; }),
    cuentas: cuentas.map(function (e) {
      return { clave: e.clave, lote: e.lote, loteNum: e.loteNum, residencial: e.residencial, nombre: e.nombre, email: e.email,
               celular: e.celular, cuota: e.cuota, lotes: e.lotes, cabanas: e.cabanas, airbnb: e.airbnb,
               inicioCobro: e.inicioCobro,
               cuotaMes: e.cuotaMes, cubiertoMes: e.cubiertoMes, pendienteMes: e.pendienteMes, estadoMes: e.estadoMes,
               facturado: e.facturado, pagado: e.pagado,
               saldo: e.saldo, mora: e.mora, saldoConMora: e.saldoConMora, creditoAFavor: e.creditoAFavor,
               estado: e.estado, aging: e.aging, diasVencido: e.diasVencido,
               fechaVencimiento: e.fechaVencimiento,
               // desglose mensual (caja real) para que el modal abra al instante (sin otra llamada)
               mensual: e.mensual };
    })
  };
}
