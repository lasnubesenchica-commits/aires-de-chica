/**
 * La configuración de ESTA copia — lo que distingue a una comunidad de otra.
 *
 * ── Por qué existe este archivo ──────────────────────────────────────────────
 * El mismo código corre en todas las comunidades. Lo único que cambia entre una copia
 * y otra son estos datos: el nombre, la hoja, la cuenta de cobro, el correo. Viven en
 * las Propiedades del script y no en el código porque el despliegue automático
 * sobrescribe el código en cada push a main: cualquier dato escrito ahí se borraría
 * solo en el siguiente despliegue.
 *
 * Y hay una razón peor que la comodidad. Con la cuenta bancaria dentro del código, una
 * copia recién creada y sin configurar le diría a los propietarios de un PH que paguen
 * a la cuenta de otro. Eso no puede depender de que alguien se acuerde.
 *
 * ── Cómo se usa ──────────────────────────────────────────────────────────────
 *   1. verConfiguracionCliente()          — qué hay puesto y qué falta.
 *   2. sembrarConfiguracionDesdeCodigo()  — SÓLO en la comunidad que ya venía
 *                                           funcionando: copia a propiedades lo que
 *                                           hoy está en el código.
 *   3. configurarCliente({...})           — en una copia nueva: escribe sus datos.
 *
 * Cada clave se guarda con el prefijo AC_ para no chocar con las de Meta o Anthropic,
 * que viven en el mismo sitio.
 */

var AC_PREFIJO = 'AC_';

/**
 * Las claves que definen una copia, y cuáles no puede faltar.
 *
 * MONEDA y TZ no están: son de Panamá y no cambian entre comunidades. Si algún día
 * el producto sale del país, entran aquí.
 */
var AC_CLAVES_CLIENTE = [
  { k: 'NEGOCIO',            req: true,  desc: 'Nombre de la comunidad, tal como sale en correos y mensajes' },
  { k: 'RAZON_SOCIAL',       req: false, desc: 'Razón social, para documentos formales' },
  { k: 'SHEET_ID',           req: true,  desc: 'Hoja de cálculo de esta comunidad' },
  { k: 'ADMIN_EMAIL',        req: true,  desc: 'Correo de la administración' },
  { k: 'REPLY_TO',           req: true,  desc: 'A dónde contestan los propietarios' },
  { k: 'COMPROBANTES_EMAIL', req: true,  desc: 'Buzón que captura los comprobantes del banco' },
  { k: 'WEBAPP_URL',         req: true,  desc: 'URL del despliegue; la usan los enlaces personales' },
  { k: 'LOGO_URL',           req: false, desc: 'Logo para los correos' },
  { k: 'LOGO_PNG_URL',       req: false, desc: 'Logo en PNG' },
  { k: 'BANCO',              req: true,  desc: 'Banco de la cuenta de cobro' },
  { k: 'CUENTA_TIPO',        req: true,  desc: 'Tipo de cuenta' },
  { k: 'CUENTA_NUM',         req: true,  desc: 'Número de cuenta' },
  { k: 'CUENTA_NOMBRE',      req: true,  desc: 'A nombre de quién está la cuenta' },
  { k: 'CUOTA_BASE',         req: true,  desc: 'Cuota mensual por unidad (número)' },
  { k: 'CABANA_FEE',         req: false, desc: 'Cargo adicional por cabaña (número)' },
  { k: 'MORA_PCT',           req: false, desc: 'Recargo por mora en tanto por uno: 0.10 = 10%' },
  { k: 'MORA_DESDE',         req: false, desc: 'Primer mes que genera mora, AAAA-MM' },
  { k: 'DUE_DAY',            req: false, desc: 'Día de vencimiento; 0 = fin de mes' },
  { k: 'ANIO_ACTUAL',        req: true,  desc: 'Año fiscal en curso (número)' }
];

function _acClaveProp(k) { return AC_PREFIJO + k; }

function _acEsNumerica(k) {
  return ['CUOTA_BASE', 'CABANA_FEE', 'MORA_PCT', 'DUE_DAY', 'ANIO_ACTUAL'].indexOf(k) >= 0;
}

