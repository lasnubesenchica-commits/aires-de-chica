// El despliegue a varias copias.
//
// Lo que más importa aquí no es que despliegue, sino que un fallo en una copia NO
// detenga a las demás: con diez comunidades, un scriptId mal escrito no puede dejar a
// las otras nueve sin la corrección que se acaba de subir.
const fs = require('fs');
const os = require('os');
const path = require('path');
let mal = 0;
const ok = (c, m) => { console.log((c ? '  ✓' : '  ✗ NO PASA') + ' ' + m); if (!c) mal++; };

const D = require(path.join(__dirname, '..', 'scripts', 'deploy-gas.js'));

// Una raíz de mentira con dos archivos de código y el clientes.json que pida la prueba.
function raizCon(cfg, nombre) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-' + (nombre || '') + '-'));
  fs.mkdirSync(path.join(raiz, 'backend-aires'));
  fs.writeFileSync(path.join(raiz, 'backend-aires', 'Code.js'), 'function doGet(){}');
  fs.writeFileSync(path.join(raiz, 'backend-aires', 'AiresChica_Bot.gs'), 'function bot(){}');
  fs.writeFileSync(path.join(raiz, 'backend-aires', 'appsscript.json'), '{}');
  fs.writeFileSync(path.join(raiz, 'backend-aires', 'notas.md'), 'esto no es código');
  if (cfg) fs.writeFileSync(path.join(raiz, 'clientes.json'), JSON.stringify(cfg));
  return raiz;
}

// Un Google de mentira que apunta lo que le piden y puede fallar para una copia.
function apiFalso(rompe) {
  const llamadas = [];
  const falla = (sid, qué) => {
    if (rompe && rompe.scriptId === sid && rompe.en === qué) throw new Error(rompe.error);
  };
  return { llamadas, projects: {
    updateContent: async (a) => { falla(a.scriptId, 'updateContent');
      llamadas.push({ q: 'updateContent', scriptId: a.scriptId, files: a.requestBody.files }); return {}; },
    versions: { create: async (a) => { falla(a.scriptId, 'versions.create');
      llamadas.push({ q: 'versions.create', scriptId: a.scriptId, desc: a.requestBody.description });
      return { data: { versionNumber: 7 } }; } },
    deployments: {
      get: async (a) => { falla(a.scriptId, 'deployments.get');
        llamadas.push({ q: 'deployments.get', scriptId: a.scriptId, deploymentId: a.deploymentId }); return {}; },
      list: async (a) => { llamadas.push({ q: 'deployments.list', scriptId: a.scriptId });
        return { data: { deployments: [{ deploymentId: 'DEP-ENCONTRADO',
          deploymentConfig: { versionNumber: 3 }, entryPoints: [{ entryPointType: 'WEB_APP' }] }] } }; },
      update: async (a) => { falla(a.scriptId, 'deployments.update');
        llamadas.push({ q: 'deployments.update', scriptId: a.scriptId, deploymentId: a.deploymentId,
          versionNumber: a.requestBody.deploymentConfig.versionNumber }); return {}; }
    } } };
}

const TRES = { gasDir: 'backend-aires', clientes: [
  { id: 'aires',  nombre: 'Aires de Chicá', scriptId: 'SID-AIRES',  deploymentId: 'DEP-AIRES' },
  { id: 'palmas', nombre: 'PH Las Palmas',  scriptId: 'SID-PALMAS', deploymentId: 'DEP-PALMAS' },
  { id: 'robles', nombre: 'PH Los Robles',  scriptId: 'SID-ROBLES', deploymentId: 'DEP-ROBLES' },
] };

const callar = async (fn) => {
  const l = console.log, w = console.warn, e = console.error;
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.warn = w; console.error = e; }
};

