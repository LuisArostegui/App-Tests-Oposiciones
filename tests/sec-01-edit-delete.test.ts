import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import express from "express";
import session from "express-session";
import { createServer, type Server } from "node:http";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must point to an isolated test database");
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("Tests must not use DATABASE_URL");
}
process.env.DATABASE_URL = testDatabaseUrl;

const [{ registerRoutes }, { storage }, { db }, { passport }, schema] = await Promise.all([
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
let questionId: number;
let attemptId: number;
let testSuffix: string;
const creationQuestionIds: number[] = [];
const creationAttemptIds: number[] = [];
const creationResultIds: number[] = [];
let ownerSecondQuestionId: number;
let ownerOtherTestQuestionId: number;
let foreignQuestionId: number;

before(async () => {
  testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = await storage.createUser({ username: `sec01-owner-${testSuffix}`, password: "test-only" });
  const otherUser = await storage.createUser({ username: `sec01-other-${testSuffix}`, password: "test-only" });
  ownerId = owner.id;
  otherUserId = otherUser.id;

  const question = await storage.createQuestion(ownerId, {
    testId: `sec01-${testSuffix}.json`,
    questionText: "Pregunta ficticia original",
    answers: { A: "Respuesta A", B: "Respuesta B" },
    correctAnswer: "A",
    category: "Fixture de pruebas",
  });
  questionId = question.id;

  for (const fixture of [
    { testId: `sec01-${testSuffix}.json`, userId: ownerId },
    { testId: `sec01-other-${testSuffix}.json`, userId: ownerId },
    { testId: `sec01-foreign-${testSuffix}.json`, userId: otherUserId },
  ]) {
    const created = await storage.createQuestion(fixture.userId, {
      testId: fixture.testId,
      questionText: "Pregunta ficticia para creación",
      answers: { A: "Respuesta A", B: "Respuesta B" },
      correctAnswer: "A",
      category: "Fixture de pruebas",
    });
    creationQuestionIds.push(created.id);
  }
  [ownerSecondQuestionId, ownerOtherTestQuestionId, foreignQuestionId] = creationQuestionIds;

  const attempt = await storage.createAttempt({
    testId: `sec01-${testSuffix}.json`,
    questionOrder: [questionId],
    userId: ownerId,
  });
  assert.ok(attempt);
  attemptId = attempt.id;

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "sec01-test-only-session-secret", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/__test/session/:userId", (req, res, next) => {
    const sessionUserId = Number(req.params.userId);
    const username = sessionUserId === ownerId ? `sec01-owner-${testSuffix}` : `sec01-other-${testSuffix}`;
    req.login({ id: sessionUserId, username }, (error) => {
      if (error) return next(error);
      res.sendStatus(204);
    });
  });
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  for (const id of creationAttemptIds) await db.delete(schema.testAttempts).where(eq(schema.testAttempts.id, id));
  for (const id of creationResultIds) await db.delete(schema.results).where(eq(schema.results.id, id));
  for (const id of creationQuestionIds) await db.delete(schema.questions).where(eq(schema.questions.id, id));
  if (questionId) await db.delete(schema.questions).where(eq(schema.questions.id, questionId));
  if (attemptId) await db.delete(schema.testAttempts).where(eq(schema.testAttempts.id, attemptId));
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

async function readQuestion() {
  const [question] = await db.select().from(schema.questions).where(eq(schema.questions.id, questionId));
  return question;
}

async function readAttempt() {
  const [attempt] = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.id, attemptId));
  return attempt;
}

