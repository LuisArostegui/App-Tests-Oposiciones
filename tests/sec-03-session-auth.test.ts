import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import type { Server } from "node:http";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl || testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must point to an isolated test database");
}
process.env.DATABASE_URL = testDatabaseUrl;

const [{ createApplication }, { db, pool }, schema] = await Promise.all([
  import("../server/app"),
  import("../server/db"),
  import("../shared/schema"),
]);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const productionSecret = "Sec03-Test-Only-0123456789-ABCDEF!";
const baseEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  SESSION_SECRET: productionSecret,
  TRUST_PROXY_HOPS: "1",
  REQUEST_LOGGING_ENABLED: "false",
  REGISTRATION_ENABLED: "true",
  APP_URL: "",
};

type RunningApplication = { app: import("express").Express; server: Server; baseUrl: string };
const runningApplications: RunningApplication[] = [];
const createdUsernames: string[] = [];
const createdQuestionIds: number[] = [];
const activeCookies: Array<{ running: RunningApplication; cookie: string }> = [];

async function startApplication(environment: NodeJS.ProcessEnv): Promise<RunningApplication> {
  const { app, server } = await createApplication(environment);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const running = { app, server, baseUrl: `http://127.0.0.1:${address.port}` };
  runningApplications.push(running);
  return running;
}

function originFor(running: RunningApplication): string {
  return running.baseUrl.replace("http://", "https://");
}

function requestHeaders(running: RunningApplication, cookie?: string): Headers {
  const headers = new Headers({
    origin: originFor(running),
    "x-forwarded-proto": "https",
  });
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

function getCookie(running: RunningApplication, response: Response): string {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "expected a session cookie");
  const cookie = header.split(";", 1)[0];
  activeCookies.push({ running, cookie });
  return cookie;
}

async function register(running: RunningApplication, username: string): Promise<{ response: Response; cookie: string }> {
  createdUsernames.push(username);
  const headers = requestHeaders(running);
  headers.set("content-type", "application/json");
  const response = await fetch(`${running.baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username, password: "sec03-test-password" }),
  });
  return { response, cookie: response.ok ? getCookie(running, response) : "" };
}

async function authMe(running: RunningApplication, cookie: string): Promise<Response> {
  return fetch(`${running.baseUrl}/api/auth/me`, { headers: requestHeaders(running, cookie) });
}

async function logout(running: RunningApplication, cookie: string, origin = originFor(running)): Promise<Response> {
  const headers = requestHeaders(running, cookie);
  headers.set("origin", origin);
  headers.set("content-type", "application/json");
  return fetch(`${running.baseUrl}/api/auth/logout`, { method: "POST", headers, body: "{}" });
}

before(async () => {
  await startApplication(baseEnvironment);
});

after(async () => {
  for (const { running, cookie } of activeCookies) await logout(running, cookie).catch(() => undefined);
  for (const running of runningApplications) {
    if (running.server.listening) {
      await new Promise<void>((resolve, reject) => running.server.close((error) => error ? reject(error) : resolve()));
    }
  }
  if (createdQuestionIds.length) {
    await db.delete(schema.questions).where(inArray(schema.questions.id, createdQuestionIds));
  }
  if (createdUsernames.length) {
    await db.delete(schema.users).where(inArray(schema.users.username, createdUsernames));
  }
  await pool.end();
});

test("SEC-03: production rejects missing, default, short, and low-diversity session secrets", async () => {
  for (const secret of [
    "",
    "default-secret-change-me",
    "opostest-development-session-secret-not-for-production",
    "short",
    "x".repeat(64),
  ]) {
    await assert.rejects(
      createApplication({ ...baseEnvironment, SESSION_SECRET: secret }),
      /SESSION_SECRET/,
    );
  }
  await assert.rejects(
    createApplication({ ...baseEnvironment, TRUST_PROXY_HOPS: "forwarded" }),
    /TRUST_PROXY_HOPS/,
  );
  await assert.rejects(
    createApplication({ ...baseEnvironment, REGISTRATION_ENABLED: "sometimes" }),
    /REGISTRATION_ENABLED/,
  );
});

test("SEC-03: registration defaults on in development and off in production without inserting disabled users", async () => {
  const productionDefault = await startApplication({
    ...baseEnvironment,
    REGISTRATION_ENABLED: undefined,
  });
  const disabledUsername = `sec03-registration-disabled-${suffix}`;
  const disabledHeaders = requestHeaders(productionDefault);
  disabledHeaders.set("content-type", "application/json");
  const disabledResponse = await fetch(`${productionDefault.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: disabledHeaders,
    body: JSON.stringify({ username: disabledUsername, password: "sec03-test-password" }),
  });
  assert.equal(disabledResponse.status, 403);
  assert.deepEqual(
    await db.select().from(schema.users).where(eq(schema.users.username, disabledUsername)),
    [],
  );

  const developmentDefault = await startApplication({
    ...baseEnvironment,
    NODE_ENV: "development",
    SESSION_SECRET: "stable-development-only-session-secret",
    REGISTRATION_ENABLED: undefined,
  });
  const enabled = await register(developmentDefault, `sec03-registration-development-${suffix}`);
  assert.equal(enabled.response.status, 201);
});

