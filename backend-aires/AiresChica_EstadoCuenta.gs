/**
 * Motor de estado de cuenta.
 *
 * Regla de cobro (ver cuotaDe() en AiresChica_Config.gs):
 *   cuota mensual = cuotaBase * (1 + cabanaPct% * nº de cabañas)   — hoy 45.00 y 30%
 *   o la cuota fija manual del propietario (cuotaMensual) cuando está definida.
 *   El nº de LOTES no multiplica la cuota: quien tiene los lotes 6 y 7 paga una sola
 *   cuota. La columna `cuota` de la hoja de Propietarios puede traer valores viejos de
 *   una fórmula anterior; el motor siempre recalcula con cuotaDe().
 *
 * POLÍTICA DE MORA ratificada por la Junta (agosto 2026):
 *   1. Devengo — sin período de gracia. La cuota vence el último día del mes y el
 *      recargo se causa al día siguiente. Rige desde la cuota de abril 2026.
 *   2. Base — 10% de la CUOTA ÍNTEGRA vencida (no de la porción que quedó sin
 *      cubrir). Un abono parcial no reduce el recargo.
 *   3. Frecuencia — un solo recargo por cuota. No se vuelve a cobrar mes tras mes.
 *   4. Capitalización — ninguna: la mora no genera mora.
 *   5. Imputación — el dinero se aplica en este orden: cuotas ya vencidas (de la más
 *      antigua a la más nueva) → cuota del mes en curso → recargos por mora.
 *      El recargo va de último a propósito. Cuando se cobraba antes que la cuota del
 *      mes, se comía parte del pago y dejaba esa cuota corta, lo que generaba un
 *      recargo nuevo: la mora terminaba generando mora por la puerta de atrás, contra
 *      la regla 4. (Caso típico: se debía abril y mayo, entraban 90.00 = las dos
 *      cuotas exactas, pero el recargo de abril se llevaba 4.50 y mayo se recargaba.)
 *   6. Tope — 10%, muy por debajo del 20% que permite la Ley 284 de 2022 (PH).
 *
 * Los puntos 2 y 5 son configurables (cfg.moraBase / cfg.moraOrden) por si la Junta
 * revisa el criterio; los valores por defecto son los ratificados.
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
 * Libro de cuenta corriente: recorre el año mes a mes con UN SOLO carril de
 * obligaciones (cuotas y recargos por mora), de modo que el reparto del dinero y la
 * generación de la mora salgan del mismo recorrido. Antes eran dos pasadas
 * independientes: la que decidía la mora no veía los pagos de mora, así que un abono
 * de recargo se registraba como crédito de capital y el mes siguiente calculaba su
 * 10% sobre una cuota "casi cubierta" (de ahí moras de 4.05 en vez de 4.50).
 *
 * Por cada mes:
 *   1. se carga la cuota del mes;
 *   2. entra el dinero recibido en ese mes (más el saldo a favor arrastrado) y se
 *      reparte UNA sola vez, en el orden indicado;
 *   3. al cierre, lo que haya quedado sin cubrir de ESA cuota genera un recargo único.
 *      El recargo nace con el mes ya cerrado, así que sólo puede pagarse con dinero de
 *      meses posteriores — y nunca genera un recargo propio.
 *
 * @param {Object} c     contexto de la cuenta (cuota, meses, pagos, condonaciones…).
 * @param {string} base  'cuota' = 10% de la cuota íntegra vencida (criterio de la Junta);
 *                       'pendiente' = 10% de la porción que quedó sin cubrir.
 * @param {string} orden 'capital' = cuotas vencidas → cuota del mes en curso → mora
 *                                   (criterio de la Junta);
 *                       'cuota'   = cuotas vencidas → mora → cuota del mes en curso;
 *                       'mora'    = mora → cuotas vencidas → cuota del mes en curso.
 * @return {Object} buckets repartidos, detalle mensual y saldo a favor sobrante.
 */
