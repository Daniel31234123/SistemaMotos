# Backend local de gestión de motos

API REST para la operación local del negocio. Usa NestJS, TypeScript estricto, PostgreSQL, Prisma y Docker Compose. No incluye frontend, Electron, integración con Supre, autenticación ni acceso desde otros equipos.

## Requisitos

- Docker Desktop con motor Linux y Docker Compose.
- Node.js 24 LTS para desarrollo local. El equipo del proyecto tiene Node.js 20.20.0, versión fuera de soporte; actualízala antes de ejecutar comandos Node en el host.
- Copiar `.env.example` a `.env` y cambiar `POSTGRES_PASSWORD` y `DATABASE_URL` por una clave local. No subir `.env` a Git.

## Desarrollo

```powershell
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:dev -- --name init
npm run prisma:seed
npm run start:dev
```

API local: `http://127.0.0.1:3000/api/v1`; Swagger: `http://127.0.0.1:3000/api/v1/docs`.

## Docker Compose

```powershell
Copy-Item .env.example .env
docker compose up --build -d postgres
docker compose run --rm api npm run prisma:migrate:deploy
docker compose run --rm api npm run prisma:seed
docker compose up --build -d api
docker compose ps
docker compose logs -f api
docker compose down
```

PostgreSQL se publica solo en `127.0.0.1:5432`; API solo en `127.0.0.1:3000`. DBeaver en el mismo PC usa host `127.0.0.1`, puerto `5432` y credenciales de `.env`. No configurar publicación de puertos en `0.0.0.0`.

El volumen `postgres_data` conserva los datos. `docker compose down` no lo elimina. **No ejecutar `docker compose down -v`** salvo decisión deliberada y con respaldo.

## Migraciones y respaldo

- Desarrollo: `npm run prisma:migrate:dev -- --name nombre_descriptivo`.
- Despliegue: `npm run prisma:migrate:deploy` (o el comando equivalente dentro del contenedor).
- Respaldo: `docker compose exec -T postgres pg_dump -U $env:POSTGRES_USER -d $env:POSTGRES_DB -Fc -f /tmp/sistema-motos.dump` y copiar el archivo desde el contenedor con `docker cp`.
- Restauración: detener API, crear una base destino vacía de forma explícita y restaurar con `pg_restore`. Revisar el procedimiento y el destino antes de ejecutarlo; no restaurar encima de datos existentes sin respaldo y autorización.

El respaldo/restore no se ha probado todavía. Para operaciones rutinarias no borrar volúmenes ni reinicializar datos.

## Reglas económicas

El precio de motocicleta, trámites, costos de trámites, porcentaje descontado y gastos se guardan por separado. El valor financiado no se contabiliza como ingreso propio. Bajaj 4 % y Auteco 11 % son reglas comerciales comunicadas, no una clasificación fiscal verificada. La aplicación requiere selección y confirmación manual de una regla con vigencia; marcas nuevas no tienen tasa implícita. Bases cero o negativas quedan para revisión y no se calculan automáticamente.

En `PercentageApplication`, `amountCop` conserva el importe original. Cada `PercentageAdjustment.amountDeltaCop` se aplica al importe vigente; el sistema lo calcula como importe original más todos los ajustes registrados, con precisión decimal de COP. La respuesta de aplicaciones y los reportes exponen `currentAmountCop` sin modificar el snapshot original. Este cálculo no se extiende a otras entidades económicas.

## Pruebas

```powershell
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

### Pruebas de integración PostgreSQL

Las pruebas de integración usan exclusivamente `TEST_DATABASE_URL` y rechazan cualquier URL cuyo nombre de base no sea exactamente `sistema_motos_integration_test`. Antes de ejecutar cada suite, el helper consulta `SELECT current_database()`; si falta la variable, no coincide el nombre o falla la comprobación, la suite se detiene antes de operar.

Requisitos: PostgreSQL local accesible en `127.0.0.1:5432`, Node.js 24.11 o posterior y un rol que pueda crear la base de pruebas y aplicar la migración. La base debe crearse explícitamente una sola vez, por ejemplo desde pgAdmin conectado al servidor local:

```sql
CREATE DATABASE sistema_motos_integration_test OWNER motos_app;
```

No uses `sistema_motos` para migraciones o pruebas de integración. No elimines ni reinicialices bases o volúmenes para limpiar pruebas. Las pruebas usan identificadores únicos y mantienen sus datos únicamente en la base dedicada.

Configura `TEST_DATABASE_URL` en la sesión de PowerShell con el usuario, contraseña local URL-encoded, host y puerto del PostgreSQL de pruebas. No publiques la URL ni la guardes en el repositorio. `.env.example` contiene solo un marcador de ejemplo. Para aplicar las migraciones pendientes y luego ejecutar las pruebas:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://motos_app:<PASSWORD_URL_ENCODED>@127.0.0.1:5432/sistema_motos_integration_test?schema=public'
npm run test:integration:migrate
npm run test:integration -- --runInBand
Remove-Item Env:TEST_DATABASE_URL
```

El comando `test:integration:migrate` verifica primero el nombre de la URL y `current_database()`. Solo entonces pasa el mismo valor de `TEST_DATABASE_URL` a Prisma como `DATABASE_URL` de proceso, porque el datasource del esquema Prisma usa ese nombre. No recurre al `DATABASE_URL` de `.env`. La suite de Jest usa el helper compartido y no crea clientes Prisma alternativos.

La configuración de Jest de integración detecta `*.integration-spec.ts`; la configuración unitaria solo detecta `*.spec.ts`. Ejecuta la suite unitaria con `npm test -- --runInBand` y la de integración con `npm run test:integration -- --runInBand`.

Las pruebas e2e utilizan NestJS HTTP y la misma base dedicada, mediante el helper verificado de integración. En PowerShell, configura la URL una sola vez y asigna explícitamente el mismo destino a `DATABASE_URL` para satisfacer la validación de configuración de `AppModule`; no uses el valor de `.env`:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://motos_app:<PASSWORD_URL_ENCODED>@127.0.0.1:5432/sistema_motos_integration_test?schema=public'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run test:e2e -- --runInBand
Remove-Item Env:TEST_DATABASE_URL
Remove-Item Env:DATABASE_URL
```

El setup e2e consulta también `current_database()` antes de inicializar NestJS. Las pruebas comprueban respuestas HTTP, validación de DTO, persistencia y CSV con BOM, decimales, escape y protección de fórmulas.

## Variables

`NODE_ENV`, `PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`, `CORS_ORIGINS`, `LOG_LEVEL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_EMAIL` y `PGADMIN_DEFAULT_PASSWORD`. CORS permanece vacío hasta conocer el origen real del futuro frontend.
