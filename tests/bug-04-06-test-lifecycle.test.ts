import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";
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
const userIds: number[] = [];

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = await storage.createUser({ username: `bug0406-owner-${suffix}`, password: "test-only" });
  const other = await storage.createUser({ username: `bug0406-other-${suffix}`, password: "test-only" });
  ownerId = owner.id;
  otherUserId = other.id;
  userIds.push(ownerId, otherUserId);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "bug-04-06-test-only-session-secret", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/__test/session/:userId", (req, res, next) => {
    const id = Number(req.params.userId);
    const username = id === ownerId ? "bug0406-owner" : "bug0406-other";
    req.login({ id, username }, (error) => error ? next(error) : res.sendStatus(204));
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
  if (userIds.length) {
    await db.delete(schema.results).where(inArray(schema.results.userId, userIds));
    await db.delete(schema.testAttempts).where(inArray(schema.testAttempts.userId, userIds));
    await db.delete(schema.questions).where(inArray(schema.questions.userId, userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }
  await pool.end();
});

function uniqueTestId(label: string): string {
  return `bug0406-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

async function addTest(userId: number, testId: string, count = 2): Promise<number[]> {
  const questions = Array.from({ length: count }, (_, index) => ({
    testId,
    questionText: `Pregunta ${index + 1}`,
    answers: { A: "Sí", B: "No" },
    correctAnswer: "A",
    category: "Fixture",
  }));
  await storage.createQuestions(userId, questions);
  return (await storage.getQuestionsByTestId(testId, userId)).map((question) => question.id);
}

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

async function createAttempt(userId: number, testId: string, questionOrder: number[]): Promise<number> {
  const attempt = await storage.createAttempt({ userId, testId, questionOrder });
  assert.ok(attempt);
  return attempt.id;
}

async function finalize(userId: number, attemptId: number, questionId: number): Promise<void> {
  const response = await request(`/api/attempts/${attemptId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ answers: { [questionId]: "A" } }),
  }, userId);
  assert.equal(response.status, 200);
}

test("BUG-04/06: rename moves open attempts and linked result history atomically and keeps the attempt resumable", async () => {
  const oldId = uniqueTestId("rename");
  const newId = uniqueTestId("renamed");
  const questionIds = await addTest(ownerId, oldId);
  const completedAttemptId = await createAttempt(ownerId, oldId, [questionIds[0]]);
  const openAttemptId = await createAttempt(ownerId, oldId, questionIds);
  await finalize(ownerId, completedAttemptId, questionIds[0]);
  const [oldResult] = await (await import("../server/db")).db.select().from(schema.results)
    .where(inArray(schema.results.userId, [ownerId]));
  assert.equal(oldResult?.attemptId, completedAttemptId);

  const rename = await request(`/api/tests/${encodeURIComponent(oldId)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: newId }),
  }, ownerId);
  assert.equal(rename.status, 200);
  assert.deepEqual(await storage.getQuestionsByTestId(oldId, ownerId), []);
  assert.equal((await storage.getQuestionsByTestId(newId, ownerId)).length, 2);

  const openAttempt = await storage.getAttempt(openAttemptId, ownerId);
  const completedAttempt = await storage.getAttempt(completedAttemptId, ownerId);
  const results = await storage.getResults(ownerId);
  const linkedResult = results.find((result) => result.attemptId === completedAttemptId);
  assert.equal(openAttempt?.testId, newId);
  assert.equal(completedAttempt?.testId, newId);
  assert.equal(linkedResult?.testId, newId);
  assert.equal(linkedResult?.attemptId, completedAttemptId);

  const resumed = await request(`/api/attempts/${openAttemptId}`, {}, ownerId);
  assert.equal(resumed.status, 200);
  const finish = await request(`/api/attempts/${openAttemptId}/finalize`, {
    method: "POST", body: JSON.stringify({ answers: { [questionIds[0]]: "A" } }),
  }, ownerId);
  assert.equal(finish.status, 200);
});

test("BUG-04: name collision rejects a rename without partial changes and is scoped to the owner", async () => {
  const sourceId = uniqueTestId("collision-source");
  const duplicateId = uniqueTestId("collision-target");
  const sourceQuestionIds = await addTest(ownerId, sourceId);
  const duplicateQuestionIds = await addTest(ownerId, duplicateId);
  await addTest(otherUserId, duplicateId, 1);
  const attemptId = await createAttempt(ownerId, sourceId, [sourceQuestionIds[0]]);

  const response = await request(`/api/tests/${encodeURIComponent(sourceId)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: duplicateId }),
  }, ownerId);
  assert.equal(response.status, 409);
  assert.equal((await storage.getQuestionsByTestId(sourceId, ownerId)).length, sourceQuestionIds.length);
  assert.deepEqual((await storage.getQuestionsByTestId(duplicateId, ownerId)).map((question) => question.id), duplicateQuestionIds);
  assert.equal((await storage.getAttempt(attemptId, ownerId))?.testId, sourceId);
  assert.equal((await storage.getQuestionsByTestId(duplicateId, otherUserId)).length, 1);
});

