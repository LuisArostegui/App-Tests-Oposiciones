import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function reset(request) {
  expect((await request.post("/__e2e/reset")).status()).toBe(204);
}

async function login(page, request) {
  await page.goto("/login");
  await page.getByTestId("connection-status-overlay").waitFor({ state: "hidden", timeout: 6_000 }).catch(() => undefined);
  await page.getByTestId("input-username").fill("account-a");
  await page.getByTestId("input-password").fill("fixture-password");
  await page.getByTestId("button-login").click();
  await expect(page.getByText("Tu Biblioteca")).toBeVisible();
}

async function startAttempt(page) {
  await page.getByTestId("link-test-account-a-private.json").click();
  await page.getByTestId("button-start-test").click();
  await expect(page).toHaveURL(/\?attempt=808$/);
  await expect(page.getByText("Pregunta de prueba uno")).toBeVisible();
}

test.beforeEach(async ({ request }) => reset(request));

test("temporary attempt-load server failure retries the same attempt with saved answers and URL context", async ({ page, request, browser }) => {
  await login(page, request);
  await startAttempt(page);
  await page.getByRole("button", { name: "Correcta" }).first().click();
  await expect.poll(async () => {
    const state = await (await request.get("/__e2e/attempt-state")).json();
    return state.attemptState?.answers?.["11"];
  }).toBe("A");

  const attemptUrl = page.url();
  expect(new URL(attemptUrl).searchParams.get("attempt")).toBe("808");
  const beforeReads = (await (await request.get("/__e2e/attempt-state")).json()).attemptReadCount;
  await request.post("/__e2e/fail-next-attempt-read");
  const resumeContext = await browser.newContext();
  await resumeContext.addCookies([{ name: "sec05sid", value: "account-a", url: new URL(attemptUrl).origin }]);
  const resumePage = await resumeContext.newPage();
  await resumePage.goto(attemptUrl);
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptReadCount).toBeGreaterThan(beforeReads);
  await expect(resumePage.getByTestId("attempt-load-error")).toContainText("servidor");
  await expect(resumePage).toHaveURL(attemptUrl);
  await expect(resumePage.getByTestId("button-start-test")).toHaveCount(0);

  await resumePage.getByTestId("button-retry-attempt").click();
  await expect(resumePage.getByText("Pregunta de prueba uno")).toBeVisible();
  await expect(resumePage.getByRole("button", { name: "Correcta" }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(resumePage).toHaveURL(attemptUrl);
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.id).toBe(808);
  expect(state.attemptState.answers["11"]).toBe("A");

  await resumeContext.clearCookies();
  await resumePage.goto(attemptUrl);
  await expect(resumePage).toHaveURL(/\/login\?returnTo=/);
  await resumePage.getByTestId("input-username").fill("account-a");
  await resumePage.getByTestId("input-password").fill("fixture-password");
  await resumePage.getByTestId("button-login").click();
  await expect(resumePage.getByText("Pregunta de prueba uno")).toBeVisible();
  await expect(resumePage).toHaveURL(attemptUrl);
  await expect(resumePage.getByRole("button", { name: "Correcta" }).first()).toHaveAttribute("aria-pressed", "true");
  await resumeContext.close();
});

test("an attempt with a missing question shows a conflict and never continues with a shortened test", async ({ page, request }) => {
  await login(page, request);
  await startAttempt(page);
  const attemptUrl = page.url();
  await request.post("/__e2e/omit-attempt-question");

  await page.goto(attemptUrl);
  await expect(page.getByTestId("attempt-question-conflict")).toBeVisible();
  await expect(page).toHaveURL(attemptUrl);
  await expect(page.getByTestId("button-finish")).toHaveCount(0);
  await expect(page.getByTestId("button-start-test")).toHaveCount(0);
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.id).toBe(808);
  expect(state.attemptState.status).toBe("in_progress");
});

test("an old attempt URL after test rename redirects and resumes the same attempt", async ({ page, request }) => {
  await login(page, request);
  await startAttempt(page);
  await page.getByRole("button", { name: "Correcta" }).first().click();
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptState.answers["11"]).toBe("A");
  const oldAttemptUrl = page.url();
  const renamedTestId = "renamed #1 % Ánimo.json";
  await request.post("/__e2e/rename-attempt-test", { data: { testId: renamedTestId } });

  await page.goto(oldAttemptUrl);

  await expect(page).toHaveURL(new RegExp(`/test/${encodeURIComponent(renamedTestId)}\\?attempt=808$`));
  await expect(page.getByText("Pregunta de prueba uno")).toBeVisible();
  await expect(page.getByRole("button", { name: "Correcta" }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("attempt-question-conflict")).toHaveCount(0);
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.id).toBe(808);
  expect(state.attemptState.testId).toBe(renamedTestId);
  expect(state.attemptState.answers["11"]).toBe("A");
});

