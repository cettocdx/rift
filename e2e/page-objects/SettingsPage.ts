import { Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";

/**
 * Settings is a route, not a dialog. The page object asserts on the URL and on
 * the section landmark, which is what makes "press Back and land where you
 * came from" testable at all.
 */
export type SettingsSection =
  | "general"
  | "appearance"
  | "workbench"
  | "agents"
  | "api-keys"
  | "privacy"
  | "billing"
  | "keyboard"
  | "account";

export class SettingsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async open(section?: SettingsSection): Promise<void> {
    await this.page.goto(section ? `/settings/${section}` : "/settings");
    await this.expectVisible();
  }

  async openWithShortcut(): Promise<void> {
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.press(`${modifier}+Comma`);
    await this.expectVisible();
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/\/settings(\/|\?|$)/);
  }

  async goToSection(section: SettingsSection): Promise<void> {
    await this.page.getByTestId(`settings-nav-${section}`).click();
    await this.expectSection(section);
  }

  async expectSection(section: SettingsSection): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/settings/${section}$`));
    await expect(
      this.page.getByTestId(`settings-nav-${section}`),
    ).toHaveAttribute("aria-current", "page");
  }

  async search(query: string): Promise<void> {
    await this.page.getByLabel("Search settings").fill(query);
    await expect(this.page).toHaveURL(/\/settings\?q=/);
  }
}
