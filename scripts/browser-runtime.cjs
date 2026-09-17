#!/usr/bin/env node
const path = require("node:path");
const { spawn } = require("node:child_process");

function installBrowser() {
  // Resolve the installed, lockfile-pinned CLI. Never fetch a different npm version.
  const cli = path.join(
    path.dirname(require.resolve("playwright/package.json")),
    "cli.js",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "install", "chromium", "--only-shell"],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Browser installation failed (${code})`)),
    );
  });
}

async function ensureBrowserRuntime({
  launch = () => require("playwright").chromium.launch({ headless: true }),
  install = installBrowser,
} = {}) {
  let browser;
  try {
    browser = await launch();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("Executable doesn't exist")
    )
      throw error;
    await install();
    browser = await launch();
  }
  await browser.close();
}

module.exports = { ensureBrowserRuntime };
if (require.main === module) {
  ensureBrowserRuntime()
    .then(() => console.log("[browser] Chromium ready"))
    .catch((error) => {
      console.error("[browser] Runtime unavailable:", error.message);
      process.exitCode = 1;
    });
}
