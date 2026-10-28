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
  const testsResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/tests") && response.request().method() === "GET",
  );
  await page.getByTestId("button-login").click();
  expect((await testsResponse).status()).toBe(200);
  const initialResultsResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/results") && response.request().method() === "GET",
  );
  await page.getByTestId("link-test-account-a-private.json").click();
  expect((await initialResultsResponse).status()).toBe(200);
  await page.getByTestId("button-start-test").click();
  await expect(page).toHaveURL(/\?attempt=\d+$/);
}

test("finalization waits for the server and includes the last selected answer", async ({ page, request }) => {
  await login(page);
  await page.getByRole("button", { name: "A Correcta" }).click();
  await page.getByTestId("button-next").click();
  await page.getByRole("button", { name: "A Incorrecta" }).click();

  await request.post("/__e2e/delay-attempt-finalize");
  const finalizeRequest = page.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/attempts/808/finalize") && requestToCheck.method() === "POST",
  );
  await page.getByTestId("button-finish").click();
  await finalizeRequest;

  await expect(page.getByTestId("button-finish")).toBeDisabled();
  await expect(page.getByText("Has respondido 1 de 2 correctamente.")).toHaveCount(0);
  await request.post("/__e2e/release-attempt-finalize");
  await expect(page.getByText("Has respondido 1 de 2 correctamente.")).toBeVisible();

  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.finalizationPayloads).toEqual([{ answers: { "11": "A", "12": "A" } }]);
});

test("a failed save retains answers and Save and Exit navigates only after retry confirmation", async ({ page, request }) => {
  await login(page);
  await request.post("/__e2e/fail-next-attempt-save");
  await page.getByRole("button", { name: "A Correcta" }).click();

  await expect(page.getByTestId("attempt-save-status")).toContainText("No se pudo guardar", { timeout: 8_000 });
  expect(page.url()).toContain("/test/account-a-private.json");
  await expect(page.getByRole("button", { name: "A Correcta" })).toBeVisible();

  await request.post("/__e2e/delay-attempt-save");
  const saveRequest = page.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/attempts/808") && requestToCheck.method() === "PUT",
  );
  await page.getByTestId("button-save-exit").click();
  await saveRequest;
  await expect(page.getByTestId("button-save-exit")).toBeDisabled();
  await expect(page.getByRole("button", { name: "B Incorrecta" })).toBeDisabled();
  await request.post("/__e2e/release-attempt-save");
  await expect(page).toHaveURL(/\/results$/);
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptState.answers).toEqual({ "11": "A" });
});

test("A to B to A snapshots stay ordered and Save and Exit waits for the latest A write", async ({ page, request }) => {
  await login(page);
  await request.post("/__e2e/delay-attempt-save");

  await page.getByRole("button", { name: "A Correcta" }).click();
  const firstSave = page.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/attempts/808") && requestToCheck.method() === "PUT",
  );
  await firstSave;
  await expect(page.getByTestId("attempt-save-status")).toContainText("Guardando");

  await page.getByTestId("button-next").click();
  await page.waitForTimeout(600);
  await page.getByTestId("button-previous").click();
  await page.waitForTimeout(600);

  await page.getByTestId("button-save-exit").click();
  await expect(page.getByTestId("button-save-exit")).toBeDisabled();
  await expect(page.getByText("Progreso Guardado")).toHaveCount(0);
  expect(page.url()).toContain("/test/account-a-private.json");

  await request.post("/__e2e/delay-attempt-save-request", { data: { requestNumber: 3 } });
  await request.post("/__e2e/release-attempt-save");
  await expect.poll(async () => (await (await request.get("/__e2e/attempt-state")).json()).attemptSaveRequests.length).toBe(3);
  await expect(page.getByText("Progreso Guardado")).toHaveCount(0);
  expect(page.url()).toContain("/test/account-a-private.json");
  await request.post("/__e2e/release-delayed-attempt-save");
  await expect(page).toHaveURL(/\/results$/);
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptSaveSnapshots.map(({ currentIndex }) => currentIndex)).toEqual([0, 1, 0]);
  expect(state.attemptState.currentIndex).toBe(0);
  expect(state.attemptState.answers).toEqual({ "11": "A" });
});