test("SEC-03: production app sets secure HttpOnly SameSite=Lax cookies and rotates authenticated sessions", async () => {
  const running = runningApplications[0]!;
  assert.equal(running.app.get("trust proxy"), 1);

  const username = `sec03-cookie-${suffix}`;
  const created = await register(running, username);
  assert.equal(created.response.status, 201);
  const cookie = created.cookie;
  const createdUser = await created.response.json() as { id: number; username: string };
  const cookieHeader = created.response.headers.get("set-cookie") ?? "";
  assert.match(cookieHeader, /; HttpOnly/i);
  assert.match(cookieHeader, /; Secure/i);
  assert.match(cookieHeader, /; SameSite=Lax/i);
  const expires = cookieHeader.match(/; Expires=([^;]+)/i)?.[1];
  assert.ok(expires);
  const remainingCookieLifetime = Date.parse(expires) - Date.now();
  assert.ok(remainingCookieLifetime > 29 * 24 * 60 * 60 * 1000);
  assert.ok(remainingCookieLifetime <= 30 * 24 * 60 * 60 * 1000 + 60_000);

  const beforeLogin = await authMe(running, cookie);
  const beforeLoginUser = await beforeLogin.json();
  assert.deepEqual(beforeLoginUser, createdUser);

  const loginHeaders = requestHeaders(running, cookie);
  loginHeaders.set("content-type", "application/json");
  const login = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: loginHeaders,
    body: JSON.stringify({ username, password: "sec03-test-password" }),
  });
  assert.equal(login.status, 200);
  const rotatedCookie = getCookie(running, login);
  assert.notEqual(rotatedCookie, cookie, "successful authentication must rotate the session ID");
  assert.deepEqual(await (await authMe(running, rotatedCookie)).json(), beforeLoginUser);

  const restarted = await startApplication({ ...baseEnvironment });
  assert.equal((await authMe(restarted, rotatedCookie)).status, 200,
    "a second app using the configured secret must read the existing session");
});

