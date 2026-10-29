import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import { applyPersistedSessionTransition, beginPrivateSessionTransition, capturePrivateSessionEpoch, clearPrivateQueryData, finishPrivateSessionTransition, interruptSessionTransition, isPrivateSessionEpochCurrent, isSessionTransitioning, queryClient, receivePrivateSessionMessage, recoverInterruptedSessionTransitions } from "../client/src/lib/queryClient";
import { withPrivateMutationCallbacks } from "../client/src/hooks/use-private-mutation";
import { enqueueAttemptUpdate, updateAttemptWithVersion } from "../client/src/hooks/use-attempts";

type WorkerEvent = {
  request?: Request;
  data?: unknown;
  respondWith?: (response: Promise<Response> | Response) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
};

async function createWorkerHarness(options: { fetch?: typeof fetch; initialCaches?: Map<string, Map<string, Response>>; precacheResponses?: Map<string, Response> } = {}) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const storedCaches = options.initialCaches ?? new Map<string, Map<string, Response>>();
  const fetchMock = options.fetch ?? fetch;
  const cacheStorage = {
    async open(name: string) {
      let cache = storedCaches.get(name);
      if (!cache) {
        cache = new Map();
        storedCaches.set(name, cache);
      }
      return {
        async addAll(urls: string[]) {
          for (const url of urls) {
            const key = new URL(url, "https://app.test").href;
            cache!.set(key, options.precacheResponses?.get(key)?.clone() ?? new Response(url));
          }
        },
        async put(request: Request | string, response: Response) {
          const url = request instanceof Request ? request.url : new URL(request, "https://app.test").href;
          cache!.set(url, response);
        },
        async match(request: Request | string) {
          const url = request instanceof Request ? request.url : new URL(request, "https://app.test").href;
          return cache!.get(url)?.clone();
        },
        async keys() { return [...cache!.keys()].map((url) => new Request(url)); },
      };
    },
    async keys() { return [...storedCaches.keys()]; },
    async delete(name: string) { return storedCaches.delete(name); },
    async match(request: Request | string) {
      for (const cache of storedCaches.values()) {
        const url = request instanceof Request ? request.url : new URL(request, "https://app.test").href;
        const response = cache.get(url);
        if (response) return response.clone();
      }
      return undefined;
    },
  };
  const self = {
    addEventListener(type: string, listener: (event: WorkerEvent) => void) { listeners.set(type, listener); },
    skipWaiting() {},
    clients: { claim: async () => undefined },
    location: { origin: "https://app.test" },
  };
  const context = { self, caches: cacheStorage, fetch: fetchMock, URL, Request, Response };
  const source = await readFile("client/public/sw.js", "utf8");
  vm.runInNewContext(source, context, { filename: "sw.js" });
  return {
    caches: storedCaches,
    dispatch(type: string, event: WorkerEvent) { listeners.get(type)?.(event); },
    async fetch(request: Request) {
      let response: Promise<Response> | Response | undefined;
      listeners.get("fetch")?.({ request, respondWith(value) { response = value; } });
      return response ? await response : undefined;
    },
    async lifecycle(type: "install" | "activate") {
      let pending: Promise<unknown> = Promise.resolve();
      listeners.get(type)?.({ waitUntil(value) { pending = value; } });
      await pending;
    },
  };
}

test("SEC-05: API GET responses never enter Cache Storage and offline API requests do not return stale data", async () => {
  const harness = await createWorkerHarness({ fetch: async () => new Response('{"private":"fresh"}', { status: 200 }) });
  const response = await harness.fetch(new Request("https://app.test/api/tests"));
  assert.equal(await response?.text(), '{"private":"fresh"}');
  assert.equal([...harness.caches.values()].some((cache) => cache.has("https://app.test/api/tests")), false);

  const oldApiCache = new Map([["https://app.test/api/tests", new Response('{"private":"old"}')]]);
  const offlineHarness = await createWorkerHarness({
    initialCaches: new Map([["opostest-dynamic-v1", oldApiCache]]),
    fetch: async () => { throw new TypeError("offline"); },
  });
  const offlineResponse = await offlineHarness.fetch(new Request("https://app.test/api/tests"));
  assert.equal(offlineResponse?.status, 503);
  assert.match(await offlineResponse!.text(), /offline|conexión/i);

  const crossOriginApiHarness = await createWorkerHarness({ fetch: async () => new Response('{"private":"network"}') });
  const crossOriginApiResponse = await crossOriginApiHarness.fetch(new Request("https://api.other.test/api/private"));
  assert.equal(await crossOriginApiResponse?.text(), '{"private":"network"}');
  assert.equal([...crossOriginApiHarness.caches.values()].some((cache) => cache.has("https://api.other.test/api/private")), false);
});

