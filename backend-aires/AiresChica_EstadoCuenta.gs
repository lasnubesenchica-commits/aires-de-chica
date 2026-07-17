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

// Clave 'YYYY-MM' para condonaciones de mora.
function _ymKey(y, m) { return y + '-' + (m < 10 ? '0' + m : '' + m); }

// Conjunto de meses con mora condonada de un propietario.
//   prop.moraCondon = 'ALL' (toda la mora) | '2026-04,2026-05' (meses puntuales) | ''
function _condonSet(prop) {
  var raw = String(prop && prop.moraCondon || '').trim();
  if (raw.toUpperCase() === 'ALL') return { all: true, set: {} };
  var set = {};
  raw.split(',').forEach(function (t) { t = t.trim(); if (t) set[t] = true; });
  return { all: false, set: set };
}

/**
 * Calcula el estado de cuenta de un propietario.
 *
 * MORA (recargo por atraso): se trata APARTE del principal (cuotas). Una vez que
 * una cuota se vuelve morosa genera su recargo, y ese recargo PERMANECE como saldo
 * aunque después se pague la cuota (no se borra al aplicar el pago).
 *  - cfg.moraCrece=false (default): cargo fijo de una sola vez (moraPct % de la cuota).
 *  - cfg.moraCrece=true: crece moraPct % por cada mes de atraso, y se congela el mes
 *    en que la cuota queda saldada (fechado por aplicación cronológica del principal).
 *  - cfg.moraOrden='cuota' (default): los pagos cubren primero las cuotas y de último la mora.
 *    cfg.moraOrden='mora': los pagos cubren primero la mora y luego las cuotas.
 *  - prop.moraCondon: meses (o 'ALL') cuya mora fue condonada por el administrador.
 *
 * @return {Object} desglose por cuota + totales + KPIs de la cuenta.
 */
