import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(projectRoot, "migrations");
const historyTable = "opostest_schema_migrations";
const lockKey = 1749230561;
const migrationNamePattern = /^\d{8}_[a-z0-9_-]+\.sql$/;

const requiredColumns = {
  questions: {
    id: { type: "integer", nullable: false, defaultKind: "serial" },
    test_id: { type: "text", nullable: false },
    question_text: { type: "text", nullable: false },
    answers: { type: "jsonb", nullable: false },
    correct_answer: { type: "text", nullable: false },
    category: { type: "text", nullable: true },
    user_id: { type: "integer", nullable: true },
  },
  results: {
    id: { type: "integer", nullable: false, defaultKind: "serial" },
    test_id: { type: "text", nullable: false },
    score: { type: "integer", nullable: false },
    correct_count: { type: "integer", nullable: false },
    total_questions: { type: "integer", nullable: false },
    completed_at: { type: "timestamp without time zone", nullable: true, defaultValue: "now()" },
    user_id: { type: "integer", nullable: true },
  },
  session: {
    sid: { type: "text", nullable: false },
    sess: { type: "jsonb", nullable: false },
    expire: { type: "timestamp without time zone", nullable: false, datetimePrecision: 6 },
  },
  test_attempts: {
    id: { type: "integer", nullable: false, defaultKind: "serial" },
    test_id: { type: "text", nullable: false },
    status: { type: "text", nullable: false, defaultValue: "'in_progress'" },
    current_index: { type: "integer", nullable: false, defaultValue: "0" },
    answers: { type: "jsonb", nullable: false, defaultValue: "'{}'" },
    question_order: { type: "jsonb", nullable: false },
    total_questions: { type: "integer", nullable: false },
    correct_count: { type: "integer", nullable: true, defaultValue: "0" },
    score: { type: "integer", nullable: true, defaultValue: "0" },
    started_at: { type: "timestamp without time zone", nullable: true, defaultValue: "now()" },
    completed_at: { type: "timestamp without time zone", nullable: true },
    user_id: { type: "integer", nullable: true },
  },
  users: {
    id: { type: "integer", nullable: false, defaultKind: "serial" },
    username: { type: "text", nullable: false },
    password: { type: "text", nullable: false },
    created_at: { type: "timestamp without time zone", nullable: true, defaultValue: "now()" },
  },
};

function rawChecksum(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function normalizeLineEndings(contents) {
  return contents.replace(/\r\n/g, "\n");
}

function checksum(contents) {
  return rawChecksum(normalizeLineEndings(contents));
}

function compatibleChecksums(contents) {
  const normalized = normalizeLineEndings(contents);
  return new Set([
    rawChecksum(normalized),
    rawChecksum(normalized.replace(/\n/g, "\r\n")),
  ]);
}

function normalizeDefault(value) {
  return value?.replace(/::[a-zA-Z_ ]+(?:\[\])?/g, "").replace(/[()\s]/g, "").toLowerCase() ?? null;
}

async function getMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => migrationNamePattern.test(name))
    .sort();
  if (names.length === 0 || !names[0].endsWith("_baseline.sql")) {
    throw new Error("No existe una migración baseline versionada en migrations/.");
  }
  return Promise.all(names.map(async (filename) => {
    const contents = await readFile(path.join(migrationsDirectory, filename), "utf8");
    return { filename, contents, checksum: checksum(contents) };
  }));
}

async function historyExists(client) {
  const result = await client.query("SELECT to_regclass($1) AS table_name", [`public.${historyTable}`]);
  return result.rows[0].table_name !== null;
}

