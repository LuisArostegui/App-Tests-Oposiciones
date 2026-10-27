import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { createServer, type Server } from "node:http";
import { ZodError } from "zod";
import { apiErrorHandler, asyncHandler, requestLogger } from "../server/http-middleware";
import { parsePositiveId } from "../server/validation";

let appServer: Server;
let baseUrl: string;
const capturedLogs: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

before(async () => {
  console.log = (...values: unknown[]) => capturedLogs.push(values.join(" "));
  console.error = (...values: unknown[]) => capturedLogs.push(values.join(" "));

  const app = express();
  app.use(requestLogger);
  app.use(express.json({ limit: "100kb" }));
  app.get("/api/tests", asyncHandler(async (_req, res) => {
    res.json({ question: "QUESTION_SECRET", answer: "ANSWER_SECRET" });
  }));
  app.get("/api/users/:id", asyncHandler(async (req, res) => {
    res.json({ id: req.params.id });
  }));
  app.get("/api/failure", asyncHandler(async () => {
    throw new Error("password=PASSWORD_SECRET cookie=COOKIE_SECRET token=TOKEN_SECRET");
  }));
  app.get("/api/invalid", asyncHandler(async () => {
    throw new ZodError([]);
  }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/parse-ok", (_req, res) => res.json({ ok: true }));
  app.use(apiErrorHandler);

  appServer = createServer(app);
  await new Promise<void>((resolve) => appServer.listen(0, "127.0.0.1", resolve));
  const address = appServer.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (appServer?.listening) {
    await new Promise<void>((resolve, reject) => appServer.close((error) => error ? reject(error) : resolve()));
  }
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

test("SEC-04: request logs include method, path, status and duration without payloads or query values", async () => {
  const response = await fetch(`${baseUrl}/api/tests?token=QUERY_TOKEN_SECRET`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { question: "QUESTION_SECRET", answer: "ANSWER_SECRET" });

  const requestLog = capturedLogs.find((line) => line.includes("GET /api/tests 200 in "));
  assert.ok(requestLog, "expected a request log with method, path, status and duration");
  assert.match(requestLog, /GET \/api\/tests 200 in \d+ms/);

  const parameterized = await fetch(`${baseUrl}/api/users/USER_SECRET?token=QUERY_TOKEN_SECRET`);
  assert.equal(parameterized.status, 200);
  const parameterizedLog = capturedLogs.find((line) => line.includes("GET /api/users/:id 200 in "));
  assert.ok(parameterizedLog, "expected the logged route to use its parameterized route pattern");
  assert.doesNotMatch(capturedLogs.join("\n"), /QUESTION_SECRET|ANSWER_SECRET|QUERY_TOKEN_SECRET/);
  assert.doesNotMatch(capturedLogs.join("\n"), /USER_SECRET/);
});

test("SEC-04: rejected async requests get a controlled response and the server handles the next request", async () => {
  const failed = await fetch(`${baseUrl}/api/failure`);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { message: "Error interno del servidor" });

  const next = await fetch(`${baseUrl}/health`);
  assert.equal(next.status, 200);
  assert.deepEqual(await next.json(), { ok: true });
  assert.doesNotMatch(capturedLogs.join("\n"), /PASSWORD_SECRET|COOKIE_SECRET|TOKEN_SECRET/);
});

test("SEC-04: expected validation failures remain 400 responses", async () => {
  const response = await fetch(`${baseUrl}/api/invalid`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Solicitud no válida" });
});

test("SEC-04: route IDs accept only positive safe integers", () => {
  assert.equal(parsePositiveId("42"), 42);
  assert.equal(parsePositiveId("0"), undefined);
  assert.equal(parsePositiveId("-1"), undefined);
  assert.equal(parsePositiveId("1.5"), undefined);
  assert.equal(parsePositiveId("NaN"), undefined);
  assert.equal(parsePositiveId("9007199254740992"), undefined);
});

test("SEC-04: known JSON parser failures keep controlled client error statuses", async () => {
  const malformed = await fetch(`${baseUrl}/api/parse-ok`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{\"password\":",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { message: "Solicitud no válida" });

  const tooLarge = await fetch(`${baseUrl}/api/parse-ok`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answer: "ANSWER_SECRET".padEnd(110 * 1024, "x") }),
  });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { message: "El cuerpo de la solicitud es demasiado grande" });

  const unsupportedCharset = await fetch(`${baseUrl}/api/parse-ok`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=unsupported" },
    body: "{}",
  });
  assert.equal(unsupportedCharset.status, 415);
  assert.deepEqual(await unsupportedCharset.json(), { message: "Formato de solicitud no admitido" });
  assert.doesNotMatch(capturedLogs.join("\n"), /ANSWER_SECRET/);
});
