# Migraciones de esquema

## `20261028_attempt_result_link.sql`

La migración añade `results.attempt_id`, nullable, con FK a `test_attempts` y unicidad para los valores presentes. Los resultados históricos quedan en `NULL`; no se asocia ningún resultado antiguo por conjetura. Al borrar un intento, su resultado se conserva y el enlace pasa a `NULL`.

Antes de aplicar cambios en una instalación, crea una copia PostgreSQL, por ejemplo:

```sh
pg_dump --format=custom --file=opostest-before-attempt-result-link.dump "$DATABASE_URL"
```

Revisa que `results` y `test_attempts` existen y aplica la migración una sola vez:

```sh
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file=migrations/20261028_attempt_result_link.sql
```

Para revertirla, detén primero las escrituras de la aplicación y guarda otra copia. La reversión conserva intentos y resultados, pero elimina las asociaciones creadas desde esta migración:

```sql
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_attempt_id_unique;
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_attempt_id_fkey;
ALTER TABLE results DROP COLUMN IF EXISTS attempt_id;
```

Si una copia previa es necesaria, restaúrala en una base de destino independiente y valida la aplicación antes de cambiar el servicio:

```sh
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists opostest-before-attempt-result-link.dump
```
