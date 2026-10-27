import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
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

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const names = ["owner", "other"] as const;
type Person = typeof names[number];
const commonFixtureKeys = ["read", "rename", "delete", "zeroRename", "zeroDelete"] as const;
type CommonFixtureKey = typeof commonFixtureKeys[number];
type FixtureKey = CommonFixtureKey | "ownerOnly" | "otherOnly";
const ids = { owner: 0, other: 0 };
const questionIds: number[] = [];
const resultIds: number[] = [];
const attemptIds: number[] = [];
const fixtures: {
  owner: Record<CommonFixtureKey | "ownerOnly", number>;
  other: Record<CommonFixtureKey | "otherOnly", number>;
} = {
  owner: { read: 0, rename: 0, delete: 0, zeroRename: 0, zeroDelete: 0, ownerOnly: 0 },
  other: { read: 0, rename: 0, delete: 0, zeroRename: 0, zeroDelete: 0, otherOnly: 0 },
};
const testIds: Record<FixtureKey, string> = {
  read: `private-read-${suffix}.json`,
  rename: `private-rename-${suffix}.json`,
  delete: `private-delete-${suffix}.json`,
  zeroRename: `private-zeroRename-${suffix}.json`,
  zeroDelete: `private-zeroDelete-${suffix}.json`,
  ownerOnly: `private-ownerOnly-${suffix}.json`,
  otherOnly: `private-otherOnly-${suffix}.json`,
};
let server: Server;
let baseUrl: string;

before(async () => {
  for (const name of names) {
    const user = await storage.createUser({ username: `private-${name}-${suffix}`, password: "test-only" });
    ids[name] = user.id;
    const ownOnlyKey: FixtureKey = name === "owner" ? "ownerOnly" : "otherOnly";
    for (const key of [...commonFixtureKeys, ownOnlyKey]) {
      if (name === "owner" && key === "otherOnly") continue;
      if (name === "other" && key === "ownerOnly") continue;
      const question = await storage.createQuestion(user.id, {
        testId: testIds[key], questionText: `Fictional ${name} ${key}`,
        answers: { A: "A", B: "B" }, correctAnswer: "A", category: "Fixture",
      });
      questionIds.push(question.id);
      if (name === "owner") {
        fixtures.owner[key] = question.id;
      } else {
        fixtures.other[key] = question.id;
      }
    }
    const result = await storage.createResult(user.id, { testId: testIds.read, score: 100, correctCount: 1, totalQuestions: 1 });
    resultIds.push(result.id);
    const attempt = await storage.createAttempt({ testId: testIds.read, userId: user.id, questionOrder: [fixtures[name].read] });
    assert.ok(attempt);
    attemptIds.push(attempt.id);
  }
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "private-storage-test-secret", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/__test/session/:userId", (req, res, next) => {
    const name = names.find(value => ids[value] === Number(req.params.userId));
    if (!name) return res.sendStatus(404);
    req.login({ id: ids[name], username: `private-${name}-${suffix}` }, error => error ? next(error) : res.sendStatus(204));
  });
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const id of attemptIds) await db.delete(schema.testAttempts).where(eq(schema.testAttempts.id, id));
  for (const id of resultIds) await db.delete(schema.results).where(eq(schema.results.id, id));
  for (const id of questionIds) await db.delete(schema.questions).where(eq(schema.questions.id, id));
  for (const id of Object.values(ids)) if (id) await db.delete(schema.users).where(eq(schema.users.id, id));
  await pool.end();
});