test("SEC-03: sessions are isolated and logout requires a same-origin request", async () => {
  const running = runningApplications[0]!;

  const rejectedRegisterHeaders = requestHeaders(running);
  rejectedRegisterHeaders.set("origin", "https://attacker.example");
  rejectedRegisterHeaders.set("content-type", "application/json");
  const crossOriginRegister = await fetch(`${running.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: rejectedRegisterHeaders,
    body: JSON.stringify({ username: `sec03-forged-${suffix}`, password: "sec03-test-password" }),
  });
  assert.equal(crossOriginRegister.status, 403);

  const noOriginRegisterHeaders = requestHeaders(running);
  noOriginRegisterHeaders.delete("origin");
  noOriginRegisterHeaders.set("content-type", "application/json");
  const noOriginRegister = await fetch(`${running.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: noOriginRegisterHeaders,
    body: JSON.stringify({ username: `sec03-no-origin-${suffix}`, password: "sec03-test-password" }),
  });
  assert.equal(noOriginRegister.status, 403);

  const first = await register(running, `sec03-first-${suffix}`);
  const second = await register(running, `sec03-second-${suffix}`);
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(first.response.headers.get("cache-control"), "no-store");

  const firstUser = await (await authMe(running, first.cookie)).json() as { username: string };
  const secondUser = await (await authMe(running, second.cookie)).json() as { username: string };
  const authenticatedApiResponse = await authMe(running, first.cookie);
  assert.equal(authenticatedApiResponse.status, 200);
  assert.equal(authenticatedApiResponse.headers.get("cache-control"), "no-store");
  assert.notEqual(firstUser.username, secondUser.username);

  for (const sourceOrigin of ["https://attacker.example", undefined]) {
    const headers = requestHeaders(running);
    if (sourceOrigin) headers.set("origin", sourceOrigin);
    else headers.delete("origin");
    headers.set("content-type", "application/json");
    const blockedLogin = await fetch(`${running.baseUrl}/api/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ username: firstUser.username, password: "sec03-test-password" }),
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal(blockedLogin.headers.get("cache-control"), "no-store");
    assert.equal(blockedLogin.headers.has("set-cookie"), false);
  }

  assert.equal((await logout(running, first.cookie, "https://attacker.example")).status, 403);
  const missingOrigin = requestHeaders(running, first.cookie);
  missingOrigin.delete("origin");
  const missingOriginLogout = await fetch(`${running.baseUrl}/api/auth/logout`, {
    method: "POST", headers: missingOrigin, body: "{}",
  });
  assert.equal(missingOriginLogout.status, 403);

  const logoutResponse = await logout(running, first.cookie);
  assert.equal(logoutResponse.status, 200);
  assert.equal(logoutResponse.headers.get("cache-control"), "no-store");
  const clearedCookie = logoutResponse.headers.get("set-cookie") ?? "";
  assert.match(clearedCookie, /; HttpOnly/i);
  assert.match(clearedCookie, /; Secure/i);
  assert.match(clearedCookie, /; SameSite=Lax/i);
  assert.match(clearedCookie, /; Path=\//i);
  const expiredSession = await authMe(running, first.cookie);
  assert.equal(expiredSession.status, 401);
  assert.equal(expiredSession.headers.get("cache-control"), "no-store");
  assert.equal((await authMe(running, second.cookie)).status, 200);
});

test("SEC-03: APP_URL pins the accepted CSRF origin", async () => {
  const running = await startApplication({
    ...baseEnvironment,
    APP_URL: "https://configured-opostest.example",
  });
  const headers = requestHeaders(running);
  headers.set("content-type", "application/json");
  headers.set("origin", "https://attacker.example");
  const rejected = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "missing-user", password: "invalid-password" }),
  });
  assert.equal(rejected.status, 403);

  headers.set("origin", "https://configured-opostest.example");
  const accepted = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "missing-user", password: "invalid-password" }),
  });
  assert.equal(accepted.status, 401, "the configured origin passes CSRF validation and reaches authentication");
});

test("SEC-03: Referer is accepted as the same-origin CSRF source when Origin is absent", async () => {
  const running = await startApplication({ ...baseEnvironment, APP_URL: "" });
  const headers = requestHeaders(running);
  headers.delete("origin");
  headers.set("referer", `${originFor(running)}/login`);
  headers.set("content-type", "application/json");
  const accepted = await fetch(`${running.baseUrl}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "missing-user", password: "invalid-password" }),
  });
  assert.equal(accepted.status, 401, "a same-origin Referer passes CSRF validation");
});

