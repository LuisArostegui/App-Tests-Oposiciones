import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const usernames = [];

test.afterAll(async () => {
  try {
    if (process.env.REL01_KEEP_DATA !== "true" && usernames.length > 0) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT id FROM users WHERE username = ANY($1::text[])", [usernames]);
        const userIds = rows.map(({ id }) => id);
        if (userIds.length > 0) {
          await client.query("DELETE FROM session WHERE sess #>> '{passport,user}' = ANY($1::text[])", [userIds.map(String)]);
          await client.query("DELETE FROM results WHERE user_id = ANY($1::int[])", [userIds]);
          await client.query("DELETE FROM test_attempts WHERE user_id = ANY($1::int[])", [userIds]);
          await client.query("DELETE FROM questions WHERE user_id = ANY($1::int[])", [userIds]);
          await client.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
});

function makeBank(prefix) {
  return [
    { pregunta: `${prefix} pregunta 1`, respuestas: { A: "Correcta 1", B: "Incorrecta 1" }, respuesta_correcta: "A", oposicion: "REL-01" },
    { pregunta: `${prefix} pregunta 2`, respuestas: { A: "Incorrecta 2", B: "Correcta 2" }, respuesta_correcta: "B", oposicion: "REL-01" },
    { pregunta: `${prefix} pregunta 3`, respuestas: { A: "Incorrecta 3", C: "Correcta 3" }, respuesta_correcta: "C", oposicion: "REL-01" },
  ];
}

async function register(page, username) {
  usernames.push(username);
  await page.goto("/register");
  await page.getByTestId("input-username").fill(username);
  await page.getByTestId("input-password").fill("rel01-test-password");
  await page.getByTestId("input-confirm-password").fill("rel01-test-password");
  await page.getByTestId("button-register").click();
  await expect(page.getByText("Tu Biblioteca")).toBeVisible();
}

async function login(page, username) {
  await page.goto("/login");
  await page.getByTestId("input-username").fill(username);
  await page.getByTestId("input-password").fill("rel01-test-password");
  await page.getByTestId("button-login").click();
  await expect(page.getByText("Tu Biblioteca")).toBeVisible();
}

async function importBank(page, filename, questions) {
  await page.getByRole("button", { name: "Importar JSON Local" }).click();
  await page.getByLabel("Selecciona archivo .json").setInputFiles({
    name: filename,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(questions)),
  });
  await page.getByRole("button", { name: "Importar Archivo" }).click();
  await expect(page.getByTestId(`link-test-${filename}`)).toBeVisible();
}

async function openMenu(page, testId, action) {
  await page.getByTestId(`link-test-${testId}`).click({ button: "right" });
  await page.getByTestId(`menu-${action}-${testId}`).click();
}

test("REL-01 recorre registro, importación, guardado, recuperación, cierre, renombrado, borrado y aislamiento con API y PostgreSQL reales", async ({ browser, baseURL }) => {
  const owner = `rel01-owner-${randomUUID()}`;
  const other = `rel01-other-${randomUUID()}`;
  const originalBank = "rel01-bank.json";
  const openBank = "rel01-open-bank.json";
  const renamedBank = "rel01-renamed-bank.json";
  const context = await browser.newContext();
  const page = await context.newPage();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();

  try {
    await register(page, owner);
    await page.getByTestId("button-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, owner);
    const appApi = page.request;
    const importedQuestions = makeBank("Recorrido principal");
    await importBank(page, originalBank, importedQuestions);

    const importedResponse = await appApi.get(`${baseURL}/api/tests`);
    expect(importedResponse.status()).toBe(200);
    expect(await importedResponse.json()).toEqual([{ id: originalBank, count: 3, category: "REL-01" }]);
    const ownerId = Number((await pool.query("SELECT id FROM users WHERE username = $1", [owner])).rows[0].id);
    const persistedQuestions = await pool.query(
      "SELECT id, question_text FROM questions WHERE user_id = $1 AND test_id = $2 ORDER BY id",
      [ownerId, originalBank],
    );
    expect(persistedQuestions.rows.map(({ question_text }) => question_text)).toEqual(importedQuestions.map(({ pregunta }) => pregunta));

    await page.getByTestId(`link-test-${originalBank}`).click();
    await page.getByTestId("button-start-test").click();
    await expect(page.getByText("Recorrido principal pregunta 1")).toBeVisible();
    const attemptUrl = page.url();
    const attemptId = Number(new URL(attemptUrl).searchParams.get("attempt"));
    await page.getByRole("button", { name: /Correcta 1/ }).click();
    await expect.poll(async () => {
      const { rows } = await pool.query("SELECT answers FROM test_attempts WHERE id = $1", [attemptId]);
      return Object.keys(rows[0]?.answers ?? {}).length;
    }).toBe(1);

    await page.getByTestId("button-next").click();
    await expect(page.getByText("Recorrido principal pregunta 2")).toBeVisible();
    await expect.poll(async () => {
      const { rows } = await pool.query("SELECT current_index FROM test_attempts WHERE id = $1", [attemptId]);
      return rows[0]?.current_index;
    }).toBe(1);

    let failNextSave = true;
    await page.route("**/api/attempts/*", async (route) => {
      if (failNextSave && route.request().method() === "PUT") {
        failNextSave = false;
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: /Incorrecta 2/ }).click();
    await expect(page.getByTestId("attempt-save-status")).toContainText("No se pudo guardar");
    await expect(page).toHaveURL(attemptUrl);
    await expect(page.getByRole("button", { name: /Incorrecta 2/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Progreso Guardado")).toHaveCount(0);
    const beforeRetry = await pool.query("SELECT answers FROM test_attempts WHERE id = $1", [attemptId]);
    expect(beforeRetry.rows[0].answers).toEqual({ [String(persistedQuestions.rows[0].id)]: "A" });

    await page.unroute("**/api/attempts/*");
    const saveRetry = page.waitForResponse((response) => response.url().includes(`/api/attempts/${attemptId}`) && response.request().method() === "PUT");
    await page.getByTestId("button-save-exit").click();
    expect((await saveRetry).status()).toBe(200);
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByText("Progreso Guardado", { exact: true })).toBeVisible();

    const savedFromApi = await appApi.get(`${baseURL}/api/attempts/${attemptId}`);
    expect(savedFromApi.status()).toBe(200);
    expect(await savedFromApi.json()).toMatchObject({ currentIndex: 1, answers: { [String(persistedQuestions.rows[0].id)]: "A", [String(persistedQuestions.rows[1].id)]: "A" } });
    const storedAfterRetry = await pool.query("SELECT current_index, answers, status FROM test_attempts WHERE id = $1", [attemptId]);
    expect(storedAfterRetry.rows[0]).toMatchObject({ current_index: 1, status: "in_progress" });
    expect(storedAfterRetry.rows[0].answers).toEqual(await savedFromApi.json().then((attempt) => attempt.answers));

    await page.reload();
    await expect(page).toHaveURL(/\/results$/);
    await page.getByTestId(`button-continue-${attemptId}`).click();
    await expect(page.getByText("Recorrido principal pregunta 2")).toBeVisible();
    await expect(page.getByRole("button", { name: /Incorrecta 2/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("button-next").click();
    await expect(page.getByText("Recorrido principal pregunta 3")).toBeVisible();
    await page.getByRole("button", { name: /Correcta 3/ }).click();
    await page.getByTestId("button-finish").click();
    await expect(page.getByText("Has respondido 2 de 3 correctamente.")).toBeVisible();
    await expect(page.getByText("67%", { exact: true })).toBeVisible();

    const firstHistory = await appApi.get(`${baseURL}/api/results`);
    expect(firstHistory.status()).toBe(200);
    const firstResult = (await firstHistory.json())[0];
    expect(firstResult).toMatchObject({ attemptId, testId: originalBank, correctCount: 2, totalQuestions: 3, score: 67 });
    const completedInDb = await pool.query(
      "SELECT status, score, correct_count FROM test_attempts WHERE id = $1",
      [attemptId],
    );
    expect(completedInDb.rows[0]).toEqual({ status: "completed", score: 67, correct_count: 2 });
    await page.reload();
    await expect(page.getByText("Has respondido 2 de 3 correctamente.")).toBeVisible();
    await expect(page.getByText("67%", { exact: true })).toBeVisible();
    expect((await (await appApi.get(`${baseURL}/api/results`)).json()).filter(({ attemptId: linkedAttempt }) => linkedAttempt === attemptId)).toHaveLength(1);

    await page.goto("/");
    const renameResponse = await appApi.put(`${baseURL}/api/tests/${encodeURIComponent(originalBank)}/rename`, {
      headers: { origin: baseURL, referer: `${baseURL}/` },
      data: { newName: "rel01-renamed-bank" },
    });
    expect(renameResponse.status()).toBe(200);
    expect(await renameResponse.json()).toEqual({ success: true, newId: renamedBank });
    const renamedAttempt = await appApi.get(`${baseURL}/api/attempts/${attemptId}`);
    expect((await renamedAttempt.json()).testId).toBe(renamedBank);
    const renamedHistory = await appApi.get(`${baseURL}/api/results`);
    expect((await renamedHistory.json()).filter(({ attemptId: linkedAttempt }) => linkedAttempt === attemptId)).toMatchObject([{ ...firstResult, testId: renamedBank }]);
    expect((await (await appApi.get(`${baseURL}/api/tests`)).json()).map(({ id }) => id)).toContain(renamedBank);
    await page.reload();
    await expect(page.getByTestId(`link-test-${renamedBank}`)).toBeVisible();

    await importBank(page, openBank, makeBank("Banco abierto"));
    await page.getByTestId(`link-test-${openBank}`).click();
    await page.getByTestId("button-start-test").click();
    await expect(page).toHaveURL(/\?attempt=\d+$/);
    const openAttemptId = Number(new URL(page.url()).searchParams.get("attempt"));
    await page.getByTestId("button-save-exit").click();
    await expect(page).toHaveURL(/\/results$/);
    await page.goto("/");
    await openMenu(page, openBank, "delete");
    const rejectedDelete = page.waitForResponse((response) => response.url().includes(`/api/tests/${encodeURIComponent(openBank)}`) && response.request().method() === "DELETE");
    await page.getByTestId("button-confirm-delete").click();
    expect((await rejectedDelete).status()).toBe(409);
    await expect(page.getByTestId(`link-test-${openBank}`)).toBeVisible();
    const rejectedAttempt = await appApi.get(`${baseURL}/api/attempts/${openAttemptId}`);
    expect(rejectedAttempt.status()).toBe(200);
    expect((await rejectedAttempt.json()).status).toBe("in_progress");

    await openMenu(page, renamedBank, "delete");
    const allowedDelete = page.waitForResponse((response) => response.url().includes(`/api/tests/${encodeURIComponent(renamedBank)}`) && response.request().method() === "DELETE");
    await page.getByTestId("button-confirm-delete").click();
    expect((await allowedDelete).status()).toBe(204);
    const testsAfterDelete = await (await appApi.get(`${baseURL}/api/tests`)).json();
    expect(testsAfterDelete.some(({ id }) => id === renamedBank)).toBe(false);
    const historicalAfterDelete = (await (await appApi.get(`${baseURL}/api/results`)).json()).filter(({ attemptId: linkedAttempt }) => linkedAttempt === attemptId);
    expect(historicalAfterDelete).toHaveLength(1);
    expect(historicalAfterDelete[0]).toMatchObject({ id: firstResult.id, testId: renamedBank, score: 67 });

    await register(otherPage, other);
    await otherPage.getByTestId("button-logout").click();
    await expect(otherPage).toHaveURL(/\/login$/);
    await login(otherPage, other);
    const otherApi = otherPage.request;
    expect(await (await otherApi.get(`${baseURL}/api/tests`)).json()).toEqual([]);
    expect(await (await otherApi.get(`${baseURL}/api/attempts`)).json()).toEqual([]);
    expect(await (await otherApi.get(`${baseURL}/api/results`)).json()).toEqual([]);
    await expect(otherPage.getByTestId(`link-test-${renamedBank}`)).toHaveCount(0);

    await page.goto("/");
    await page.getByTestId("button-logout").click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, other);
    await expect(page.getByText("No hay tests importados")).toBeVisible();
    await expect(page.getByTestId(`link-test-${renamedBank}`)).toHaveCount(0);
    expect(await (await page.request.get(`${baseURL}/api/tests`)).json()).toEqual([]);
    expect(await (await page.request.get(`${baseURL}/api/results`)).json()).toEqual([]);
  } finally {
    await otherContext.close();
    await context.close();
  }
});

test("BUG-05 ordena de forma estable y presenta los 10 resultados más recientes", async ({ browser, baseURL }) => {
  const username = `rel01-history-${randomUUID()}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await register(page, username);
    const userId = Number((await pool.query("SELECT id FROM users WHERE username = $1", [username])).rows[0].id);
    const baseTime = new Date("2025-01-01T00:00:00.000Z");
    const inserted = [];
    for (const index of [...Array.from({ length: 10 }, (_value, position) => position), 11, 10]) {
      const completedAt = index >= 10
        ? new Date(baseTime.getTime() + 11 * 60_000)
        : new Date(baseTime.getTime() + index * 60_000);
      const { rows } = await pool.query(
        "INSERT INTO results (test_id, score, correct_count, total_questions, completed_at, user_id) VALUES ($1, $2, 1, 1, $3, $4) RETURNING id",
        [`history-${index}.json`, 10 + index, completedAt, userId],
      );
      inserted.push({ id: rows[0].id, index, completedAt });
    }

    const apiResponse = await page.request.get(`${baseURL}/api/results`);
    expect(apiResponse.status()).toBe(200);
    const apiResults = await apiResponse.json();
    expect(apiResults).toHaveLength(12);
    const expectedHistory = inserted.slice().sort((left, right) =>
      right.completedAt.getTime() - left.completedAt.getTime() || right.id - left.id,
    );
    expect(apiResults.map(({ id }) => id)).toEqual(expectedHistory.map(({ id }) => id));

    await page.goto("/results");
    const resultRows = page.locator("tbody tr");
    await expect(resultRows).toHaveCount(12);
    const visibleRows = await resultRows.allTextContents();
    expect(visibleRows[0]).toContain("history-10");
    expect(visibleRows[1]).toContain("history-11");
    expect(visibleRows.at(-1)).toContain("history-0");

    const chartDots = page.locator(".recharts-line-dot");
    await expect(chartDots).toHaveCount(10);
    await chartDots.last().hover();
    await expect(page.locator(".recharts-tooltip-wrapper")).toContainText("20");
  } finally {
    await context.close();
  }
});