function calcEstado(prop, pagosArr, asOf) {
  asOf = _asOfDate(asOf);
  var cfg = _cfg();
  var moraPct = cfg.moraPct / 100;
  var moraCrece = !!cfg.moraCrece;
  var moraOrden = (cfg.moraOrden === 'mora') ? 'mora' : 'cuota';
  var cuota = cuotaDe(prop);
  var year = CONFIG.ANIO_ACTUAL;
  var mesActual = (asOf.getFullYear() > year) ? 12 : (asOf.getMonth() + 1);
  var moraDesde = _moraDesdeIdx();
  var currentIdx = year * 12 + mesActual;
  var condon = _condonSet(prop);

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

  // 1) buckets de principal, del más antiguo al más nuevo
  var buckets = [];
  if (deuda2025 > 0) {
    buckets.push({ label: 'Saldo 2025', year: 2025, month: 12, idx: 2025 * 12 + 12, monto: deuda2025, tipo: 'saldo2025' });
  }
  for (var m = mesInicio; m <= mesActual; m++) {
    buckets.push({ label: AC_MESES_LARGO[m - 1], year: year, month: m, idx: year * 12 + m, monto: cuota, tipo: 'cuota' });
  }

  // Sólo pagos recibidos HASTA la fecha de corte (para que un corte histórico
  // sea una foto real de esa fecha y no incluya pagos posteriores).
  var _corteMs = asOf.getTime() + 86399999; // fin del día de corte (inclusivo)
  var pagosArrC = (pagosArr || []).filter(function (p) {
    var d = new Date(p.fecha); return isNaN(d.getTime()) ? true : d.getTime() <= _corteMs;
  });

  var totalPagado = 0;
  pagosArrC.forEach(function (p) { totalPagado += Number(p.monto) || 0; });
  totalPagado = _round2(totalPagado);

  // 2) fechado de pago (cronológico, principal más antiguo primero) para congelar la mora
  //    en modo 'crece'. El crédito 2025 está disponible desde el inicio.
  var thresholds = [], run = 0;
  buckets.forEach(function (b) { run = _round2(run + b.monto); thresholds.push(run); });
  var payoffIdx = buckets.map(function () { return Infinity; });
  var pays = pagosArrC.map(function (p) { return { d: new Date(p.fecha), a: _round2(Number(p.monto) || 0) }; })
    .filter(function (x) { return x.a > 0 && !isNaN(x.d.getTime()); })
    .sort(function (a, b) { return a.d - b.d; });
  var acc = credito2025;
  buckets.forEach(function (b, k) { if (acc >= thresholds[k] - 0.009) payoffIdx[k] = Math.min(payoffIdx[k], b.idx); });
  pays.forEach(function (p) {
    acc = _round2(acc + p.a);
    var pidx = p.d.getFullYear() * 12 + (p.d.getMonth() + 1);
    buckets.forEach(function (b, k) { if (payoffIdx[k] === Infinity && acc >= thresholds[k] - 0.009) payoffIdx[k] = pidx; });
  });

  // 3) mora por bucket (cargo fijo o creciente, independiente del pago; congela al saldar)
  buckets.forEach(function (b, k) {
    b.mora = 0; b.moraMeses = 0; b.condonada = false;
    if (b.tipo !== 'cuota') return;
    if (b.idx < moraDesde) return;                  // cuotas anteriores a moraDesde no generan mora (regla del cliente)
    var hi = Math.min(payoffIdx[k], currentIdx);   // hasta cuándo corre el atraso
    var lo = b.idx + 1;                             // se vuelve morosa el mes siguiente al vencimiento
    var meses = Math.max(0, hi - lo + 1);
    var cond = condon.all || !!condon.set[_ymKey(b.year, b.month)];
    if (meses > 0 && cond) { b.condonada = true; }
    if (meses > 0 && !cond) {
      b.moraMeses = meses;
      b.mora = _round2(cuota * moraPct * (moraCrece ? meses : 1));
    }
  });

  // 4) aplicación del pago: principal y mora, en el ORDEN configurado.
  var pool = _round2(totalPagado + credito2025);
  buckets.forEach(function (b) { b.pagado = 0; b.saldo = b.monto; b.moraPagado = 0; b.moraSaldo = b.mora; });
  var moraList = buckets.filter(function (b) { return b.mora > 0; });
  function _aplicaPrincipal() {
    buckets.forEach(function (b) { var ap = Math.min(pool, b.saldo); b.pagado = _round2(b.pagado + ap); b.saldo = _round2(b.saldo - ap); pool = _round2(pool - ap); });
  }
  function _aplicaMora() {
    moraList.forEach(function (b) { var ap = Math.min(pool, b.moraSaldo); b.moraPagado = _round2(b.moraPagado + ap); b.moraSaldo = _round2(b.moraSaldo - ap); pool = _round2(pool - ap); });
  }
  if (moraOrden === 'mora') { _aplicaMora(); _aplicaPrincipal(); } else { _aplicaPrincipal(); _aplicaMora(); }

  // 5) totales
  var facturado = 0, saldoTotal = 0, moraCargada = 0, moraPendiente = 0;
  var oldestUnpaid = null, bucketMes = null;
  buckets.forEach(function (b) {
    facturado += b.monto;
    moraCargada = _round2(moraCargada + b.mora);
    if (b.saldo > 0.009) { saldoTotal = _round2(saldoTotal + b.saldo); if (!oldestUnpaid) oldestUnpaid = b; }
    if (b.moraSaldo > 0.009) moraPendiente = _round2(moraPendiente + b.moraSaldo);
    if (b.tipo === 'cuota' && b.month === mesActual) bucketMes = b;
  });

  // cobertura de la cuota del MES DE CORTE (principal)
  var pendienteMes = bucketMes ? bucketMes.saldo : 0;
  var cubiertoMes = bucketMes ? _round2(bucketMes.monto - bucketMes.saldo) : 0;
  var estadoMes;
  if (!bucketMes) estadoMes = 'na';
  else if (pendienteMes <= 0.009) estadoMes = 'pagado';
  else if (pendienteMes < bucketMes.monto - 0.009) estadoMes = 'parcial';
  else estadoMes = 'pendiente';

  saldoTotal = _round2(saldoTotal);
  var moraTotal = moraPendiente;              // compat: "mora" = recargo pendiente
  var creditoAFavor = _round2(pool);
  var saldoConMora = _round2(saldoTotal + moraPendiente);

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
  pagosArrC.forEach(function (p) {
    var d = new Date(p.fecha);
    if (d.getFullYear() === year) {
      var mi = d.getMonth() + 1;
      pagosMes[mi] = _round2((pagosMes[mi] || 0) + (Number(p.monto) || 0));
      if (p.comprobanteUrl) (vouchersMes[mi] = vouchersMes[mi] || []).push(p.comprobanteUrl);
    }
  });
  // mora y condonación por mes (para pintar la columna Mora)
  var moraByIdx = {}, condonByIdx = {};
  buckets.forEach(function (b) { if (b.tipo === 'cuota') { moraByIdx[b.idx] = b.mora; condonByIdx[b.idx] = b.condonada; } });

  var mensual = [], acum = saldo2025;
  if (acum !== 0) mensual.push({ label: acum < 0 ? 'Saldo a favor 2025' : 'Saldo 2025', cuota: 0, pagado: 0, saldo: acum, mora: 0, condonada: false, vouchers: [] });
  for (var mm = mesInicio; mm <= mesActual; mm++) {
    var pg = _round2(pagosMes[mm] || 0);
    acum = _round2(acum + cuota - pg);
    var _idx = year * 12 + mm;
    mensual.push({ label: AC_MESES_LARGO[mm - 1], ym: _ymKey(year, mm), cuota: cuota, pagado: pg, saldo: acum,
      mora: _round2(moraByIdx[_idx] || 0), condonada: !!condonByIdx[_idx], vouchers: vouchersMes[mm] || [] });
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
    mora: moraTotal,               // recargo por mora PENDIENTE (lo que aún se debe)
    moraCargada: moraCargada,      // recargo por mora total generado (antes de pagos/condonación)
    saldoConMora: saldoConMora,
    creditoAFavor: creditoAFavor,
    moraOrden: moraOrden, moraCrece: moraCrece,
    moraCondon: String(prop.moraCondon || ''), moraCondonAll: condon.all,
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

  // pagado del mes de corte (por fecha de pago, hasta la fecha de corte) — global y por cuenta
  var _corteMs = asOf.getTime() + 86399999;
  var pagadoMesByClave = {};
  pagos.forEach(function (p) {
    var d = new Date(p.fecha);
    if (d.getFullYear() === year && (d.getMonth() + 1) === mesActual && d.getTime() <= _corteMs) {
      pagadoMes += Number(p.monto) || 0;
      pagadoMesByClave[p.clave] = _round2((pagadoMesByClave[p.clave] || 0) + (Number(p.monto) || 0));
    }
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
               pagadoMes: _round2(pagadoMesByClave[e.clave] || 0),
               facturado: e.facturado, pagado: e.pagado,
               saldo: e.saldo, mora: e.mora, moraCargada: e.moraCargada, saldoConMora: e.saldoConMora, creditoAFavor: e.creditoAFavor,
               moraCondon: e.moraCondon, moraCondonAll: e.moraCondonAll,
               estado: e.estado, aging: e.aging, diasVencido: e.diasVencido,
               fechaVencimiento: e.fechaVencimiento,
               // desglose mensual (caja real) para que el modal abra al instante (sin otra llamada)
               mensual: e.mensual };
    })
  };
}
