import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.INFRA_TEST_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : "";
if (!databaseUrl || !databaseName.endsWith("_infra_test")) {
  throw new Error("INFRA_TEST_DATABASE_URL debe apuntar a una base temporal cuyo nombre termine en _infra_test.");
}

const [command] = process.argv.slice(2);
const snapshotPath = process.env.INFRA_PERSISTENCE_SNAPSHOT;
if ((command !== "snapshot" && command !== "assert") || !snapshotPath) {
  throw new Error("Uso: INFRA_PERSISTENCE_SNAPSHOT=<ruta-json> node script/verify-compose-persistence.mjs <snapshot|assert>");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const snapshot = {};
  for (const table of ["users", "questions", "test_attempts", "results"]) {
    const { rows } = await client.query(`SELECT count(*)::integer AS count FROM ${table}`);
    snapshot[table] = rows[0].count;
  }

  if (command === "snapshot") {
    for (const [table, count] of Object.entries(snapshot)) {
      assert.ok(count > 0, `La prueba REL-01 debe dejar filas en ${table} para demostrar persistencia.`);
    }
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  } else {
    const expected = JSON.parse(await readFile(snapshotPath, "utf8"));
    assert.deepEqual(snapshot, expected, "Las cuentas, preguntas, intentos e historial deben persistir al recrear contenedores.");
  }
} finally {
  await client.end();
}
