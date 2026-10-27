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
const username = `sec02-${suffix}`;
const filename = `sec02-import-${suffix}.json`;
const questions: number[] = [];
let userId = 0;
let appServer: Server;
let sinkServer: Server;
let baseUrl: string;
let sinkUrl: string;
let outboundRequests = 0;

before(async () => {
  const user = await storage.createUser({ username, password: "test-only" });
  userId = user.id;

  const sink = express();
  sink.use((_req, _res, next) => { outboundRequests += 1; next(); });
  sink.get("/listing", (_req, res) => res.type("html").send('<a href="test.json">test</a>'));
  sink.get("/files/test.json", (_req, res) => res.json([]));
  sinkServer = createServer(sink);
  await new Promise<void>(resolve => sinkServer.listen(0, "127.0.0.1", resolve));
  const sinkAddress = sinkServer.address();
  assert.ok(sinkAddress && typeof sinkAddress !== "string");
  sinkUrl = `http://127.0.0.1:${sinkAddress.port}`;

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "sec02-test-secret", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/__test/session", (req, res, next) => {
    req.login({ id: userId, username }, error => error ? next(error) : res.sendStatus(204));
  });
  appServer = createServer(app);
  await registerRoutes(appServer, app);
  await new Promise<void>(resolve => appServer.listen(0, "127.0.0.1", resolve));
  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  baseUrl = `http://127.0.0.1:${appAddress.port}`;
});

after(async () => {
  if (appServer?.listening) await new Promise<void>((resolve, reject) => appServer.close(error => error ? reject(error) : resolve()));
  if (sinkServer?.listening) await new Promise<void>((resolve, reject) => sinkServer.close(error => error ? reject(error) : resolve()));
  for (const id of questions) await db.delete(schema.questions).where(eq(schema.questions.id, id));
  if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
  await pool.end();
});

async function authenticatedRequest(path: string, options: RequestInit = {}) {
  const login = await fetch(`${baseUrl}/__test/session`, { method: "POST" });
  assert.equal(login.status, 204);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const headers = new Headers(options.headers);
  headers.set("cookie", cookie);
  if (options.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test("SEC-02: remote list and fetch reject before any outbound request", async () => {
  outboundRequests = 0;
  const list = await authenticatedRequest(`/api/remote/list?url=${encodeURIComponent(`${sinkUrl}/listing`)}`);
  const download = await authenticatedRequest(`/api/remote/fetch?url=${encodeURIComponent(`${sinkUrl}/files`)}&filename=test.json`);

  assert.equal(list.status, 503);
  assert.equal(download.status, 503);
  assert.equal(outboundRequests, 0);
});

test("SEC-02: remote list and fetch still require authentication", async () => {
  const list = await fetch(`${baseUrl}/api/remote/list?url=${encodeURIComponent(`${sinkUrl}/listing`)}`);
  const download = await fetch(`${baseUrl}/api/remote/fetch?url=${encodeURIComponent(`${sinkUrl}/files`)}&filename=test.json`);
  assert.equal(list.status, 401);
  assert.equal(download.status, 401);
  assert.equal(outboundRequests, 0);
});

test("SEC-02: local JSON import remains available", async () => {
  const response = await authenticatedRequest("/api/tests/import", {
    method: "POST",
    body: JSON.stringify({
      filename,
      content: [{ pregunta: "Pregunta local", respuestas: { A: "Respuesta" }, respuesta_correcta: "A" }],
    }),
  });
  assert.equal(response.status, 201);
  const row = await db.select().from(schema.questions).where(eq(schema.questions.testId, filename));
  questions.push(...row.map(question => question.id));
  assert.equal(row.length, 1);
  assert.equal(row[0].userId, userId);
});
