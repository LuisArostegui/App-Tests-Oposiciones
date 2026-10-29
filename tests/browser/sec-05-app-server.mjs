import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/public");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const users = {
  "account-a": { id: 1, username: "account-a", tests: [{ id: "account-a-private.json", count: 1, category: "Private A" }] },
  "account-b": { id: 2, username: "account-b", tests: [{ id: "account-b-private.json", count: 1, category: "Private B" }] },
};
let expired = false;
let delayedTestsUser = null;
const releaseDelayedTests = new Set();
let delayLogout = false;
let releaseDelayedLogout;
let attemptState = null;
let nextAttemptSnapshot = null;
let failNextAttemptSave = false;
let delayAttemptSave = false;
let releaseAttemptSave;
let delayAttemptSaveRequestNumber = null;
let releaseDelayedAttemptSave;
let attemptSaveRequests = [];
let delayAttemptFinalize = false;
let releaseAttemptFinalize;
let finalizationPayloads = [];
let attemptSaveSnapshots = [];
let results = [];
let dropNextFinalizeResponse = false;
let failNextResultsRead = false;
let missingAttemptQuestion = false;
let failNextAttemptRead = false;
let attemptReadCount = 0;
let delayNextAttemptRead = false;
let releaseAttemptRead;
const attemptQuestions = [
  { id: 11, questionText: "Pregunta de prueba uno", answers: { A: "Correcta", B: "Incorrecta" }, correctAnswer: "A" },
  { id: 12, questionText: "Pregunta de prueba dos", answers: { A: "Incorrecta", B: "Correcta" }, correctAnswer: "B" },
];
const initialAttemptQuestions = attemptQuestions.map((question) => ({ ...question }));