function _correrLibro(c, base, orden) {
  var buckets = [];
  if (c.deuda2025 > 0) {
    buckets.push({ label: 'Saldo 2025', year: 2025, month: 12, idx: 2025 * 12 + 12, monto: c.deuda2025, tipo: 'saldo2025' });
  }
  for (var m = c.mesInicio; m <= c.mesActual; m++) {
    buckets.push({ label: AC_MESES_LARGO[m - 1], year: c.year, month: m, idx: c.year * 12 + m, monto: c.cuota, tipo: 'cuota' });
  }
  buckets.forEach(function (b) {
    b.pagado = 0; b.saldo = b.monto; b.mora = 0; b.moraMeses = 0;
    b.condonada = false; b.moraPagado = 0; b.moraSaldo = 0;
  });
  var byIdx = {};
  buckets.forEach(function (b) { byIdx[b.idx] = b; });

  var pool = c.poolIni;
  function _pagaCuota(b) {
    var ap = Math.min(pool, b.saldo);
    if (ap <= 0.0001) return 0;
    b.pagado = _round2(b.pagado + ap); b.saldo = _round2(b.saldo - ap); pool = _round2(pool - ap);
    return ap;
  }
  function _pagaMora(b) {
    var ap = Math.min(pool, b.moraSaldo);
    if (ap <= 0.0001) return 0;
    b.moraPagado = _round2(b.moraPagado + ap); b.moraSaldo = _round2(b.moraSaldo - ap); pool = _round2(pool - ap);
    return ap;
  }
  // saldo pendiente considerando sólo las obligaciones hasta `hastaIdx` (inclusive),
  // menos el saldo a favor que quede sin aplicar
  function _saldoHasta(hastaIdx) {
    var s = 0;
    buckets.forEach(function (b) { if (b.idx <= hastaIdx) s = _round2(s + b.saldo + b.moraSaldo); });
    return _round2(s - pool);
  }

  var mensual = [], moraByIdx = {}, condonByIdx = {};
  for (var mm = 1; mm <= c.mesActual; mm++) {
    var idx = c.year * 12 + mm, bMes = byIdx[idx] || null;
    var saldoIni = _saldoHasta(idx - 1);
    var pg = _round2(c.pagosMes[mm] || 0);
    pool = _round2(pool + pg);

    var apVenc = 0, apMora = 0, apMes = 0;
    var _venc = function () { buckets.forEach(function (b) { if (b.idx < idx) apVenc = _round2(apVenc + _pagaCuota(b)); }); };
    var _mora = function () { buckets.forEach(function (b) { apMora = _round2(apMora + _pagaMora(b)); }); };
    var _mes  = function () { if (bMes) apMes = _round2(apMes + _pagaCuota(bMes)); };
    if (orden === 'mora')         { _mora(); _venc(); _mes(); }
    else if (orden === 'capital') { _venc(); _mes(); _mora(); }
    else                          { _venc(); _mora(); _mes(); }

    // cierre del mes: la parte de ESTA cuota que quedó descubierta genera el recargo
    if (bMes && idx >= c.moraDesde && idx < c.currentIdx && bMes.saldo > 0.009) {
      if (c.condon.all || !!c.condon.set[_ymKey(c.year, mm)]) bMes.condonada = true;
      else {
        bMes.mora = _round2((base === 'pendiente' ? bMes.saldo : c.cuota) * c.moraPct);
        bMes.moraSaldo = bMes.mora;
        bMes.moraMeses = 1;
      }
    }
    moraByIdx[idx] = bMes ? bMes.mora : 0;
    condonByIdx[idx] = bMes ? bMes.condonada : false;
    mensual.push({
      idx: idx, mes: mm, saldoIni: saldoIni,
      cuota: bMes ? bMes.monto : 0, mora: bMes ? bMes.mora : 0, pagado: pg,
      apVencidas: apVenc, apMora: apMora, apMesEnCurso: apMes,
      apCredito: _round2(pg - apVenc - apMora - apMes),
      cubierto: bMes ? bMes.pagado : 0,
      descubierto: bMes ? bMes.saldo : 0,
      saldo: _saldoHasta(idx)
    });
  }
  return { buckets: buckets, pool: pool, mensual: mensual, moraByIdx: moraByIdx, condonByIdx: condonByIdx };
}

