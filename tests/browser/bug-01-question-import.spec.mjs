import { expect, test } from "@playwright/test";

test("BUG-01: shows import validation errors and allows selecting a corrected file", async ({ page, request }) => {
  await request.post("/__e2e/reset");
  await page.goto("/login");
  await page.getByTestId("connection-status-overlay").waitFor({ state: "hidden", timeout: 6_000 }).catch(() => undefined);
  await page.getByTestId("input-username").fill("account-a");
  await page.getByTestId("input-password").fill("fixture-password");
  await page.getByTestId("button-login").click();
  await expect(page.getByText("Tu Biblioteca")).toBeVisible();

  await page.getByRole("button", { name: "Importar JSON Local" }).click();
  await expect(page.getByRole("link", { name: "Descargar ejemplo válido" })).toBeVisible();
  const fileInput = page.locator("#file");
  await fileInput.focus();
  expect(await fileInput.locator("..").evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
  await fileInput.setInputFiles({
    name: "preguntas.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([
      { pregunta: "  ", respuestas: { A: "3", B: "4" }, respuesta_correcta: "B" },
    ])),
  });
  await page.getByRole("button", { name: "Importar Archivo" }).click();
  await expect(page.getByRole("alert")).toContainText("Pregunta 1, campo pregunta");
  await expect(page.getByRole("dialog")).toBeVisible();

  await fileInput.setInputFiles({
    name: "preguntas.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([
      { pregunta: "Pregunta válida", respuestas: { A: "3", B: "4" }, respuesta_correcta: "B" },
    ])),
  });
  const importResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/tests/import") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Importar Archivo" }).click();
  expect((await importResponse).status()).toBe(201);
  await expect(page.getByText("Importación Exitosa")).toBeVisible();
  await expect(page.getByTestId("link-test-preguntas.json")).toBeVisible();
});
