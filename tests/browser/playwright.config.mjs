import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
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
    },
    {
      command: "node sec-05-server.mjs",
      url: "http://127.0.0.1:4174/sec05-browser-test.html",
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
