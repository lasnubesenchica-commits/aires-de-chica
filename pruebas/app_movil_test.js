// El panel móvil: que mande el autor, y que esconda lo que la comunidad no contrató.
//
// No tenía pruebas, y eso costó un fallo que llevaba ahí desde el principio: el botón de
// enviar el estado de cuenta no mandaba `autor`, el servidor lo rechazaba con
// «sin-autor», y nadie se enteró porque nadie lo miraba.
//
// Se prueba en un navegador de verdad, como panel_modulos_test.js: lo que se afirma es
// lo que se ve y lo que de verdad sale por la red.
const fs = require('fs');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('  · sin playwright instalado: esta prueba se salta'); process.exit(0); }

const HTML = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');

/**
 * La app de verdad, con la red interceptada.
 *
 * `modulos` es lo que contestará getAuthState. El resto de llamadas devuelven lo justo
 * para que arranque: lo que se mira aquí es el enrutado y lo que sale por la red, no el
 * contenido de las tablas.
 */
async function abrir(b, modulos) {
  const pg = await b.newPage({ viewport: { width: 390, height: 780 } });
  const enviados = [];
  const errores = [];
  pg.on('pageerror', e => errores.push(e.message));

  // La app se sirve desde un origen de mentira en vez de con setContent, y no es un
  // capricho: setContent deja la página en about:blank, donde tocar localStorage lanza
  // SecurityError. El script abortaba en su tercera línea y las variables quedaban sin
  // inicializar — un fallo del andamio que se leía como un fallo de la app.
  await pg.route('https://movil.prueba/', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));

  // JSONP: la app inyecta un <script src=...&callback=__cbX>. Se responde con el
  // callback ya invocado, que es exactamente lo que hace Apps Script.
  await pg.route('**/macros/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      let cuerpo = {};
      try { cuerpo = JSON.parse(req.postData() || '{}'); } catch (e) {}
      enviados.push(cuerpo);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: { ok: true } }) });
    }
    const url = new URL(req.url());
    const accion = url.searchParams.get('action');
    const cb = url.searchParams.get('callback');
    const datos = {
      getAuthState: { hasPassword: true, modulos: modulos },
      getDashboard: { cuentas: [{ clave: 'Q-9', lote: '9', nombre: 'Ana Rosa Tejada',
        residencial: 'El Quirá', saldoConMora: 245, saldoNeto: 245, cuota: 45,
        estado: 'Moroso', email: 'a@b.c', mensual: [] }] },
      getAcceso: { unidad: 'lote', adentro: 2, colgadas: 1, avisos: [],
        visitas: [{ id: 'VI1', visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '9',
                    fecha: '13/09/2026 14:00', estado: 'autorizada', autorizadoPor: 'Guardia · Garita principal', salida: '' },
                  { id: 'VI2', visitante: 'Sin Decidir', cedula: '', lote: '14',
                    fecha: '13/09/2026 15:00', estado: 'pendiente', autorizadoPor: '', salida: '' }] }
    }[accion] || {};
    return route.fulfill({ status: 200, contentType: 'application/javascript',
      body: cb + '(' + JSON.stringify({ ok: true, data: datos }) + ');' });
  });

  await pg.addInitScript(() => {
    localStorage.setItem('ac_token', 'TOK');
    localStorage.setItem('ac_autor', 'Iris');
  });
  await pg.goto('https://movil.prueba/', { waitUntil: 'load' });
  // Sin .catch(): si la app no arranca, esto tiene que fallar aquí y no diez
  // afirmaciones más abajo con un error que no dice nada.
  await pg.waitForFunction(() => document.getElementById('app').style.display === 'block',
    null, { timeout: 8000 });
  if (errores.length) throw new Error('la app soltó un error: ' + errores[0]);
  return { pg, enviados, errores };
}