(async () => {

console.log('── QUÉ ARCHIVOS SE SUBEN ──');
const raiz = raizCon(TRES, 'files');
const files = D.readGasFiles(path.join(raiz, 'backend-aires'));
ok(files.length === 3, 'sólo el código y el manifiesto: ' + files.map(f => f.name).join(', '));
ok(!files.some(f => f.name === 'notas'), 'un .md del repositorio no se sube al proyecto');
ok(files.some(f => f.name === 'appsscript' && f.type === 'JSON'),
   'el manifiesto va como JSON y sin extensión, que es como lo quiere Apps Script');
ok(files.every(f => f.name !== 'appsscript' ? f.type === 'SERVER_JS' : true), 'y el resto como SERVER_JS');

console.log('\n── A QUIÉN SE DESPLIEGA ──');
let r = D.leerClientes(raiz, '');
ok(r.clientes.length === 3, 'las tres copias de clientes.json');
ok(r.gasDir === 'backend-aires', 'con su directorio de código');
r = D.leerClientes(raiz, 'palmas');
ok(r.clientes.length === 1 && r.clientes[0].id === 'palmas', '--solo despliega una sola');
let err = '';
try { D.leerClientes(raiz, 'no-existe'); } catch (e) { err = e.message; }
ok(/no-existe/.test(err) && /aires, palmas, robles/.test(err),
   'un id que no existe lo dice y enumera los que hay: ' + err);

const apagada = raizCon({ gasDir: 'backend-aires', clientes: [
  { id: 'aires', scriptId: 'SID-A' }, { id: 'pausada', scriptId: 'SID-P', activo: false } ] }, 'apagada');
ok(D.leerClientes(apagada, '').clientes.length === 1,
   'una copia con activo:false se salta sin tener que borrarla de la lista');
ok(D.leerClientes(apagada, 'pausada').clientes.length === 1,
   'pero con --solo se puede desplegar igual, para volver a ponerla en marcha');

const repetida = raizCon({ clientes: [{ id: 'x', scriptId: 'A' }, { id: 'x', scriptId: 'B' }] }, 'rep');
err = ''; try { D.leerClientes(repetida, ''); } catch (e) { err = e.message; }
ok(/repetidos/.test(err), 'dos copias con el mismo id se rechazan antes de desplegar nada');

const sinSid = raizCon({ clientes: [{ id: 'x' }] }, 'sinsid');
err = ''; try { D.leerClientes(sinSid, ''); } catch (e) { err = e.message; }
ok(/id o scriptId/.test(err), 'y una sin scriptId también');

console.log('\n── EL REPOSITORIO A MEDIO MIGRAR TAMBIÉN DESPLIEGA ──');
const viejo = raizCon(null, 'viejo');
fs.writeFileSync(path.join(viejo, 'deploy.config.json'),
  JSON.stringify({ scriptId: 'SID-VIEJO', deploymentId: 'DEP-VIEJO', gasDir: 'backend-aires' }));
r = await callar(() => D.leerClientes(viejo, ''));
ok(r.clientes.length === 1 && r.clientes[0].scriptId === 'SID-VIEJO',
   'sin clientes.json se usa el deploy.config.json de cuando había una sola comunidad');

console.log('\n── EL DESPLIEGUE NORMAL ──');
let api = apiFalso(null);
let res = await callar(() => D.main({ raiz, api, argv: [], esperaMs: 0 }));
ok(res.resultados.length === 3 && res.resultados.every(x => x.ok), 'las tres salen bien');
const sids = api.llamadas.filter(l => l.q === 'updateContent').map(l => l.scriptId);
ok(sids.join() === 'SID-AIRES,SID-PALMAS,SID-ROBLES', 'cada una a su propio proyecto: ' + sids.join(' '));
const subidos = api.llamadas.find(l => l.q === 'updateContent').files.map(f => f.name).sort();
const subidos2 = api.llamadas.filter(l => l.q === 'updateContent')[1].files.map(f => f.name).sort();
ok(JSON.stringify(subidos) === JSON.stringify(subidos2),
   'con EL MISMO código: lo que distingue a una copia son sus propiedades, no sus archivos');
ok(api.llamadas.filter(l => l.q === 'deployments.update').every(l => l.versionNumber === 7),
   'y el despliegue de cada una queda apuntando a la versión nueva');
ok(api.llamadas.find(l => l.q === 'versions.create').desc.indexOf('Aires de Chicá') >= 0,
   'la versión lleva el nombre de la comunidad, para saber qué se miró al revisar');

console.log('\n── UNA COPIA ROTA NO DETIENE A LAS DEMÁS ──');
api = apiFalso({ scriptId: 'SID-PALMAS', en: 'updateContent', error: 'Requested entity was not found' });
let fallo = null;
res = await callar(() => D.main({ raiz, api, argv: [], esperaMs: 0 }).catch(e => { fallo = e; return e; }));
ok(!!fallo, 'el proceso termina en error, para que el Action se ponga en rojo');
const hechas = api.llamadas.filter(l => l.q === 'deployments.update').map(l => l.scriptId);
ok(hechas.indexOf('SID-AIRES') >= 0 && hechas.indexOf('SID-ROBLES') >= 0,
   'pero Aires y Robles SÍ se desplegaron: ' + hechas.join(' '));
ok(hechas.indexOf('SID-PALMAS') < 0, 'y la rota no');
ok(/palmas/.test(fallo.message) && !/aires/.test(fallo.message),
   'el error nombra a la que falló, no a todas: ' + fallo.message);
ok(fallo.resultados.filter(x => x.ok).length === 2, 'y trae el detalle de las que sí salieron');

console.log('\n── SI EL deploymentId YA NO VALE, SE BUSCA EL WEB APP ──');
api = apiFalso({ scriptId: 'SID-AIRES', en: 'deployments.get', error: 'Not found' });
await callar(() => D.main({ raiz, api, argv: ['--solo', 'aires'], esperaMs: 0 }));
ok(api.llamadas.some(l => l.q === 'deployments.list'), 'pregunta por los despliegues del proyecto');
const upd = api.llamadas.find(l => l.q === 'deployments.update');
ok(upd && upd.deploymentId === 'DEP-ENCONTRADO',
   'y actualiza el que encontró, en vez de rendirse: ' + (upd && upd.deploymentId));

console.log('\n── EL ENSAYO NO TOCA NADA ──');
api = apiFalso(null);
res = await callar(() => D.main({ raiz, api, argv: ['--seco'], esperaMs: 0 }));
ok(res.seco === true && api.llamadas.length === 0, 'con --seco no se llama a Google ni una vez');

console.log('\n' + (mal ? '✗ ' + mal + ' fallas' : '✓ todo bien'));
process.exit(mal ? 1 : 0);

})();
