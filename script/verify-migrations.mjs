import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import pg from "pg";

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRunnerPath = path.join(projectRoot, "script", "db-migrate.mjs");
const adminUrl = process.env.INFRA_TEST_DATABASE_URL;
if (!adminUrl || !new URL(adminUrl).pathname.slice(1).endsWith("_infra_test")) {
  throw new Error("INFRA_TEST_DATABASE_URL debe apuntar a una base desechable cuyo nombre termine en _infra_test.");
}

const admin = new URL(adminUrl);
const databasePrefix = admin.pathname.slice(1);
const createdDatabases = [];

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function urlForDatabase(name) {
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
}

async function createDatabase(suffix) {
  const name = `${databasePrefix}_${suffix}_${randomBytes(3).toString("hex")}`;
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await client.end();
  }
  createdDatabases.push(name);
  return name;
}

async function connectDatabase(name) {
  const client = new Client({ connectionString: urlForDatabase(name) });
  await client.connect();
  return client;
}

function runMigrationCommand(database, command, runnerPath = defaultRunnerPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath, command], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: urlForDatabase(database) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function createRunnerSandbox({ includeAttemptLink = true, insertedMigration = null, changedAttemptLink = false } = {}) {
  const sandbox = await mkdtemp(path.join(projectRoot, ".infra-migrations-runner-"));
  const scriptDirectory = path.join(sandbox, "script");
  const migrationsDirectory = path.join(sandbox, "migrations");
  await mkdir(scriptDirectory);
  await mkdir(migrationsDirectory);
  await cp(defaultRunnerPath, path.join(scriptDirectory, "db-migrate.mjs"));
  await cp(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), path.join(migrationsDirectory, "20261028_000_baseline.sql"));
  if (includeAttemptLink) {
    const attemptLinkPath = path.join(projectRoot, "migrations", "20261028_attempt_result_link.sql");
    if (changedAttemptLink) {
      await writeFile(path.join(migrationsDirectory, "20261028_attempt_result_link.sql"), `${await readFile(attemptLinkPath, "utf8")}\n-- cambio real de prueba\n`);
    } else {
      await cp(attemptLinkPath, path.join(migrationsDirectory, "20261028_attempt_result_link.sql"));
    }
  }
  await cp(
    path.join(projectRoot, "migrations", "20261029_attempt_write_version.sql"),
    path.join(migrationsDirectory, "20261029_attempt_write_version.sql"),
  );
  if (insertedMigration) {
    await writeFile(path.join(migrationsDirectory, insertedMigration.filename), insertedMigration.contents);
  }
  return sandbox;
}

let emptyDatabase;
let existingDatabase;
let currentDatabase;
let incompatibleDatabase;
let portableChecksumsDatabase;
let missingAppliedDatabase;
let outOfOrderDatabase;

before(async () => {
  emptyDatabase = await createDatabase("empty");
  existingDatabase = await createDatabase("existing");
  currentDatabase = await createDatabase("current");
  incompatibleDatabase = await createDatabase("incompatible");
  portableChecksumsDatabase = await createDatabase("portable");
  missingAppliedDatabase = await createDatabase("missing_applied");
  outOfOrderDatabase = await createDatabase("out_of_order");
});

after(async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const database of createdDatabases) {
      await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [database]);
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
    }
  } finally {
    await client.end();
  }
});