test("SEC-05: activation removes only this application's old caches and keeps static resources", async () => {
  const harness = await createWorkerHarness({ initialCaches: new Map([
    ["opostest-static-v1", new Map([["https://app.test/", new Response("old app")]])],
    ["opostest-dynamic-v1", new Map([["https://app.test/api/tests", new Response("private")]])],
    ["another-app-runtime", new Map([["https://app.test/shared", new Response("other app")]])],
  ]) });
  await harness.lifecycle("install");
  await harness.lifecycle("activate");
  assert.ok([...harness.caches.keys()].some((name) => name.startsWith("opostest-static-v")));
  assert.equal(harness.caches.has("opostest-dynamic-v1"), false);
  assert.equal(harness.caches.has("another-app-runtime"), true);
});

test("SEC-05: migration keeps the new shell and versioned assets instead of copying old HTML or unhashed files", async () => {
  const shellKey = "https://app.test/";
  const hashedAssetKey = "https://app.test/assets/index-AbCd1234.css";
  const freshShell = new Response("<html>new v2 shell</html>", { headers: { "Content-Type": "text/html" } });
  const freshAsset = new Response("new v2 stylesheet", { headers: { "Content-Type": "text/css" } });
  const harness = await createWorkerHarness({
    precacheResponses: new Map([[shellKey, freshShell]]),
    initialCaches: new Map([
      ["opostest-static-v2", new Map([[shellKey, freshShell.clone()], [hashedAssetKey, freshAsset.clone()]])],
      ["opostest-static-v1", new Map([
        [shellKey, new Response("<html>OLD V1 SHELL</html>", { headers: { "Content-Type": "text/html" } })],
        ["https://app.test/old/index.html", new Response("<html>OLD V1 DOCUMENT</html>", { headers: { "Content-Type": "text/html" } })],
        [hashedAssetKey, new Response("old stylesheet", { headers: { "Content-Type": "text/css" } })],
        ["https://app.test/assets/unhashed.css", new Response("unhashed stylesheet", { headers: { "Content-Type": "text/css" } })],
      ])],
    ]),
  });

  await harness.lifecycle("install");
  await harness.lifecycle("activate");

  const newStaticCache = harness.caches.get("opostest-static-v2")!;
  assert.equal(await newStaticCache.get(shellKey)?.text(), "<html>new v2 shell</html>");
  assert.equal(newStaticCache.has("https://app.test/old/index.html"), false);
  assert.equal(await newStaticCache.get(hashedAssetKey)?.text(), "new v2 stylesheet");
  assert.equal(newStaticCache.has("https://app.test/assets/unhashed.css"), false);
});

test("SEC-05: static assets keep an offline cached response", async () => {
  const harness = await createWorkerHarness({
    initialCaches: new Map([
      ["opostest-static-v1", new Map([["https://app.test/assets/main-AbCd1234.css", new Response("cached css", { headers: { "Content-Type": "text/css" } })]])],
      ["opostest-dynamic-v1", new Map([["https://app.test/api/tests", new Response("private data")]])],
    ]),
    fetch: async () => { throw new TypeError("offline"); },
  });
  await harness.lifecycle("activate");
  const response = await harness.fetch(new Request("https://app.test/assets/main-AbCd1234.css"));
  assert.equal(await response?.text(), "cached css");
  const apiCache = [...harness.caches.values()].find((cache) => cache.has("https://app.test/api/tests"));
  assert.equal(apiCache, undefined);
});

test("SEC-05: clearing private query data prevents a pending old-account query from repopulating it", async () => {
  queryClient.setQueryData(["/api/tests"], [{ id: "account-a-private" }]);
  let resolveQuery!: (value: string) => void;
  const pending = queryClient.fetchQuery({
    queryKey: ["/api/attempts"],
    queryFn: () => new Promise<string>((resolve) => { resolveQuery = resolve; }),
  });
  await Promise.resolve();

  await clearPrivateQueryData(false);
  resolveQuery("late account A data");
  await pending.catch(() => undefined);

  assert.equal(queryClient.getQueryData(["/api/tests"]), undefined);
  assert.equal(queryClient.getQueryData(["/api/attempts"]), undefined);
});

