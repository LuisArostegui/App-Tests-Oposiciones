import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  globalTimeout: 8 * 60_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4186",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node script/run-server.mjs development",
    cwd: projectRoot,
    url: "http://127.0.0.1:4186/login",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL,
      APP_URL: process.env.APP_URL,
      SESSION_SECRET: process.env.SESSION_SECRET,
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      REQUEST_LOGGING_ENABLED: process.env.REQUEST_LOGGING_ENABLED,
      REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED,
    },
  },
});
