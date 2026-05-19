import { expect, test } from "@playwright/test";

test("AI inbox writes a plan and setup dialog exports ICS", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const setupDialog = page.getByRole("dialog", { name: /连接提醒和 AI 后端/ });
  if (await setupDialog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /保存并开始/ }).click();
  }

  await expect(page.getByText("AI 收件箱")).toBeVisible();
  await page.getByRole("button", { name: /读书/ }).click();
  await expect(page.getByText("选书与页数")).toBeVisible();
  await page.getByRole("button", { name: /确认写入规划/ }).click();
  await expect
    .poll(() => page.locator(".block-title-input").evaluateAll((items) => items.map((item) => item.value)))
    .toContain("选书与页数");

  await page.getByLabel("记录一件要提醒的事").fill("20:00 读完第三章并摘录一句");
  await page.getByLabel("提醒时间").selectOption("tonight");
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect
    .poll(() => page.locator(".block-title-input").evaluateAll((items) => items.map((item) => item.value)))
    .toContain("20:00 读完第三章并摘录一句");

  await page.getByLabel("AI 收件箱输入").fill("写方案\n测试提醒闭环\n晚上复盘完成率");
  await page.getByRole("button", { name: /生成草稿/ }).click();
  await expect(page.getByRole("button", { name: /确认写入规划/ })).toBeVisible();
  await page.getByRole("button", { name: /确认写入规划/ }).click();
  await expect
    .poll(() => page.locator(".block-title-input").evaluateAll((items) => items.map((item) => item.value)))
    .toContain("写方案");

  await page.getByRole("button", { name: /配置/ }).click();
  await page.getByLabel(/Bark Key/).fill("local-test-key");
  await page.getByRole("checkbox", { name: "Bark", exact: true }).check();
  await page.getByRole("button", { name: /保存并开始/ }).click();
  await expect(page.getByText("配置已保存到 .env.local")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/time-goalie-\d{4}-\d{2}-\d{2}\.ics/);
});
