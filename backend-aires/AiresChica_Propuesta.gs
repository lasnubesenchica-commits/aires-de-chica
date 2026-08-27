/**
 * Almacenamiento compartido de documentos editables (propuesta.html,
 * contrato.html). Permite editarlos desde distintos computadores y que los
 * cambios queden guardados en el servidor. El HTML editable se guarda
 * troceado en Script Properties para no chocar con el límite de 9 KB por
 * propiedad.
 *
 * Endpoints:
 *   - getPropuesta() / guardarPropuesta(html, q, ver)
 *   - getContrato()  / guardarContrato(html, q, ver)
 *
 * El logo va incrustado en la página; el frontend lo reemplaza por un
 * marcador antes de enviar, así que el payload guardado es pequeño.
 */

var DOC_CHUNK_SIZE = 8000;   // < 9 KB por propiedad
var DOC_MAX = 450000;        // tope defensivo del contenido total

// ── helper genérico de almacenamiento por documento ──
function _docLoad(metaKey, chunkKey) {
  var props = PropertiesService.getScriptProperties();
  var rawMeta = props.getProperty(metaKey);
  if (!rawMeta) return { html: '', updatedAt: '', updatedBy: '', version: '' };
  var meta = {};
  try { meta = JSON.parse(rawMeta); } catch (e) { return { html: '', updatedAt: '', updatedBy: '', version: '' }; }
  var n = Number(meta.n) || 0, html = '';
  for (var i = 0; i < n; i++) html += (props.getProperty(chunkKey + i) || '');
  return { html: html, updatedAt: meta.updatedAt || '', updatedBy: meta.updatedBy || '', version: meta.version || '' };
}

function _docStore(metaKey, chunkKey, html, quien, version) {
  html = String(html == null ? '' : html);
  if (html.length > DOC_MAX) throw new Error('El contenido es demasiado grande para guardarse.');
  var q = String(quien || '').slice(0, 40);
  var ver = String(version || '').slice(0, 40);
  var props = PropertiesService.getScriptProperties();

  // borrar trozos previos (por si la nueva versión tiene menos)
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf(chunkKey) === 0) props.deleteProperty(k); });

  var n = Math.ceil(html.length / DOC_CHUNK_SIZE);
  var toSet = {};
  for (var i = 0; i < n; i++) toSet[chunkKey + i] = html.substr(i * DOC_CHUNK_SIZE, DOC_CHUNK_SIZE);
  var updatedAt = new Date().toISOString();
  toSet[metaKey] = JSON.stringify({ n: n, updatedAt: updatedAt, updatedBy: q, version: ver, len: html.length });
  props.setProperties(toSet);

  return { updatedAt: updatedAt, updatedBy: q, version: ver, len: html.length };
}

// ── Propuesta ──
function getPropuesta() { return _docLoad('AC_PROPUESTA_META', 'AC_PROPUESTA_CHUNK_'); }
function guardarPropuesta(html, quien, version) { return _docStore('AC_PROPUESTA_META', 'AC_PROPUESTA_CHUNK_', html, quien, version); }

// ── Contrato ──
function getContrato() { return _docLoad('AC_CONTRATO_META', 'AC_CONTRATO_CHUNK_'); }
function guardarContrato(html, quien, version) { return _docStore('AC_CONTRATO_META', 'AC_CONTRATO_CHUNK_', html, quien, version); }

// ── Comunicado a los propietarios ──
// Ojo con el nombre: guardarComunicado (sin Doc) es otra cosa — el comunicado que se
// envía por correo desde el panel, en AiresChica_Comunicados.gs. Esto es el DOCUMENTO
// que la administración redacta a varias manos, como el contrato y la propuesta.
function getComunicadoDoc() { return _docLoad('AC_COMDOC_META', 'AC_COMDOC_CHUNK_'); }
function guardarComunicadoDoc(html, quien, version) { return _docStore('AC_COMDOC_META', 'AC_COMDOC_CHUNK_', html, quien, version); }