test("SEC-03: CSRF protects authenticated question creation and allows a same-origin write", async () => {
  const running = runningApplications[0]!;
  const authenticated = await register(running, `sec03-csrf-writer-${suffix}`);
  assert.equal(authenticated.response.status, 201);

  const testId = `sec03-csrf-${suffix}.json`;
  const question = {
    testId,
    questionText: "Pregunta de regresión CSRF",
    answers: { A: "Respuesta A", B: "Respuesta B" },
    correctAnswer: "A",
    category: "SEC-03 test",
  };
  const forgedHeaders = requestHeaders(running, authenticated.cookie);
  forgedHeaders.set("origin", "https://attacker.example");
  forgedHeaders.set("content-type", "application/json");
  const forgedWrite = await fetch(`${running.baseUrl}/api/questions`, {
    method: "POST",
    headers: forgedHeaders,
    body: JSON.stringify(question),
  });
  assert.equal(forgedWrite.status, 403);
  assert.deepEqual(
    await db.select().from(schema.questions).where(eq(schema.questions.testId, testId)),
    [],
  );

  const sameOriginHeaders = requestHeaders(running, authenticated.cookie);
  sameOriginHeaders.set("content-type", "application/json");
  const allowedWrite = await fetch(`${running.baseUrl}/api/questions`, {
    method: "POST",
    headers: sameOriginHeaders,
    body: JSON.stringify(question),
  });
  assert.equal(allowedWrite.status, 201);
  const createdQuestion = await allowedWrite.json() as { id: number };
  createdQuestionIds.push(createdQuestion.id);

  const importName = `sec03-csrf-import-${suffix}.json`;
  const forgedImportHeaders = requestHeaders(running, authenticated.cookie);
  forgedImportHeaders.set("origin", "https://attacker.example");
  forgedImportHeaders.set("content-type", "application/json");
  const forgedImport = await fetch(`${running.baseUrl}/api/tests/import`, {
    method: "POST",
    headers: forgedImportHeaders,
    body: "{",
  });
  assert.equal(forgedImport.status, 403, "CSRF rejection happens before parsing the larger import body");
  assert.deepEqual(await db.select().from(schema.questions).where(eq(schema.questions.testId, importName)), []);

  const allowedImport = await fetch(`${running.baseUrl}/api/tests/import`, {
    method: "POST",
    headers: sameOriginHeaders,
    body: JSON.stringify({
      filename: importName,
      content: [{ pregunta: "Pregunta importada", respuestas: { A: "Correcta", B: "Incorrecta" }, respuesta_correcta: "A" }],
    }),
  });
  assert.equal(allowedImport.status, 201);
  const importedQuestions = await db.select().from(schema.questions).where(eq(schema.questions.testId, importName));
  createdQuestionIds.push(...importedQuestions.map(row => row.id));
  assert.equal(importedQuestions.length, 1);
});

test("SEC-03: development request logging defaults on and can be disabled for a private instance", async () => {
  const originalLog = console.log;
  const captured: string[] = [];
  console.log = (...values: unknown[]) => captured.push(values.join(" "));
  try {
    const development = await startApplication({
      ...baseEnvironment,
      NODE_ENV: "development",
      SESSION_SECRET: "stable-development-only-session-secret",
      TRUST_PROXY_HOPS: undefined,
      REQUEST_LOGGING_ENABLED: undefined,
    });
    assert.equal(development.app.get("trust proxy"), 0, "proxy headers are ignored by default");
    await fetch(`${development.baseUrl}/api/auth/me`);
    assert.ok(captured.some((line) => line.includes("GET /api/auth/me 401 in ")));

    captured.length = 0;
    const privateInstance = await startApplication({ ...baseEnvironment, REQUEST_LOGGING_ENABLED: "false" });
    await fetch(`${privateInstance.baseUrl}/api/auth/me`);
    assert.equal(captured.length, 0);
  } finally {
    console.log = originalLog;
  }
});

test("SEC-03: login and registration limits ignore spoofed forwarding headers when proxy trust is disabled", async () => {
  const limited = await startApplication({ ...baseEnvironment, TRUST_PROXY_HOPS: "0" });
  assert.equal(limited.app.get("trust proxy"), 0);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${limited.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: limited.baseUrl,
        "x-forwarded-for": `198.51.100.${attempt + 1}`,
      },
      body: JSON.stringify({ username: `missing-${suffix}`, password: "invalid-password" }),
    });
    assert.equal(response.status, 401);
  }
  const blockedLogin = await fetch(`${limited.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: limited.baseUrl,
      "x-forwarded-for": "203.0.113.77",
    },
    body: JSON.stringify({ username: `missing-${suffix}`, password: "invalid-password" }),
  });
  assert.equal(blockedLogin.status, 429);
  assert.ok(blockedLogin.headers.has("retry-after"));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${limited.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: limited.baseUrl },
      body: JSON.stringify({ username: "x", password: "short" }),
    });
    assert.equal(response.status, 400);
  }
  const blockedRegistration = await fetch(`${limited.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: limited.baseUrl, "x-forwarded-for": "192.0.2.55" },
    body: JSON.stringify({ username: "x", password: "short" }),
  });
  assert.equal(blockedRegistration.status, 429);
});
