import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import session from "express-session";
import { createServer, type Server } from "node:http";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL must point to an isolated test database");
if (testDatabaseUrl === process.env.DATABASE_URL) throw new Error("Tests must not use DATABASE_URL");
process.env.DATABASE_URL = testDatabaseUrl;

const [{ registerRoutes }, { storage }, { db, pool }, { passport }, schema] = await Promise.all([
  import("../server/routes"),
  import("../server/storage"),
  import("../server/db"),
  import("../server/auth"),
  import("../shared/schema"),
]);

let server: Server;
let baseUrl: string;
let ownerId: number;
let otherUserId: number;
let attemptId: number;
let foreignAttemptId: number;
let testId: string;
let firstQuestionId: number;
let secondQuestionId: number;
let foreignQuestionId: number;
const questionIds: number[] = [];
const attemptIds: number[] = [];

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  testId = `bug-02-03-${suffix}.json`;
  const owner = await storage.createUser({ username: `bug0203-owner-${suffix}`, password: "test-only" });
  const other = await storage.createUser({ username: `bug0203-other-${suffix}`, password: "test-only" });
  ownerId = owner.id;
  otherUserId = other.id;

  const firstQuestion = await storage.createQuestion(ownerId, {
    testId, questionText: "Pregunta uno", answers: { A: "Correcta", B: "Incorrecta" },
    correctAnswer: "A", category: "Fixture",
  });
  const secondQuestion = await storage.createQuestion(ownerId, {
    testId, questionText: "Pregunta dos", answers: { A: "Incorrecta", B: "Correcta" },
    correctAnswer: "B", category: "Fixture",
  });
  const foreignQuestion = await storage.createQuestion(otherUserId, {
    testId, questionText: "Pregunta ajena", answers: { A: "Correcta" },
    correctAnswer: "A", category: "Fixture",
  });
  firstQuestionId = firstQuestion.id;
  secondQuestionId = secondQuestion.id;
  foreignQuestionId = foreignQuestion.id;
  questionIds.push(firstQuestionId, secondQuestionId, foreignQuestionId);

  const attempt = await storage.createAttempt({ testId, questionOrder: [firstQuestionId, secondQuestionId], userId: ownerId });
  const foreignAttempt = await storage.createAttempt({ testId, questionOrder: [foreignQuestionId], userId: otherUserId });
  assert.ok(attempt);
  assert.ok(foreignAttempt);
  attemptId = attempt.id;
  foreignAttemptId = foreignAttempt.id;
  attemptIds.push(attemptId, foreignAttemptId);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "bug-02-03-test-only-session-secret", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/__test/session/:userId", (req, res, next) => {
    const sessionUserId = Number(req.params.userId);
    const username = sessionUserId === ownerId ? `bug0203-owner-${suffix}` : `bug0203-other-${suffix}`;
    req.login({ id: sessionUserId, username }, (error) => error ? next(error) : res.sendStatus(204));
  });
  server = createServer(app);
  await registerRoutes(server, app);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal error" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (attemptIds.length) await db.delete(schema.results).where(inArray(schema.results.attemptId, attemptIds));
  for (const id of attemptIds) await db.delete(schema.testAttempts).where(eq(schema.testAttempts.id, id));
  for (const id of questionIds) await db.delete(schema.questions).where(eq(schema.questions.id, id));
  if (ownerId) await db.delete(schema.users).where(eq(schema.users.id, ownerId));
  if (otherUserId) await db.delete(schema.users).where(eq(schema.users.id, otherUserId));
  const { pool } = await import("../server/db");
  await pool.end();
});

async function request(path: string, options: RequestInit = {}, sessionUserId?: number): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (sessionUserId !== undefined) {
    const sessionResponse = await fetch(`${baseUrl}/__test/session/${sessionUserId}`, { method: "POST" });
    assert.equal(sessionResponse.status, 204);
    const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    headers.set("cookie", cookie);
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function readAttempt(id = attemptId) {
  const [attempt] = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.id, id));
  return attempt;
}

test("BUG-03: finalization requires the owner session and calculates one linked result on the server", async () => {
  const path = `/api/attempts/${attemptId}/finalize`;
  assert.equal((await request(path, { method: "POST", body: JSON.stringify({ answers: {} }) })).status, 401);
  assert.equal((await request(path, { method: "POST", body: JSON.stringify({ answers: {} }) }, otherUserId)).status, 404);

  const response = await request(path, {
    method: "POST",
    body: JSON.stringify({ answers: { [firstQuestionId]: "A", [secondQuestionId]: "A" } }),
  }, ownerId);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.testId, testId);
  assert.equal(result.correctCount, 1);
  assert.equal(result.totalQuestions, 2);
  assert.equal(result.score, 50);
  assert.equal(result.attemptId, attemptId);

  const completed = await readAttempt();
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.correctCount, 1);
  assert.equal(completed?.score, 50);
  assert.deepEqual(completed?.answers, { [firstQuestionId]: "A", [secondQuestionId]: "A" });
});