test("SEC-05: session tabs stay blocked until the server-side session change settles", async () => {
  const firstTransition = await beginPrivateSessionTransition();
  assert.equal(isSessionTransitioning(), true);
  const secondTransition = await beginPrivateSessionTransition();
  await finishPrivateSessionTransition(firstTransition);
  assert.equal(isSessionTransitioning(), true);
  await finishPrivateSessionTransition(secondTransition);
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: delayed start messages cannot reopen a settled session transition", async () => {
  const transitionId = "out-of-order-transition";
  await receivePrivateSessionMessage({ type: "session-transition-settled", transitionId });
  await receivePrivateSessionMessage({ type: "session-transition-start", transitionId });
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: a tab opened during a session transition starts with private queries blocked", async () => {
  applyPersistedSessionTransition("transition-already-in-progress", "active");
  assert.equal(isSessionTransitioning(), true);
  applyPersistedSessionTransition("transition-already-in-progress", "settled");
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: per-transition storage phases ignore late starts and preserve concurrent tabs", () => {
  applyPersistedSessionTransition("settled-before-delayed-start", "settled");
  applyPersistedSessionTransition("settled-before-delayed-start", "active");
  assert.equal(isSessionTransitioning(), false);

  applyPersistedSessionTransition("concurrent-transition-a", "active");
  applyPersistedSessionTransition("concurrent-transition-b", "active");
  applyPersistedSessionTransition("concurrent-transition-a", "settled");
  assert.equal(isSessionTransitioning(), true);
  applyPersistedSessionTransition("concurrent-transition-b", "settled");
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: an interrupted persisted transition stays blocked until server identity revalidation succeeds", async () => {
  const transitionId = await beginPrivateSessionTransition();
  interruptSessionTransition(transitionId);
  assert.equal(isSessionTransitioning(), true);

  let serverWasChecked = false;
  const identity = await recoverInterruptedSessionTransitions(async () => {
    serverWasChecked = true;
    assert.equal(isSessionTransitioning(), true);
    return { id: 2, username: "account-b" };
  });

  assert.equal(serverWasChecked, true);
  assert.deepEqual(identity, { id: 2, username: "account-b" });
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: failed interrupted-session revalidation keeps the private-data gate closed", async () => {
  const transitionId = await beginPrivateSessionTransition();
  interruptSessionTransition(transitionId);

  await assert.rejects(() => recoverInterruptedSessionTransitions(async () => { throw new Error("offline"); }));
  assert.equal(isSessionTransitioning(), true);
  await finishPrivateSessionTransition(transitionId);
});

