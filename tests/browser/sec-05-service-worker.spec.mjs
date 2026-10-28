import { expect, test } from "@playwright/test";

test("production service worker isolates API responses and keeps static assets available offline", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4174/sec05-browser-test.html");

  await expect(page.locator("#results")).toHaveAttribute("data-result", "pass", { timeout: 30_000 });
  const results = await page.locator("#results").innerText();
  for (const assertion of [
    "Legacy private API cache removed",
    "Unrelated cache preserved",
    "API GET reaches the network",
    "API GET is absent from Cache Storage",
    "Static resource reaches the network",
    "Cached static resource remains available offline",
    "Offline API fails without stale data or HTML",
  ]) {
    expect(results).toContain(`PASS ${assertion}`);
  }

  await context.close();
});