test("BUG-03: replay after a committed finalization returns the same result without duplicating it", async () => {
  const path = `/api/attempts/${attemptId}/finalize`;
  const payload = { answers: { [firstQuestionId]: "A", [secondQuestionId]: "A" } };
  const first = await request(path, { method: "POST", body: JSON.stringify(payload) }, ownerId);
  const second = await request(path, { method: "POST", body: JSON.stringify(payload) }, ownerId);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).id, (await second.json()).id);
  const linked = await db.select().from(schema.results).where(eq(schema.results.attemptId, attemptId));
  assert.equal(linked.length, 1);
});

test("BUG-03: client scores, answers outside the attempt, and invalid choices are rejected without writes", async () => {
  const [q3] = await db.insert(schema.questions).values({
    testId, questionText: "Pregunta tres", answers: { A: "Correcta" }, correctAnswer: "A", userId: ownerId,
  }).returning();
  questionIds.push(q3.id);
  const attempt = await storage.createAttempt({ testId, questionOrder: [firstQuestionId, secondQuestionId], userId: ownerId });
  assert.ok(attempt);
  attemptIds.push(attempt.id);
  const before = await readAttempt(attempt.id);

  const forgedScore = await request(`/api/attempts/${attempt.id}/finalize`, {
    method: "POST", body: JSON.stringify({ answers: {}, score: 100, correctCount: 2, totalQuestions: 2, completedAt: new Date().toISOString() }),
  }, ownerId);
  assert.equal(forgedScore.status, 400);

  for (const answers of [
    { [q3.id]: "A" },
    { [firstQuestionId]: "X" },
  ]) {
    const response = await request(`/api/attempts/${attempt.id}/finalize`, {
      method: "POST", body: JSON.stringify({ answers }),
    }, ownerId);
    assert.equal(response.status, 409);
  }
  assert.deepEqual(await readAttempt(attempt.id), before);
  assert.equal((await db.select().from(schema.results).where(eq(schema.results.attemptId, attempt.id))).length, 0);
});

test("BUG-03: simultaneous finalization requests create exactly one result", async () => {
  const attempt = await storage.createAttempt({ testId, questionOrder: [firstQuestionId, secondQuestionId], userId: ownerId });
  assert.ok(attempt);
  attemptIds.push(attempt.id);
  const path = `/api/attempts/${attempt.id}/finalize`;
  const options = { method: "POST", body: JSON.stringify({ answers: { [firstQuestionId]: "A" } }) };
  const [first, second] = await Promise.all([request(path, options, ownerId), request(path, options, ownerId)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).id, (await second.json()).id);
  assert.equal((await db.select().from(schema.results).where(eq(schema.results.attemptId, attempt.id))).length, 1);
});

test("BUG-03: a missing legacy question leaves the in-progress attempt and history untouched", async () => {
  const missingQuestion = await storage.createQuestion(ownerId, {
    testId, questionText: "Pregunta que se eliminará", answers: { A: "Correcta" },
    correctAnswer: "A", category: "Fixture",
  });
  questionIds.push(missingQuestion.id);
  const attempt = await storage.createAttempt({ testId, questionOrder: [missingQuestion.id], userId: ownerId });
  assert.ok(attempt);
  attemptIds.push(attempt.id);
  await db.delete(schema.questions).where(eq(schema.questions.id, missingQuestion.id));

  const response = await request(`/api/attempts/${attempt.id}/finalize`, {
    method: "POST", body: JSON.stringify({ answers: {} }),
  }, ownerId);
  assert.equal(response.status, 409);
  assert.equal((await readAttempt(attempt.id))?.status, "in_progress");
  assert.equal((await db.select().from(schema.results).where(eq(schema.results.attemptId, attempt.id))).length, 0);
});

