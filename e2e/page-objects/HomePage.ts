import { Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage";
import { SidebarComponent } from "./SidebarComponent";
import { UserMenuComponent } from "./UserMenuComponent";
import { SettingsPage, SettingsSection } from "./SettingsPage";

export class HomePage extends BasePage {
  readonly sidebar: SidebarComponent;
  readonly userMenu: UserMenuComponent;
  readonly settings: SettingsPage;

  constructor(page: Page) {
    super(page);
    this.sidebar = new SidebarComponent(page);
    this.userMenu = new UserMenuComponent(page);
    this.settings = new SettingsPage(page);
  }

  async openSettings(): Promise<void> {
    await this.userMenu.openSettings();
    await this.settings.expectVisible();
  }

  async navigateToSettingsSection(section: SettingsSection): Promise<void> {
    await this.openSettings();
    await this.settings.goToSection(section);
  }

  async verifySessionPersistence(): Promise<void> {
    await this.userMenu.expectVisible();
    await this.reload();
    await this.userMenu.expectVisible();
  }

  async verifyUpgradeButtonNotVisible(): Promise<void> {
    const upgradeButton = this.page.getByRole("button", {
      name: "Upgrade plan",
    });
    await expect(upgradeButton).not.toBeVisible();
  }
}