async function createHistory(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${historyTable} (
      version text PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function tableColumns(client) {
  const result = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default, datetime_precision
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const columns = new Map();
  for (const row of result.rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map());
    columns.get(row.table_name).set(row.column_name, row);
  }
  return columns;
}

async function validateExistingSchema(client) {
  const columns = await tableColumns(client);
  const missing = [];
  const mismatched = [];
  for (const [table, expectedColumns] of Object.entries(requiredColumns)) {
    for (const [column, expected] of Object.entries(expectedColumns)) {
      const actual = columns.get(table)?.get(column);
      if (!actual) {
        missing.push(`${table}.${column}`);
        continue;
      }
      if (actual.data_type !== expected.type) mismatched.push(`${table}.${column} debe ser ${expected.type}`);
      if ((actual.is_nullable === "YES") !== expected.nullable) {
        mismatched.push(`${table}.${column} debe ${expected.nullable ? "permitir" : "rechazar"} NULL`);
      }
      if (expected.defaultKind === "serial" && !/^nextval\('[^']+'::regclass\)$/.test(actual.column_default ?? "")) {
        mismatched.push(`${table}.${column} debe usar una secuencia como valor por defecto`);
      }
      if (expected.defaultValue !== undefined && normalizeDefault(actual.column_default) !== normalizeDefault(expected.defaultValue)) {
        mismatched.push(`${table}.${column} debe conservar su valor por defecto`);
      }
      if (expected.datetimePrecision !== undefined && actual.datetime_precision !== expected.datetimePrecision) {
        mismatched.push(`${table}.${column} debe tener precisión temporal ${expected.datetimePrecision}`);
      }
    }
  }
  const constraints = await client.query(`
    SELECT table_name, constraint_name, constraint_type, column_name,
      count(*) OVER (PARTITION BY constraint_schema, table_name, constraint_name) AS column_count
    FROM information_schema.table_constraints AS table_constraint
    JOIN information_schema.key_column_usage AS key_column
      USING (constraint_catalog, constraint_schema, constraint_name, table_name)
    WHERE table_constraint.table_schema = 'public'
  `);
  const hasConstraint = (table, type, column) => constraints.rows.some((row) =>
    row.table_name === table && row.constraint_type === type && row.column_name === column && Number(row.column_count) === 1);
  const primaryKeys = { questions: "id", results: "id", session: "sid", test_attempts: "id", users: "id" };
  for (const [table, column] of Object.entries(primaryKeys)) {
    if (!hasConstraint(table, "PRIMARY KEY", column)) mismatched.push(`${table} debe tener clave primaria ${column}`);
  }
  if (!hasConstraint("users", "UNIQUE", "username")) {
    mismatched.push("users.username debe ser único");
  }
  if (missing.length || mismatched.length) {
    const details = [
      ...(missing.length ? [`faltan columnas (${missing.join(", ")})`] : []),
      ...mismatched,
    ];
    throw new Error(`No se puede adoptar la base: esquema OposTest incompatible (${details.join("; ")}).`);
  }
  return columns;
}

async function hasAttemptLink(client) {
  const column = await client.query(`
    SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'results' AND column_name = 'attempt_id'
  `);
  if (column.rowCount === 0) return false;
  if (column.rows[0].data_type !== "integer" || column.rows[0].is_nullable !== "YES") {
    throw new Error("results.attempt_id debe ser integer y nullable.");
  }

  const constraints = await client.query(`
    SELECT constraint_row.contype, constraint_row.confdeltype,
      array_length(constraint_row.conkey, 1) AS source_column_count,
      array_length(constraint_row.confkey, 1) AS target_column_count,
      referenced_attribute.attname AS referenced_column
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
    LEFT JOIN pg_class AS referenced_table ON referenced_table.oid = constraint_row.confrelid
    LEFT JOIN pg_namespace AS referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
    LEFT JOIN pg_attribute AS referenced_attribute
      ON referenced_attribute.attrelid = referenced_table.oid
      AND referenced_attribute.attnum = constraint_row.confkey[1]
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname = 'results'
      AND array_length(constraint_row.conkey, 1) = 1
      AND constraint_row.conkey[1] = (
        SELECT attribute_row.attnum
        FROM pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = table_row.oid AND attribute_row.attname = 'attempt_id'
      )
      AND (constraint_row.contype <> 'f' OR (
        referenced_namespace.nspname = 'public' AND referenced_table.relname = 'test_attempts'
        AND referenced_attribute.attname = 'id'
      ))
  `);
  const uniqueConstraint = constraints.rows.some((row) => row.contype === "u" && Number(row.source_column_count) === 1);
  const nullableForeignKey = constraints.rows.some((row) => row.contype === "f" && row.confdeltype === "n"
    && Number(row.source_column_count) === 1 && Number(row.target_column_count) === 1);
  if (!uniqueConstraint || !nullableForeignKey) {
    throw new Error("La base ya tiene results.attempt_id, pero faltan su unicidad o la FK ON DELETE SET NULL.");
  }
  return true;
}

async function hasAttemptWriteVersion(client) {
  const column = await client.query(`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'test_attempts' AND column_name = 'write_version'
  `);
  if (column.rowCount === 0) return false;
  if (column.rows[0].data_type !== "integer" || column.rows[0].is_nullable !== "NO" || !/^0/.test(column.rows[0].column_default ?? "")) {
    throw new Error("test_attempts.write_version debe ser integer, NOT NULL y tener default 0.");
  }
  return true;
}

async function withMigrationLock(client, action) {
  await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
  try {
    return await action();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
  }
}

function migrationBody(contents) {
  return contents.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "").trim();
}

