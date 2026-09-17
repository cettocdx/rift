import localRunnerPackage from "@/packages/local/package.json";
import localRunnerArchive from "@/public/downloads/rift-cli.manifest.json";

export type LocalRunnerShell = "posix" | "powershell";

function parseOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The ${label} is not configured.`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      `The ${label} must be a trusted HTTPS origin or local development origin.`,
    );
  }
  return url;
}

function literal(value: string, shell: LocalRunnerShell): string {
  return shell === "powershell"
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, "'\"'\"'")}'`;
}

/** The credential is returned only to the caller's clipboard, never rendered. */
export function buildLocalRunnerConnectCommand({
  origin,
  convexUrl,
  token,
  shell,
}: {
  origin: string;
  convexUrl: string;
  token: string;
  shell: LocalRunnerShell;
}): string {
  const installerOrigin = parseOrigin(origin, "installer origin");
  parseOrigin(convexUrl, "backend URL");
  if (!token || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error("The local runner token is invalid.");
  }
  const installer = new URL("/downloads/rift-cli.tgz", installerOrigin);
  installer.searchParams.set("v", localRunnerPackage.version);
  installer.searchParams.set("sha", localRunnerArchive.archiveSha256);
  return `npx --yes ${literal(installer.href, shell)} --token ${literal(token, shell)} --convex-url ${literal(convexUrl, shell)}`;
}
