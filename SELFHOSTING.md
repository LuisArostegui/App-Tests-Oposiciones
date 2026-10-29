# Self-hosting de OposTest Pro con Docker Compose

Esta guía usa el despliegue de producción `compose.prod.yaml`. Es independiente de `compose.local.yaml`: PostgreSQL no publica puertos en el host y la aplicación queda disponible solo en `127.0.0.1:5000`, para un proxy inverso local.

## Requisitos

- Docker Engine y Docker Compose v2.
- Un dominio servido por un proxy inverso controlado con HTTPS (por ejemplo, Nginx o Caddy) en el mismo servidor. La aplicación usa cookies `Secure` en producción: no desactives HTTPS, `Secure` ni la protección de origen/CSRF.
- Un clon del repositorio y espacio persistente para PostgreSQL.

## Configuración inicial

No copies `.env` de desarrollo al servidor ni lo incluyas en una imagen. Crea un archivo local no versionado, `.env.production`, con permisos restrictivos. Genera primero un secreto:

```sh
umask 077
openssl rand -base64 48
```

Usa el valor generado como `SESSION_SECRET` y sustituye todos los marcadores. La contraseña de PostgreSQL forma parte de una URL: usa caracteres compatibles con URL o codifícala antes de ponerla en `DATABASE_URL`.

```env
POSTGRES_USER=opostest_prod
POSTGRES_PASSWORD=CAMBIA_ESTO_POR_UN_SECRETO_LARGO
POSTGRES_DB=opostest
DATABASE_URL=postgresql://opostest_prod:CAMBIA_ESTO_POR_UN_SECRETO_LARGO@postgres:5432/opostest
APP_PORT=5000
SESSION_SECRET=PEGA_AQUI_EL_VALOR_GENERADO_DE_AL_MENOS_32_CARACTERES
APP_URL=https://opostest.example.com
TRUST_PROXY_HOPS=1
REGISTRATION_ENABLED=false
REQUEST_LOGGING_ENABLED=true
```

`APP_PORT` es el puerto local que usa el proxy para llegar a la aplicación; el valor habitual es `5000`. `APP_URL` debe ser el origen público exacto, sin barra final. `TRUST_PROXY_HOPS=1` es correcto solo cuando hay exactamente un proxy inverso controlado delante de la aplicación; usa `0` si no lo hay. Compose rechaza el arranque con un mensaje explícito si faltan `APP_PORT`, `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`, `TRUST_PROXY_HOPS` o las credenciales de PostgreSQL.

Configura el proxy para pasar `Host` y `X-Forwarded-Proto`, conservar HTTPS hacia el navegador y enviar tráfico a `http://127.0.0.1:5000`. No expongas el puerto de PostgreSQL ni cambies el binding de la aplicación a todas las interfaces sin añadir una capa de red equivalente.

## Primera instalación

Construye la imagen y arranca únicamente PostgreSQL. El proyecto dedicado evita afectar a contenedores de otros despliegues:

```sh
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml build app
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml up -d postgres
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml ps
```

Cuando `postgres` esté saludable, aplica las migraciones versionadas. Los scripts son trabajos explícitos; nunca se ejecutan al arrancar `app`.

```sh
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml run --rm --no-deps app npm run db:migrate
```

`db:migrate` prepara una base vacía. `db:baseline` se reserva para adoptar una instalación existente que ya contiene el esquema, tras copia de seguridad y validación; ejecútalo una sola vez antes de `db:migrate`. Para una actualización posterior, realiza una copia de seguridad, revisa el cambio y ejecuta únicamente `db:migrate`. No uses `db:push` para actualizar producción.

Arranca la aplicación y verifica ambos servicios:

```sh
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml up -d app
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml ps
curl --fail http://127.0.0.1:5000/healthz
```

El endpoint de salud debe devolver `200` antes de considerar el servicio disponible. Comprueba también el acceso a través del dominio HTTPS del proxy.

## Primera cuenta

El registro está deshabilitado por defecto. Para crear la primera cuenta, cambia temporalmente `REGISTRATION_ENABLED=true` en `.env.production`, recrea **solo** `app`, registra la cuenta mediante el dominio HTTPS y vuelve inmediatamente a `false`:

```sh
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml up -d --force-recreate app
# Registra la primera cuenta en https://opostest.example.com
# Cambia REGISTRATION_ENABLED=false en .env.production
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml up -d --force-recreate app
```

No mantengas el registro habilitado ni reduzcas las protecciones de cookie u origen para evitar este paso.

## Actualizar o recrear

Antes de actualizar, haz una copia de seguridad y conserva `.env.production` fuera de Git:

```sh
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > opostest-$(date +%F).dump
git pull
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml build
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml run --rm --no-deps app npm run db:migrate
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml up -d --force-recreate app
```

Para recrear todos los contenedores conservando datos:

```sh
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml up -d --build --force-recreate
```

## Operación y datos

```sh
# Estado y logs
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml ps
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml logs -f app

# Detener contenedores sin borrar datos
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml stop

# Eliminar contenedores y red, conservando el volumen PostgreSQL
docker compose --project-name opostest-prod --env-file .env.production -f compose.prod.yaml down
```

El volumen con los datos se llama `opostest-prod_postgres_prod_data`. `down` no lo borra. **No ejecutes `docker compose down -v`** salvo que quieras eliminar definitivamente la base de datos y dispongas de una copia verificada; `-v` borra el volumen persistente.