test("BUG-04: users with the same test name keep questions, attempts, and results isolated when one renames", async () => {
  const sharedId = uniqueTestId("same-name");
  const ownerQuestions = await addTest(ownerId, sharedId, 1);
  const otherQuestions = await addTest(otherUserId, sharedId, 1);
  const ownerAttemptId = await createAttempt(ownerId, sharedId, ownerQuestions);
  const otherAttemptId = await createAttempt(otherUserId, sharedId, otherQuestions);
  await finalize(ownerId, ownerAttemptId, ownerQuestions[0]);
  await finalize(otherUserId, otherAttemptId, otherQuestions[0]);

  const renamedId = uniqueTestId("same-name-renamed");
  const response = await request(`/api/tests/${encodeURIComponent(sharedId)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: renamedId }),
  }, ownerId);
  assert.equal(response.status, 200);
  assert.equal((await storage.getQuestionsByTestId(renamedId, ownerId)).length, 1);
  assert.equal((await storage.getQuestionsByTestId(sharedId, otherUserId)).length, 1);
  assert.equal((await storage.getAttempt(ownerAttemptId, ownerId))?.testId, renamedId);
  assert.equal((await storage.getAttempt(otherAttemptId, otherUserId))?.testId, sharedId);
  assert.equal((await storage.getResults(ownerId)).find((result) => result.attemptId === ownerAttemptId)?.testId, renamedId);
  assert.equal((await storage.getResults(otherUserId)).find((result) => result.attemptId === otherAttemptId)?.testId, sharedId);
});

test("BUG-04/06: deleting a test with an open attempt returns 409 and leaves its data unchanged", async () => {
  const testId = uniqueTestId("delete-open");
  const questionIds = await addTest(ownerId, testId);
  const attemptId = await createAttempt(ownerId, testId, questionIds);

  const response = await request(`/api/tests/${encodeURIComponent(testId)}`, { method: "DELETE" }, ownerId);
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /intentos abiertos|finalízalos|elimínalos/i);
  assert.equal((await storage.getQuestionsByTestId(testId, ownerId)).length, questionIds.length);
  assert.equal((await storage.getAttempt(attemptId, ownerId))?.status, "in_progress");
  assert.equal((await request(`/api/tests/${encodeURIComponent(testId)}`, { method: "DELETE" }, otherUserId)).status, 404);
});

test("BUG-04/06: deleting a completed test preserves attempts, linked results, and result access", async () => {
  const testId = uniqueTestId("delete-completed");
  const questionIds = await addTest(ownerId, testId, 1);
  const attemptId = await createAttempt(ownerId, testId, questionIds);
  await finalize(ownerId, attemptId, questionIds[0]);

  const response = await request(`/api/tests/${encodeURIComponent(testId)}`, { method: "DELETE" }, ownerId);
  assert.equal(response.status, 204);
  assert.deepEqual(await storage.getQuestionsByTestId(testId, ownerId), []);
  assert.equal((await storage.getAttempt(attemptId, ownerId))?.status, "completed");
  const resultsResponse = await request("/api/results", {}, ownerId);
  assert.equal(resultsResponse.status, 200);
  const results = await resultsResponse.json() as Array<{ testId: string; attemptId: number }>;
  assert.ok(results.some((result) => result.testId === testId && result.attemptId === attemptId));
  assert.equal((await request(`/api/tests/${encodeURIComponent(testId)}`, {}, ownerId)).status, 404);
});

test("BUG-04/06: concurrent delete and attempt creation cannot leave an open attempt without questions", async () => {
  const testId = uniqueTestId("delete-race");
  const questionIds = await addTest(ownerId, testId, 1);
  const [deleteResponse, attemptResponse] = await Promise.all([
    request(`/api/tests/${encodeURIComponent(testId)}`, { method: "DELETE" }, ownerId),
    request("/api/attempts", {
      method: "POST", body: JSON.stringify({ testId, questionOrder: questionIds }),
    }, ownerId),
  ]);

  const questions = await storage.getQuestionsByTestId(testId, ownerId);
  const attempts = await storage.getAttempts(ownerId);
  const openAttempts = attempts.filter((attempt) => attempt.testId === testId && attempt.status === "in_progress");
  if (deleteResponse.status === 204) {
    assert.notEqual(attemptResponse.status, 201);
    assert.deepEqual(questions, []);
    assert.deepEqual(openAttempts, []);
  } else {
    assert.equal(deleteResponse.status, 409);
    assert.equal(attemptResponse.status, 201);
    assert.equal(questions.length, 1);
    assert.equal(openAttempts.length, 1);
  }
});

test("BUG-04: concurrent rename and import keep each imported question wholly in one test identity", async () => {
  const oldId = uniqueTestId("import-race-old");
  const newId = uniqueTestId("import-race-new");
  const existingQuestionIds = await addTest(ownerId, oldId, 2);
  const importRequest = request("/api/tests/import", {
    method: "POST",
    body: JSON.stringify({ filename: oldId, content: [
      { pregunta: "Importada A", respuestas: { A: "Sí", B: "No" }, respuesta_correcta: "A" },
      { pregunta: "Importada B", respuestas: { A: "Sí", B: "No" }, respuesta_correcta: "A" },
    ] }),
  }, ownerId);
  const renameRequest = request(`/api/tests/${encodeURIComponent(oldId)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: newId }),
  }, ownerId);
  const [importResponse, renameResponse] = await Promise.all([importRequest, renameRequest]);
  assert.equal(importResponse.status, 201);
  assert.equal(renameResponse.status, 200);

  const oldQuestions = await storage.getQuestionsByTestId(oldId, ownerId);
  const newQuestions = await storage.getQuestionsByTestId(newId, ownerId);
  const originalQuestions = [...oldQuestions, ...newQuestions].filter((question) => existingQuestionIds.includes(question.id));
  assert.equal(originalQuestions.length, existingQuestionIds.length);
  assert.ok(oldQuestions.length === 0 || oldQuestions.length === 2);
  assert.ok(newQuestions.length === 2 || newQuestions.length === 4);
  assert.equal(oldQuestions.length + newQuestions.length, 4);
  assert.equal(new Set([...oldQuestions, ...newQuestions].map((question) => question.userId)).size, 1);
});

