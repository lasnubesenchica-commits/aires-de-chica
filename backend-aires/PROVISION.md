# Puesta en marcha — Aires de Chicá (repo propio)

Todo corre bajo la cuenta **`admin@airesdechica.org`**: el Sheet, el Apps Script
y el token de deploy. Sin dependencias de otras cuentas.

## Ya está hecho
- Google Sheet + proyecto Apps Script creados.
- Código, panel y auto-deploy en este repo, apuntando a tu `scriptId` /
  `deploymentId` (`deploy.config.json`) y a `admin.airesdechica.org`.

## 1. Secrets del repo (para el auto-deploy)
En GitHub → Settings → Secrets and variables → Actions, agrega **3 secrets**,
generados con la cuenta `admin@airesdechica.org`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Cómo obtenerlos (OAuth Playground):
1. En Google Cloud Console (proyecto de `admin@airesdechica.org`): crea un OAuth
   Client ID tipo **Web application**, con URI de redirección
   `https://developers.google.com/oauthplayground`. Copia Client ID y Secret.
2. En [OAuth Playground](https://developers.google.com/oauthplayground): ⚙ (arriba
   der.) → marca **Use your own OAuth credentials** → pega ID y Secret.
3. En el scope de la izquierda escribe y autoriza:
   `https://www.googleapis.com/auth/script.projects` y
   `https://www.googleapis.com/auth/script.deployments`.
4. Autoriza con `admin@airesdechica.org` → **Exchange authorization code for tokens**
   → copia el **Refresh token**.
5. Activa la Apps Script API en `script.google.com/home/usersettings`.

## 2. Primera carga de datos
En el editor de Apps Script (como `admin@airesdechica.org`), corre una vez:
1. `ensureSheets` — crea las pestañas (autoriza permisos).
2. `seedInicial` — carga los 67 propietarios + histórico 2026.

> Completa a mano los 3 correos faltantes (Daphney Visueti, Omar/Yessenia H-28,
> Alfonso Castillo) y revisa las cuentas marcadas *"lote repetido en sub-bloque"*.

## 3. GitHub Pages + dominio
1. Repo → Settings → Pages → Source: `Deploy from a branch` → `main` / root.
2. Custom domain: `admin.airesdechica.org` (el archivo `CNAME` ya lo fija).
3. En Hostinger (DNS de airesdechica.org) agrega un registro:
   - **CNAME** · Name `admin` · Content `lasnubesenchica-commits.github.io`
   (o registros A a las IPs de GitHub Pages si prefieres). No afecta el correo.
4. Espera la propagación y marca **Enforce HTTPS** en Pages.

## 4. Contraseña del panel
La primera vez que abras `https://admin.airesdechica.org`, el panel te pedirá
**crear la contraseña** de la administración. A partir de ahí, todos los datos
(saldos, contactos) quedan detrás del login. Para resetearla, define un Script
Property `AUTH_RESET_TOKEN` y usa la acción `resetPassword`.

## 5. Correos automáticos
- Al consolidar pagos, marca *"Enviar estado de cuenta al consolidar"*.
- Para recordatorios programados, crea activadores por tiempo en Apps Script:
  ```js
  function recordatorioMensual() { enviarRecordatorios('mensual'); }
  function avisoDeMora()         { enviarRecordatorios('mora'); }
  ```
  (Activadores → Añadir activador → time-driven, con la periodicidad deseada.)

---

### Cambios de código
Edita `backend-aires/**` y haz push a `main`: el auto-deploy sube el código,
crea versión y actualiza el Web App. El panel (frontend) se publica solo con Pages.