test("browser Back asks before leaving while answers have not been confirmed", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "A Correcta" }).click();
  const dialogPromise = page.waitForEvent("dialog");
  const backPromise = page.goBack();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain("respuestas pendientes");
  await dialog.dismiss();
  await backPromise;
  expect(page.url()).toContain("/test/account-a-private.json");
  await expect(page.getByRole("button", { name: "A Correcta" })).toBeDisabled();
});

test("a failed finalization acknowledgement recovers the same linked result in place without saving again", async ({ page, request }) => {
  await login(page);
  await page.getByRole("button", { name: "A Correcta" }).click();
  await page.getByTestId("button-next").click();
  await page.getByRole("button", { name: "A Incorrecta" }).click();
  await request.post("/__e2e/fail-next-finalize-response");
  expect((await (await request.get("/__e2e/attempt-state")).json()).dropNextFinalizeResponse).toBe(true);

  const finalizeRequest = page.waitForRequest((requestToCheck) =>
    requestToCheck.url().endsWith("/api/attempts/808/finalize") && requestToCheck.method() === "POST",
  );
  await page.getByTestId("button-finish").click();
  await finalizeRequest;
  expect((await (await request.get("/__e2e/attempt-state")).json()).dropNextFinalizeResponse).toBe(false);
  await expect(page.getByText("Has respondido 1 de 2 correctamente.")).toBeVisible();
  await expect(page.getByText("50%")).toBeVisible();
  const finalizedState = await (await request.get("/__e2e/attempt-state")).json();
  expect(finalizedState.attemptState.status).toBe("completed");
  expect(finalizedState.results).toHaveLength(1);
  const saveCountBeforeRecovery = finalizedState.attemptSaveSnapshots.length;
  await expect(page.getByTestId("button-save-exit")).toHaveCount(0);
  await page.waitForTimeout(700);

  const recoveredState = await (await request.get("/__e2e/attempt-state")).json();
  expect(recoveredState.results).toHaveLength(1);
  expect(recoveredState.results[0].id).toBe(finalizedState.results[0].id);
  expect(recoveredState.finalizationPayloads).toHaveLength(1);
  expect(recoveredState.attemptSaveSnapshots).toHaveLength(saveCountBeforeRecovery);
});

test("a failed results lookup can retry and recover a completed attempt without edits", async ({ page, request }) => {
  await login(page);
  await request.post("/__e2e/complete-attempt-with-result");
  await request.post("/__e2e/fail-next-results-read");
  await page.reload();

  await expect(page.getByText("No se pudo recuperar el resultado")).toBeVisible();
  await expect(page.getByTestId("button-save-exit")).toHaveCount(0);
  await expect(page.getByTestId("button-retry-result")).toBeVisible();
  await page.getByTestId("button-retry-result").click();
  await expect(page.getByText("Has respondido 1 de 2 correctamente.")).toBeVisible();
  await expect(page.getByText("50%")).toBeVisible();

  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.results).toHaveLength(1);
  expect(state.attemptSaveSnapshots).toHaveLength(0);
});

test("a completed historical attempt without a linked result is read-only and explains why its score is unavailable", async ({ page, request }) => {
  await login(page);
  await request.post("/__e2e/complete-attempt-without-result");
  await page.reload();

  await expect(page.getByTestId("completed-result-unavailable")).toContainText("no tiene un resultado asociado");
  await expect(page.getByTestId("button-home")).toBeVisible();
  await expect(page.getByTestId("button-save-exit")).toHaveCount(0);
  const state = await (await request.get("/__e2e/attempt-state")).json();
  expect(state.attemptSaveSnapshots).toHaveLength(0);
});
