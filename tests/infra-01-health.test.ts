import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import { test } from "node:test";
import { createHealthHandler } from "../server/health";

async function requestHealth(checkDatabase: () => Promise<unknown>) {
  const app = express();
  app.get("/healthz", createHealthHandler(checkDatabase));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("health check returns a generic success when PostgreSQL responds", async () => {
  const response = await requestHealth(async () => ({ rows: [{ result: 1 }] }));
  assert.deepEqual(response, { status: 200, body: { status: "ok" } });
});

test("health check hides database errors in its response", async () => {
  const response = await requestHealth(async () => { throw new Error("database password leaked"); });
  assert.deepEqual(response, { status: 503, body: { status: "unavailable" } });
  assert.doesNotMatch(JSON.stringify(response.body), /password|database/i);
});
