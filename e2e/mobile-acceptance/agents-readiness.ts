import { expect, type Page } from "@playwright/test";

export async function waitForAgentsReady(page: Page, timeout = 15_000) {
  const selector = page.getByRole("combobox", { name: "Project", exact: true });
  await expect(selector).toBeVisible({ timeout });
  await expect(
    selector,
    "Project data has loaded and selection is usable",
  ).toBeEnabled({ timeout });
  await expect(
    page.getByRole("status").filter({ hasText: "Loading your team" }),
  ).toHaveCount(0, { timeout });
  const loaded = page
    .getByRole("heading", { name: "Start with a project", exact: true })
    .or(
      page.getByRole("heading", {
        name: "Build your project team",
        exact: true,
      }),
    )
    .or(page.getByRole("complementary", { name: "Project team", exact: true }));
  await expect(
    loaded,
    "A real loaded empty state or team is rendered",
  ).toBeVisible({ timeout });
}
