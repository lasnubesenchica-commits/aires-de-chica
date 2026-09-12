// El panel esconde las pestañas de los módulos que la comunidad no contrató.
//
// Es cortesía, no seguridad —el servidor ya rechaza esas acciones—, pero una pestaña
// que al tocarla contesta «ese módulo no está activo» es una mala primera impresión.
//
// Se prueba en un navegador de verdad porque lo que se afirma es lo que se ve.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  console.log('  · sin playwright instalado: esta prueba se salta');
  process.exit(0);
}

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Del index.html se toman tres cosas REALES: la barra de pestañas, la función que las
// esconde, y el manejador que cambia de pestaña. Abrir el panel entero exigiría un Apps
// Script vivo, pero inventarse el manejador seria hacerse trampas: la primera version de
// esta prueba fallaba justo porque su pagina no lo tenia.
//
// Lo unico que se sustituye son las funciones que pintan contenido, que no tienen nada
// que ver con que pestaña se ve.
function paginaCon() {
  const nav = HTML.slice(HTML.indexOf('<nav class="tabs" id="tabs">'),
                         HTML.indexOf('</nav>') + 6);
  const fn = HTML.slice(HTML.indexOf('const TAB_MODULO = {'),
                        HTML.indexOf('function pantallaSinConexion'));
  const ini = HTML.indexOf("document.getElementById('tabs').addEventListener('click'");
  const manejador = HTML.slice(ini, HTML.indexOf('\n});', ini) + 4);
  const stubs = ['renderProp','renderComunic','renderComprob','renderGastos','renderFinanzas',
                 'cargarRegistro','renderOpts'].map(f => 'function ' + f + '(){}').join('\n')
                 + '\nvar REG_DATA = 1;';
  const secciones = ['dash','conc','registro','comprob','prop','comunic','gastos','finanzas','opts']
    .map(t => `<section id="tab-${t}" style="display:none">${t}</section>`).join('');
  return `<!doctype html><html><body>${nav}${secciones}` +
         `<script>${stubs}\n${fn}\n${manejador}</script></body></html>`;
}

(async () => {
  const b = await chromium.launch();

  // Una página NUEVA por escenario. setContent reescribe el mismo documento, así que
  // reutilizarla dejaba el «const TAB_MODULO» de la carga anterior ya declarado: el
  // segundo script reventaba en su primera línea y el manejador de pestañas no llegaba
  // a registrarse. La prueba parecía verde por casualidad.
  let errorPagina = '';
  const abrir = async () => {
    const pg = await b.newPage();
    pg.on('pageerror', e => { errorPagina = e.message; });
    await pg.setContent(paginaCon());
    return pg;
  };
  let p = await abrir();

  const visibles = () => p.evaluate(() =>
    [...document.querySelectorAll('#tabs button')]
      .filter(x => x.style.display !== 'none').map(x => x.dataset.tab));

  console.log('── SIN LISTA DE MÓDULOS NO SE ESCONDE NADA ──');
  await p.evaluate(() => aplicarModulos(undefined));
  let v = await visibles();
  ok(v.length === 9, 'un backend viejo o una copia sin la propiedad ve su panel entero: ' + v.length);
  await p.evaluate(() => aplicarModulos([]));
  ok((await visibles()).length === 9, 'y una lista vacía tampoco esconde nada');

  console.log('\n── SÓLO EL MÓDULO FINANCIERO ──');
  await p.evaluate(() => aplicarModulos(['financiero']));
  v = await visibles();
  ok(v.indexOf('comunic') < 0, 'Comunicados desaparece: ' + v.join(' '));
  ok(v.indexOf('dash') >= 0 && v.indexOf('gastos') >= 0 && v.indexOf('conc') >= 0,
     'y lo financiero se queda');
  ok(v.indexOf('prop') >= 0 && v.indexOf('registro') >= 0 && v.indexOf('opts') >= 0,
     'el padrón, el registro y las opciones también: hacen falta se contrate lo que se contrate');

  console.log('\n── SÓLO COMUNICACIONES ──');
  p = await abrir();
  await p.evaluate(() => aplicarModulos(['comunicaciones']));
  v = await visibles();
  ok(v.indexOf('dash') < 0 && v.indexOf('gastos') < 0 && v.indexOf('conc') < 0,
     'lo financiero desaparece: ' + v.join(' '));
  ok(v.indexOf('comunic') >= 0, 'y Comunicados se queda');

  console.log('\n── EL PANEL NO ABRE EN UNA PESTAÑA ESCONDIDA ──');
  const activa = await p.evaluate(() => {
    const a = document.querySelector('#tabs button.active');
    return { tab: a && a.dataset.tab, visible: a && a.style.display !== 'none' };
  });
  ok(activa.tab !== 'dash' && activa.visible,
     'con «Cuentas» escondida, la activa pasa a la primera que sí se ve: ' + activa.tab);
  const seccion = await p.evaluate(() =>
    document.getElementById('tab-' + document.querySelector('#tabs button.active').dataset.tab).style.display);
  ok(seccion !== 'none', 'y su sección queda a la vista, no en blanco');

  console.log('\n── LAS SECCIONES ESCONDIDAS NO SE QUEDAN ABIERTAS ──');
  p = await abrir();
  await p.evaluate(() => { document.getElementById('tab-comunic').style.display = ''; });
  await p.evaluate(() => aplicarModulos(['financiero']));
  ok(await p.evaluate(() => document.getElementById('tab-comunic').style.display) === 'none',
     'una sección de un módulo apagado se cierra aunque estuviera abierta');

  ok(!errorPagina, 'ninguna página soltó un error de JavaScript' + (errorPagina ? ': ' + errorPagina : ''));

  await b.close();
  console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
  process.exit(mal ? 1 : 0);
})();