test("SEC-01: question and attempt edits and deletes enforce ownership and preserve protected fields", async () => {
  const originalQuestion = await readQuestion();
  const originalAttempt = await readAttempt();
  assert.ok(originalQuestion);
  assert.ok(originalAttempt);

  const ownerQuestionUpdate = await request(`/api/questions/${questionId}`, {
    method: "PUT",
    body: JSON.stringify({
      questionText: "Pregunta ficticia editada",
      answers: { A: "Respuesta A editada", B: "Respuesta B" },
    }),
  }, ownerId);
  assert.equal(ownerQuestionUpdate.status, 200);
  const questionAfterOwnerUpdate = await readQuestion();
  assert.deepEqual(questionAfterOwnerUpdate?.answers, { A: "Respuesta A editada", B: "Respuesta B" });

  const ownerAttemptUpdate = await request(`/api/attempts/${attemptId}`, {
    method: "PUT",
    body: JSON.stringify({ currentIndex: 1 }),
  }, ownerId);
  assert.equal(ownerAttemptUpdate.status, 200);

  const protectedQuestionUpdate = await request(`/api/questions/${questionId}`, {
    method: "PUT",
    body: JSON.stringify({ userId: otherUserId, id: questionId + 9000, questionText: "Intento de reasignación" }),
  }, ownerId);
  assert.equal(protectedQuestionUpdate.status, 400);

  const protectedTestIdUpdate = await request(`/api/questions/${questionId}`, {
    method: "PUT",
    body: JSON.stringify({ testId: "sec01-otro-test.json" }),
  }, ownerId);
  assert.equal(protectedTestIdUpdate.status, 400);
  const questionAfterProtectedUpdate = await readQuestion();
  assert.equal(questionAfterProtectedUpdate?.userId, ownerId);
  assert.equal(questionAfterProtectedUpdate?.id, questionId);
  assert.equal(questionAfterProtectedUpdate?.testId, `sec01-${testSuffix}.json`);
  assert.equal(questionAfterProtectedUpdate?.questionText, "Pregunta ficticia editada");
  assert.deepEqual(questionAfterProtectedUpdate?.answers, { A: "Respuesta A editada", B: "Respuesta B" });

  const loggedValidationErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => loggedValidationErrors.push(args);
  let protectedAttemptUpdate: Response;
  try {
    protectedAttemptUpdate = await request(`/api/attempts/${attemptId}`, {
      method: "PUT",
      body: JSON.stringify({
        userId: otherUserId,
        id: attemptId + 9000,
        testId: "sec01-otro-test.json",
        questionOrder: [],
        startedAt: "2000-01-01T00:00:00.000Z",
        currentIndex: 2,
      }),
    }, ownerId);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(protectedAttemptUpdate.status, 400);
  assert.equal(loggedValidationErrors.length, 0);
  const attemptAfterProtectedUpdate = await readAttempt();
  assert.equal(attemptAfterProtectedUpdate?.userId, ownerId);
  assert.equal(attemptAfterProtectedUpdate?.id, attemptId);
  assert.equal(attemptAfterProtectedUpdate?.testId, originalAttempt.testId);
  assert.deepEqual(attemptAfterProtectedUpdate?.questionOrder, originalAttempt.questionOrder);
  assert.equal(attemptAfterProtectedUpdate?.currentIndex, 1);

  for (const resource of ["questions", "attempts"] as const) {
    const id = resource === "questions" ? questionId : attemptId;
    const path = `/api/${resource}/${id}`;
    const updateBody = resource === "questions" ? { questionText: "Cambio ajeno" } : { currentIndex: 2 };
    const foreignUpdate = await request(path, { method: "PUT", body: JSON.stringify(updateBody) }, otherUserId);
    assert.equal(foreignUpdate.status, 404);
    const foreignDelete = await request(path, { method: "DELETE" }, otherUserId);
    assert.equal(foreignDelete.status, 404);
    const missingUpdate = await request(`/api/${resource}/2147483000`, { method: "PUT", body: JSON.stringify(updateBody) }, ownerId);
    assert.equal(missingUpdate.status, 404);
    const missingDelete = await request(`/api/${resource}/2147483000`, { method: "DELETE" }, ownerId);
    assert.equal(missingDelete.status, 404);
    assert.equal((await request(path, { method: "PUT", body: JSON.stringify(updateBody) })).status, 401);
    assert.equal((await request(path, { method: "DELETE" })).status, 401);
  }

  const unchangedQuestion = await readQuestion();
  const unchangedAttempt = await readAttempt();
  assert.equal(unchangedQuestion?.userId, ownerId);
  assert.equal(unchangedQuestion?.questionText, "Pregunta ficticia editada");
  assert.equal(unchangedAttempt?.userId, ownerId);
  assert.equal(unchangedAttempt?.currentIndex, 1);

  assert.equal((await request(`/api/questions/${questionId}`, { method: "DELETE" }, ownerId)).status, 204);
  assert.equal((await readQuestion()), undefined);
  assert.equal((await request(`/api/attempts/${attemptId}`, { method: "DELETE" }, ownerId)).status, 204);
  assert.equal((await readAttempt()), undefined);
});


test("SEC-01: owner can create an attempt with their test questions in the original order", async () => {
  const testId = `sec01-${testSuffix}.json`;
  // The original edit/delete case removes questionId, so use a dedicated second fixture.
  const additional = await storage.createQuestion(ownerId, {
    testId, questionText: "Otra pregunta ficticia",
    answers: { A: "Respuesta A", B: "Respuesta B" }, correctAnswer: "A", category: "Fixture de pruebas",
  });
  creationQuestionIds.push(additional.id);
  const order = [additional.id, ownerSecondQuestionId];
  const response = await request("/api/attempts", {
    method: "POST", body: JSON.stringify({ testId, questionOrder: order }),
  }, ownerId);
  assert.equal(response.status, 201);
  const body: { id: number } = await response.json();
  creationAttemptIds.push(body.id);
  const [attempt] = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.id, body.id));
  assert.ok(attempt);
  assert.equal(attempt.userId, ownerId);
  assert.equal(attempt.testId, testId);
  assert.deepEqual(attempt.questionOrder, order);
  assert.equal(attempt.totalQuestions, 2);
});

