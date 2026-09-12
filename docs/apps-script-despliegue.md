# Apps Script: despliegue, credenciales y webhooks

Lo que costó una tarde de vueltas en Aires de Chicá, para no repetirla.
Aplica a cualquier proyecto GAS desplegado por API desde GitHub Actions.

---

## 1. El botón «Ejecutar» del editor no pasa argumentos

Una función administrativa con parámetros —`configurarCliente({...})`,
`registrarPH(a, b, c)`— **no se puede ejecutar desde el desplegable del editor**.
Se elige, se ejecuta, y corre sin argumentos.

Y la pantalla de Propiedades del script es mala alternativa: se pone en sólo
lectura, el botón de guardar se desactiva si cualquier fila tiene el valor en
blanco, y una URL de despliegue son ochenta caracteres que no pueden ir mal ni
en uno.

**Patrón:** un objeto formulario vacío + una función sin argumentos.

```javascript
// Vacío en el repositorio. Se rellena, se ejecuta, se vuelve a vaciar.
var X_ALTA = {
  // clave: 'valor'
};

function altaDeX() {
  var claves = Object.keys(X_ALTA || {});
  if (!claves.length) {
    console.log('X_ALTA está vacío, así que no se escribió nada.');
    console.log('Rellénalo en Archivo.gs y vuelve a ejecutar.');
    return { ok: false };
  }
  return configurarX(X_ALTA);
}
```

Tres reglas que no son opcionales:

- **Vacío en el repositorio.** El despliegue copia el código a todas las copias;
  datos de un cliente ahí acaban visibles en el editor de los demás.
- **Vacío no escribe nada.** Esa función vive en el mismo desplegable que todas
  las otras y se abre sin querer.
- **Pasa por la función validadora**, no por `setProperty` directo, para que
  herede sus comprobaciones.

El despliegue siguiente devuelve el archivo a su estado vacío por sí solo. El
dato ya quedó en las propiedades, que es lo que persiste.

---

## 2. Desplegar desde otra cuenta: qué se puede y qué no

Comprobado contra la API, no deducido:

| Operación | ¿Como editor de otro dominio? |
|---|---|
| `projects.updateContent` — subir código | **Sí** |
| `projects.versions.create` — cortar versión | **Sí** |
| `projects.deployments.update` — mover el despliegue | **No** |

El fallo del tercero:

```
Only users in the same domain as the script owner may deploy this script.
```

**No se arregla compartiendo más.** Compartir el proyecto como Editor resuelve
el primero y el segundo; el tercero exige estar en el mismo dominio que el
dueño.

### Consecuencia de producto

Un cliente que quiera el proyecto Apps Script **en su propia cuenta** no puede
limitarse a añadirte como editor: hace falta una credencial OAuth suya. Y el día
que la revoquen o cambien la contraseña, dejan de recibir actualizaciones sin
enterarse.

La alternativa que evita todo esto: **el código en tu cuenta, los datos en la
suya** — su Sheet, su Drive, sus archivos. Se llevan lo que importa si se van, y
tú puedes arreglarles algo un domingo sin pedir permiso.

### Cómo se resuelve cuando hace falta de verdad

Una credencial por dominio, nombrada desde `clientes.json`:

```json
{ "id": "router", "scriptId": "1TGU…", "credencial": "BC" }
```

`credencial: "BC"` busca `GOOGLE_CLIENT_ID_BC`, `GOOGLE_CLIENT_SECRET_BC`,
`GOOGLE_REFRESH_TOKEN_BC`. Una credencial que falte tiene que fallar **sólo esa
copia**, no el despliegue entero.

---

## 3. Las tres piezas de una credencial OAuth viajan juntas

```
unauthorized_client
```

Casi siempre significa: el refresh token fue emitido **para otra aplicación
OAuth** y se está presentando con un `client_id` distinto. Un refresh token no
es portable entre aplicaciones.

Copiar sólo el token de un repositorio a otro **no funciona** salvo que ambos
usen la misma aplicación OAuth. Copia las tres.

```
invalid_grant
```

El token caducó o fue revocado. Hay que volver a generarlo.

