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
  const enviados = [];   // POST: lo que escribe
  const pedidos = [];    // JSONP: lo que consulta
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
    pedidos.push(accion);
    const datos = {
      getAuthState: { hasPassword: true, modulos: modulos },
      getAutores: { yo: 'Iris', yoClave: '', lotes: [],
        usuarios: [{ nombre: 'Iris', mio: true }, { nombre: 'Doraida', mio: false }] },
      getDashboard: { cuentas: [{ clave: 'Q-9', lote: '9', nombre: 'Ana Rosa Tejada',
        residencial: 'El Quirá', saldoConMora: 245, saldoNeto: 245, cuota: 45,
        estado: 'Moroso', email: 'a@b.c', mensual: [] }] },
      getEstadoCuenta: { clave: 'Q-9', lote: '9', nombre: 'Ana Rosa Tejada', residencial: 'El Quirá',
        cuota: 45, email: 'a@b.c', saldoNeto: 245, saldoConMora: 245, mora: 4.5, moraCargada: 4.5,
        moraCondonAll: false, diasVencido: 12,
        mensual: [{ label: 'Ago 2026', ym: '2026-08', cuota: 45, mora: 4.5, pagado: 0, saldo: 245 }] },
      getCuentasData: { cuentas: [{ id: 'BG1', nombre: 'Banco General', activa: true, esCobro: true, clase: 'banco' },
                                  { id: 'CJ', nombre: 'Caja menuda', activa: true, esCobro: false, clase: 'caja' }] },
      getPropietarios: [{ clave: 'Q-9', lote: '9', nombre: 'Ana Rosa Tejada', residencial: 'El Quirá' },
                        { clave: 'L-14', lote: '14', nombre: 'Judith Araúz', residencial: 'Aires' }],
      getComprobantes: [
        { id: 'C1', estado: 'pendiente', fecha: '12/09/2026', nombre: 'Ana Rosa Tejada',
          remitente: 'ana@correo.com', asunto: 'Pago cuota', adjuntoUrl: 'https://x/y.pdf',
          monto: 45, clave: 'Q-9', metodo: 'email', verif: { nivel: 'ok', mensaje: 'Cuenta Aires de Chicá', cuentaId: 'BG1' } },
        { id: 'C2', estado: 'aplicado', fecha: '10/09/2026', nombre: 'Judith Araúz', monto: 90, lote: '14' },
        { id: 'C3', estado: 'descartado', fecha: '09/09/2026', nombre: '—', motivo: 'sin adjunto' }],
      previsualizarComprobante: { nombre: 'Ana Rosa Tejada', lote: '9', cuota: 45, monto: 45,
        aplicacion: [{ label: 'Ago 2026', cuota: 45, aplicado: 45, quedaPendiente: 0 }],
        aplicacionMora: [], antes: { saldoConMora: 245, mora: 4.5, pendienteMes: 45 },
        despues: { saldoConMora: 200, mora: 4.5, pendienteMes: 0 }, totalAplicado: 45,
        creditoResultante: 0, pendienteResultante: 200, orden: 'cuota', cuotaMes: 45,
        mesActual: 'septiembre', moraSiNoCubre: 4.5, moraPct: 10 },
      getRegistro: { total: 2, autores: ['Iris', 'Josué'], acciones: { 'pago.alta': 'Pago registrado' },
        filas: [{ ymd: '2026-09-12', hora: '09:14', autor: 'Iris', accion: 'pago.alta',
                  accionLbl: 'Pago registrado', clave: 'Q-9', propietario: 'Ana Rosa Tejada',
                  monto: 45, campo: '', antes: '', despues: '', detalle: 'Banca en línea', origen: 'panel' },
                { ymd: '2026-09-11', hora: '17:02', autor: 'Josué', accion: 'prop.edita',
                  accionLbl: 'Propietario editado', clave: 'L-14', propietario: 'Judith Araúz',
                  monto: null, campo: 'celular', antes: '6000-0000', despues: '6111-1111', detalle: '', origen: 'panel' }] },
      getAcceso: { unidad: 'lote', unidadPlural: 'lotes', maxContactos: 5, adentro: 2, colgadas: 1, avisos: [],
        roles: ['propietario', 'inquilino', 'otro'], diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        unidades: [{ clave: 'Q-9', lote: '9', nombre: 'Ana Rosa Tejada' },
                   { clave: 'L-14', lote: '14', nombre: 'Judith Araúz' }],
        sinContactos: [{ clave: 'L-14', nombre: 'Judith Araúz' }],
        contactos: [{ id: 'K1', clave: 'Q-9', nombre: 'Ana Rosa Tejada', celular: '6000-1111',
                      rol: 'propietario', orden: 1, autoriza: true, activo: true, notas: '' }],
        autorizaciones: [{ id: 'A1', clave: 'Q-9', lote: '9', visitante: 'Pedro el jardinero',
                           cedula: '8-700-100', desde: '2026-01-01', hasta: '', recurrente: true,
                           dias: ['L', 'X'], creadoPor: 'Ana', activo: true, vigente: true, notas: '' }],
        garitas: [{ id: 'G1', nombre: 'Garita principal', celular: '6000-9999', turno: '24 h', activo: true, notas: '' }],
        visitas: [{ id: 'VI1', visitante: 'Luis Mendoza', cedula: '8-123-456', lote: '9',
                    fecha: '13/09/2026 14:00', estado: 'autorizada', autorizadoPor: 'Guardia · Garita principal', salida: '' },
                  { id: 'VI2', visitante: 'Sin Decidir', cedula: '', lote: '14',
                    fecha: '13/09/2026 15:00', estado: 'pendiente', autorizadoPor: '', salida: '' }] }
    }[accion] || {};
    return route.fulfill({ status: 200, contentType: 'application/javascript',
      body: cb + '(' + JSON.stringify({ ok: true, data: datos }) + ');' });
  });

  // Las MISMAS claves que el panel de escritorio: viven en el mismo dominio, así que
  // si cada uno usara las suyas el mismo teléfono sería dos dispositivos distintos.
  await pg.addInitScript(() => {
    localStorage.setItem('ac_token', 'TOK');
    localStorage.setItem('bc_autor', 'Iris');
    localStorage.setItem('bc_dev', 'EQUIPO-1');
  });
  await pg.goto('https://movil.prueba/', { waitUntil: 'load' });
  // Sin .catch(): si la app no arranca, esto tiene que fallar aquí y no diez
  // afirmaciones más abajo con un error que no dice nada.
  await pg.waitForFunction(() => document.getElementById('app').style.display === 'block',
    null, { timeout: 8000 });
  if (errores.length) throw new Error('la app soltó un error: ' + errores[0]);
  return { pg, enviados, pedidos, errores };
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
  ok(env && env.dispositivo === 'EQUIPO-1',
     'y el dispositivo del PANEL, no uno propio: el padrón reserva cada nombre para un ' +
     'equipo, y dos identificadores en el mismo teléfono lo partirían en dos: ' + (env && env.dispositivo));
  ok(env && env.token === 'TOK', 'con su token');

  console.log('\n── SIN NOMBRE NO SE ESCRIBE NADA ──');
  const pg2 = (await abrir(b, ['financiero'])).pg;
  await pg2.evaluate(() => { AUTOR = ''; localStorage.removeItem('bc_autor'); });
  const fallo = await pg2.evaluate(async () => {
    try { await post('enviarEstado', { clave: 'Q-9' }); return 'salió'; } catch (e) { return String(e); }
  });
  ok(fallo === 'sin-autor',
     'si no se identifica, la petición NO sale: mejor eso que una bitácora con cambios anónimos');
  await pg2.waitForFunction(() => /Quién usa la app/.test(document.getElementById('sheetHd').textContent),
    null, { timeout: 5000 }).catch(() => {});
  ok(await pg2.evaluate(() => /Quién usa la app/.test(document.getElementById('sheetHd').textContent)),
     'y se abre el selector de identidad en vez de dejarlo en un error sin salida');
  ok(await pg2.evaluate(() => /Doraida/.test(document.getElementById('sheetBd').textContent)),
     'que enseña el padrón del servidor, no un campo libre: los nombres tomados se ven');

  console.log('\n── UN NOMBRE DE OTRO EQUIPO NO SE PUEDE FIRMAR ──');
  // El servidor corta con «autor-de-otro». El móvil enseñaba el código crudo y dejaba
  // el nombre inservible guardado: cada intento siguiente fallaba igual.
  const pg4 = (await abrir(b, ['financiero'])).pg;
  await pg4.evaluate(() => { window.alert = () => {}; });
  await pg4.route('**/macros/**', route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'autor-de-otro' }) });
    const u = new URL(req.url());
    // Coherente con el rechazo: si «Iris» es de otro equipo, el padrón no puede decir
    // que este equipo se llama Iris. Devolverlo restauraría el nombre recién soltado.
    if (u.searchParams.get('action') === 'getAutores') return route.fulfill({ status: 200,
      contentType: 'application/javascript',
      body: u.searchParams.get('callback') + '(' + JSON.stringify({ ok: true, data: {
        yo: '', usuarios: [{ nombre: 'Iris', mio: false }] } }) + ');' });
    return route.fallback();
  });
  // Por un caller de verdad: `post` sólo lanza, y quien decide qué hacer con el error
  // es quien llama. Probarlo con un try/catch pelado no mediría nada.
  await pg4.evaluate(() => mail('Q-9'));
  await pg4.waitForFunction(() => !AUTOR, null, { timeout: 5000 }).catch(() => {});
  ok(await pg4.evaluate(() => !AUTOR && !localStorage.getItem('bc_autor')),
     'el nombre rechazado se suelta: si se quedara guardado, todo cambio siguiente fallaría igual');
  ok(await pg4.evaluate(() => /Quién usa la app/.test(document.getElementById('sheetHd').textContent)),
     'y se pide uno nuevo ahí mismo');

  console.log('\n── IDENTIFICARSE RESERVA EL NOMBRE EN EL SERVIDOR ──');
  const pg5 = await abrir(b, ['financiero']);
  await pg5.pg.evaluate(() => { AUTOR = ''; localStorage.removeItem('bc_autor'); pedirAutor(); });
  await pg5.pg.waitForFunction(() => !!document.getElementById('idNom'), null, { timeout: 5000 });
  await pg5.pg.fill('#idNom', 'Josué');
  await pg5.pg.click('#sheetBd .acb.go');
  await pg5.pg.waitForFunction(() => AUTOR === 'Josué', null, { timeout: 5000 }).catch(() => {});
  const claim = pg5.enviados.filter(x => x.action === 'claimAutor')[0];
  ok(!!claim && claim.nombre === 'Josué',
     'se aparta con claimAutor, no sólo en el teléfono: si no, dos personas usarían el mismo nombre');
  ok(claim && claim.dispositivo === 'EQUIPO-1', 'a nombre de este equipo');

  console.log('\n── LA VISTA DE ACCESO SÓLO SI SE CONTRATÓ ──');
  const soloFin = (await abrir(b, ['financiero'])).pg;
  ok(await soloFin.evaluate(() => document.getElementById('segAcc').style.display) === 'none',
     'sin el módulo, su botón no aparece: no se ofrece lo que no se puede usar');
  ok(await soloFin.evaluate(() => document.getElementById('segCmp').style.display) !== 'none'
     && await soloFin.evaluate(() => document.getElementById('segReg').style.display) !== 'none',
     'y las que sí se pagaron siguen ahí: comprobantes y registro son del módulo financiero');

  const conAcc = (await abrir(b, ['financiero', 'acceso'])).pg;
  ok(await conAcc.evaluate(() => document.getElementById('seg').style.display) === 'flex',
     'con el módulo, sí');

  const sinLista = (await abrir(b, null)).pg;
  ok(await sinLista.evaluate(() => document.getElementById('seg').style.display) === 'flex',
     'y un backend viejo que no manda módulos lo enseña todo: que falte un dato no ' +
     'puede dejar a nadie sin su panel');

  console.log('\n── UNA COMUNIDAD SIN LO FINANCIERO TAMBIÉN TIENE APP ──');
  // Es el caso de Lobby vendido solo: sin esto la app arrancaba en Cuentas, pedía
  // getDashboard, el servidor lo rechazaba por módulo y el dueño se quedaba en el login
  // de su propia app sin saber por qué.
  const soloAcc = await abrir(b, ['acceso', 'comunicaciones']);
  ok(await soloAcc.pg.evaluate(() => document.getElementById('vAcceso').style.display) === 'block',
     'abre directamente en Acceso');
  ok(await soloAcc.pg.evaluate(() => document.getElementById('vCuentas').style.display) === 'none',
     'y las cuentas no se ven');
  ok(await soloAcc.pg.evaluate(() => document.getElementById('seg').style.display) === 'none',
     'ni el conmutador, que no conmuta a nada');
  ok(!soloAcc.pedidos.includes('getPropietarios'),
     'y tampoco getPropietarios: el padrón de unidades viene dentro de getAcceso, ' +
     'porque getPropietarios también es del módulo financiero');
  ok(!soloAcc.pedidos.includes('getDashboard'),
     'y no se pide getDashboard: el servidor lo rechaza por módulo y tumbaba el arranque');
  await soloAcc.pg.waitForFunction(() => document.querySelectorAll('#vAcceso .vis').length > 0,
    null, { timeout: 5000 });
  ok(await soloAcc.pg.evaluate(() => document.querySelectorAll('#vAcceso .vis').length) === 2,
     'la bitácora carga igual');

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

  console.log('\n── CONTACTOS, PERMISOS Y GARITA DESDE EL TELÉFONO ──');
  // Cargar a quién se le pregunta, o dejar un permiso, pasa de pie frente a alguien —
  // no sentado en un escritorio. Antes sólo estaba la bitácora.
  const pa = await abrir(b, ['financiero', 'acceso']);
  await pa.pg.evaluate(() => verVista('acceso'));
  await pa.pg.waitForFunction(() => !!document.getElementById('segAccSub'), null, { timeout: 5000 });

  await pa.pg.evaluate(() => accVista('contactos'));
  ok(/Ana Rosa Tejada/.test(await pa.pg.evaluate(() => document.getElementById('vAcceso').textContent)),
     'los contactos salen por unidad, con su nombre y no con la clave en bruto');
  await pa.pg.evaluate(() => accFormContacto('Q-9', 'K1'));
  const selUnidad = await pa.pg.evaluate(() =>
    [...document.querySelectorAll('#ac_clave option')].map(o => o.textContent));
  ok(selUnidad.length === 2 && selUnidad.some(x => /Judith/.test(x)),
     'y el desplegable de unidades sale del padrón que trae getAcceso: ' + selUnidad.length + ' opciones');
  await pa.pg.fill('#ac_nombre', 'Ana Rosa Tejada Q.');
  await pa.pg.evaluate(() => accGuardarContacto('K1', document.querySelector('#sheetBd .acb.go')));
  let g1 = pa.enviados.filter(x => x.action === 'guardarContacto')[0];
  ok(!!g1 && g1.contacto.id === 'K1' && g1.contacto.nombre === 'Ana Rosa Tejada Q.',
     'guardar manda el contacto entero con su id, que es lo que el servidor espera');
  ok(g1 && g1.contacto.autoriza === true && g1.contacto.orden === 1,
     'con «autoriza» y el orden, que deciden a quién se le pregunta primero');

  await pa.pg.evaluate(() => accVista('permisos'));
  const perm = await pa.pg.evaluate(() => document.getElementById('vAcceso').textContent);
  ok(/Pedro el jardinero/.test(perm), 'los permisos también');
  ok(/sin vencimiento/.test(perm),
     'y uno sin fecha de vencimiento se dice: un permiso que nadie recuerda haber dado ' +
     'es la forma más común de perder el control de quién entra');
  await pa.pg.evaluate(() => accFormPermiso('A1'));
  ok(await pa.pg.evaluate(() => [...document.querySelectorAll('.au_dia')].filter(x => x.checked).map(x => x.value).join('')) === 'LX',
     'el formulario trae marcados los días que ya tenía');
  await pa.pg.evaluate(() => accGuardarPermiso('A1', document.querySelector('#sheetBd .acb.go')));
  const g2 = pa.enviados.filter(x => x.action === 'guardarAutorizacion')[0];
  ok(!!g2 && g2.autorizacion.dias === 'L,X',
     'y los devuelve como los pide el servidor, separados por coma: ' + (g2 && g2.autorizacion.dias));

  await pa.pg.evaluate(() => accVista('garita'));
  ok(/Garita principal/.test(await pa.pg.evaluate(() => document.getElementById('vAcceso').textContent)),
     'y la garita, sin la cual ningún guardia puede usar el sistema');

  console.log('\n── UN PERMISO SIN UNIDAD O SIN NOMBRE NO SE GUARDA ──');
  await pa.pg.evaluate(() => accFormPermiso(''));
  await pa.pg.evaluate(() => accGuardarPermiso('', document.querySelector('#sheetBd .acb.go')));
  const antes = pa.enviados.filter(x => x.action === 'guardarAutorizacion').length;
  ok(antes === 1 && /no pueden quedar vacíos/.test(await pa.pg.evaluate(() => document.getElementById('auErr').textContent)),
     'se corta aquí y se dice por qué, en vez de mandar un permiso a nombre de nadie');

  console.log('\n── COMPROBANTES: CONFIRMAR UN PAGO DESDE EL TELÉFONO ──');
  const pc = await abrir(b, ['financiero']);
  await pc.pg.evaluate(() => verVista('comprob'));
  await pc.pg.waitForFunction(() => !!document.getElementById('cmp_C1'), null, { timeout: 5000 });
  const cmpTxt = await pc.pg.evaluate(() => document.getElementById('vComprob').textContent);
  ok(/Ana Rosa Tejada/.test(cmpTxt), 'el pendiente sale');
  ok(/Cuenta Aires de Chicá/.test(cmpTxt),
     'con la señal de a qué cuenta entró el dinero, que es lo que hay que verificar');
  ok(await pc.pg.evaluate(() => document.getElementById('cm_b_C1').value) === 'BG1',
     'y la cuenta detectada del aviso viene preseleccionada, no en blanco');
  ok(await pc.pg.evaluate(() => document.getElementById('cm_p_C1').value) === 'Q-9',
     'igual que el propietario que el sistema emparejó');

  // Confirmar NO aplica: primero enseña cómo va a quedar la cuenta. Es la última
  // oportunidad de ver que el monto o la cuenta están mal.
  await pc.pg.evaluate(() => cmpPrevio('C1', document.querySelector('#cmp_C1 .acb.go')));
  await pc.pg.waitForFunction(() => /Así se aplicará/.test(document.getElementById('sheetHd').textContent),
    null, { timeout: 5000 });
  ok(!pc.enviados.some(x => x.action === 'resolverComprobante'),
     'confirmar NO aplica todavía: primero se ve cómo queda la cuenta');
  const prev = await pc.pg.evaluate(() => document.getElementById('sheetBd').textContent);
  ok(/queda cubierta/.test(prev),
     'y se dice si la cuota del mes queda cubierta, que es lo único que quien confirma ' +
     'todavía puede cambiar');
  await pc.pg.evaluate(() => cmpAplicar('C1', document.querySelector('#sheetBd .acb.go')));
  const apl = pc.enviados.filter(x => x.action === 'resolverComprobante')[0];
  ok(!!apl && apl.accion === 'aplicar' && apl.clave === 'Q-9' && apl.monto === 45 && apl.cuenta === 'BG1',
     'aplicar manda las cuatro cosas: quién, cuánto, a qué cuenta y cuál comprobante');
  // Aplicar un pago cambia la cartera. Volver a Cuentas y leer los saldos de antes del
  // pago es peor que no verlos: se toma una decisión sobre un número que ya no es cierto.
  const antesDash = pc.pedidos.filter(x => x === 'getDashboard').length;
  await pc.pg.evaluate(() => verVista('cuentas'));
  ok(pc.pedidos.filter(x => x === 'getDashboard').length > antesDash,
     'y al volver a Cuentas se recargan los saldos, que acaban de cambiar');

  console.log('\n── REGISTRAR UN PAGO Y CONDONAR MORA ──');
  const pp = await abrir(b, ['financiero']);
  await pp.pg.evaluate(() => openSheet('Q-9'));
  await pp.pg.waitForFunction(() => !!document.getElementById('pgBox'), null, { timeout: 5000 });
  ok(pp.pedidos.includes('getEstadoCuenta'),
     'el detalle se pide al servidor y no se arma con la fila del tablero: condonar o ' +
     'registrar obliga a recalcular');
  ok(await pp.pg.evaluate(() => document.getElementById('pgBox').style.display) === 'none',
     'el formulario de pago empieza cerrado: en un teléfono el saldo es lo que se viene a ver');
  await pp.pg.evaluate(() => pgForm([...document.querySelectorAll('#sheetBd .acb')].find(x => /Registrar pago/.test(x.textContent))));
  await pp.pg.fill('#pg_monto', '45');
  await pp.pg.evaluate(() => pgGuardar(document.querySelector('#pgBox .acb.go')));
  const pago = pp.enviados.filter(x => x.action === 'registrarPago')[0];
  ok(!!pago && pago.pago.monto === 45 && pago.pago.clave === 'Q-9', 'el pago sale');
  ok(pago && /T12:00:00$/.test(pago.pago.fecha),
     'con la fecha a mediodía, para que ninguna zona horaria la corra al día anterior: ' + (pago && pago.pago.fecha));
  ok(pago && pago.pago.generarVoucher === true,
     'y pidiendo la constancia en PDF, igual que un pago aplicado desde Conciliación');
  ok(pago && pago.pago.cuenta === 'BG1', 'a la cuenta de cobro, que es donde llega el dinero salvo excepción');

  await pp.pg.evaluate(() => { window.confirm = () => true; });
  await pp.pg.evaluate(() => condonarMora(true, [...document.querySelectorAll('#sheetBd .acb')].find(x => /Condonar/.test(x.textContent))));
  const cond = pp.enviados.filter(x => x.action === 'setMoraCondon')[0];
  ok(!!cond && cond.mes === 'ALL' && cond.condonar === true && cond.clave === 'Q-9',
     'y condonar la mora manda el propietario entero, no un mes suelto');

  console.log('\n── EL REGISTRO DE CAMBIOS ──');
  const pr = await abrir(b, ['financiero']);
  await pr.pg.evaluate(() => verVista('registro'));
  await pr.pg.waitForFunction(() => /Pago registrado/.test(document.getElementById('vRegistro').textContent),
    null, { timeout: 5000 });
  const reg = await pr.pg.evaluate(() => document.getElementById('vRegistro').textContent);
  ok(/12 de Sep 2026/.test(reg), 'agrupado por día, con el día escrito y no en AAAA-MM-DD');
  ok(/Iris/.test(reg) && /Josué/.test(reg), 'con el autor de cada cambio');
  ok(/6000-0000/.test(reg) && /6111-1111/.test(reg), 'y el antes y el después de lo que cambió');
  ok(!/Descargar/.test(reg) && !/Eliminar/.test(reg),
     'sin botones de escribir ni de borrar: la bitácora no se edita desde ningún panel');
  await pr.pg.evaluate(() => { document.querySelector('#vRegistro details').open = true; });
  await pr.pg.selectOption('#rg_autor', 'Josué');
  await pr.pg.evaluate(() => cargarRegistro(true));
  await pr.pg.waitForFunction(() => window.__f !== undefined || true, null, { timeout: 1000 }).catch(() => {});
  ok(pr.pedidos.filter(x => x === 'getRegistro').length >= 2,
     'y el filtro vuelve a preguntarle al servidor, que es quien tiene los 400 cambios');
  ok(await pr.pg.evaluate(() => document.getElementById('rg_autor').value) === 'Josué',
     'sin perder lo que se acaba de escoger al repintar');

  await b.close();
  console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
  process.exit(mal ? 1 : 0);
})();