test("SEC-01: attempt creation requires a session and leaves attempts unchanged", async () => {
  const beforeAttempts = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.userId, ownerId));
  const response = await request("/api/attempts", {
    method: "POST", body: JSON.stringify({ testId: `sec01-${testSuffix}.json`, questionOrder: [ownerSecondQuestionId] }),
  });
  assert.equal(response.status, 401);
  const afterAttempts = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.userId, ownerId));
  assert.deepEqual(afterAttempts, beforeAttempts);
});

test("SEC-01: client cannot supply the persisted question count", async () => {
  const beforeAttempts = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.userId, ownerId));
  const response = await request("/api/attempts", {
    method: "POST", body: JSON.stringify({
      testId: `sec01-${testSuffix}.json`, questionOrder: [ownerSecondQuestionId], totalQuestions: 999,
    }),
  }, ownerId);
  if (response.status === 201) {
    const body: { id: number } = await response.json();
    creationAttemptIds.push(body.id);
  }
  assert.equal(response.status, 400);
  const afterAttempts = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.userId, ownerId));
  assert.deepEqual(afterAttempts, beforeAttempts);
});

test("SEC-01: question and result creation reject client-supplied owners and persist the session owner", async () => {
  const questionTestId = `sec01-created-question-${testSuffix}.json`;
  const questionPayload = {
    testId: questionTestId,
    questionText: "Pregunta ficticia de creación",
    answers: { A: "Respuesta A" },
    correctAnswer: "A",
    category: "Fixture de pruebas",
  };
  const questionsBefore = await db.select().from(schema.questions).where(eq(schema.questions.testId, questionTestId));
  const spoofedQuestion = await request("/api/questions", {
    method: "POST", body: JSON.stringify({ ...questionPayload, userId: otherUserId }),
  }, ownerId);
  assert.equal(spoofedQuestion.status, 400);
  assert.deepEqual(await db.select().from(schema.questions).where(eq(schema.questions.testId, questionTestId)), questionsBefore);

  const createdQuestionResponse = await request("/api/questions", {
    method: "POST", body: JSON.stringify(questionPayload),
  }, ownerId);
  assert.equal(createdQuestionResponse.status, 201);
  const createdQuestion: { id: number; userId: number } = await createdQuestionResponse.json();
  creationQuestionIds.push(createdQuestion.id);
  assert.equal(createdQuestion.userId, ownerId);
  const [persistedQuestion] = await db.select().from(schema.questions).where(eq(schema.questions.id, createdQuestion.id));
  assert.equal(persistedQuestion?.userId, ownerId);

  const importedTestId = `sec01-imported-${testSuffix}.json`;
  const imported = await request("/api/tests/import", {
    method: "POST",
    body: JSON.stringify({
      filename: importedTestId,
      content: [{ pregunta: "Pregunta importada", respuestas: { A: "Respuesta A" }, respuesta_correcta: "A", userId: otherUserId }],
    }),
  }, ownerId);
  assert.equal(imported.status, 201);
  const [persistedImport] = await db.select().from(schema.questions).where(eq(schema.questions.testId, importedTestId));
  assert.ok(persistedImport);
  creationQuestionIds.push(persistedImport.id);
  assert.equal(persistedImport.userId, ownerId);

  const resultPayload = { testId: questionTestId, score: 80, correctCount: 4, totalQuestions: 5 };
  const resultsBefore = await db.select().from(schema.results).where(eq(schema.results.testId, questionTestId));
  const spoofedResult = await request("/api/results", {
    method: "POST", body: JSON.stringify({ ...resultPayload, userId: otherUserId }),
  }, ownerId);
  assert.equal(spoofedResult.status, 400);
  assert.deepEqual(await db.select().from(schema.results).where(eq(schema.results.testId, questionTestId)), resultsBefore);

  const createdResultResponse = await request("/api/results", {
    method: "POST", body: JSON.stringify(resultPayload),
  }, ownerId);
  assert.equal(createdResultResponse.status, 201);
  const createdResult: { id: number; userId: number } = await createdResultResponse.json();
  creationResultIds.push(createdResult.id);
  assert.equal(createdResult.userId, ownerId);
  const [persistedResult] = await db.select().from(schema.results).where(eq(schema.results.id, createdResult.id));
  assert.equal(persistedResult?.userId, ownerId);
});