/**
 * Calcula el estado de cuenta de un propietario al corte indicado.
 *
 * Corre el libro dos veces: una con los criterios vigentes (los seis del encabezado
 * del módulo) y otra con la regla anterior de mora, para poder mostrar ambas en las
 * pestañas de comparación mientras la Junta valida el cambio. La segunda es
 * informativa: no afecta ningún saldo.
 *
 * `prop.moraCondon` lista los meses ('2026-04,2026-05') o 'ALL' cuya mora condonó el
 * administrador; un mes condonado no genera recargo aunque la cuota siga descubierta.
 *
 * @return {Object} desglose mensual, desglose del saldo, totales y KPIs de la cuenta.
 */
function calcEstado(prop, pagosArr, asOf) {
  asOf = _asOfDate(asOf);
  var cfg = _cfg();
  var moraPct = cfg.moraPct / 100;
  var moraCrece = !!cfg.moraCrece;
  var moraOrden = (cfg.moraOrden === 'mora' || cfg.moraOrden === 'cuota') ? cfg.moraOrden : 'capital';
  var moraBase = (cfg.moraBase === 'pendiente') ? 'pendiente' : 'cuota';
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

  // 3) libro de cuenta corriente con los criterios aprobados por la Junta (ago-2026).
  var _sumMes = 0;
  for (var _k in pagosMes) _sumMes = _round2(_sumMes + pagosMes[_k]);
  var ctxLibro = {
    cuota: cuota, year: year, mesInicio: mesInicio, mesActual: mesActual,
    moraDesde: moraDesde, currentIdx: currentIdx, moraPct: moraPct, condon: condon,
    deuda2025: deuda2025, pagosMes: pagosMes,
    // el crédito de 2025 y cualquier pago fechado fuera del año entran como saldo a favor inicial
    poolIni: _round2(credito2025 + (totalPagado - _sumMes))
  };
  var libro   = _correrLibro(ctxLibro, moraBase, moraOrden);
  var buckets = libro.buckets;
  var pool    = libro.pool;

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

  // cobertura de la cuota del MES DE CORTE. Sale del mismo libro que la mora, así que
  // "Pagado / Parcial / Pendiente" y el recargo no pueden contradecirse: si el mes
  // aparece cubierto es exactamente porque no generaría recargo al cerrar.
  var cubiertoMes = bucketMes ? bucketMes.pagado : 0;
  var pendienteMes = bucketMes ? bucketMes.saldo : 0;
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
  var condonByIdx = libro.condonByIdx;

  var mensual = [];
  var saldoRun = saldo2025;
  if (saldo2025 !== 0) mensual.push({ label: saldo2025 < 0 ? 'Saldo a favor 2025' : 'Saldo 2025', cuota: 0, mora: 0, pagado: 0, saldo: saldoRun, condonada: false, vouchers: [] });
  libro.mensual.forEach(function (r) {
    if (r.mes < mesInicio) return;
    saldoRun = r.saldo;
    mensual.push({
      label: AC_MESES_LARGO[r.mes - 1], ym: _ymKey(year, r.mes),
      cuota: r.cuota, mora: r.mora,
      pagado: r.pagado, saldo: r.saldo,
      condonada: !!condonByIdx[r.idx], vouchers: vouchersMes[r.mes] || [],
      // trazabilidad para explicar cada cifra en pantalla (tooltips del estado de cuenta)
      saldoIni: r.saldoIni, cubierto: r.cubierto, descubierto: r.descubierto,
      apVencidas: r.apVencidas, apMora: r.apMora, apMesEnCurso: r.apMesEnCurso, apCredito: r.apCredito
    });
  });
  var saldoNeto = saldoRun; // saldo total con signo (debe positivo / crédito negativo)

  // Desglose de QUÉ compone el saldo: cuotas que siguen pendientes y recargos por mora
  // sin pagar, mes por mes. Sale de la aplicación en cascada de los pagos, así que la
  // suma de los renglones es exactamente el saldo total.
  // Se incluye el monto original y lo ya abonado de cada renglón: sin eso, una cuota
  // parcialmente cubierta aparecía como "Cuota de mayo 4.50" y contradecía a la tabla,
  // que en mayo muestra la cuota de 45.00 y un pago de 90.00.
  var detalleSaldo = [], moraCubiertas = [];
  buckets.forEach(function (b) {
    if (b.saldo > 0.009) detalleSaldo.push({ tipo: 'cuota', label: b.label,
      ym: b.tipo === 'cuota' ? _ymKey(b.year, b.month) : '', monto: _round2(b.saldo),
      original: _round2(b.monto), abonado: _round2(b.pagado) });
  });
  buckets.forEach(function (b) {
    if (b.moraSaldo > 0.009) {
      detalleSaldo.push({ tipo: 'mora', label: b.label, ym: _ymKey(b.year, b.month),
        monto: _round2(b.moraSaldo), original: _round2(b.mora), abonado: _round2(b.moraPagado) });
    } else if (b.mora > 0.009) {
      // recargos que SÍ se cargaron pero ya están pagados: no suman al saldo, pero si no
      // se dicen, la tabla parece cobrar una mora que después desaparece del desglose.
      moraCubiertas.push({ label: b.label, ym: _ymKey(b.year, b.month), monto: _round2(b.mora) });
    }
  });

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
    detalleSaldo: detalleSaldo,    // renglones que componen el saldo (cuotas y moras pendientes)
    moraCubiertas: moraCubiertas,  // recargos ya pagados: no suman al saldo, pero se muestran para que no parezcan desaparecidos
    creditoAFavor: creditoAFavor,
    moraOrden: moraOrden, moraBase: moraBase, moraPct: cfg.moraPct, moraCrece: moraCrece,
    moraCondon: String(prop.moraCondon || ''), moraCondonAll: condon.all,
    diasVencido: diasVencido,
    mesesMora: mesesMora,          // nº de cuotas vencidas con recargo aún pendientes de pago
    aging: aging,
    estado: estado,
    fechaVencimiento: venceProx,
    asOf: asOf
  };
}

