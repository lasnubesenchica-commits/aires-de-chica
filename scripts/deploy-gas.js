/**
 * Despliegue del backend a los proyectos Apps Script de cada comunidad.
 *
 * El MISMO código va a todas las copias. Lo que las distingue vive en las Propiedades
 * del script de cada proyecto —AC_NEGOCIO, AC_SHEET_ID, AC_CUENTA_NUM…— y este script
 * no las toca: `updateContent` sólo reemplaza archivos.
 *
 * Las copias se listan en clientes.json. Cada una se despliega por separado y un fallo
 * NO detiene a las demás: con diez comunidades, un scriptId mal escrito no puede dejar
 * a las otras nueve sin la corrección que se acaba de subir. Al final se resume qué
 * pasó con cada una y el proceso falla si alguna quedó atrás.
 *
 * Requiere (GitHub Secrets del repo):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * Uso:
 *   node scripts/deploy-gas.js                  todas las copias activas
 *   node scripts/deploy-gas.js --solo aires     sólo esa
 *   node scripts/deploy-gas.js --seco           dice qué haría, sin tocar nada
 */

const fs = require('fs');
const path = require('path');

/**
 * Lee la lista de copias.
 *
 * Si no hay clientes.json pero sí el deploy.config.json de cuando había una sola
 * comunidad, se usa aquél: un repositorio a medio migrar tiene que poder desplegar.
 */
function leerClientes(raiz, solo) {
  const fClientes = path.join(raiz, 'clientes.json');
  const fViejo = path.join(raiz, 'deploy.config.json');
  let cfg;

  if (fs.existsSync(fClientes)) {
    cfg = JSON.parse(fs.readFileSync(fClientes, 'utf8'));
  } else if (fs.existsSync(fViejo)) {
    const v = JSON.parse(fs.readFileSync(fViejo, 'utf8'));
    console.log('· No hay clientes.json; se usa el deploy.config.json de una sola comunidad.');
    cfg = { gasDir: v.gasDir, clientes: [{ id: 'unico', nombre: 'Aires de Chicá',
             scriptId: v.scriptId, deploymentId: v.deploymentId }] };
  } else {
    throw new Error('No encuentro clientes.json ni deploy.config.json.');
  }

  const gasDir = cfg.gasDir || 'backend-aires';
  let clientes = (cfg.clientes || []).filter((c) => c.activo !== false);

  if (solo) {
    const todas = (cfg.clientes || []).map((c) => c.id).join(', ');
    clientes = (cfg.clientes || []).filter((c) => c.id === solo);
    if (!clientes.length) throw new Error(`No hay ninguna copia con id «${solo}». Hay: ${todas}`);
  }
  if (!clientes.length) throw new Error('No hay ninguna copia activa en clientes.json.');

  const faltan = clientes.filter((c) => !c.id || !c.scriptId);
  if (faltan.length) {
    throw new Error('Estas copias no tienen id o scriptId: ' + JSON.stringify(faltan));
  }
  const repes = clientes.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (repes.length) throw new Error('Hay ids repetidos en clientes.json: ' + repes.join(', '));

  return { gasDir, clientes };
}

function getAuth() {
  const { google } = require('googleapis');
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Faltan variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
  }
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return auth;
}

// Base de la espera entre reintentos. Las pruebas la ponen en 0: si no, comprobar que
// un fallo no detiene a las demás cuesta catorce segundos de reloj cada vez, y una
// suite lenta se deja de correr.
let ESPERA_BASE = 1000;

