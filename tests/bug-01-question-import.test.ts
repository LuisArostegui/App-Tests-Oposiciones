import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import express from "express";
import session from "express-session";
import { createServer, type Server } from "node:http";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl || testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must point to an isolated test database");
}
process.env.DATABASE_URL = testDatabaseUrl;
const [{ registerRoutes }, { storage }, { db, pool }, { passport }, schema] = await Promise.all([
  import("../server/routes"), import("../server/storage"), import("../server/db"),
  import("../server/auth"), import("../shared/schema"),
]);
const [{ importJsonBodyParser }, { apiErrorHandler }, { api }] = await Promise.all([
  import("../server/body-parsers"), import("../server/http-middleware"), import("../shared/routes"),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const usernames = [`bug01-a-${suffix}`, `bug01-b-${suffix}`];
const filename = `bug01-${suffix}.json`;
const questionIds: number[] = [];
const userIds: number[] = [];
let appServer: Server;
let baseUrl: string;

before(async () => {
  for (const username of usernames) {
    const user = await storage.createUser({ username, password: "test-only" });
    userIds.push(user.id);
  }

  const app = express();
  const defaultJsonBodyParser = express.json();
  app.use((req, res, next) => req.method === "POST" && req.path === api.tests.import.path
    ? next()
    : defaultJsonBodyParser(req, res, next));
  app.use(session({ secret: "bug01-test-secret", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post(api.tests.import.path, (req, res, next) => {
    if (req.isAuthenticated()) return next();
    return res.status(401).json({ message: "No autenticado" });
  }, importJsonBodyParser);
  app.post("/__test/session/:user", (req, res, next) => {
    const index = req.params.user === "a" ? 0 : 1;
    req.login({ id: userIds[index], username: usernames[index] }, error => error ? next(error) : res.sendStatus(204));
  });
  appServer = createServer(app);
  await registerRoutes(appServer, app);
  app.use(apiErrorHandler);
  await new Promise<void>(resolve => appServer.listen(0, "127.0.0.1", resolve));
  const address = appServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (appServer?.listening) await new Promise<void>((resolve, reject) => appServer.close(error => error ? reject(error) : resolve()));
  if (questionIds.length) await db.delete(schema.questions).where(inArrayQuestionIds(questionIds));
  for (const userId of userIds) await db.delete(schema.users).where(eq(schema.users.id, userId));
  await pool.end();
});

function inArrayQuestionIds(ids: number[]) {
  return inArray(schema.questions.id, ids);
}

async function request(path: string, options: RequestInit = {}, user: "a" | "b" | null = "a") {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (user) {
    const login = await fetch(`${baseUrl}/__test/session/${user}`, { method: "POST" });
    assert.equal(login.status, 204);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    headers.set("cookie", cookie);
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

function payload(name = filename, content: unknown = [
  { pregunta: "  ¿Cuánto es 2 + 2?  ", respuestas: { A: " 3 ", B: " 4 " }, respuesta_correcta: "B" },
]) {
  return JSON.stringify({ filename: name, content });
}

test("BUG-01: imports a validated bank and applies the default category", async () => {
  const response = await request("/api/tests/import", { method: "POST", body: payload(filename, [
    { pregunta: "  ¿Cuánto es 2 + 2?  ", respuestas: { A: " 3 ", B: " 4 " }, respuesta_correcta: "B" },
    { pregunta: "¿Cuál es correcta?", respuestas: { A: "1", B: "2", C: "3", D: "4", E: "5", F: "6", G: "7", H: "8" }, respuesta_correcta: "H", oposicion: "  General  " },
  ]) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).count, 2);
  const saved = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, filename), eq(schema.questions.userId, userIds[0]),
  ));
  questionIds.push(...saved.map(question => question.id));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].questionText, "¿Cuánto es 2 + 2?");
  assert.deepEqual(saved[0].answers, { A: "3", B: "4" });
  assert.equal(saved[0].correctAnswer, "B");
  assert.equal(saved[0].category, "General");
  assert.equal(saved[1].correctAnswer, "H");
});

test("BUG-01: rejects malformed JSON, empty or invalid banks without writing", async () => {
  const beforeCount = (await db.select().from(schema.questions).where(eq(schema.questions.userId, userIds[0]))).length;
  const malformed = await request("/api/tests/import", { method: "POST", body: "{" });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).message, /JSON mal formado/i);

  for (const content of [
    [],
    [{ pregunta: "  ", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" }],
    [{ pregunta: "pregunta", respuestas: { A: "  ", B: "dos" }, respuesta_correcta: "B" }],
    [{ pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A", oposicion: "  " }],
    [{ pregunta: "pregunta", respuestas: { A: "uno" }, respuesta_correcta: "A" }],
    [{ pregunta: "pregunta", respuestas: { A: "uno", B: "dos", C: "tres", D: "cuatro", E: "cinco", F: "seis", G: "siete", H: "ocho", I: "nueve" }, respuesta_correcta: "A" }],
    [{ pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "C" }],
    [{ pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A", userId: userIds[1] }],
    [{ pregunta: 12, respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" }],
    [{ pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A", extra: true }],
  ]) {
    const response = await request("/api/tests/import", { method: "POST", body: payload(`${suffix}-${Math.random()}.json`, content) });
    assert.equal(response.status, 400);
  }

  const invalidLast = await request("/api/tests/import", {
    method: "POST",
    body: payload(`bug01-last-invalid-${suffix}.json`, [
      { pregunta: "válida", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" },
      { pregunta: "", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" },
    ]),
  });
  assert.equal(invalidLast.status, 400);
  const invalidLastError = await invalidLast.json();
  assert.match(invalidLastError.message, /Pregunta 2, campo pregunta/i);
  assert.ok(invalidLastError.errors.length <= 11);
  assert.equal((await db.select().from(schema.questions).where(eq(schema.questions.userId, userIds[0]))).length, beforeCount);
});

test("BUG-01: enforces filename, field, question-count and request-size limits", async () => {
  const invalidNames = [
    `${"a".repeat(146)}.json`,
    `folder/${suffix}.json`,
    `folder\\${suffix}.json`,
    `bad\u0001name-${suffix}.json`,
    `control-${suffix}.json\n`,
    `wrong-extension-${suffix}.JSON`,
  ];
  for (const invalidName of invalidNames) {
    const response = await request("/api/tests/import", { method: "POST", body: payload(invalidName) });
    assert.equal(response.status, 400);
  }
  const validMaxName = `${"a".repeat(145)}.json`;
  const validNameResponse = await request("/api/tests/import", { method: "POST", body: payload(validMaxName) });
  assert.equal(validNameResponse.status, 201);
  const validNameRows = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, validMaxName), eq(schema.questions.userId, userIds[0]),
  ));
  questionIds.push(...validNameRows.map(question => question.id));

  const overlongFields = [
    [{ pregunta: "p".repeat(4001), respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" }],
    [{ pregunta: "pregunta", respuestas: { A: "a".repeat(2001), B: "dos" }, respuesta_correcta: "A" }],
    [{ pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A", oposicion: "c".repeat(201) }],
    Array.from({ length: 1001 }, () => ({ pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" })),
  ];
  for (const content of overlongFields) {
    const response = await request("/api/tests/import", { method: "POST", body: payload(`bug01-overlong-${Math.random()}-${suffix}.json`, content) });
    assert.equal(response.status, 400);
  }

  const oversizedContent = Array.from({ length: 263 }, (_, index) => ({
    pregunta: `pregunta ${index} ${"p".repeat(3980)}`,
    respuestas: Object.fromEntries("ABCDEFGH".split("").map(key => [key, "r".repeat(2000)])),
    respuesta_correcta: "A",
  }));
  let contentBytes = Buffer.byteLength(JSON.stringify(oversizedContent));
  while (contentBytes > 5 * 1024 * 1024 + 8_000) {
    const reductionPerQuestion = Math.ceil((contentBytes - (5 * 1024 * 1024 + 8_000)) / oversizedContent.length);
    for (const question of oversizedContent) {
      question.respuestas.A = question.respuestas.A.slice(0, -reductionPerQuestion);
    }
    contentBytes = Buffer.byteLength(JSON.stringify(oversizedContent));
  }
  const oversized = await request("/api/tests/import", {
    method: "POST",
    body: payload(`bug01-oversized-${suffix}.json`, oversizedContent),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await db.select().from(schema.questions).where(eq(schema.questions.testId, `bug01-oversized-${suffix}.json`)), []);

  const parserLimit = await request("/api/tests/import", {
    method: "POST",
    body: JSON.stringify({ filename: `bug01-parser-limit-${suffix}.json`, content: [{ pregunta: "x".repeat(5 * 1024 * 1024 + 20_000) }] }),
  });
  assert.equal(parserLimit.status, 413);
});

test("BUG-01: duplicate names conflict atomically and the same name is private to each owner", async () => {
  const original = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, filename), eq(schema.questions.userId, userIds[0]),
  ));
  const duplicate = await request("/api/tests/import", { method: "POST", body: payload(filename, [
    { pregunta: "reemplazo", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A" },
  ]) });
  assert.equal(duplicate.status, 409);

  const otherOwner = await request("/api/tests/import", { method: "POST", body: payload() }, "b");
  assert.equal(otherOwner.status, 201);
  const afterOwnerA = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, filename), eq(schema.questions.userId, userIds[0]),
  ));
  const afterOwnerB = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, filename), eq(schema.questions.userId, userIds[1]),
  ));
  questionIds.push(...afterOwnerB.map(question => question.id));
  assert.deepEqual(afterOwnerA, original);
  assert.equal(afterOwnerB.length, 1);
  assert.notEqual(afterOwnerA[0].id, afterOwnerB[0].id);
});

test("BUG-01: concurrent same-owner imports accept exactly one request", async () => {
  const sharedFilename = `bug01-concurrent-${suffix}.json`;
  const responses = await Promise.all([
    request("/api/tests/import", { method: "POST", body: payload(sharedFilename) }),
    request("/api/tests/import", { method: "POST", body: payload(sharedFilename) }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const saved = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, sharedFilename), eq(schema.questions.userId, userIds[0]),
  ));
  questionIds.push(...saved.map(question => question.id));
  assert.equal(saved.length, 1);
});

test("BUG-01: concurrent manual question creation keeps its add-to-bank behavior", async () => {
  const sharedFilename = `bug01-manual-race-${suffix}.json`;
  const [manualResponse, importResponse] = await Promise.all([
    request("/api/questions", {
      method: "POST",
      body: JSON.stringify({
        testId: sharedFilename,
        questionText: "Pregunta manual",
        answers: { A: "uno", B: "dos" },
        correctAnswer: "A",
      }),
    }),
    request("/api/tests/import", { method: "POST", body: payload(sharedFilename) }),
  ]);
  assert.equal(manualResponse.status, 201);
  assert.ok(importResponse.status === 201 || importResponse.status === 409);
  const saved = await db.select().from(schema.questions).where(and(
    eq(schema.questions.testId, sharedFilename), eq(schema.questions.userId, userIds[0]),
  ));
  questionIds.push(...saved.map(question => question.id));
  assert.equal(saved.filter(question => question.questionText === "Pregunta manual").length, 1);
  assert.equal(saved.length, importResponse.status === 201 ? 2 : 1);
});

test("BUG-01: unauthenticated requests and owner spoofing cannot import", async () => {
  const unauthenticated = await request("/api/tests/import", { method: "POST", body: payload(`bug01-anon-${suffix}.json`) }, null);
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedLargeBody = await request("/api/tests/import", {
    method: "POST",
    body: JSON.stringify({ content: "x".repeat(5 * 1024 * 1024 + 20_000) }),
  }, null);
  assert.equal(unauthenticatedLargeBody.status, 401);
  const spoofed = await request("/api/tests/import", {
    method: "POST",
    body: payload(`bug01-spoof-${suffix}.json`, [
      { pregunta: "pregunta", respuestas: { A: "uno", B: "dos" }, respuesta_correcta: "A", userId: userIds[1] },
    ]),
  });
  assert.equal(spoofed.status, 400);
  assert.deepEqual(await db.select().from(schema.questions).where(eq(schema.questions.testId, `bug01-spoof-${suffix}.json`)), []);
});
