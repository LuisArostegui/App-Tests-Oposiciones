import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parse as parseDotEnv } from "dotenv";

const projectRoot = process.cwd();
const rel01Mode = process.argv[2] === "--rel01";
const testFiles = rel01Mode ? [] : process.argv.slice(2);
const tsxCliPath = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const drizzleCliPath = path.join(projectRoot, "node_modules", "drizzle-kit", "bin.cjs");
const testDatabaseName = "opostest_test";
const testDatabaseUser = "opostest_test";

function run(command: string, args: string[], env = process.env): number {
  const result = spawnSync(command, args, { cwd: projectRoot, env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} exited with status ${result.status}`);
  }
  return result.stdout.trim();
}

function sameDatabase(firstUrl: string, secondUrl: string): boolean {
  try {
    const first = new URL(firstUrl);
    const second = new URL(secondUrl);
    return first.protocol === second.protocol
      && first.hostname === second.hostname
      && first.port === second.port
      && first.pathname === second.pathname;
  } catch {
    return firstUrl === secondUrl;
  }
}

function configuredDevelopmentDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(projectRoot, ".env");
  if (!existsSync(envPath)) return undefined;
  return parseDotEnv(readFileSync(envPath)).DATABASE_URL;
}

function pushTestSchema(databaseUrl: string): number {
  return run(process.execPath, [drizzleCliPath, "push"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
  });
}

async function waitForPostgres(containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync("docker", [
      "exec", containerName, "pg_isready", "-U", testDatabaseUser, "-d", testDatabaseName,
    ], { cwd: projectRoot, stdio: "ignore" });
    if (result.status === 0) return;
    await delay(500);
  }
  throw new Error("El PostgreSQL temporal no llegó a estar disponible.");
}

async function createTemporaryDatabase(): Promise<{ containerName: string; databaseUrl: string }> {
  const containerName = `opostest-test-${randomUUID().slice(0, 8)}`;
  const password = randomBytes(24).toString("hex");
  const startResult = spawnSync("docker", [
    "run", "--rm", "--detach",
    "--name", containerName,
    "--env", `POSTGRES_USER=${testDatabaseUser}`,
    "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", `POSTGRES_DB=${testDatabaseName}`,
    "--publish", "127.0.0.1::5432",
    "postgres:17",
  ], { cwd: projectRoot, encoding: "utf8" });
  if (startResult.error || startResult.status !== 0) {
    const detail = startResult.error?.message ?? startResult.stderr.trim();
    throw new Error(`No se pudo iniciar PostgreSQL temporal (${detail}). Inicia Docker o configura TEST_DATABASE_URL con una base exclusiva de pruebas.`);
  }

  try {
    const portMapping = capture("docker", ["port", containerName, "5432/tcp"]);
    const portMatch = portMapping.match(/:(\d+)\s*$/);
    if (!portMatch) throw new Error("No se pudo detectar el puerto del PostgreSQL temporal.");

    await waitForPostgres(containerName);
    return {
      containerName,
      databaseUrl: `postgresql://${testDatabaseUser}:${password}@127.0.0.1:${portMatch[1]}/${testDatabaseName}`,
    };
  } catch (error) {
    spawnSync("docker", ["stop", containerName], { cwd: projectRoot, stdio: "ignore" });
    throw error;
  }
}

async function main(): Promise<void> {
  const configuredTestUrl = rel01Mode
    ? process.env.REL01_DATABASE_URL
    : process.env.TEST_DATABASE_URL;
  const developmentUrl = configuredDevelopmentDatabaseUrl();
  let containerName: string | undefined;

  try {
    let testDatabaseUrl = configuredTestUrl;
    if (testDatabaseUrl) {
      if (developmentUrl && sameDatabase(testDatabaseUrl, developmentUrl)) {
        throw new Error("TEST_DATABASE_URL apunta a la base de desarrollo; configura una base de datos distinta.");
      }
    } else {
      const temporaryDatabase = await createTemporaryDatabase();
      containerName = temporaryDatabase.containerName;
      testDatabaseUrl = temporaryDatabase.databaseUrl;
    }

    const schemaExitCode = pushTestSchema(testDatabaseUrl);
    if (schemaExitCode !== 0) {
      process.exitCode = schemaExitCode;
      return;
    }

    const command = rel01Mode
      ? [
        path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js"),
        "test",
        "--config=tests/rel01/playwright.config.mjs",
      ]
      : [tsxCliPath, "--test", ...testFiles];
    const rel01Environment = rel01Mode
      ? {
        DATABASE_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        APP_URL: "http://127.0.0.1:4186",
        SESSION_SECRET: "rel01-isolated-browser-session-secret-2026",
        NODE_ENV: "development",
        PORT: "4186",
        REQUEST_LOGGING_ENABLED: "false",
        REGISTRATION_ENABLED: "true",
      }
      : {};
    process.exitCode = run(process.execPath, command, {
      ...process.env,
      TEST_DATABASE_URL: testDatabaseUrl,
      ...rel01Environment,
    });
  } finally {
    if (containerName) {
      const stopResult = spawnSync("docker", ["stop", containerName], {
        cwd: projectRoot,
        stdio: "inherit",
      });
      if (stopResult.error || stopResult.status !== 0) {
        console.error(`No se pudo detener el contenedor temporal ${containerName}.`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
