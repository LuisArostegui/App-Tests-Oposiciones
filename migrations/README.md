# Migraciones versionadas

`npm run db:migrate` es el único comando de aplicación de esquema para producción. La aplicación no migra al arrancar. El runner toma un bloqueo asesor de PostgreSQL, comprueba el historial completo contra el prefijo ordenado del catálogo antes de ejecutar SQL pendiente, aplica cada archivo en una transacción y registra su nombre y SHA-256 en `opostest_schema_migrations`.

## Orden y checksums

Los archivos `migrations/*.sql` usan finales de línea LF; `.gitattributes` aplica esta política en los checkouts de Git. El SHA-256 se calcula sobre el SQL normalizado a LF, por lo que LF y CRLF representan el mismo contenido. Para mantener instalaciones existentes, un checksum histórico calculado con LF o CRLF también se acepta sin reescribir su registro. Cambios reales en el contenido de una migración aplicada siguen causando un error.

Antes de ejecutar SQL, el runner exige que las filas aplicadas, ordenadas por `version`, coincidan exactamente con el comienzo del catálogo disponible. Rechaza migraciones aplicadas que falten del catálogo, versiones/nombres inconsistentes, checksums incompatibles y archivos nuevos insertados antes de migraciones ya aplicadas. Un rechazo no ejecuta SQL pendiente ni modifica el historial. Añade las nuevas migraciones al final del orden existente; no renombres ni edites archivos aplicados.

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

`npm run test:infra-migrations` exige `INFRA_TEST_DATABASE_URL` con nombre terminado en `_infra_test`. Crea bases temporales, prueba inicialización, ejecuciones concurrentes y repetidas, compatibilidad con checksums históricos CRLF sin reescritura, rechazo de cambios SQL y de historiales que no sean prefijos exactos sin cambios parciales, adopción de un esquema previo con resultado legacy y validación de esquemas incompatibles. La suite limpia solo las bases que crea.

```sh
$env:INFRA_TEST_DATABASE_URL = "postgresql://.../opostest_infra_test"
npm run test:infra-migrations
Remove-Item Env:INFRA_TEST_DATABASE_URL
```