/** Qué está puesto, qué falta, y de dónde sale cada valor. */
function verConfiguracionCliente() {
  var props = PropertiesService.getScriptProperties().getProperties() || {};
  var faltan = [], enCodigo = [];
  console.log('════ CONFIGURACIÓN DE ESTA COPIA ════');
  AC_CLAVES_CLIENTE.forEach(function (c) {
    var p = props[_acClaveProp(c.k)];
    var puesta = !(p === undefined || p === null || String(p).trim() === '');
    var valor = puesta ? String(p).trim() : CONFIG[c.k];
    var origen = puesta ? 'propiedad' : 'CÓDIGO';
    if (!puesta) {
      enCodigo.push(c.k);
      if (c.req) faltan.push(c.k);
    }
    console.log('%s %-18s %s   [%s]', puesta ? '✓' : '·', c.k,
      (valor === '' || valor === undefined) ? '(vacío)' : valor, origen);
  });

  if (!enCodigo.length) {
    console.log('\n✓ Todo viene de las propiedades. Esta copia ya es independiente del código.');
  } else {
    console.log('\n%s clave(s) todavía salen del código: %s', enCodigo.length, enCodigo.join(', '));
    console.log('En la comunidad que ya venía funcionando, ejecuta sembrarConfiguracionDesdeCodigo().');
    console.log('En una copia nueva, ejecuta configurarCliente({...}) con sus datos.');
  }
  if (faltan.length) {
    console.log('\n⚠ Sin estas el sistema no puede operar bien: %s', faltan.join(', '));
  }
  return { faltan: faltan, enCodigo: enCodigo };
}

/**
 * Escribe la configuración de esta copia.
 *
 * Sólo acepta claves conocidas: una clave mal escrita se guardaría sin efecto y el
 * problema aparecería semanas después, en un correo con la cuenta bancaria equivocada.
 */
function configurarCliente(datos) {
  if (!datos || typeof datos !== 'object') {
    console.log('Llámala con los datos de la comunidad. Por ejemplo:');
    console.log('  configurarCliente({ NEGOCIO: "PH Las Palmas", SHEET_ID: "...", CUENTA_NUM: "..." })');
    console.log('\nClaves que admite:');
    AC_CLAVES_CLIENTE.forEach(function (c) {
      console.log('  %-18s %s%s', c.k, c.desc, c.req ? '  (obligatoria)' : '');
    });
    return { ok: false };
  }

  var validas = {};
  AC_CLAVES_CLIENTE.forEach(function (c) { validas[c.k] = c; });

  var aEscribir = {}, desconocidas = [], malNumero = [];
  Object.keys(datos).forEach(function (k) {
    if (!validas[k]) { desconocidas.push(k); return; }
    var v = datos[k];
    if (_acEsNumerica(k)) {
      var n = Number(v);
      if (isNaN(n)) { malNumero.push(k + ' = «' + v + '»'); return; }
      aEscribir[_acClaveProp(k)] = String(n);
    } else {
      aEscribir[_acClaveProp(k)] = String(v === undefined || v === null ? '' : v).trim();
    }
  });

  if (desconocidas.length) {
    console.log('✗ Claves que no existen: %s', desconocidas.join(', '));
    console.log('  No se escribió nada. Revisa la ortografía contra la lista de configurarCliente().');
    return { ok: false, desconocidas: desconocidas };
  }
  if (malNumero.length) {
    console.log('✗ Estas tienen que ser números: %s', malNumero.join(', '));
    console.log('  No se escribió nada.');
    return { ok: false, malNumero: malNumero };
  }
  if (!Object.keys(aEscribir).length) {
    console.log('No había nada que escribir.');
    return { ok: false };
  }

  PropertiesService.getScriptProperties().setProperties(aEscribir, false);
  console.log('✓ Escritas %s clave(s).', Object.keys(aEscribir).length);
  console.log('El cambio surte efecto en la siguiente ejecución. Comprueba con verConfiguracionCliente().');
  return { ok: true, escritas: Object.keys(aEscribir).length };
}

/**
 * Migración de la comunidad que ya venía funcionando: copia a propiedades lo que hoy
 * está en el código, sin cambiar ningún valor.
 *
 * No pisa lo que ya esté puesto — si una clave ya vive en propiedades, se respeta.
 * Ejecutarla dos veces no hace daño.
 */
function sembrarConfiguracionDesdeCodigo() {
  var props = PropertiesService.getScriptProperties();
  var actuales = props.getProperties() || {};
  var nuevas = {}, respetadas = [];

  AC_CLAVES_CLIENTE.forEach(function (c) {
    var p = actuales[_acClaveProp(c.k)];
    if (!(p === undefined || p === null || String(p).trim() === '')) { respetadas.push(c.k); return; }
    var v = CONFIG[c.k];
    if (v === undefined || v === null || String(v) === '') return;
    nuevas[_acClaveProp(c.k)] = String(v);
  });

  console.log('════ SEMBRAR DESDE EL CÓDIGO ════');
  if (respetadas.length) console.log('Ya estaban en propiedades, no se tocan: %s', respetadas.join(', '));
  if (!Object.keys(nuevas).length) {
    console.log('No hay nada que sembrar: todo viene ya de las propiedades.');
    return { ok: true, escritas: 0 };
  }
  Object.keys(nuevas).forEach(function (k) {
    console.log('  %s = %s', k, nuevas[k]);
  });
  props.setProperties(nuevas, false);
  console.log('\n✓ Sembradas %s clave(s).', Object.keys(nuevas).length);
  console.log('Comprueba con verConfiguracionCliente() y luego se pueden vaciar del código.');
  return { ok: true, escritas: Object.keys(nuevas).length };
}
