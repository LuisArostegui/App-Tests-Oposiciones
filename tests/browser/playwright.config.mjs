import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";

const fixtureOwner = randomUUID();
process.env.BROWSER_FIXTURE_OWNER = fixtureOwner;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  globalTeardown: "./teardown.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node sec-05-app-server.mjs",
      url: "http://127.0.0.1:4175/login",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: { BROWSER_FIXTURE_OWNER: fixtureOwner },
    },
    {
      command: "node sec-05-server.mjs",
      url: "http://127.0.0.1:4174/sec05-browser-test.html",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
      env: { BROWSER_FIXTURE_OWNER: fixtureOwner },
    },
  ],
});