test("BUG-04/06: concurrent rename and finalization use one lock order and preserve the complete result", async () => {
  const oldId = uniqueTestId("rename-finalize-old");
  const newId = uniqueTestId("rename-finalize-new");
  const questionIds = await addTest(ownerId, oldId, 2);
  const attemptId = await createAttempt(ownerId, oldId, questionIds);

  let signalQuestionsLocked!: () => void;
  let releaseQuestions!: () => void;
  const questionsLocked = new Promise<void>((resolve) => { signalQuestionsLocked = resolve; });
  const releaseBlocker = new Promise<void>((resolve) => { releaseQuestions = resolve; });
  const blocker = (async () => db.transaction(async (tx) => {
    await tx.select({ id: schema.questions.id }).from(schema.questions).where(
      inArray(schema.questions.id, questionIds),
    ).for("update");
    signalQuestionsLocked();
    await releaseBlocker;
  }))();

  async function waitForLockWaiters(minimum: number, pattern: "questions" | "either", timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const waiting = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock'
           AND ${pattern === "questions"
             ? "query ILIKE '%questions%'"
             : "(query ILIKE '%questions%' OR query ILIKE '%users%')"}`,
      );
      if (Number(waiting.rows[0]?.count) >= minimum) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Expected ${minimum} PostgreSQL lock waiter(s) matching ${pattern}`);
  }

  try {
    await questionsLocked;

    const rename = request(`/api/tests/${encodeURIComponent(oldId)}/rename`, {
      method: "PUT", body: JSON.stringify({ newName: newId }),
    }, ownerId);
    await waitForLockWaiters(1, "questions");

    const finalizeResponse = request(`/api/attempts/${attemptId}/finalize`, {
      method: "POST", body: JSON.stringify({ answers: { [questionIds[0]]: "A", [questionIds[1]]: "A" } }),
    }, ownerId);
    await waitForLockWaiters(2, "either");

    releaseQuestions();
    const [renameResult, finalizeResult] = await Promise.all([rename, finalizeResponse]);
    assert.equal(renameResult.status, 200);
    assert.equal(finalizeResult.status, 200, await finalizeResult.text());

    const renamedQuestions = await storage.getQuestionsByTestId(newId, ownerId);
    const completedAttempt = await storage.getAttempt(attemptId, ownerId);
    const linkedResult = (await storage.getResults(ownerId)).find((result) => result.attemptId === attemptId);
    assert.deepEqual(renamedQuestions.map((question) => question.id).sort(), [...questionIds].sort());
    assert.equal(await storage.getQuestionsByTestId(oldId, ownerId).then((questions) => questions.length), 0);
    assert.equal(completedAttempt?.testId, newId);
    assert.equal(completedAttempt?.status, "completed");
    assert.deepEqual(completedAttempt?.questionOrder, questionIds);
    assert.equal(linkedResult?.testId, newId);
    assert.equal(linkedResult?.attemptId, attemptId);
    assert.equal(linkedResult?.totalQuestions, questionIds.length);
    assert.equal(linkedResult?.correctCount, questionIds.length);
  } finally {
    releaseQuestions();
    await blocker;
  }
});
