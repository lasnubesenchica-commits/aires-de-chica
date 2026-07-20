/**
 * Almacenamiento compartido de la propuesta editable (propuesta.html).
 *
 * Permite que los administradores editen la propuesta desde distintos
 * computadores y que los cambios queden guardados en el servidor (no solo
 * en el navegador). El HTML editable se guarda troceado en Script
 * Properties para no chocar con el límite de 9 KB por propiedad.
 *
 * Endpoints:
 *   - getPropuesta()            (público, lectura)   -> { html, updatedAt, updatedBy }
 *   - guardarPropuesta(html, q) (requiere token)     -> { updatedAt, updatedBy, len }
 *
 * El logo va incrustado en la página; el frontend lo reemplaza por un
 * marcador antes de enviar, así que el payload guardado es pequeño.
 */

var PROP_META = 'AC_PROPUESTA_META';
var PROP_CHUNK = 'AC_PROPUESTA_CHUNK_';
var PROP_CHUNK_SIZE = 8000;         // < 9 KB por propiedad
var PROP_MAX = 450000;              // tope defensivo del contenido total

function getPropuesta() {
  var props = PropertiesService.getScriptProperties();
  var rawMeta = props.getProperty(PROP_META);
  if (!rawMeta) return { html: '', updatedAt: '', updatedBy: '' };
  var meta = {};
  try { meta = JSON.parse(rawMeta); } catch (e) { return { html: '', updatedAt: '', updatedBy: '' }; }
  var n = Number(meta.n) || 0, html = '';
  for (var i = 0; i < n; i++) html += (props.getProperty(PROP_CHUNK + i) || '');
  return { html: html, updatedAt: meta.updatedAt || '', updatedBy: meta.updatedBy || '' };
}

function guardarPropuesta(html, quien) {
  html = String(html == null ? '' : html);
  if (html.length > PROP_MAX) throw new Error('El contenido es demasiado grande para guardarse.');
  var q = String(quien || '').slice(0, 40);
  var props = PropertiesService.getScriptProperties();

  // borrar trozos previos (por si la nueva versión tiene menos)
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf(PROP_CHUNK) === 0) props.deleteProperty(k); });

  var n = Math.ceil(html.length / PROP_CHUNK_SIZE);
  var toSet = {};
  for (var i = 0; i < n; i++) toSet[PROP_CHUNK + i] = html.substr(i * PROP_CHUNK_SIZE, PROP_CHUNK_SIZE);
  var updatedAt = new Date().toISOString();
  toSet[PROP_META] = JSON.stringify({ n: n, updatedAt: updatedAt, updatedBy: q, len: html.length });
  props.setProperties(toSet);

  return { updatedAt: updatedAt, updatedBy: q, len: html.length };
}
