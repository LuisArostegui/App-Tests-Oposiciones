import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function resetFixture(request) {
  const response = await request.post("/__e2e/reset");
  expect(response.status()).toBe(204);
}

async function waitForReady(page) {
  await page.getByTestId("connection-status-overlay").waitFor({ state: "hidden", timeout: 6_000 }).catch(() => undefined);
}

async function login(page, username) {
  await page.goto("/login");
  await waitForReady(page);
  await page.getByTestId("input-username").fill(username);
  await page.getByTestId("input-password").fill("fixture-password");
  const testsResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/tests") && response.request().method() === "GET",
  );
  await page.getByTestId("button-login").click();
  const response = await testsResponse;
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual([
    { id: `${username}-private.json`, count: 1, category: username === "account-a" ? "Private A" : "Private B" },
  ]);
  await expect(page.getByTestId(`link-test-${username}-private.json`)).toBeVisible();
}

async function logout(page) {
  await page.getByTestId("button-logout").click();
  await expect(page.getByTestId("button-login")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test("does not show account A data after logout and account B login", async ({ page }) => {
  await login(page, "account-a");
  await logout(page);
  await login(page, "account-b");

  await expect(page.getByTestId("link-test-account-b-private.json")).toBeVisible();
  await expect(page.getByTestId("link-test-account-a-private.json")).toHaveCount(0);
});

test("clears cached private data in a second tab when the shared session changes", async ({ browser }) => {
  const context = await browser.newContext();
  const firstTab = await context.newPage();
  await login(firstTab, "account-a");

  const secondTab = await context.newPage();
  await secondTab.goto("/");
  await waitForReady(secondTab);
  await expect(secondTab.getByTestId("link-test-account-a-private.json")).toBeVisible();

  await logout(firstTab);
  await login(firstTab, "account-b");

  await expect(secondTab.getByTestId("link-test-account-b-private.json")).toBeVisible();
  await expect(secondTab.getByTestId("link-test-account-a-private.json")).toHaveCount(0);
  await context.close();
});

test("drops a delayed account A list response after changing to account B", async ({ page, request }) => {
  await login(page, "account-a");
  expect((await request.post("/__e2e/delay-tests", { data: { username: "account-a" } })).status()).toBe(204);

  const waitingForOldResponse = page.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/tests") && requestToCheck.method() === "GET",
  );
  await page.reload();
  await waitingForOldResponse;

  await logout(page);
  await login(page, "account-b");
  expect((await request.post("/__e2e/release-tests")).status()).toBe(204);

  await expect(page.getByTestId("link-test-account-b-private.json")).toBeVisible();
  await expect(page.getByTestId("link-test-account-a-private.json")).toHaveCount(0);
});

test("returns to login without retaining private UI when the server expires a session", async ({ page, request }) => {
  await login(page, "account-a");
  expect((await request.post("/__e2e/expire")).status()).toBe(204);

  await page.reload();
  await expect(page.getByTestId("button-login")).toBeVisible();
  await expect(page.getByTestId("link-test-account-a-private.json")).toHaveCount(0);
});

test("recovers an interrupted logout in a new page by revalidating the server session", async ({ browser, request }) => {
  const context = await browser.newContext();
  const closingPage = await context.newPage();
  await login(closingPage, "account-a");
  expect((await request.post("/__e2e/delay-logout")).status()).toBe(204);

  const logoutRequest = closingPage.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/auth/logout") && requestToCheck.method() === "POST",
  );
  await closingPage.getByTestId("button-logout").click();
  await logoutRequest;
  await closingPage.close();
  expect((await request.post("/__e2e/release-logout")).status()).toBe(204);

  const recoveredPage = await context.newPage();
  const identityRequest = recoveredPage.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/auth/me") && requestToCheck.method() === "GET",
  );
  await recoveredPage.goto("/");
  await identityRequest;
  await expect(recoveredPage.getByTestId("button-login")).toBeVisible();
  await expect(recoveredPage.getByTestId("link-test-account-a-private.json")).toHaveCount(0);
  await context.close();
});