function resetFixture() {
  attemptQuestions.splice(0, attemptQuestions.length, ...initialAttemptQuestions.map((question) => ({ ...question })));
  expired = false;
  users["account-a"].tests = [{ id: "account-a-private.json", count: 1, category: "Private A" }];
  users["account-b"].tests = [{ id: "account-b-private.json", count: 1, category: "Private B" }];
  delayedTestsUser = null;
  for (const release of releaseDelayedTests) release();
  releaseDelayedTests.clear();
  delayLogout = false;
  releaseDelayedLogout?.();
  releaseDelayedLogout = undefined;
  attemptState = null;
  nextAttemptSnapshot = null;
  failNextAttemptSave = false;
  delayAttemptSave = false;
  releaseAttemptSave?.();
  releaseAttemptSave = undefined;
  delayAttemptSaveRequestNumber = null;
  releaseDelayedAttemptSave?.();
  releaseDelayedAttemptSave = undefined;
  attemptSaveRequests = [];
  delayAttemptFinalize = false;
  releaseAttemptFinalize?.();
  releaseAttemptFinalize = undefined;
  finalizationPayloads = [];
  attemptSaveSnapshots = [];
  results = [];
  dropNextFinalizeResponse = false;
  failNextResultsRead = false;
  missingAttemptQuestion = false;
  failNextAttemptRead = false;
  attemptReadCount = 0;
  delayNextAttemptRead = false;
  releaseAttemptRead?.();
  releaseAttemptRead = undefined;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function respondJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost:4175");
  const sid = /(?:^|;\s*)sec05sid=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
  if (url.pathname === "/__test/shutdown" && request.method === "POST") {
    if (request.headers["x-test-run-id"] !== process.env.BROWSER_FIXTURE_OWNER) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(204).end();
    server.close((error) => {
      if (error) {
        console.error(`No se pudo cerrar el fixture de aplicación SEC-05 (${error.message}).`);
        process.exitCode = 1;
      }
    });
    return;
  }
  if (url.pathname === "/__e2e/reset" && request.method === "POST") {
    resetFixture();
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/test-name" && request.method === "POST") {
    const { testId } = await readJson(request);
    users["account-a"].tests[0] = { ...users["account-a"].tests[0], id: testId };
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/seed-question-count" && request.method === "POST") {
    const { count } = await readJson(request);
    users["account-a"].tests[0].count = count;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/omit-attempt-question" && request.method === "POST") {
    missingAttemptQuestion = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/restore-attempt-question" && request.method === "POST") {
    missingAttemptQuestion = false;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/rename-attempt-test" && request.method === "POST") {
    const { testId } = await readJson(request);
    users["account-a"].tests[0] = { ...users["account-a"].tests[0], id: testId };
    if (attemptState) attemptState = { ...attemptState, testId };
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/fail-next-attempt-read" && request.method === "POST") {
    failNextAttemptRead = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/delay-next-attempt-read" && request.method === "POST") {
    delayNextAttemptRead = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/release-attempt-read" && request.method === "POST") {
    releaseAttemptRead?.();
    releaseAttemptRead = undefined;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/delay-tests" && request.method === "POST") {
    const { username } = await readJson(request);
    delayedTestsUser = username;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/release-tests" && request.method === "POST") {
    for (const release of releaseDelayedTests) release();
    releaseDelayedTests.clear();
    delayedTestsUser = null;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/expire" && request.method === "POST") {
    expired = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/delay-logout" && request.method === "POST") {
    delayLogout = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/release-logout" && request.method === "POST") {
    releaseDelayedLogout?.();
    releaseDelayedLogout = undefined;
    delayLogout = false;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/fail-next-attempt-save" && request.method === "POST") {
    failNextAttemptSave = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/delay-attempt-save" && request.method === "POST") {
    delayAttemptSave = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/release-attempt-save" && request.method === "POST") {
    releaseAttemptSave?.();
    releaseAttemptSave = undefined;
    delayAttemptSave = false;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/delay-attempt-save-request" && request.method === "POST") {
    delayAttemptSaveRequestNumber = (await readJson(request)).requestNumber;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/release-delayed-attempt-save" && request.method === "POST") {
    releaseDelayedAttemptSave?.();
    releaseDelayedAttemptSave = undefined;
    delayAttemptSaveRequestNumber = null;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/delay-attempt-finalize" && request.method === "POST") {
    delayAttemptFinalize = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/release-attempt-finalize" && request.method === "POST") {
    releaseAttemptFinalize?.();
    releaseAttemptFinalize = undefined;
    delayAttemptFinalize = false;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/fail-next-finalize-response" && request.method === "POST") {
    dropNextFinalizeResponse = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/complete-attempt-without-result" && request.method === "POST") {
    if (attemptState) attemptState = { ...attemptState, status: "completed", completedAt: "2026-10-28T00:00:00.000Z", score: 0, correctCount: 0 };
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/complete-attempt-with-result" && request.method === "POST") {
    if (attemptState) {
      attemptState = { ...attemptState, status: "completed", completedAt: "2026-10-28T00:00:00.000Z", answers: { "11": "A", "12": "A" }, score: 50, correctCount: 1 };
      results = [{ id: 9001, attemptId: attemptState.id, testId: attemptState.testId, correctCount: 1, totalQuestions: 2, score: 50, completedAt: attemptState.completedAt, userId: attemptState.userId }];
    }
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/fail-next-results-read" && request.method === "POST") {
    failNextResultsRead = true;
    return response.writeHead(204).end();
  }
  if (url.pathname === "/__e2e/attempt-state" && request.method === "GET") {
    return respondJson(response, 200, { attemptState, attemptReadCount, failNextAttemptRead, finalizationPayloads, attemptSaveRequests, attemptSaveSnapshots, results, dropNextFinalizeResponse });
  }
  if (url.pathname === "/__e2e/seed-next-attempt" && request.method === "POST") {
    nextAttemptSnapshot = await readJson(request);
    return response.writeHead(204).end();
  }
  if (url.pathname === "/api/auth/me") {
    const user = expired ? undefined : users[sid];
    return user ? respondJson(response, 200, { id: user.id, username: user.username }) : respondJson(response, 401, { message: "No autenticado" });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { username } = JSON.parse(body);
    const user = users[username];
    if (!user) return respondJson(response, 401, { message: "Credenciales incorrectas" });
    expired = false;
    return respondJson(response, 200, { id: user.id, username: user.username }, { "Set-Cookie": `sec05sid=${username}; Path=/; SameSite=Lax` });
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (delayLogout) await new Promise((resolve) => { releaseDelayedLogout = resolve; });
    expired = true;
    return respondJson(response, 200, { message: "Sesión cerrada" }, { "Set-Cookie": "sec05sid=; Path=/; Max-Age=0; SameSite=Lax" });
  }
  if (url.pathname === "/api/tests/import" && request.method === "POST") {
    const user = expired ? undefined : users[sid];
    if (!user) return respondJson(response, 401, { message: "No autenticado" });
    const { filename, content } = await readJson(request);
    if (user.tests.some((test) => test.id === filename)) {
      return respondJson(response, 409, { message: "Ya tienes un banco con ese nombre." });
    }
    user.tests.push({ id: filename, count: content.length, category: content[0]?.oposicion ?? "General" });
    return respondJson(response, 201, { success: true, count: content.length });
  }
  if (url.pathname === "/api/tests") {
    const user = expired ? undefined : users[sid];
    if (user && delayedTestsUser === user.username) {
      await new Promise((resolve) => { releaseDelayedTests.add(resolve); });
    }
    return user ? respondJson(response, 200, user.tests) : respondJson(response, 401, { message: "No autenticado" });
  }
  if (url.pathname.startsWith("/api/tests/")) {
    const user = expired ? undefined : users[sid];
    const testId = decodeURIComponent(url.pathname.slice("/api/tests/".length));
    if (!user) return respondJson(response, 401, { message: "No autenticado" });
    const ownedTest = user.tests.find((test) => test.id === testId);
    const availableQuestions = missingAttemptQuestion ? attemptQuestions.filter((question) => question.id !== 12) : attemptQuestions;
    return ownedTest
      ? respondJson(response, 200, availableQuestions.map((question) => ({ ...question, testId, category: ownedTest.category, userId: user.id })))
      : respondJson(response, 404, { message: "Test not found" });
  }
  if (url.pathname.startsWith("/api/questions/") && request.method === "DELETE") {
    const questionId = Number(url.pathname.slice("/api/questions/".length));
    const index = attemptQuestions.findIndex((question) => question.id === questionId);
    if (index >= 0) attemptQuestions.splice(index, 1);
    if (index >= 0) users["account-a"].tests[0].count = attemptQuestions.length;
    return response.writeHead(index >= 0 ? 204 : 404).end();
  }
  if (url.pathname === "/api/attempts" && request.method === "GET") {
    const user = expired ? undefined : users[sid];
    return user ? respondJson(response, 200, attemptState?.userId === user.id ? [attemptState] : []) : respondJson(response, 401, { message: "No autenticado" });
  }
  if (url.pathname === "/api/attempts" && request.method === "POST") {
    const user = expired ? undefined : users[sid];
    if (!user) return respondJson(response, 401, { message: "No autenticado" });
    const body = await readJson(request);
    attemptState = { id: 808, ...body, answers: nextAttemptSnapshot?.answers ?? {}, currentIndex: nextAttemptSnapshot?.currentIndex ?? 0, status: "in_progress", userId: user.id };
    nextAttemptSnapshot = null;
    return respondJson(response, 201, attemptState);
  }
  if (url.pathname === "/api/attempts/808" && request.method === "GET") {
    const user = expired ? undefined : users[sid];
    attemptReadCount += 1;
    if (failNextAttemptRead) {
      failNextAttemptRead = false;
      return respondJson(response, 503, { message: "Error temporal al recuperar el intento" });
    }
    if (delayNextAttemptRead) {
      delayNextAttemptRead = false;
      await new Promise((resolve) => { releaseAttemptRead = resolve; });
    }
    return user && attemptState?.userId === user.id
      ? respondJson(response, 200, attemptState)
      : respondJson(response, 404, { message: "Attempt not found" });
  }
  if (url.pathname === "/api/attempts/808" && request.method === "PUT") {
    const user = expired ? undefined : users[sid];
    if (!user) return respondJson(response, 401, { message: "No autenticado" });
    if (failNextAttemptSave) {
      failNextAttemptSave = false;
      return respondJson(response, 503, { message: "Error de guardado de prueba" });
    }
    const snapshot = await readJson(request);
    attemptSaveRequests.push(snapshot);
    if (delayAttemptSave) await new Promise((resolve) => { releaseAttemptSave = resolve; });
    if (delayAttemptSaveRequestNumber === attemptSaveRequests.length) await new Promise((resolve) => { releaseDelayedAttemptSave = resolve; });
    attemptSaveSnapshots.push(snapshot);
    attemptState = { ...attemptState, ...snapshot };
    return respondJson(response, 200, attemptState);
  }
  if (url.pathname === "/api/results" && request.method === "GET") {
    const user = expired ? undefined : users[sid];
    if (user && failNextResultsRead) {
      failNextResultsRead = false;
      return respondJson(response, 503, { message: "Error temporal al recuperar resultados" });
    }
    return user ? respondJson(response, 200, results.filter((result) => result.userId === user.id)) : respondJson(response, 401, { message: "No autenticado" });
  }
  if (url.pathname === "/api/attempts/808/finalize" && request.method === "POST") {
    const user = expired ? undefined : users[sid];
    if (!user) return respondJson(response, 401, { message: "No autenticado" });
    const body = await readJson(request);
    if (missingAttemptQuestion) return respondJson(response, 409, { message: "Faltan preguntas del intento" });
    if (delayAttemptFinalize) await new Promise((resolve) => { releaseAttemptFinalize = resolve; });
    let result = results.find((existing) => existing.attemptId === 808);
    if (!result) {
      finalizationPayloads.push(body);
      const correctCount = attemptQuestions.filter((question) => body.answers?.[question.id] === question.correctAnswer).length;
      attemptState = { ...attemptState, answers: body.answers, status: "completed", correctCount, score: Math.round(correctCount / attemptQuestions.length * 100) };
      result = {
        id: 9001, attemptId: 808, testId: attemptState.testId, correctCount,
        totalQuestions: attemptQuestions.length, score: attemptState.score,
        completedAt: "2026-10-28T00:00:00.000Z", userId: user.id,
      };
      results.push(result);
    }
    if (dropNextFinalizeResponse) {
      dropNextFinalizeResponse = false;
      return respondJson(response, 503, { message: "La confirmación de finalización se perdió después de guardar el resultado" });
    }
    return respondJson(response, 200, result);
  }
  if (url.pathname.startsWith("/api/")) return respondJson(response, 401, { message: "No autenticado" });

  const candidate = url.pathname === "/" || !path.extname(url.pathname) || url.pathname.startsWith("/test/")
    ? path.join(root, "index.html")
    : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (candidate !== path.join(root, "index.html") && !candidate.startsWith(`${root}${path.sep}`)) {
    response.writeHead(400).end("Bad path");
    return;
  }
  try {
    const info = await stat(candidate);
    const file = info.isDirectory() ? path.join(candidate, "index.html") : candidate;
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(4175, "127.0.0.1", () => {
  console.log("SEC-05 app fixture: http://localhost:4175/login");
});