test("SEC-05: a newer session change during recovery prevents returning the older identity", async () => {
  const interruptedId = await beginPrivateSessionTransition();
  interruptSessionTransition(interruptedId);
  let resolveRecovery!: (value: { id: number; username: string }) => void;
  const recovery = recoverInterruptedSessionTransitions(() => new Promise((resolve) => { resolveRecovery = resolve; }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  const newerTransitionId = await beginPrivateSessionTransition();
  resolveRecovery({ id: 1, username: "account-a" });
  assert.equal(await recovery, null);
  assert.equal(isSessionTransitioning(), true);

  await finishPrivateSessionTransition(newerTransitionId);
  const identity = await recoverInterruptedSessionTransitions(async () => ({ id: 2, username: "account-b" }));
  assert.deepEqual(identity, { id: 2, username: "account-b" });
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: interrupted recovery waits for active transitions and rejects a probe when transition phases change", async () => {
  const interruptedId = await beginPrivateSessionTransition();
  interruptSessionTransition(interruptedId);
  const activeId = await beginPrivateSessionTransition();

  let probeCalls = 0;
  assert.equal(await recoverInterruptedSessionTransitions(async () => {
    probeCalls++;
    return { id: 1, username: "account-a" };
  }), null);
  assert.equal(probeCalls, 0);

  await finishPrivateSessionTransition(activeId);
  let resolveRecovery!: (value: { id: number; username: string }) => void;
  const recovery = recoverInterruptedSessionTransitions(() => new Promise((resolve) => { resolveRecovery = resolve; }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  const concurrentId = await beginPrivateSessionTransition();
  resolveRecovery({ id: 1, username: "account-a" });
  assert.equal(await recovery, null);
  assert.equal(isSessionTransitioning(), true);

  await finishPrivateSessionTransition(concurrentId);
  const identity = await recoverInterruptedSessionTransitions(async () => ({ id: 2, username: "account-b" }));
  assert.deepEqual(identity, { id: 2, username: "account-b" });
  assert.equal(isSessionTransitioning(), false);
});

test("SEC-05: a mutation callback from the previous session cannot repopulate the private query cache", async () => {
  let finishMutation!: (value: string) => void;
  let markMutationStarted!: () => void;
  const mutationStarted = new Promise<void>((resolve) => { markMutationStarted = resolve; });
  let callbackRan = false;
  const mutation = queryClient.getMutationCache().build(queryClient, withPrivateMutationCallbacks({
    mutationFn: () => new Promise<string>((resolve) => { finishMutation = resolve; }),
    onMutate: () => { markMutationStarted(); },
    onSuccess: () => {
      callbackRan = true;
      queryClient.setQueryData(["/api/tests"], [{ id: "old-account" }]);
    },
  }, capturePrivateSessionEpoch, isPrivateSessionEpochCurrent));
  const pendingMutation = mutation.execute();
  await mutationStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const transitionId = await beginPrivateSessionTransition();
  finishMutation("old account result");
  await pendingMutation;

  assert.equal(callbackRan, false);
  assert.equal(queryClient.getQueryData(["/api/tests"]), undefined);
  await finishPrivateSessionTransition(transitionId);
});

test("SEC-05: an older attempt autosave cannot finish after and overwrite the explicit save", async () => {
  const order: string[] = [];
  let finishFirst!: () => void;
  const first = enqueueAttemptUpdate(501, async () => {
    order.push("autosave started");
    await new Promise<void>((resolve) => { finishFirst = resolve; });
    order.push("autosave finished");
  });
  const second = enqueueAttemptUpdate(501, async () => { order.push("explicit save finished"); });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["autosave started"]);
  finishFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["autosave started", "autosave finished", "explicit save finished"]);
});

test("SEC-05: duplicate writes for the same attempt snapshot share one pending request", async () => {
  let release!: () => void;
  let calls = 0;
  const update = () => {
    calls++;
    return new Promise<void>((resolve) => { release = resolve; });
  };
  const first = enqueueAttemptUpdate(503, update, "update:{\"currentIndex\":1}");
  const duplicate = enqueueAttemptUpdate(503, update, "update:{\"currentIndex\":1}");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await Promise.all([first, duplicate]);
  assert.equal(calls, 1);
});

test("SEC-05: queued attempt writes from the old session do not start after a session change", async () => {
  let finishFirst!: () => void;
  let staleWriteStarted = false;
  const first = enqueueAttemptUpdate(502, async () => new Promise<void>((resolve) => { finishFirst = resolve; }));
  const queued = enqueueAttemptUpdate(502, async () => { staleWriteStarted = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const transitionId = await beginPrivateSessionTransition();
  finishFirst();
  await first;
  await assert.rejects(queued, /sesión cambió/i);
  assert.equal(staleWriteStarted, false);
  await finishPrivateSessionTransition(transitionId);
});

test("SEC-05: a late attempt-version read from the old session cannot repopulate cache or issue a PUT", async () => {
  const attemptId = 904;
  const attemptKey = ["/api/attempts/:id", attemptId];
  queryClient.removeQueries({ queryKey: attemptKey });
  const originalFetch = globalThis.fetch;
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  let releaseRead!: (response: Response) => void;
  const pendingRead = new Promise<Response>((resolve) => { releaseRead = resolve; });
  let putCalls = 0;
  globalThis.fetch = async (_input, init) => {
    if ((init?.method ?? "GET").toUpperCase() === "GET") {
      markReadStarted();
      return pendingRead;
    }
    putCalls += 1;
    return Response.json({ id: attemptId, writeVersion: 1, answers: { "11": "B" }, currentIndex: 1 });
  };

  const staleWrite = enqueueAttemptUpdate(attemptId, (sessionEpoch) =>
    updateAttemptWithVersion(attemptId, { currentIndex: 1 }, queryClient, sessionEpoch),
  );
  try {
    await readStarted;
    await clearPrivateQueryData(false);
    releaseRead(Response.json({ id: attemptId, writeVersion: 0, answers: {}, currentIndex: 0 }));
    await assert.rejects(staleWrite, /sesión cambió/i);

    assert.equal(queryClient.getQueryData(attemptKey), undefined);
    assert.equal(putCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await clearPrivateQueryData(false);
  }
});

test("SEC-05: an attempt update from a new session cannot reuse the previous session's deduplicated promise", async () => {
  let releaseOldUpdate!: (value: string) => void;
  const oldUpdateResult = new Promise<string>((resolve) => { releaseOldUpdate = resolve; });
  let newSessionUpdateStarted = false;
  const oldUpdate = enqueueAttemptUpdate(905, () => oldUpdateResult, "same-attempt-snapshot");
  await new Promise<void>((resolve) => setImmediate(resolve));

  await clearPrivateQueryData(false);
  const newSessionUpdate = enqueueAttemptUpdate(905, async () => {
    newSessionUpdateStarted = true;
    return "account B";
  }, "same-attempt-snapshot");
  releaseOldUpdate("account A");

  await oldUpdate;
  assert.equal(await newSessionUpdate, "account B");
  assert.equal(newSessionUpdateStarted, true);
});