async function withRetry(fn, label, max = 4) {
  let lastErr;
  for (let i = 1; i <= max; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === max) break;
      const wait = Math.pow(2, i) * ESPERA_BASE;
      console.warn(`    ⚠ ${label} intento ${i} falló: ${e.message}. Reintentando en ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function readGasFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(entry).toLowerCase();
    const name = path.basename(entry, ext);
    const source = fs.readFileSync(full, 'utf8');
    if (entry === 'appsscript.json') files.push({ name: 'appsscript', type: 'JSON', source });
    else if (ext === '.gs' || ext === '.js') files.push({ name, type: 'SERVER_JS', source });
  }
  return files;
}

async function findWebAppDeploymentId(api, scriptId) {
  const res = await withRetry(() => api.projects.deployments.list({ scriptId }), 'deployments.list');
  for (const dep of (res.data.deployments || [])) {
    if (!dep.deploymentConfig || !dep.deploymentConfig.versionNumber) continue;
    for (const ep of (dep.entryPoints || [])) if (ep.entryPointType === 'WEB_APP') return dep.deploymentId;
  }
  return null;
}

/** Una copia. Devuelve el resultado en vez de lanzar: quien llama decide si sigue. */
async function desplegarCliente(api, cliente, files) {
  const marca = `Auto-deploy ${new Date().toISOString()}`;
  try {
    await withRetry(() => api.projects.updateContent({
      scriptId: cliente.scriptId, requestBody: { scriptId: cliente.scriptId, files },
    }), 'updateContent');
    console.log('    ✓ código actualizado');

    const ver = await withRetry(() => api.projects.versions.create({
      scriptId: cliente.scriptId, requestBody: { description: `${marca} · ${cliente.nombre || cliente.id}` },
    }), 'versions.create');
    const versionNumber = ver.data.versionNumber;
    console.log(`    ✓ versión ${versionNumber}`);

    let deploymentId = cliente.deploymentId;
    try {
      if (!deploymentId) throw new Error('sin deploymentId en clientes.json');
      await withRetry(() => api.projects.deployments.get(
        { scriptId: cliente.scriptId, deploymentId }), 'deployments.get', 2);
    } catch (e) {
      console.warn('    ⚠ deploymentId no válido — buscando el Web App activo');
      deploymentId = await findWebAppDeploymentId(api, cliente.scriptId);
      if (!deploymentId) {
        throw new Error('no hay ningún Web App. Créalo una vez desde el editor (Implementar → App web).');
      }
    }

    await withRetry(() => api.projects.deployments.update({
      scriptId: cliente.scriptId, deploymentId,
      requestBody: { deploymentConfig: { scriptId: cliente.scriptId, versionNumber,
        manifestFileName: 'appsscript', description: marca } },
    }), 'deployments.update');
    console.log(`    ✓ despliegue ${deploymentId} en la versión ${versionNumber}`);
    return { id: cliente.id, ok: true, versionNumber, deploymentId };
  } catch (e) {
    console.error(`    ✗ ${e.message}`);
    return { id: cliente.id, ok: false, error: e.message };
  }
}

async function main(opciones) {
  opciones = opciones || {};
  const argv = opciones.argv || process.argv.slice(2);
  const raiz = opciones.raiz || process.cwd();
  const solo = opciones.solo || (argv.includes('--solo') ? argv[argv.indexOf('--solo') + 1] : '');
  const seco = opciones.seco || argv.includes('--seco');

  if (opciones.esperaMs !== undefined) ESPERA_BASE = opciones.esperaMs;

  const { gasDir, clientes } = leerClientes(raiz, solo);
  const files = readGasFiles(path.join(raiz, gasDir));
  if (!files.length) throw new Error(`Sin archivos .gs/.js en ${gasDir}`);

  console.log(`${files.length} archivos de ${gasDir} → ${clientes.length} copia(s)`);
  clientes.forEach((c) => console.log(`  · ${c.id}  ${c.nombre || ''}`));
  if (seco) {
    console.log('\n(--seco: no se tocó nada.)');
    return { seco: true, clientes: clientes.map((c) => c.id) };
  }

  const api = opciones.api || require('googleapis').google.script({ version: 'v1', auth: getAuth() });

  const resultados = [];
  for (const c of clientes) {
    console.log(`\n── ${c.nombre || c.id} (${c.scriptId})`);
    resultados.push(await desplegarCliente(api, c, files));
  }

  const mal = resultados.filter((r) => !r.ok);
  console.log('\n════ RESUMEN ════');
  resultados.forEach((r) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.id}${r.ok ? '' : ' — ' + r.error}`));
  console.log(`${resultados.length - mal.length} de ${resultados.length} desplegadas.`);
  if (mal.length) {
    const err = new Error(`${mal.length} copia(s) sin desplegar: ${mal.map((r) => r.id).join(', ')}`);
    err.resultados = resultados;
    throw err;
  }
  return { resultados };
}

if (require.main === module) {
  main().catch((err) => { console.error('\nError:', err.message); process.exit(1); });
} else {
  module.exports = { leerClientes, readGasFiles, desplegarCliente, main };
}