test("BUG-03: a database failure during result insertion rolls back attempt completion", async () => {
  const attempt = await storage.createAttempt({ testId, questionOrder: [firstQuestionId], userId: ownerId });
  assert.ok(attempt);
  attemptIds.push(attempt.id);
  await pool.query(`
    CREATE OR REPLACE FUNCTION bug0203_reject_result_insert() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'fixture forces result insert rollback'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER bug0203_reject_result_insert
      BEFORE INSERT ON results FOR EACH ROW WHEN (NEW.attempt_id = ${attempt.id})
      EXECUTE FUNCTION bug0203_reject_result_insert();
  `);
  try {
    const response = await request(`/api/attempts/${attempt.id}/finalize`, {
      method: "POST", body: JSON.stringify({ answers: { [firstQuestionId]: "A" } }),
    }, ownerId);
    assert.equal(response.status, 500);
    assert.equal((await readAttempt(attempt.id))?.status, "in_progress");
    assert.equal((await db.select().from(schema.results).where(eq(schema.results.attemptId, attempt.id))).length, 0);
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS bug0203_reject_result_insert ON results");
    await pool.query("DROP FUNCTION IF EXISTS bug0203_reject_result_insert()");
  }
});

test("BUG-03: the migration is atomic, preserves historical results, and enforces new attempt links", async () => {
  const client = await pool.connect();
  const schemaName = `bug0203_migration_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    await client.query(`CREATE SCHEMA ${schemaName}`);
    await client.query(`SET search_path TO ${schemaName}`);
    await client.query("CREATE TABLE test_attempts (id serial PRIMARY KEY)");
    await client.query(`
      CREATE TABLE results (
        id serial PRIMARY KEY,
        test_id text NOT NULL,
        score integer NOT NULL,
        correct_count integer NOT NULL,
        total_questions integer NOT NULL,
        completed_at timestamp DEFAULT now(),
        user_id integer
      )
    `);
    await client.query("INSERT INTO results (test_id, score, correct_count, total_questions) VALUES ('legacy.json', 80, 4, 5)");

    const migration = await readFile(fileURLToPath(new URL("../migrations/20261028_attempt_result_link.sql", import.meta.url)), "utf8");
    assert.match(migration, /^BEGIN;\s*$/m);
    assert.match(migration, /\nCOMMIT;\s*$/);
    await client.query("CREATE INDEX results_attempt_id_unique ON test_attempts (id)");
    await assert.rejects(client.query(migration), /already exists/i);
    await client.query("ROLLBACK");
    const rolledBackColumn = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'results'
        AND column_name = 'attempt_id'
    `);
    assert.equal(rolledBackColumn.rowCount, 0);
    await client.query("DROP INDEX results_attempt_id_unique");
    await client.query(migration);
    const legacy = await client.query("SELECT attempt_id FROM results WHERE test_id = 'legacy.json'");
    assert.equal(legacy.rows[0].attempt_id, null);

    const { rows: [attempt] } = await client.query("INSERT INTO test_attempts DEFAULT VALUES RETURNING id");
    await client.query("INSERT INTO results (test_id, score, correct_count, total_questions, attempt_id) VALUES ('new.json', 100, 1, 1, $1)", [attempt.id]);
    await assert.rejects(
      client.query("INSERT INTO results (test_id, score, correct_count, total_questions, attempt_id) VALUES ('duplicate.json', 100, 1, 1, $1)", [attempt.id]),
      /unique/i,
    );
    await client.query("DELETE FROM test_attempts WHERE id = $1", [attempt.id]);
    const linked = await client.query("SELECT attempt_id FROM results WHERE test_id = 'new.json'");
    assert.equal(linked.rows[0].attempt_id, null);
  } finally {
    await client.query("RESET search_path").catch(() => undefined);
    client.release();
    await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  }
});

test("BUG-03: legacy result creation is unavailable and completed attempts reject answer changes", async () => {
  const path = `/api/attempts/${attemptId}/finalize`;
  const payload = { answers: { [firstQuestionId]: "A", [secondQuestionId]: "A" } };
  const finalized = await request(path, { method: "POST", body: JSON.stringify(payload) }, ownerId);
  assert.equal(finalized.status, 200);

  const oldRoute = await request("/api/results", {
    method: "POST", body: JSON.stringify({ testId, score: 100, correctCount: 2, totalQuestions: 2 }),
  }, ownerId);
  assert.equal(oldRoute.status, 404);

  const mutation = await request(`/api/attempts/${attemptId}`, {
    method: "PUT", body: JSON.stringify({ answers: { [firstQuestionId]: "B" } }),
  }, ownerId);
  assert.equal(mutation.status, 409);
  const unchanged = await readAttempt();
  assert.equal(unchanged?.status, "completed");
  assert.deepEqual(unchanged?.answers, { [firstQuestionId]: "A", [secondQuestionId]: "A" });
});