test("retrying question lookup keeps the conflict until every attempt question is available", async ({ page, request }) => {
  await login(page, request);
  await startAttempt(page);
  await page.getByRole("button", { name: "A Correcta" }).click();
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptState.answers["11"]).toBe("A");
  await page.getByTestId("button-next").click();
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptState.currentIndex).toBe(1);
  const attemptUrl = page.url();
  await request.post("/__e2e/omit-attempt-question");

  await page.goto(attemptUrl);
  await expect(page.getByTestId("attempt-question-conflict")).toBeVisible();
  await page.getByTestId("button-retry-questions").click();
  await expect(page.getByTestId("attempt-question-conflict")).toBeVisible();
  await expect(page.getByTestId("button-start-test")).toHaveCount(0);
  await expect(page).toHaveURL(attemptUrl);

  await request.post("/__e2e/restore-attempt-question");
  await page.getByTestId("button-retry-questions").click();
  await expect(page.getByText("Pregunta de prueba dos")).toBeVisible();
  await expect(page.getByTestId("attempt-question-conflict")).toHaveCount(0);
  await expect(page).toHaveURL(attemptUrl);
  await expect(page.getByTestId("button-start-test")).toHaveCount(0);
  await page.getByTestId("button-finish").click();
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptState.status).toBe("completed");
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.id).toBe(808);
  expect(state.attemptState.status).toBe("completed");
  expect(state.finalizationPayloads).toEqual([{ answers: { "11": "A" } }]);
});

test("finishing before autosave keeps local answers and question index after conflict retry", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, request);
  await request.post("/__e2e/seed-next-attempt", { data: { answers: { "11": "A" }, currentIndex: 0 } });
  await startAttempt(page);
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptReadCount).toBeGreaterThan(0);
  await page.evaluate(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (handler, timeout, ...args) =>
      originalSetTimeout(handler, timeout === 500 ? 60_000 : timeout, ...args);
  });
  await request.post("/__e2e/omit-attempt-question");
  await page.getByRole("button", { name: "B Incorrecta" }).click();
  await page.getByTestId("button-next").click();
  await expect(page.getByText("Pregunta de prueba dos")).toBeVisible();
  await page.getByTestId("button-finish").click();

  await expect(page.getByTestId("attempt-question-conflict")).toBeVisible();
  let state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.answers["11"]).toBe("A");
  expect(state.attemptState.currentIndex).toBe(0);

  await request.post("/__e2e/restore-attempt-question");
  await page.getByTestId("button-retry-questions").click();

  await expect(page.getByText("Pregunta de prueba dos")).toBeVisible();
  await page.getByRole("button", { name: "Anterior" }).click();
  await expect(page.getByRole("button", { name: "B Incorrecta" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\?attempt=808$/);
  await page.getByTestId("button-next").click();
  await page.getByTestId("button-finish").click();
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptState.status).toBe("completed");
  state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.finalizationPayloads).toEqual([{ answers: { "11": "B" } }]);
  expect(state.attemptState.answers["11"]).toBe("B");
});

test("special test names navigate through one encoded path and the manager preselects the chosen test", async ({ page, request }) => {
  const testId = "Tema #1 % aprobado Ánimo.json";
  await request.post("/__e2e/test-name", { data: { testId } });
  await login(page, request);

  const testLink = page.getByTestId(`link-test-${testId}`);
  await expect(testLink).toBeVisible();
  await expect(testLink).toHaveAttribute("href", `/test/${encodeURIComponent(testId)}`);
  const questionsResponse = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith("/api/tests/"));
  await testLink.click();
  const questionLoad = await questionsResponse;
  expect(questionLoad.status(), questionLoad.url()).toBe(200);
  await expect(page.getByTestId("button-start-test")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/test/${encodeURIComponent(testId)}`);

  await page.goto("/");
  await page.getByTestId(`link-test-${testId}`).click({ button: "right" });
  await page.getByTestId(`menu-edit-${testId}`).click();
  await expect(page).toHaveURL(new RegExp(`/admin\\?test=${encodeURIComponent(testId)}`));
  await expect(page.getByTestId("admin-selected-test")).toHaveText("Tema #1 % aprobado Ánimo");
});
