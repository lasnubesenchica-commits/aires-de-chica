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
 *   1. verConfiguracionCliente()  — qué hay puesto y qué falta.
 *   2. configurarCliente({...})   — escribe los datos de esta comunidad.
 *
 * Hubo una tercera, sembrarConfiguracionDesdeCodigo(), para migrar la comunidad que ya
 * venía funcionando cuando sus datos vivían en Code.js. Hizo su trabajo y se retiró: el
 * código ya no tiene datos que copiar.
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
  { k: 'ANIO_ACTUAL',        req: true,  desc: 'Año fiscal en curso (número)' },
  { k: 'UNIDAD',             req: false, desc: 'Cómo llama esta comunidad a su unidad: lote, apartamento, casa…' },
  { k: 'MODULOS',            req: false, desc: 'Módulos contratados, separados por coma; vacío = todos' }
];

function _acClaveProp(k) { return AC_PREFIJO + k; }

/**
 * Rellena a la derecha hasta n caracteres.
 *
 * console.log de Apps Script sólo sustituye «%s» a secas: un «%-18s» sale impreso tal
 * cual y los argumentos se corren de sitio. El relleno hay que hacerlo a mano.
 */
function _acPad(txt, n) {
  var s = String(txt === undefined || txt === null ? '' : txt);
  while (s.length < n) s += ' ';
  return s;
}

function _acEsNumerica(k) {
  return ['CUOTA_BASE', 'CABANA_FEE', 'MORA_PCT', 'DUE_DAY', 'ANIO_ACTUAL'].indexOf(k) >= 0;
}

/* ─────────────── cómo se llama aquí una unidad ─────────────── */

/**
 * Aires de Chicá tiene lotes; una torre tiene apartamentos y un centro comercial,
 * locales. La palabra sale en cada mensaje del bot y en cada plantilla, así que no
 * puede estar escrita a mano: un propietario de un edificio al que le hablan de «su
 * lote» sabe en el acto que le vendieron el sistema de otro.
 *
 * Por defecto «unidad», que es fea pero no es falsa en ninguna comunidad.
 */
function _acUnidad() {
  var u = '';
  try { if (typeof CONFIG === 'object' && CONFIG && CONFIG.UNIDAD) u = String(CONFIG.UNIDAD); } catch (e) {}
  if (!u) {
    try { u = String(PropertiesService.getScriptProperties().getProperty(AC_PREFIJO + 'UNIDAD') || ''); }
    catch (e) {}
  }
  u = u.trim().toLowerCase();
  return u || 'unidad';
}

/**
 * Plural en español: vocal final pide «s», consonante pide «es».
 * lote→lotes, casa→casas, apartamento→apartamentos, unidad→unidades, local→locales.
 */
function _acPlural(palabra) {
  var p = String(palabra || '');
  if (!p) return p;
  return /[aeiouáéíóú]$/i.test(p) ? p + 's' : p + 'es';
}

function _acUnidades() { return _acPlural(_acUnidad()); }

/** «Lote», para empezar una frase o un título. */
function _acUnidadCap() {
  var u = _acUnidad();
  return u.charAt(0).toUpperCase() + u.slice(1);
}

/** «lote Q-9» — la forma en que se nombra una unidad concreta dentro de una frase. */
function _acUnidadDe(clave) {
  return _acUnidad() + ' ' + String(clave == null ? '' : clave);
}

/** «Lote Q-9» — la misma, cuando encabeza un mensaje o un título. */
function _acUnidadDeCap(clave) {
  return _acUnidadCap() + ' ' + String(clave == null ? '' : clave);
}

/**
 * Género de la palabra, para que los artículos concuerden.
 *
 * «el lote» pero «la casa»; «ningún apartamento» pero «ninguna finca». Sin esto, la
 * mitad de las comunidades leería mensajes mal escritos, que es justo lo que delata a
 * un sistema copiado.
 *
 * La regla: termina en -a, o en -dad / -ción / -sión, es femenina. Cubre las que se
 * usan de verdad —lote, apartamento, local, casa, quinta, finca, unidad— y falla en
 * rarezas como «día». Si alguna comunidad llama a lo suyo con una excepción, se le
 * pone otra palabra en AC_UNIDAD y listo.
 */
function _acUnidadFem() {
  var u = _acUnidad();
  return /(?:[aá]|dad|ci[oó]n|si[oó]n)$/i.test(u);
}

function _acEl()      { return _acUnidadFem() ? 'la'      : 'el'; }
function _acUn()      { return _acUnidadFem() ? 'una'     : 'un'; }
function _acNingun()  { return _acUnidadFem() ? 'ninguna' : 'ningún'; }
/** «del lote Q-9» / «de la casa 14». */
function _acDel()     { return _acUnidadFem() ? 'de la'   : 'del'; }