async function recordMigration(client, migration) {
  await client.query("BEGIN");
  try {
    await client.query(migrationBody(migration.contents));
    await client.query(
      `INSERT INTO ${historyTable} (version, filename, checksum) VALUES ($1, $2, $3)`,
      [migration.filename, migration.filename, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function existingPublicTables(client) {
  const result = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> $1
  `, [historyTable]);
  return result.rows.map((row) => row.tablename);
}

function validateAppliedHistory(appliedRows, migrations) {
  if (appliedRows.length > migrations.length) {
    throw new Error("El historial aplicado contiene migraciones que no existen en el catálogo disponible.");
  }

  for (const [index, saved] of appliedRows.entries()) {
    const migration = migrations[index];
    if (!migration || saved.version !== migration.filename || saved.filename !== migration.filename) {
      throw new Error(
        `El historial aplicado no es un prefijo exacto y ordenado del catálogo: se esperaba ${migration?.filename ?? "ninguna migración"} y se encontró ${saved.filename} (${saved.version}).`,
      );
    }
    if (!compatibleChecksums(migration.contents).has(saved.checksum)) {
      throw new Error(`La migración aplicada ${migration.filename} no coincide con su checksum registrado.`);
    }
  }

  return appliedRows.length;
}

async function migrate(client, migrations) {
  const hasHistory = await historyExists(client);
  if (!hasHistory) {
    if ((await existingPublicTables(client)).length) {
      throw new Error("La base ya contiene tablas sin historial. Valídala y ejecuta primero `npm run db:baseline`.");
    }
    await createHistory(client);
  }

  const appliedResult = await client.query(`SELECT version, filename, checksum FROM ${historyTable} ORDER BY version ASC`);
  const appliedCount = validateAppliedHistory(appliedResult.rows, migrations);
  if (appliedCount === 0 && (await existingPublicTables(client)).length) {
    throw new Error("La base ya contiene tablas sin baseline aplicado. Valídala y ejecuta primero `npm run db:baseline`.");
  }
  for (const migration of migrations.slice(appliedCount)) {
    await recordMigration(client, migration);
    console.log(`Migración aplicada: ${migration.filename}`);
  }
}

async function baseline(client, migrations) {
  const hasHistory = await historyExists(client);
  if (hasHistory) {
    const recorded = await client.query(`SELECT count(*)::integer AS count FROM ${historyTable}`);
    if (recorded.rows[0].count > 0) {
      throw new Error("Ya existe el historial de migraciones; no se puede volver a crear el baseline.");
    }
  }
  await validateExistingSchema(client);
  const existingAttemptLink = await hasAttemptLink(client);
  const existingAttemptWriteVersion = await hasAttemptWriteVersion(client);
  if (existingAttemptWriteVersion && !existingAttemptLink) {
    throw new Error("test_attempts.write_version no se puede adoptar sin results.attempt_id aplicado.");
  }

  const baselineMigration = migrations[0];
  await client.query("BEGIN");
  try {
    if (!hasHistory) await createHistory(client);
    await client.query(
      `INSERT INTO ${historyTable} (version, filename, checksum) VALUES ($1, $2, $3)`,
      [baselineMigration.filename, baselineMigration.filename, baselineMigration.checksum],
    );
    if (existingAttemptLink) {
      const attemptMigration = migrations.find((migration) => migration.filename === "20261028_attempt_result_link.sql");
      if (!attemptMigration) throw new Error("No se encontró la migración de enlace resultado-intento.");
      await client.query(
        `INSERT INTO ${historyTable} (version, filename, checksum) VALUES ($1, $2, $3)`,
        [attemptMigration.filename, attemptMigration.filename, attemptMigration.checksum],
      );
    }
    if (existingAttemptWriteVersion) {
      const writeVersionMigration = migrations.find((migration) => migration.filename === "20261029_attempt_write_version.sql");
      if (!writeVersionMigration) throw new Error("No se encontró la migración de versión de escritura del intento.");
      await client.query(
        `INSERT INTO ${historyTable} (version, filename, checksum) VALUES ($1, $2, $3)`,
        [writeVersionMigration.filename, writeVersionMigration.filename, writeVersionMigration.checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  console.log(existingAttemptLink
    ? "Baseline registrado; el enlace resultado-intento existente también quedó reconocido."
    : "Baseline registrado; ejecuta `npm run db:migrate` para aplicar las migraciones posteriores.");
}

async function main() {
  const command = process.argv[2];
  if (command !== "migrate" && command !== "baseline") {
    throw new Error("Uso: node script/db-migrate.mjs <migrate|baseline>");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL es obligatorio para las migraciones.");
  const migrations = await getMigrations();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await withMigrationLock(client, () => command === "migrate"
      ? migrate(client, migrations)
      : baseline(client, migrations));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "No se pudieron aplicar las migraciones.");
  process.exitCode = 1;
});
