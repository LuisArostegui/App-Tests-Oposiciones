import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import { applyPersistedSessionTransition, beginPrivateSessionTransition, clearPrivateQueryData, finishPrivateSessionTransition, isSessionTransitioning, queryClient, receivePrivateSessionMessage } from "../client/src/lib/queryClient";
import { enqueueAttemptUpdate } from "../client/src/hooks/use-attempts";

type WorkerEvent = {
  request?: Request;
  data?: unknown;
  respondWith?: (response: Promise<Response> | Response) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
};

async function createWorkerHarness(options: { fetch?: typeof fetch; initialCaches?: Map<string, Map<string, Response>> } = {}) {
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
          for (const url of urls) cache!.set(new URL(url, "https://app.test").href, new Response(url));
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

test("SEC-05: static assets keep an offline cached response", async () => {
  const harness = await createWorkerHarness({
    initialCaches: new Map([
      ["opostest-static-v1", new Map([["https://app.test/assets/main.css", new Response("cached css")]])],
      ["opostest-dynamic-v1", new Map([["https://app.test/api/tests", new Response("private data")]])],
    ]),
    fetch: async () => { throw new TypeError("offline"); },
  });
  await harness.lifecycle("activate");
  const response = await harness.fetch(new Request("https://app.test/assets/main.css"));
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
