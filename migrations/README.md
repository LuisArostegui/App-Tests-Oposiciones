# Migraciones versionadas

`npm run db:migrate` es el único comando de aplicación de esquema para producción. La aplicación no migra al arrancar. El runner toma un bloqueo asesor de PostgreSQL, aplica cada archivo en una transacción, registra su nombre y SHA-256 en `opostest_schema_migrations` y rechaza cambios posteriores en un archivo ya aplicado.

## Base nueva

La cadena se ejecuta en orden de nombre:

1. `20261028_000_baseline.sql` crea el esquema previo a la relación entre resultado e intento.
2. `20261028_attempt_result_link.sql` añade `results.attempt_id`, nullable, con FK `ON DELETE SET NULL` y unicidad. Los resultados históricos siguen sin enlace; no se inventan asociaciones.

```sh
npm ci
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

Repetir el comando no reejecuta migraciones registradas. No uses `db:push` en producción.

## Adoptar una instalación existente

Las instalaciones creadas con `db:push` no tienen historial. Antes de adoptarlas, detén las escrituras, crea una copia independiente y ensaya allí el mismo procedimiento. Nunca ejecutes el baseline directamente sobre la base personal o de producción para “probar”.

```sh
DATABASE_URL="$DATABASE_URL_DE_LA_COPIA" npm run db:baseline
DATABASE_URL="$DATABASE_URL_DE_LA_COPIA" npm run db:migrate
```

`db:baseline` comprueba las tablas y columnas requeridas antes de registrar la baseline. Si `results.attempt_id` ya existe, también valida que tenga unicidad y una FK `ON DELETE SET NULL`, y registra esa migración como aplicada. Si la columna aún no existe, registra solo la baseline; `db:migrate` aplica después el enlace sin alterar los resultados previos. Una base vacía, parcial o incompatible no se adopta.

El comando no sustituye la comprobación de la copia: valida estructura y relaciones requeridas, pero no certifica que el contenido o todas las restricciones ajenas al proyecto coincidan con el esquema esperado. Tras ensayar, confirma el estado en la copia antes de programar cualquier actualización.

## Validación aislada

`npm run test:infra-migrations` exige `INFRA_TEST_DATABASE_URL` con nombre terminado en `_infra_test`. Crea dos bases temporales, prueba inicialización, ejecuciones concurrentes y repetidas, adopción de un esquema previo con resultado legacy y limpia solo esas bases creadas por la suite.

```sh
$env:INFRA_TEST_DATABASE_URL = "postgresql://.../opostest_infra_test"
npm run test:infra-migrations
Remove-Item Env:INFRA_TEST_DATABASE_URL
```
