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
  await page.getByTestId("link-test-account-a-private.json").click();
  await page.getByTestId("button-start-test").click();
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