El mensaje crudo de Google manda a revisar los permisos del proyecto, que es el
sitio equivocado: el problema está en los secretos del repositorio. Merece la
pena traducirlo en el script de despliegue.

---

## 4. El punto de entrada de un despliegue puede no coincidir con el manifiesto

El caso que más tiempo costó.

Un despliegue **creado antes** de que `appsscript.json` declarara
`webapp.access: ANYONE_ANONYMOUS` conserva el acceso que tenía, aunque las
versiones siguientes lleven el manifiesto correcto.

Y el diálogo **Administrar implementaciones miente**: muestra «Anyone» porque es
lo que pide el manifiesto de la última versión, no lo que ese punto de entrada
está sirviendo.

**Síntoma:** una petición anónima recibe la página de Google Drive
«Necesitas acceso», y Meta reporta que no pudo validar la URL de devolución de
llamada.

**Arreglo:** crear una implementación **nueva**. No se puede reparar la vieja.
Su URL cambia, así que hay que actualizarla donde esté registrada
(`clientes.json`, el webhook de Meta) y archivar la anterior.

**Evitarlo:** que `appsscript.json` lleve el bloque `webapp` desde el primer
commit, antes de crear ningún despliegue.

---

## 5. El test de incógnito

Antes de tocar la configuración de nadie, y antes de culpar a Google o a Meta:

**Abre la URL `/exec` en una ventana de incógnito, sin sesión de Google.**
Es exactamente lo que ve un servicio externo.

| Lo que sale | Lo que significa |
|---|---|
| La respuesta de `doGet` | El acceso anónimo funciona. El problema está en otra parte. |
| «Necesitas acceso» (Google Drive) | El punto de entrada no es anónimo → sección 4 |
| Pantalla de login de Google | Acceso «Cualquier usuario con cuenta», o política del dominio |
| Error de Apps Script | El código revienta; mira el registro de ejecuciones |

Una pestaña normal no sirve: con cualquier sesión iniciada la prueba miente.

**Orden de diagnóstico**, de lo barato a lo caro:

1. Incógnito con la URL a secas.
2. Incógnito con los parámetros reales del servicio.
3. Comparar el `deploymentId` registrado con el de la implementación **activa**.
4. Sólo entonces, mirar políticas de Workspace.

En Aires de Chicá se saltó el orden y se perdió una ronda revisando la consola
de administración, que estaba bien configurada desde el principio.

---

## 6. `scriptId` no es `deploymentId`

| | Empieza por | Largo | Identifica |
|---|---|---|---|
| `scriptId` | `1` | ~57 | El proyecto. Va en Configuración del proyecto. |
| `deploymentId` | `AKfycb` | ~71 | Una implementación. Es lo que sale en la URL `/macros/s/…/exec`. |

Para subir código hace falta el **scriptId**. Pedir «el id» a secas trae el otro.

---

## 7. Webhooks de Meta sobre Apps Script

- La verificación (`doGet` con `hub.mode=subscribe`) espera el `hub.challenge`
  **en texto plano**. Envuelto en JSON, falla y Meta no dice por qué.
- `doPost` debe devolver **200 siempre**, pase lo que pase. Meta reintenta lo que
  no se acusa, y un fallo propio se convierte en el mismo mensaje llegando sin
  parar.
- `doPost(e)` de Apps Script **no da acceso a las cabeceras**, así que la firma
  `X-Hub-Signature-256` no se puede verificar. Lo que protege el endpoint es que
  la URL es impredecible, más comprobar la forma del contenido antes de hacerle
  caso. Conviene saberlo y no descubrirlo después.
- Guardar la URL no basta: hay que **suscribir los campos** (`messages`), o no
  llega nada.
- Comprobación de extremo a extremo antes de tocar Meta:
  `…/exec?hub.mode=subscribe&hub.verify_token=LA_FRASE&hub.challenge=123456`
  tiene que devolver `123456` en incógnito.

---

## 8. La cuota de llamadas salientes es de la cuenta que ejecuta

`UrlFetchApp`: **20 000 al día** en una cuenta Gmail normal, **100 000** en
Workspace. Cada webhook reenviado es una llamada.

Un router que reparte el tráfico de varios clientes va en una cuenta de
Workspace, no en una personal.