test("migrate initializes an empty database once, including concurrent invocations", async () => {
  const [first, second] = await Promise.all([
    runMigrationCommand(emptyDatabase, "migrate"),
    runMigrationCommand(emptyDatabase, "migrate"),
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const client = await connectDatabase(emptyDatabase);
  try {
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    assert.deepEqual(new Set(tables.rows.map((row) => row.tablename)), new Set([
      "opostest_schema_migrations", "questions", "results", "session", "test_attempts", "users",
    ]));

    const applied = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
    assert.equal(applied.rowCount, 3);
    assert.match(applied.rows[0].filename, /baseline\.sql$/);
    assert.equal(applied.rows[1].filename, "20261028_attempt_result_link.sql");
    assert.equal(applied.rows[2].filename, "20261029_attempt_write_version.sql");
    const baselineContents = await readFile(path.join(projectRoot, "migrations", applied.rows[0].filename), "utf8");
    const expectedLfChecksum = createHash("sha256").update(baselineContents.replace(/\r\n/g, "\n")).digest("hex");
    assert.equal(applied.rows[0].checksum, expectedLfChecksum, "new history entries use the canonical LF checksum");

    const attemptColumn = await client.query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'results' AND column_name = 'attempt_id'",
    );
    assert.equal(attemptColumn.rows[0].is_nullable, "YES");

    const writeVersion = await client.query(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_attempts' AND column_name = 'write_version'",
    );
    assert.equal(writeVersion.rows[0].is_nullable, "NO");
    assert.match(writeVersion.rows[0].column_default, /^0/);

    const beforeRepeat = applied.rows.map((row) => row.applied_at.toISOString());
    const repeat = await runMigrationCommand(emptyDatabase, "migrate");
    assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
    const afterRepeat = await client.query("SELECT applied_at FROM opostest_schema_migrations ORDER BY version");
    assert.deepEqual(afterRepeat.rows.map((row) => row.applied_at.toISOString()), beforeRepeat);

    await client.query("UPDATE opostest_schema_migrations SET checksum = repeat('0', 64) WHERE version = $1", [applied.rows[0].version]);
    const tampered = await runMigrationCommand(emptyDatabase, "migrate");
    assert.notEqual(tampered.status, 0, "an altered migration checksum must stop the runner");
    assert.match(tampered.stderr + tampered.stdout, /checksum/i);
  } finally {
    await client.end();
  }
});

test("migrate accepts legacy CRLF checksums without rewriting the applied history", async () => {
  const initialized = await runMigrationCommand(portableChecksumsDatabase, "migrate");
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  let appliedBeforeSqlChange;
  const client = await connectDatabase(portableChecksumsDatabase);
  try {
    const applied = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
    const crlfChecksums = [];
    for (const row of applied.rows) {
      const contents = await readFile(path.join(projectRoot, "migrations", row.filename), "utf8");
      const checksum = createHash("sha256").update(contents.replace(/\n/g, "\r\n")).digest("hex");
      crlfChecksums.push({ ...row, checksum });
      await client.query("UPDATE opostest_schema_migrations SET checksum = $1 WHERE version = $2", [checksum, row.version]);
    }

    const before = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
    appliedBeforeSqlChange = before.rows;
    const rerun = await runMigrationCommand(portableChecksumsDatabase, "migrate");
    assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
    const after = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual(after.rows.map(({ checksum }) => checksum), crlfChecksums.map(({ checksum }) => checksum));
  } finally {
    await client.end();
  }

  const sandbox = await createRunnerSandbox({ changedAttemptLink: true });
  try {
    const changedSql = await runMigrationCommand(portableChecksumsDatabase, "migrate", path.join(sandbox, "script", "db-migrate.mjs"));
    assert.notEqual(changedSql.status, 0, "a real SQL edit must not match a previously applied checksum");
    assert.match(changedSql.stderr + changedSql.stdout, /checksum/i);
    const inspect = await connectDatabase(portableChecksumsDatabase);
    try {
      const afterRejection = await inspect.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
      assert.deepEqual(afterRejection.rows, appliedBeforeSqlChange, "a changed applied migration must leave history unchanged");
    } finally {
      await inspect.end();
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("migrate rejects an applied migration missing from the catalog before applying pending SQL", async () => {
  const initialized = await runMigrationCommand(missingAppliedDatabase, "migrate");
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const sandbox = await createRunnerSandbox({
    includeAttemptLink: false,
    insertedMigration: {
      filename: "20261029_pending_after_missing.sql",
      contents: "CREATE TABLE migration_should_not_run (id integer PRIMARY KEY);\n",
    },
  });
  try {
    const client = await connectDatabase(missingAppliedDatabase);
    try {
      const before = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
      const rejected = await runMigrationCommand(missingAppliedDatabase, "migrate", path.join(sandbox, "script", "db-migrate.mjs"));
      assert.notEqual(rejected.status, 0, "an applied file absent from the catalog must be rejected");
      assert.match(rejected.stderr + rejected.stdout, /historial|prefijo|catalogo|migraci[oó]n aplicada/i);
      const after = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
      assert.deepEqual(after.rows, before.rows, "rejection must not alter applied history");
      const pending = await client.query("SELECT to_regclass('public.migration_should_not_run') AS table_name");
      assert.equal(pending.rows[0].table_name, null, "rejection must not execute pending migration SQL");
    } finally {
      await client.end();
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("migrate rejects a new migration inserted before applied entries without partial changes", async () => {
  const initialized = await runMigrationCommand(outOfOrderDatabase, "migrate");
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const sandbox = await createRunnerSandbox({
    insertedMigration: {
      filename: "20261028_001_inserted_before_link.sql",
      contents: "CREATE TABLE migration_should_not_run (id integer PRIMARY KEY);\n",
    },
  });
  try {
    const client = await connectDatabase(outOfOrderDatabase);
    try {
      const before = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
      const rejected = await runMigrationCommand(outOfOrderDatabase, "migrate", path.join(sandbox, "script", "db-migrate.mjs"));
      assert.notEqual(rejected.status, 0, "a catalog insertion before applied entries must be rejected");
      assert.match(rejected.stderr + rejected.stdout, /historial|prefijo|orden|catalogo|migraci[oó]n aplicada/i);
      const after = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
      assert.deepEqual(after.rows, before.rows, "rejection must not alter applied history");
      const pending = await client.query("SELECT to_regclass('public.migration_should_not_run') AS table_name");
      assert.equal(pending.rows[0].table_name, null, "rejection must not execute the inserted migration");
    } finally {
      await client.end();
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("baseline adopts an existing pre-link schema and preserves legacy results", async () => {
  const client = await connectDatabase(existingDatabase);
  try {
    const baseline = await readFile(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), "utf8");
    await client.query(baseline);
    await client.query(
      "INSERT INTO results (test_id, score, correct_count, total_questions, user_id) VALUES ('legacy-bank', 7, 7, 10, NULL)",
    );
  } finally {
    await client.end();
  }

  const unsafeMigration = await runMigrationCommand(existingDatabase, "migrate");
  assert.notEqual(unsafeMigration.status, 0, "untracked pre-existing tables must require explicit baseline");
  assert.match(unsafeMigration.stderr + unsafeMigration.stdout, /baseline/i);

  const baselineCommand = await runMigrationCommand(existingDatabase, "baseline");
  assert.equal(baselineCommand.status, 0, baselineCommand.stderr || baselineCommand.stdout);

  const migration = await runMigrationCommand(existingDatabase, "migrate");
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const adopted = await connectDatabase(existingDatabase);
  try {
    const rows = await adopted.query("SELECT test_id, attempt_id FROM results");
    assert.deepEqual(rows.rows, [{ test_id: "legacy-bank", attempt_id: null }]);
    const history = await adopted.query("SELECT version FROM opostest_schema_migrations ORDER BY version");
    assert.equal(history.rowCount, 3);
  } finally {
    await adopted.end();
  }
});

test("baseline recognizes a current db:push schema without replaying the result-link migration", async () => {
  const pushed = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "push"], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: urlForDatabase(currentDatabase) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);

  const client = await connectDatabase(currentDatabase);
  try {
    await client.query(
      "INSERT INTO results (test_id, score, correct_count, total_questions, user_id) VALUES ('current-install', 3, 3, 5, NULL)",
    );
  } finally {
    await client.end();
  }

  const baselineCommand = await runMigrationCommand(currentDatabase, "baseline");
  assert.equal(baselineCommand.status, 0, baselineCommand.stderr || baselineCommand.stdout);
  const migration = await runMigrationCommand(currentDatabase, "migrate");
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const adopted = await connectDatabase(currentDatabase);
  try {
    const rows = await adopted.query("SELECT test_id, attempt_id FROM results");
    assert.deepEqual(rows.rows, [{ test_id: "current-install", attempt_id: null }]);
    const history = await adopted.query("SELECT filename FROM opostest_schema_migrations ORDER BY version");
    assert.deepEqual(history.rows.map((row) => row.filename), [
      "20261028_000_baseline.sql",
      "20261028_attempt_result_link.sql",
      "20261029_attempt_write_version.sql",
    ]);
  } finally {
    await adopted.end();
  }
});

test("baseline rejects an existing schema with incompatible column types without creating history", async () => {
  const client = await connectDatabase(incompatibleDatabase);
  try {
    const baseline = await readFile(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), "utf8");
    await client.query(baseline);
    await client.query("ALTER TABLE results ALTER COLUMN score TYPE text USING score::text");
  } finally {
    await client.end();
  }

  const result = await runMigrationCommand(incompatibleDatabase, "baseline");
  assert.notEqual(result.status, 0, "baseline must not adopt incompatible column types");
  assert.match(result.stderr + result.stdout, /results\.score.*integer/i);

  const inspect = await connectDatabase(incompatibleDatabase);
  try {
    const history = await inspect.query("SELECT to_regclass('public.opostest_schema_migrations') AS history_table");
    assert.equal(history.rows[0].history_table, null, "a rejected baseline must leave no partial migration history");
  } finally {
    await inspect.end();
  }
});

test("baseline rejects misleading defaults, composite identity constraints, and an incorrect attempt foreign key", async (t) => {
  const baseline = await readFile(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), "utf8");
  const attemptLink = await readFile(path.join(projectRoot, "migrations", "20261028_attempt_result_link.sql"), "utf8");
  const cases = [
    {
      name: "a numeric default that only contains the expected zero",
      alter: "ALTER TABLE test_attempts ALTER COLUMN current_index SET DEFAULT 100",
      expected: /test_attempts\.current_index.*valor por defecto/i,
    },
    {
      name: "a composite primary key containing id",
      alter: "ALTER TABLE questions DROP CONSTRAINT questions_pkey; ALTER TABLE questions ADD PRIMARY KEY (id, test_id)",
      expected: /questions debe tener clave primaria id/i,
    },
    {
      name: "a composite username uniqueness constraint",
      alter: "ALTER TABLE users DROP CONSTRAINT users_username_unique; ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username, created_at)",
      expected: /users\.username debe ser único/i,
    },
    {
      name: "an attempt link referencing the wrong table",
      alter: "ALTER TABLE results DROP CONSTRAINT results_attempt_id_fkey; ALTER TABLE results ADD CONSTRAINT results_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES users(id) ON DELETE SET NULL",
      expected: /La base ya tiene results\.attempt_id.*FK ON DELETE SET NULL/i,
      withAttemptLink: true,
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, async () => {
      const database = await createDatabase(`invalid_${index}`);
      const client = await connectDatabase(database);
      try {
        await client.query(baseline);
        if (scenario.withAttemptLink) await client.query(attemptLink);
        await client.query(scenario.alter);
      } finally {
        await client.end();
      }
      const result = await runMigrationCommand(database, "baseline");
      assert.notEqual(result.status, 0, "baseline must reject this incompatible schema");
      assert.match(result.stderr + result.stdout, scenario.expected);
      const inspect = await connectDatabase(database);
      try {
        const history = await inspect.query("SELECT to_regclass('public.opostest_schema_migrations') AS history_table");
        assert.equal(history.rows[0].history_table, null, "a rejected baseline must leave no partial migration history");
      } finally {
        await inspect.end();
      }
    });
  }
});