(async () => {
  const b = await chromium.launch();

  console.log('── EL MÓVIL MANDA QUIÉN HACE EL CAMBIO ──');
  // El servidor exige autor y no escribe sin él. El móvil no lo mandaba: el botón de
  // enviar el estado de cuenta devolvía «sin-autor» y nunca funcionó.
  let { pg, enviados } = await abrir(b, ['financiero', 'acceso']);
  await pg.evaluate(() => post('enviarEstado', { clave: 'Q-9' }));
  const env = enviados.filter(x => x.action === 'enviarEstado')[0];
  ok(!!env, 'la petición sale');
  ok(env && env.autor === 'Iris',
     'y lleva el autor, que es lo que el servidor exige para escribir: ' + (env && env.autor));
  ok(env && !!env.dispositivo,
     'y el dispositivo, que el padrón de usuarios usa para que un nombre no se use desde dos equipos');
  ok(env && env.token === 'TOK', 'con su token');

  console.log('\n── SIN NOMBRE NO SE ESCRIBE NADA ──');
  const pg2 = (await abrir(b, ['financiero'])).pg;
  await pg2.evaluate(() => { AUTOR = ''; localStorage.removeItem('ac_autor'); });
  await pg2.evaluate(() => { window.prompt = () => null; });   // el usuario cancela
  const fallo = await pg2.evaluate(async () => {
    try { await post('enviarEstado', { clave: 'Q-9' }); return 'salió'; } catch (e) { return String(e); }
  });
  ok(fallo === 'sin-autor',
     'si no se identifica, la petición NO sale: mejor eso que una bitácora con cambios anónimos');

  console.log('\n── LA VISTA DE ACCESO SÓLO SI SE CONTRATÓ ──');
  const soloFin = (await abrir(b, ['financiero'])).pg;
  ok(await soloFin.evaluate(() => document.getElementById('seg').style.display) === 'none',
     'sin el módulo, el conmutador no aparece: no se ofrece lo que no se puede usar');

  const conAcc = (await abrir(b, ['financiero', 'acceso'])).pg;
  ok(await conAcc.evaluate(() => document.getElementById('seg').style.display) === 'flex',
     'con el módulo, sí');

  const sinLista = (await abrir(b, null)).pg;
  ok(await sinLista.evaluate(() => document.getElementById('seg').style.display) === 'flex',
     'y un backend viejo que no manda módulos lo enseña todo: que falte un dato no ' +
     'puede dejar a nadie sin su panel');

  console.log('\n── LA BITÁCORA EN EL TELÉFONO ──');
  const p3 = (await abrir(b, ['financiero', 'acceso'])).pg;
  await p3.evaluate(() => verVista('acceso'));
  await p3.waitForFunction(() => document.querySelectorAll('#vAcceso .vis').length > 0, null, { timeout: 5000 });
  ok(await p3.evaluate(() => document.querySelectorAll('#vAcceso .vis').length) === 2,
     'salen las visitas');
  const resumen = await p3.evaluate(() => document.querySelector('#vAcceso .summary').textContent);
  ok(/Adentro ahora/.test(resumen) && /2/.test(resumen), 'con cuántos hay adentro: ' + resumen.trim().slice(0, 40));
  ok(/Sin cerrar/.test(resumen), 'y cuántas entradas quedaron sin cerrar');
  ok(await p3.evaluate(() => document.getElementById('vCuentas').style.display) === 'none',
     'y las cuentas se esconden: en un teléfono no caben las dos');

  console.log('\n── QUÉ SE PUEDE HACER CON CADA VISITA ──');
  await p3.evaluate(() => abrirVisita('VI1'));     // autorizada, sin salida
  let botones = await p3.evaluate(() =>
    [...document.querySelectorAll('#sheetBd .acb')].map(x => x.textContent.trim()));
  ok(botones.some(x => /salió/.test(x)), 'una que entró y no tiene salida: se le puede anotar');
  ok(!botones.some(x => /nadie contestó/.test(x)), 'y no se le ofrece cerrar: ya está decidida');

  await p3.evaluate(() => abrirVisita('VI2'));     // pendiente
  botones = await p3.evaluate(() =>
    [...document.querySelectorAll('#sheetBd .acb')].map(x => x.textContent.trim()));
  ok(botones.some(x => /nadie contestó/.test(x)), 'una pendiente: se puede cerrar');
  ok(!botones.some(x => /salió/.test(x)),
     'y NO se le ofrece anotar salida: afirmaría una entrada que nadie confirmó');
  ok(!botones.some(x => /[Aa]utoriz/.test(x)),
     'en ninguna aparece «autorizar»: eso lo decide quien tiene el documento delante');
  const pie = await p3.evaluate(() => document.getElementById('sheetBd').textContent);
  ok(/no se autoriza una entrada/.test(pie), 'y se dice, para que nadie lo busque');

  await b.close();
  console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
  process.exit(mal ? 1 : 0);
})();
