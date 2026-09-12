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
 * Una copia puede pedir otra credencial con la clave «credencial» de clientes.json:
 * "credencial": "BC" busca GOOGLE_REFRESH_TOKEN_BC. Hace falta porque un editor de
 * otro dominio puede subir código pero no mover el despliegue.
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

/**
 * Qué variables de entorno usa una credencial.
 *
 * Sin sufijo, las de siempre. Con sufijo —la clave «credencial» de clientes.json— se
 * busca GOOGLE_REFRESH_TOKEN_<SUF>, y el id y el secreto caen en los de siempre si no
 * hay unos propios: normalmente es la MISMA aplicación OAuth autorizada por otra
 * cuenta de Google, y sólo cambia el token.
 */
function variablesDeCredencial(sufijo) {
  const s = String(sufijo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (!s) {
    return { id: 'GOOGLE_CLIENT_ID', secreto: 'GOOGLE_CLIENT_SECRET', token: 'GOOGLE_REFRESH_TOKEN' };
  }
  return { id: 'GOOGLE_CLIENT_ID_' + s, secreto: 'GOOGLE_CLIENT_SECRET_' + s,
           token: 'GOOGLE_REFRESH_TOKEN_' + s, sufijo: s };
}

/**
 * La credencial con la que se despliega una copia.
 *
 * Hace falta más de una porque Google impone algo que no se arregla compartiendo el
 * proyecto: un editor de otro dominio puede subir código y crear versiones, pero NO
 * mover el despliegue a la versión nueva —«Only users in the same domain as the script
 * owner may deploy this script»—. Así que cada proyecto se despliega con una cuenta de
 * su propio dominio, y clientes.json dice cuál.
 */
function credencialDe(sufijo, env) {
  env = env || process.env;
  const v = variablesDeCredencial(sufijo);
  const token = env[v.token];
  // El id y el secreto sí caen en los de siempre; el token NO puede caer en otro,
  // porque desplegaría con la cuenta equivocada y el síntoma sería un despliegue que
  // dice que funcionó y no cambió nada.
  const id = env[v.id] || (v.sufijo ? env.GOOGLE_CLIENT_ID : undefined);
  const secreto = env[v.secreto] || (v.sufijo ? env.GOOGLE_CLIENT_SECRET : undefined);

  if (!token) throw new Error(`Falta ${v.token} en los secretos del repositorio`);
  if (!id || !secreto) {
    throw new Error(`Faltan ${v.id} y ${v.secreto} (ni los de siempre sirven de respaldo)`);
  }
  return { id, secreto, token };
}

// Separada de credencialDe a propósito: las pruebas no tienen googleapis instalado
// —el job de pruebas del Action no hace npm install— y elegir mal la credencial es
// justo lo que hay que poder comprobar.
function getAuth(sufijo) {
  const { google } = require('googleapis');
  const c = credencialDe(sufijo);
  const auth = new google.auth.OAuth2(c.id, c.secreto);
  auth.setCredentials({ refresh_token: c.token });
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
    const msg = explicar(e.message, cliente);
    console.error(`    ✗ ${msg}`);
    return { id: cliente.id, ok: false, error: msg };
  }
}

/**
 * Traduce los errores de Google que no dicen nada por sí solos.
 *
 * No es cosmética: «unauthorized_client» a secas manda a buscar permisos del proyecto,
 * que es el sitio equivocado. El problema está en el repositorio, y cada PH nuevo con
 * su propia cuenta va a tropezar con el mismo.
 */
function explicar(mensaje, cliente) {
  const m = String(mensaje || '');
  const v = variablesDeCredencial(cliente && cliente.credencial);

  if (/unauthorized_client/i.test(m)) {
    return m + ` — ese token no fue emitido para esta aplicación OAuth. ` +
      (v.sufijo
        ? `Copia también ${v.id} y ${v.secreto} desde donde sacaste ${v.token}: ` +
          `los tres van juntos, el token solo no sirve.`
        : `Revisa que GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET sean los de la aplicación ` +
          `con la que se generó GOOGLE_REFRESH_TOKEN.`);
  }
  if (/invalid_grant/i.test(m)) {
    return m + ` — el token caducó o fue revocado. Hay que volver a generar ${v.token}.`;
  }
  if (/same domain as the script owner/i.test(m)) {
    return m + ` — compartir el proyecto como editor no basta para mover el despliegue. ` +
      `Este proyecto necesita una credencial de su propio dominio ` +
      `("credencial" en clientes.json).`;
  }
  return m;
}

async function main(opciones) {
  opciones = opciones || {};
  const argv = opciones.argv || process.argv.slice(2);
  const raiz = opciones.raiz || process.cwd();
  const solo = opciones.solo || (argv.includes('--solo') ? argv[argv.indexOf('--solo') + 1] : '');
  const seco = opciones.seco || argv.includes('--seco');

  if (opciones.esperaMs !== undefined) ESPERA_BASE = opciones.esperaMs;

  const { gasDir, clientes } = leerClientes(raiz, solo);

  // Cada copia puede traer su propio directorio. El router no lleva el backend de una
  // comunidad: lleva el suyo, que sólo reparte mensajes.
  const porDir = {};
  clientes.forEach((c) => {
    const d = c.gasDir || gasDir;
    if (!porDir[d]) {
      porDir[d] = readGasFiles(path.join(raiz, d));
      if (!porDir[d].length) throw new Error(`Sin archivos .gs/.js en ${d}`);
    }
  });

  console.log(`${clientes.length} copia(s):`);
  clientes.forEach((c) => console.log(
    `  · ${c.id}  ${c.nombre || ''}  [${c.gasDir || gasDir}, ${porDir[c.gasDir || gasDir].length} archivos]`));
  if (seco) {
    console.log('\n(--seco: no se tocó nada.)');
    return { seco: true, clientes: clientes.map((c) => c.id) };
  }

  // Una conexión por credencial, no por copia: veinte comunidades de la misma cuenta
  // no tienen por qué pedir veinte tokens.
  const conexiones = {};
  const apiPara = opciones.apiPara || ((c) => {
    if (opciones.api) return opciones.api;
    const suf = String(c.credencial || '');
    if (!conexiones[suf]) {
      conexiones[suf] = require('googleapis').google.script({ version: 'v1', auth: getAuth(suf) });
    }
    return conexiones[suf];
  });

  const resultados = [];
  for (const c of clientes) {
    console.log(`\n── ${c.nombre || c.id} (${c.scriptId})`);
    let api;
    try {
      api = apiPara(c);
    } catch (e) {
      // Una credencial que falta es un fallo de esa copia, no de todas: el resto se
      // sigue desplegando y el resumen dice cuál se quedó fuera.
      console.log(`    ✗ ${e.message}`);
      resultados.push({ id: c.id, ok: false, error: e.message });
      continue;
    }
    resultados.push(await desplegarCliente(api, c, porDir[c.gasDir || gasDir]));
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
  module.exports = { leerClientes, readGasFiles, desplegarCliente, main,
                     getAuth, variablesDeCredencial, credencialDe, explicar };
}