/**
 * Estado de cuenta de un propietario.
 *
 * @param {string} clave
 * @param {Object} [simular]  pago hipotético { fecha:'AAAA-MM-DD', monto:number }.
 *        Si viene, el estado se calcula COMO SI ese pago ya estuviera registrado,
 *        sin tocar la hoja. Sirve para ver cómo quedaría una cuenta antes de
 *        cargar un pago (conciliación bancaria, revisión de comprobantes).
 */
function getEstadoCuentaByKey(clave, simular) {
  var prop = _findProp(clave);
  if (!prop) throw new Error('No existe la cuenta ' + clave);
  var pagosC = getPagosByClave(clave);

  var sim = null;
  if (simular && Number(simular.monto) > 0) {
    var f = _fechaPagoDesdeISO(simular.fecha);
    if (!f) throw new Error('Fecha de simulación inválida. Se espera AAAA-MM-DD.');
    sim = { clave: clave, fecha: f, monto: _round2(simular.monto), origen: 'simulado',
            notas: 'Pago simulado — no está registrado' };
    pagosC = pagosC.concat([sim]);
  }

  var est = calcEstado(prop, pagosC, null);
  est.pagosHistorial = pagosC.map(function (p) {
    return { fecha: p.fecha, monto: p.monto, origen: p.origen, referencia: p.referencia, notas: p.notas };
  }).sort(function (a, b) { return new Date(a.fecha) - new Date(b.fecha); });
  if (sim) { est.simulado = { fecha: simular.fecha, monto: sim.monto }; }
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
               detalleSaldo: e.detalleSaldo, moraCubiertas: e.moraCubiertas,
               moraCondon: e.moraCondon, moraCondonAll: e.moraCondonAll,
               estado: e.estado, aging: e.aging, diasVencido: e.diasVencido, mesesMora: e.mesesMora,
               fechaVencimiento: e.fechaVencimiento,
               // desglose mensual (caja real) para que el modal abra al instante (sin otra llamada)
               mensual: e.mensual };
    })
  };
}
