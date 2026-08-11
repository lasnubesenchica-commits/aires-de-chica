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
  if (asOf) {
    // 'YYYY-MM-DD' se construye como MEDIANOCHE LOCAL del negocio. Si se deja a
    // new Date(str), el motor lo interpreta como medianoche UTC, que en Panamá es
    // el día anterior a las 19:00: el mes de corte se corría (un corte al 1 de
    // agosto calculaba julio) y la ventana de pagos quedaba desfasada un día.
    var m = String(asOf).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(asOf); if (!isNaN(d.getTime())) return d;
  }
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

  // 2) pagos por mes calendario (caja real). La cobertura de la cuota de cada mes se
  //    evalúa contra lo pagado DENTRO de ese mismo mes; alimenta la mora y el desglose.
  var pagosMes = {}, vouchersMes = {};
  pagosArrC.forEach(function (p) {
    var d = new Date(p.fecha);
    if (d.getFullYear() === year) {
      var mi = d.getMonth() + 1;
      pagosMes[mi] = _round2((pagosMes[mi] || 0) + (Number(p.monto) || 0));
      if (p.comprobanteUrl) (vouchersMes[mi] = vouchersMes[mi] || []).push(p.comprobanteUrl);
    }
  });

  // 3) mora por mes (regla del cliente): del mes de abril en adelante se aplica un cargo
  //    ÚNICO del 10% de la cuota si la cuota de ESE mes no queda cubierta por el pago del
  //    mes MÁS el saldo a favor que traía el propietario. Es decir, un adelanto/crédito
  //    arrastrado cubre la cuota del mes y evita la mora. El mes en curso todavía no
  //    genera mora. Es un cargo fijo (no crece con el atraso).
  var saldoPrin = saldo2025;   // principal corriente (deuda + / crédito -), sin mora
  var moraMesMap = {}, condMesMap = {};
  var cubiertoMesCash = 0;     // cobertura de la cuota del MES DE CORTE con el mismo criterio
  for (var mm3 = mesInicio; mm3 <= mesActual; mm3++) {
    var idx3 = year * 12 + mm3;
    var pago3 = _round2(pagosMes[mm3] || 0);
    var creditoPrevio = saldoPrin < 0 ? -saldoPrin : 0;          // saldo a favor que traía al mes
    var disponible3 = _round2(creditoPrevio + pago3);            // con qué contó para cubrir el mes
    var cubierta3 = disponible3 >= cuota - 0.009;
    if (mm3 === mesActual) cubiertoMesCash = _round2(Math.min(cuota, Math.max(0, disponible3)));
    var mora3 = 0, cond3 = false;
    if (idx3 >= moraDesde && idx3 < currentIdx && !cubierta3) {
      if (condon.all || !!condon.set[_ymKey(year, mm3)]) cond3 = true;
      else mora3 = _round2(cuota * moraPct);                     // cargo único del 10%
    }
    moraMesMap[idx3] = mora3; condMesMap[idx3] = cond3;
    saldoPrin = _round2(saldoPrin + cuota - pago3);              // avanza principal (sin mora)
  }
  buckets.forEach(function (b) {
    b.mora = 0; b.moraMeses = 0; b.condonada = false;
    if (b.tipo !== 'cuota') return;
    b.condonada = !!condMesMap[b.idx];
    if (moraMesMap[b.idx] > 0.009) { b.mora = moraMesMap[b.idx]; b.moraMeses = 1; }
  });

  // 4) aplicación del pago para repartir el saldo entre principal y mora: primero las
  //    cuotas (de la más antigua a la más nueva) y la mora de último — la mora permanece
  //    aunque se pague la cuota. El total no cambia; sólo define el desglose principal/mora.
  var pool = _round2(totalPagado + credito2025);
  buckets.forEach(function (b) { b.pagado = 0; b.saldo = b.monto; b.moraPagado = 0; b.moraSaldo = b.mora; });
  var moraList = buckets.filter(function (b) { return b.mora > 0; });
  function _aplicaPrincipal() { buckets.forEach(function (b) { var ap = Math.min(pool, b.saldo); b.pagado = _round2(b.pagado + ap); b.saldo = _round2(b.saldo - ap); pool = _round2(pool - ap); }); }
  function _aplicaMora() { moraList.forEach(function (b) { var ap = Math.min(pool, b.moraSaldo); b.moraPagado = _round2(b.moraPagado + ap); b.moraSaldo = _round2(b.moraSaldo - ap); pool = _round2(pool - ap); }); }
  if (moraOrden === 'mora') { _aplicaMora(); _aplicaPrincipal(); } else { _aplicaPrincipal(); _aplicaMora(); }

  // 5) totales
  var facturado = 0, saldoTotal = 0, moraCargada = 0, moraPendiente = 0;
  var oldestUnpaid = null, bucketMes = null, mesesMora = 0;
  buckets.forEach(function (b) {
    // "Facturado" = SOLO las cuotas devengadas del año en curso. El saldo que algunos
    // propietarios arrastran de 2025 se facturó en 2025, así que no cuenta como
    // facturación de este año; lo que se cobre de él se refleja en "Pagado".
    if (b.tipo === 'cuota') facturado += b.monto;
    moraCargada = _round2(moraCargada + b.mora);
    if (b.saldo > 0.009) { saldoTotal = _round2(saldoTotal + b.saldo); if (!oldestUnpaid) oldestUnpaid = b; }
    if (b.moraSaldo > 0.009) moraPendiente = _round2(moraPendiente + b.moraSaldo);
    if (b.tipo === 'cuota' && b.month === mesActual) bucketMes = b;
    // meses de mora: meses con recargo aún pendiente de pago
    if (b.tipo === 'cuota' && b.mora > 0.009 && b.moraSaldo > 0.009) mesesMora++;
  });

  // cobertura de la cuota del MES DE CORTE. Se mide con el MISMO criterio que la mora:
  // lo pagado dentro del mes más el saldo a favor que se traía. Antes se leía del bucket
  // (cascada de lo más antiguo primero), lo que marcaba "Pendiente" a quien sí pagó su
  // cuota del mes sólo porque su dinero se había imputado a meses anteriores —
  // contradiciendo a la mora, que ya lo daba por cubierto.
  var cubiertoMes = bucketMes ? cubiertoMesCash : 0;
  var pendienteMes = bucketMes ? _round2(bucketMes.monto - cubiertoMes) : 0;
  var estadoMes;
  if (!bucketMes) estadoMes = 'na';
  else if (pendienteMes <= 0.009) estadoMes = 'pagado';
  else if (cubiertoMes > 0.009) estadoMes = 'parcial';
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

  // desglose MENSUAL — libro de cuenta corriente. Para cada mes:
  //   Saldo final = Saldo inicial + Cuota del mes + Recargo (mora) del mes − Pago del mes
  // El "Saldo total" es un único saldo corriente que ya incluye la mora del mes; positivo
  // significa que debe y negativo significa crédito a favor.
  var moraByIdx = {}, condonByIdx = {};
  buckets.forEach(function (b) { if (b.tipo === 'cuota') { moraByIdx[b.idx] = b.mora; condonByIdx[b.idx] = b.condonada; } });

  var mensual = [];
  var saldoRun = saldo2025; // saldo inicial: deuda 2025 (positiva) o crédito a favor (negativo)
  if (saldo2025 !== 0) mensual.push({ label: saldo2025 < 0 ? 'Saldo a favor 2025' : 'Saldo 2025', cuota: 0, mora: 0, pagado: 0, saldo: saldoRun, condonada: false, vouchers: [] });
  for (var mm = mesInicio; mm <= mesActual; mm++) {
    var _idx = year * 12 + mm;
    var pg = _round2(pagosMes[mm] || 0);
    var moraMes = _round2(moraByIdx[_idx] || 0);
    saldoRun = _round2(saldoRun + cuota + moraMes - pg);
    mensual.push({ label: AC_MESES_LARGO[mm - 1], ym: _ymKey(year, mm), cuota: cuota, mora: moraMes, pagado: pg, saldo: saldoRun,
      condonada: !!condonByIdx[_idx], vouchers: vouchersMes[mm] || [] });
  }
  var saldoNeto = saldoRun; // saldo total con signo (debe positivo / crédito negativo)

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
    saldoNeto: saldoNeto,          // saldo total con signo: positivo = debe; negativo = crédito a favor
    creditoAFavor: creditoAFavor,
    moraOrden: moraOrden, moraCrece: moraCrece,
    moraCondon: String(prop.moraCondon || ''), moraCondonAll: condon.all,
    diasVencido: diasVencido,
    mesesMora: mesesMora,          // nº de cuotas vencidas con recargo aún pendientes de pago
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
  var totalFacturado = 0, totalPagado = 0, carteraVencida = 0, moraAcum = 0, creditoTotal = 0, moraCargadaTot = 0;
  var aging = { 'al-dia': 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  var agingMonto = { 'al-dia': 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  var morosos = 0, pendientes = 0, alDia = 0;
  var facturadoMes = 0, pagadoMes = 0;

  cuentas.forEach(function (e) {
    totalFacturado += e.facturado;
    totalPagado += e.pagado;
    carteraVencida += e.saldo;
    moraAcum += e.mora;
    creditoTotal += e.creditoAFavor || 0;
    moraCargadaTot += e.moraCargada || 0;
    aging[e.aging] = (aging[e.aging] || 0) + 1;
    agingMonto[e.aging] = _round2((agingMonto[e.aging] || 0) + e.saldoConMora);
    if (e.diasVencido > 0) morosos++;               // cuota(s) vencida(s)
    else if (e.saldoConMora > 0.009) pendientes++;  // sólo el mes en curso, aún no vencido
    else alDia++;
    // recaudación del mes en curso (excluye a quien aún no empieza a pagar)
    facturadoMes += e.cuotaMes;
  });

  // pagado del mes de corte (por fecha de pago, hasta la fecha de corte) — global y por cuenta
  // y matriz de caja real por mes (Ene..Dic) por cuenta, para la hoja "Cobros por mes"
  var _corteMs = asOf.getTime() + 86399999;
  var pagadoMesByClave = {};
  var cobradoMensualByClave = {};
  pagos.forEach(function (p) {
    var d = new Date(p.fecha);
    if (d.getFullYear() !== year || d.getTime() > _corteMs) return;
    var mIdx = d.getMonth(); // 0..11
    var arr = cobradoMensualByClave[p.clave] || (cobradoMensualByClave[p.clave] = [0,0,0,0,0,0,0,0,0,0,0,0]);
    arr[mIdx] = _round2(arr[mIdx] + (Number(p.monto) || 0));
    if ((mIdx + 1) === mesActual) {
      pagadoMes += Number(p.monto) || 0;
      pagadoMesByClave[p.clave] = _round2((pagadoMesByClave[p.clave] || 0) + (Number(p.monto) || 0));
    }
  });

  // "Cobrado del mes" se separa igual que en Finanzas: lo que corresponde a CUOTAS de
  // propietarios (que es lo que suman la hoja "Cobros por mes" y la de "Cobros del Mes")
  // y otros ingresos del mes (aportes, reembolsos). El % de recaudación se calcula con
  // las cuotas, para compararlo contra lo facturado del mes en la misma base.
  var _clavesCuenta = {};
  cuentas.forEach(function (e) { _clavesCuenta[e.clave] = 1; });
  var pagadoMesCuotas = 0;
  Object.keys(pagadoMesByClave).forEach(function (k) {
    if (_clavesCuenta[k]) pagadoMesCuotas = _round2(pagadoMesCuotas + pagadoMesByClave[k]);
  });
  var pagadoMesOtros = _round2(pagadoMes - pagadoMesCuotas);

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
    // fecha de corte REALMENTE usada, ya formateada en la zona horaria del negocio.
    // Los reportes deben etiquetarse con ésta y no con el control de la pantalla,
    // que puede haber cambiado sin recargar el tablero.
    asOfStr: Utilities.formatDate(asOf, CONFIG.TZ, 'yyyy-MM-dd'),
    mesActual: AC_MESES_LARGO[mesActual - 1],
    mesActualNum: mesActual,
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
      creditoAFavorTotal: _round2(creditoTotal),
      moraCargadaTotal: _round2(moraCargadaTot),
      facturadoMes: _round2(facturadoMes),
      pagadoMes: _round2(pagadoMes),                 // caja total recibida en el mes
      pagadoMesCuotas: _round2(pagadoMesCuotas),     // sólo cuotas de propietarios
      pagadoMesOtros: pagadoMesOtros,                // aportes u otros ingresos del mes
      tasaRecaudacionMes: facturadoMes ? _round2(pagadoMesCuotas / facturadoMes * 100) : 0,
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
               cobradoMensual: cobradoMensualByClave[e.clave] || [0,0,0,0,0,0,0,0,0,0,0,0],
               facturado: e.facturado, pagado: e.pagado,
               saldo: e.saldo, mora: e.mora, moraCargada: e.moraCargada, saldoConMora: e.saldoConMora, saldoNeto: e.saldoNeto, creditoAFavor: e.creditoAFavor,
               moraCondon: e.moraCondon, moraCondonAll: e.moraCondonAll,
               estado: e.estado, aging: e.aging, diasVencido: e.diasVencido, mesesMora: e.mesesMora,
               fechaVencimiento: e.fechaVencimiento,
               // desglose mensual (caja real) para que el modal abra al instante (sin otra llamada)
               mensual: e.mensual };
    })
  };
}
