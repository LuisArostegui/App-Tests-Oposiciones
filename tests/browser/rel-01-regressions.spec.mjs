import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
  await request.post("/__e2e/reset");
});

async function login(page) {
  await page.goto("/login");
  await page.getByTestId("connection-status-overlay").waitFor({ state: "hidden", timeout: 6_000 }).catch(() => undefined);
  await page.getByTestId("input-username").fill("account-a");
  await page.getByTestId("input-password").fill("fixture-password");
  await page.getByTestId("button-login").click();
  await expect(page.getByText("Tu Biblioteca")).toBeVisible();
}

test("deleting a question refreshes both the test list counter and manager details without reloading", async ({ page }) => {
  await page.request.post("/__e2e/seed-question-count", { data: { count: 2 } });
  await login(page);
  await page.goto("/admin?test=account-a-private.json");
  await expect(page.getByText("2 preguntas")).toBeVisible();
  await expect(page.locator("div.flex.justify-between.items-center.text-sm").filter({ hasText: /^Preguntas/ })).toContainText("2");

  await page.getByTestId("button-delete-11").click();
  await page.getByTestId("button-confirm-delete-11").click();

  await expect(page.getByText("1 preguntas")).toBeVisible();
  await expect(page.locator("div.flex.justify-between.items-center.text-sm").filter({ hasText: /^Preguntas/ })).toContainText("1");
  await expect(page.getByTestId("text-question-11")).toHaveCount(0);
  await expect(page.getByTestId("text-question-12")).toBeVisible();
  await page.getByTestId("select-test").click();
  await expect(page.getByRole("option").filter({ hasText: "account-a-private" })).toContainText("1");
  await page.keyboard.press("Escape");
  await page.goto("/");
  await expect(page.getByTestId("link-test-account-a-private.json")).toContainText("1 Preg.");
});

test("an offline save fails visibly and remains retryable without leaving the attempt locked", async ({ page }) => {
  await login(page);
  await page.getByTestId("link-test-account-a-private.json").click();
  await page.getByTestId("button-start-test").click();
  await expect(page).toHaveURL(/\?attempt=808$/);
  await page.context().setOffline(true);

  await page.getByRole("button", { name: "A Correcta" }).click();
  await expect(page.getByTestId("attempt-save-status")).toContainText("No se pudo guardar", { timeout: 7_000 });
  await expect(page.getByTestId("button-next")).toBeEnabled();
  await expect(page.getByTestId("button-save-exit")).toBeEnabled();

  await page.context().setOffline(false);
  await page.getByTestId("button-save-exit").click();
  await expect(page).toHaveURL(/\/results$/);
  const state = await (await page.request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.answers).toEqual({ "11": "A" });
});

test("a save request that never responds times out and releases the attempt controls", async ({ page, request }) => {
  test.setTimeout(30_000);
  await login(page);
  await page.getByTestId("link-test-account-a-private.json").click();
  await page.getByTestId("button-start-test").click();
  await request.post("/__e2e/delay-attempt-save");

  await page.getByRole("button", { name: "A Correcta" }).click();
  await expect(page.getByTestId("attempt-save-status")).toContainText("Guardando");
  await expect(page.getByTestId("attempt-save-status")).toContainText("No se pudo guardar", { timeout: 13_000 });
  await expect(page.getByTestId("button-next")).toBeEnabled();
  await expect(page.getByTestId("button-save-exit")).toBeEnabled();
  await request.post("/__e2e/release-attempt-save");
});

test("continuing during an attempt refetch uses the refreshed answer snapshot", async ({ page, request }) => {
  await login(page);
  await page.getByTestId("link-test-account-a-private.json").click();
  await page.getByTestId("button-start-test").click();
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptReadCount).toBeGreaterThan(0);
  await page.evaluate(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (handler, timeout, ...args) => originalSetTimeout(handler, timeout === 500 ? 60_000 : timeout, ...args);
  });
  await page.getByRole("button", { name: "A Correcta" }).click();
  await request.post("/__e2e/delay-next-attempt-read");
  const saveRequest = page.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/attempts/808") && requestToCheck.method() === "PUT",
  );
  await page.getByTestId("button-save-exit").click();
  await saveRequest;
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.getByTestId("button-continue-808")).toBeVisible();
  await page.getByTestId("button-continue-808").click();
  await expect(page.getByRole("button", { name: "A Correcta" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("attempt-question-conflict")).toHaveCount(0);

  await request.post("/__e2e/release-attempt-read");
});