for (const invalid of [
  { name: "foreign test", input: () => ({ testId: `sec01-foreign-${testSuffix}.json`, questionOrder: [foreignQuestionId] }) },
  { name: "foreign question", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [foreignQuestionId] }) },
  { name: "question from another owner test", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [ownerOtherTestQuestionId] }) },
  { name: "nonexistent question", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [2147483000] }) },
  { name: "duplicate questions", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [ownerSecondQuestionId, ownerSecondQuestionId] }) },
  { name: "zero question ID", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [0] }) },
  { name: "negative question ID", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [-1] }) },
  { name: "fractional question ID", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [1.5] }) },
  { name: "empty question order", input: () => ({ testId: `sec01-${testSuffix}.json`, questionOrder: [] }) },
]) {
  test(`SEC-01: storage rejects ${invalid.name} without inserting an attempt`, async () => {
    const beforeAttempts = await db.select().from(schema.testAttempts);
    const result = await storage.createAttempt({ ...invalid.input(), userId: ownerId });
    assert.equal(result, undefined);
    const afterAttempts = await db.select().from(schema.testAttempts);
    assert.deepEqual(afterAttempts, beforeAttempts);
  });

  test(`SEC-01: attempt creation rejects ${invalid.name} without changing attempts`, async () => {
    const beforeAttempts = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.userId, ownerId));
    const response = await request("/api/attempts", {
      method: "POST", body: JSON.stringify(invalid.input()),
    }, ownerId);
    if (response.status === 201) {
      const body: { id: number } = await response.json();
      creationAttemptIds.push(body.id);
    }
    const afterAttempts = await db.select().from(schema.testAttempts).where(eq(schema.testAttempts.userId, ownerId));
    assert.equal(response.status, 400);
    assert.deepEqual(afterAttempts, beforeAttempts);
  });
}
