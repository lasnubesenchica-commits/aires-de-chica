# Aires de Chicá — Cobros

Sistema de **estados de cuenta y cobros de mantenimiento** de la comunidad
ecológica Aires de Chicá (Los Laureles, El Quira, El Higuerón).

- **Panel web:** `https://admin.airesdechica.org` (escritorio) y `/app/` (móvil)
- **Backend:** Google Apps Script + Google Sheet (Drive de `admin@airesdechica.org`)
- **Acceso:** protegido con contraseña de la administración.

## Estructura

```
index.html            Panel de escritorio (KPIs, cuentas, conciliación)
app/index.html        Panel móvil
brand/                Logo, favicon y paleta de la marca
backend-aires/        Apps Script
  Code.js               Router doGet/doPost + CONFIG
  AiresChica_Auth.gs    Contraseña / sesión
  AiresChica_Data.gs    Pestañas Propietarios / Pagos + carga inicial
  AiresChica_EstadoCuenta.gs  Motor de cuota + mora + aging + KPIs
  AiresChica_Email.gs   Estado de cuenta en PDF + correos
  AiresChica_Conciliacion.gs  Lector del estado de Banco General
  AiresChica_Seed.gs    Datos iniciales 2026 (67 cuentas)
scripts/deploy-gas.js Auto-deploy del backend al proyecto Apps Script
deploy.config.json    scriptId / deploymentId del proyecto
CNAME                 admin.airesdechica.org
```

## Cómo funciona

- **Cuota** = `B/.45.00 × lotes + B/.13.50 × cabañas` por mes.
- **Mora** = 10% mensual sobre el saldo de cada cuota morosa, desde **abril 2026**.
  La cuota vence a fin de mes y se vuelve morosa el mes siguiente.
- **Pagos**: se aplican en cascada al saldo más antiguo primero.
- **Conciliación**: lee el export `.xlsx` de Banco General (`BGRExcelContReport`),
  detecta los pagos entrantes, los cruza con los propietarios (por lote y nombre,
  desambiguando entre residenciales), descarta duplicados e interés/devoluciones,
  y consolida los que se confirmen (~91% automático en la prueba de mayo 2026).

## Deploy

Cada push a `main` que toque `backend-aires/**` re-despliega el backend
automáticamente (GitHub Actions). El frontend se publica con GitHub Pages.
Ver `backend-aires/PROVISION.md` para la puesta en marcha.

<!-- pages build trigger -->
