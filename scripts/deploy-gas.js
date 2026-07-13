/**
 * Deploy del backend de Aires de Chicá a su proyecto Apps Script.
 *
 * Un solo proyecto (a diferencia del monorepo multi-cliente de BalanceClip).
 * Sube los archivos de backend-aires/, crea una versión y actualiza el Web App.
 *
 * Requiere (GitHub Secrets del repo, cuenta admin@airesdechica.org):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * Config del proyecto en deploy.config.json: { scriptId, deploymentId, gasDir }
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CFG = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'deploy.config.json'), 'utf8'));

function getAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Faltan variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
  }
  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return auth;
}

async function withRetry(fn, label, max = 4) {
  let lastErr;
  for (let i = 1; i <= max; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const wait = Math.pow(2, i) * 1000;
      console.warn(`  ⚠ ${label} intento ${i} falló: ${e.message}. Reintentando en ${wait / 1000}s…`);
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
    if (!dep.deploymentConfig?.versionNumber) continue;
    for (const ep of (dep.entryPoints || [])) if (ep.entryPointType === 'WEB_APP') return dep.deploymentId;
  }
  return null;
}

async function main() {
  const gasDir = path.join(process.cwd(), CFG.gasDir);
  const files = readGasFiles(gasDir);
  if (!files.length) throw new Error(`Sin archivos .gs/.js en ${CFG.gasDir}`);

  const api = google.script({ version: 'v1', auth: getAuth() });
  console.log(`Deployando Aires de Chicá (${files.length} archivos) a ${CFG.scriptId}…`);
  files.forEach((f) => console.log(`  • ${f.name} [${f.type}]`));

  await withRetry(() => api.projects.updateContent({
    scriptId: CFG.scriptId, requestBody: { scriptId: CFG.scriptId, files },
  }), 'updateContent');
  console.log('  ✓ Código actualizado');

  const ver = await withRetry(() => api.projects.versions.create({
    scriptId: CFG.scriptId, requestBody: { description: `Auto-deploy ${new Date().toISOString()}` },
  }), 'versions.create');
  const versionNumber = ver.data.versionNumber;
  console.log(`  ✓ Versión ${versionNumber} creada`);

  let deploymentId = CFG.deploymentId;
  try {
    await withRetry(() => api.projects.deployments.get({ scriptId: CFG.scriptId, deploymentId }), 'deployments.get', 2);
  } catch (e) {
    console.warn(`  ⚠ deploymentId no válido — buscando Web App activo`);
    deploymentId = await findWebAppDeploymentId(api, CFG.scriptId);
    if (!deploymentId) throw new Error('No hay ningún Web App deployment. Crea uno una vez desde el editor (Implementar → App web).');
  }

  await withRetry(() => api.projects.deployments.update({
    scriptId: CFG.scriptId, deploymentId,
    requestBody: { deploymentConfig: { scriptId: CFG.scriptId, versionNumber, manifestFileName: 'appsscript', description: `Auto-deploy ${new Date().toISOString()}` } },
  }), 'deployments.update');
  console.log(`  ✓ Deployment ${deploymentId} actualizado a versión ${versionNumber}`);
  console.log('✓ Aires de Chicá deployado correctamente.');
}

main().catch((err) => { console.error('\nError fatal:', err.message); process.exit(1); });