/** Qué está puesto y qué falta en esta copia. */
function verConfiguracionCliente() {
  var props = PropertiesService.getScriptProperties().getProperties() || {};
  var faltan = [], sinPoner = [];
  console.log('════ CONFIGURACIÓN DE ESTA COPIA ════');
  AC_CLAVES_CLIENTE.forEach(function (c) {
    var p = props[_acClaveProp(c.k)];
    var puesta = !(p === undefined || p === null || String(p).trim() === '');
    if (!puesta) {
      sinPoner.push(c.k);
      if (c.req) faltan.push(c.k);
    }
    console.log('%s %s %s', puesta ? '✓' : (c.req ? '✗' : '·'), _acPad(c.k, 18),
      puesta ? String(p).trim() : (c.req ? '— FALTA —' : '(sin poner)'));
  });

  if (faltan.length) {
    console.log('\n✗ Faltan %s obligatoria(s): %s', faltan.length, faltan.join(', '));
    console.log('Sin ellas el sistema no cobra ni envía bien. Ponlas con configurarCliente({...}).');
  } else if (sinPoner.length) {
    console.log('\n✓ Lo obligatorio está puesto.');
    console.log('Opcionales sin poner: %s', sinPoner.join(', '));
  } else {
    console.log('\n✓ Configuración completa.');
  }
  return { faltan: faltan, sinPoner: sinPoner };
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
      console.log('  %s %s%s', _acPad(c.k, 18), c.desc, c.req ? '  (obligatoria)' : '');
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

/* ═══════════════ Módulos ═══════════════
 *
 * El sistema se vende por módulos y cada copia enciende los que pagó. La lista está en
 * la propiedad AC_MODULOS, separada por comas.
 *
 * Sin poner, TODOS quedan activos. Es a propósito: la comunidad que ya venía
 * funcionando no puede quedarse sin nada por una propiedad que nadie escribió. Las
 * copias nuevas la reciben de configurarCliente().
 *
 * La verja está en el router, no en el panel. Esconder un botón no impide llamar a la
 * acción; comprobarlo en el servidor, sí.
 */

var AC_MODULOS_TODOS = ['financiero', 'comunicaciones', 'acceso'];

/**
 * Acciones que no son de ningún módulo: entrar al sistema, ver quién es quién, leer la
 * configuración, el padrón. Sin ellas no se puede usar ni el módulo que sí se pagó.
 */
var AC_ACCIONES_NUCLEO = {
  ping:1, getAuthState:1, verifyPassword:1, setPassword:1, resetPassword:1,
  getConfig:1, guardarConfig:1, getRegistro:1, getAutores:1, claimAutor:1,
  moverAutor:1, liberarAutor:1, marcarAvisoVisto:1, ensureSheets:1, seedInicial:1,
  getPropietarios:1, guardarPropietario:1, eliminarPropietario:1,
  getPropuesta:1, guardarPropuesta:1, getContrato:1, guardarContrato:1,
  getComunicadoDoc:1, guardarComunicadoDoc:1
};

/**
 * Qué módulo pide cada acción.
 *
 * Sólo se listan las de comunicaciones y acceso. Todo lo demás cae en «financiero»,
 * que es el módulo base: así una acción nueva que se olvide de clasificar queda
 * disponible para quien tiene el sistema, en vez de bloqueada sin motivo.
 */
var AC_MODULO_DE = {
  // Comunicados de la Junta y el bot de WhatsApp. Mandar un estado de cuenta NO está
  // aquí: es del módulo financiero, porque un estado que no se puede enviar no sirve.
  getComunicados:'comunicaciones', getComunicadoDetalle:'comunicaciones',
  guardarComunicado:'comunicaciones', eliminarComunicado:'comunicaciones',
  enviarComunicado:'comunicaciones', reenviarComunicado:'comunicaciones',
  enviarPruebaComunicado:'comunicaciones', previsualizarComunicado:'comunicaciones',
  getEnviosPendientes:'comunicaciones', marcarEnvio:'comunicaciones',
  verComunicado:'comunicaciones', misComunicados:'comunicaciones', acuseComunicado:'comunicaciones',

  // Control de acceso. Las acciones aún no existen; la verja ya las conoce para que
  // el módulo no nazca abierto.
  getVisitas:'acceso', registrarVisita:'acceso', autorizarVisita:'acceso',
  getAutorizaciones:'acceso', guardarAutorizacion:'acceso', eliminarAutorizacion:'acceso',
  getGarita:'acceso', guardarGarita:'acceso'
};

/** Los módulos activos en esta copia. */
function modulosActivos() {
  var crudo = String(_waPropiedad(AC_PREFIJO + 'MODULOS')).trim();
  if (!crudo) return AC_MODULOS_TODOS.slice();
  var pedidos = crudo.toLowerCase().split(/[,;]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return AC_MODULOS_TODOS.indexOf(s) >= 0; });
  return pedidos.length ? pedidos : AC_MODULOS_TODOS.slice();
}

function moduloActivo(nombre) {
  return modulosActivos().indexOf(String(nombre).toLowerCase()) >= 0;
}

/** Lectura de una propiedad sin depender del orden de carga de los archivos. */
function _waPropiedad(clave) {
  try { return PropertiesService.getScriptProperties().getProperty(clave) || ''; }
  catch (e) { return ''; }
}

/** De una acción al módulo que la cubre. '' significa que no la cubre ninguno. */
function _moduloDeAccion(accion) {
  var a = String(accion || '');
  if (!a || AC_ACCIONES_NUCLEO[a]) return '';
  return AC_MODULO_DE[a] || 'financiero';
}

/**
 * La verja. Devuelve null si la acción se puede ejecutar, o el motivo si no.
 *
 * Se llama desde el router, antes de despachar. Que el panel esconda una pestaña es
 * cortesía; esto es lo que de verdad impide usar lo que no se contrató.
 */
function _moduloBloquea(accion) {
  var m = _moduloDeAccion(accion);
  if (!m || moduloActivo(m)) return null;
  return 'El módulo «' + m + '» no está activo en esta comunidad.';
}

/** Qué módulos tiene esta copia. Ejecútala en el editor. */
function verModulos() {
  var crudo = String(_waPropiedad(AC_PREFIJO + 'MODULOS')).trim();
  console.log('════ MÓDULOS ════');
  console.log('AC_MODULOS: %s', crudo || '(sin poner — todos activos)');
  AC_MODULOS_TODOS.forEach(function (m) {
    console.log('%s %s', moduloActivo(m) ? '✓' : '·', m);
  });
  return modulosActivos();
}
