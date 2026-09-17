import localRunnerPackage from "@/packages/local/package.json";
import localRunnerArchive from "@/public/downloads/rift-cli.manifest.json";
import { execFileSync } from "node:child_process";
import { buildLocalRunnerConnectCommand } from "../connect-command";

const settings = {
  origin: "https://riftsys.app",
  convexUrl: "https://fixture.convex.cloud",
  token: "fixture'$(printf injected)`value",
};

it("quotes every POSIX argument without expanding credential characters", () => {
  const command = buildLocalRunnerConnectCommand({
    ...settings,
    shell: "posix",
  });
  const printed = execFileSync(
    "/bin/sh",
    ["-c", command.replace(/^npx /, "printf '%s\\0' ")],
    { encoding: "utf8" },
  );
  expect(printed.split("\0").filter(Boolean)).toEqual([
    "--yes",
    `https://riftsys.app/downloads/rift-cli.tgz?v=${localRunnerPackage.version}&sha=${localRunnerArchive.archiveSha256}`,
    "--token",
    settings.token,
    "--convex-url",
    settings.convexUrl,
  ]);
});

it("uses PowerShell literal strings and escapes embedded single quotes", () => {
  expect(
    buildLocalRunnerConnectCommand({ ...settings, shell: "powershell" }),
  ).toBe(
    `npx --yes 'https://riftsys.app/downloads/rift-cli.tgz?v=${localRunnerPackage.version}&sha=${localRunnerArchive.archiveSha256}' --token 'fixture''$(printf injected)\`value' --convex-url 'https://fixture.convex.cloud'`,
  );
});

it.each([
  "javascript:alert(1)",
  "https://user:password@rift.test",
  "http://remote.example",
  "https://rift.test/path",
  "https://rift.test?bad=1",
])("rejects an unsafe installer origin: %s", (origin) => {
  expect(() =>
    buildLocalRunnerConnectCommand({ ...settings, origin, shell: "posix" }),
  ).toThrow();
});

it("allows the exact development origin and rejects incomplete configuration", () => {
  expect(
    buildLocalRunnerConnectCommand({
      ...settings,
      origin: "http://localhost:3020",
      shell: "posix",
    }),
  ).toContain(
    `'http://localhost:3020/downloads/rift-cli.tgz?v=${localRunnerPackage.version}&sha=${localRunnerArchive.archiveSha256}'`,
  );
  expect(() =>
    buildLocalRunnerConnectCommand({
      ...settings,
      convexUrl: "",
      shell: "posix",
    }),
  ).toThrow(/backend/);
  expect(() =>
    buildLocalRunnerConnectCommand({ ...settings, token: "", shell: "posix" }),
  ).toThrow(/token/);
});