async function request(name: Person, path: string, options: RequestInit = {}) {
  const login = await fetch(`${baseUrl}/__test/session/${ids[name]}`, { method: "POST" });
  assert.equal(login.status, 204);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const headers = new Headers(options.headers);
  headers.set("cookie", cookie);
  if (options.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}
async function requestWithoutSession(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}
async function question(id: number) {
  const [row] = await db.select().from(schema.questions).where(eq(schema.questions.id, id));
  return row;
}

test("authenticated lists and test details are isolated for both sessions", async () => {
  for (const [index, name] of names.entries()) {
    const list = await request(name, "/api/tests");
    assert.equal(list.status, 200);
    const tests: { id: string; count: number }[] = await list.json();
    assert.deepEqual(tests.map(row => row.id).sort(), Object.keys(fixtures[name]).map(key => testIds[key]).sort());
    assert.ok(tests.every(row => row.count === 1));
    for (const key of ["read", `${name}Only`]) {
      const response = await request(name, `/api/tests/${encodeURIComponent(testIds[key])}`);
      assert.equal(response.status, 200);
      const rows: { id: number; userId: number }[] = await response.json();
      assert.deepEqual(rows.map(row => row.id), [fixtures[name][key]]);
      assert.equal(rows[0].userId, ids[name]);
    }
    const other = name === "owner" ? "other" : "owner";
    assert.equal((await request(name, `/api/tests/${encodeURIComponent(testIds[`${other}Only`])}`)).status, 404);
    for (const [path, id] of [["/api/results", resultIds[index]], ["/api/attempts", attemptIds[index]]] as const) {
      const response = await request(name, path);
      assert.equal(response.status, 200);
      const rows: { id: number; userId: number }[] = await response.json();
      assert.deepEqual(rows.map(row => row.id), [id]);
      assert.equal(rows[0].userId, ids[name]);
    }
  }
});

test("owner rename and delete preserve another user's rows with the same test ID", async () => {
  const renamed = `renamed-${suffix}.json`;
  const rename = await request("owner", `/api/tests/${encodeURIComponent(testIds.rename)}/rename`, { method: "PUT", body: JSON.stringify({ newName: renamed }) });
  assert.equal(rename.status, 200);
  assert.equal((await question(fixtures.owner.rename))?.testId, renamed);
  assert.equal((await question(fixtures.other.rename))?.testId, testIds.rename);
  const deletion = await request("owner", `/api/tests/${encodeURIComponent(testIds.delete)}`, { method: "DELETE" });
  assert.equal(deletion.status, 204);
  assert.equal(await question(fixtures.owner.delete), undefined);
  assert.equal((await question(fixtures.other.delete))?.testId, testIds.delete);
});

test("rename and delete return not found for foreign and missing tests without changing stored rows", async () => {
  const ownerBefore = await question(fixtures.owner.rename);
  const foreignBefore = await question(fixtures.other.rename);
  const missingTestId = `missing-${suffix}.json`;

  const foreignRename = await request("owner", `/api/tests/${encodeURIComponent(testIds.otherOnly)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: `not-owned-${suffix}.json` }),
  });
  assert.equal(foreignRename.status, 404);
  const missingRename = await request("owner", `/api/tests/${encodeURIComponent(missingTestId)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: `missing-renamed-${suffix}.json` }),
  });
  assert.equal(missingRename.status, 404);
  const foreignDelete = await request("owner", `/api/tests/${encodeURIComponent(testIds.otherOnly)}`, { method: "DELETE" });
  assert.equal(foreignDelete.status, 404);
  const missingDelete = await request("owner", `/api/tests/${encodeURIComponent(missingTestId)}`, { method: "DELETE" });
  assert.equal(missingDelete.status, 404);

  assert.deepEqual(await question(fixtures.owner.rename), ownerBefore);
  assert.deepEqual(await question(fixtures.other.rename), foreignBefore);
  assert.equal((await question(fixtures.other.otherOnly))?.testId, testIds.otherOnly);
  assert.equal((await question(fixtures.owner.ownerOnly))?.testId, testIds.ownerOnly);
});

test("rename and delete require a session and preserve the owner's rows", async () => {
  const ownerBefore = await question(fixtures.owner.rename);
  const ownerDeleteBefore = await question(fixtures.owner.ownerOnly);
  assert.ok(ownerBefore);
  assert.ok(ownerDeleteBefore);

  const rename = await requestWithoutSession(`/api/tests/${encodeURIComponent(testIds.rename)}/rename`, {
    method: "PUT", body: JSON.stringify({ newName: `anonymous-${suffix}.json` }),
  });
  assert.equal(rename.status, 401);
  const deletion = await requestWithoutSession(`/api/tests/${encodeURIComponent(testIds.ownerOnly)}`, { method: "DELETE" });
  assert.equal(deletion.status, 401);

  assert.deepEqual(await question(fixtures.owner.rename), ownerBefore);
  assert.deepEqual(await question(fixtures.owner.ownerOnly), ownerDeleteBefore);
});

test("GET attempt is private, returns 404 to another account, and requires a session", async () => {
  const ownerAttemptId = attemptIds[0];
  const foreignAttemptId = attemptIds[1];
  const ownerRead = await request("owner", `/api/attempts/${ownerAttemptId}`);
  assert.equal(ownerRead.status, 200);
  const ownerBody: { id: number; userId: number } = await ownerRead.json();
  assert.equal(ownerBody.id, ownerAttemptId);
  assert.equal(ownerBody.userId, ids.owner);

  const foreignRead = await request("other", `/api/attempts/${ownerAttemptId}`);
  assert.equal(foreignRead.status, 404);
  const missingRead = await request("owner", "/api/attempts/2147483000");
  assert.equal(missingRead.status, 404);
  const anonymousRead = await requestWithoutSession(`/api/attempts/${foreignAttemptId}`);
  assert.equal(anonymousRead.status, 401);
});

for (const [name, read] of [
  ["getTests", () => storage.getTests(0)],
  ["getQuestionsByTestId", () => storage.getQuestionsByTestId(testIds.read, 0)],
  ["getResults", () => storage.getResults(0)],
  ["getAttempts", () => storage.getAttempts(0)],
] as const) {
  test(`${name} with zero owner returns no rows`, async () => assert.deepEqual(await read(), []));
}

for (const [name, key, mutate] of [
  ["renameTest", "zeroRename", () => storage.renameTest(testIds.zeroRename, `zero-renamed-${suffix}.json`, 0)],
  ["deleteTest", "zeroDelete", () => storage.deleteTest(testIds.zeroDelete, 0)],
] as const) {
  test(`${name} with zero owner leaves both users' rows intact`, async () => {
    const beforeRows = await Promise.all(names.map(person => question(fixtures[person][key])));
    assert.ok(beforeRows.every(Boolean));
    assert.equal(await mutate(), false);
    const afterRows = await Promise.all(names.map(person => question(fixtures[person][key])));
    assert.deepEqual(afterRows, beforeRows);
  });
}
