// Loopback-only component fixture. Never reads .env or starts application services.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const requireRoot = createRequire(path.join(root, "package.json"));
const store = path.join(root, "node_modules/.pnpm");
const installed = fs
  .readdirSync(store)
  .filter((name) => /^esbuild@/.test(name))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
const esbuild = require(path.join(store, installed, "node_modules/esbuild"));
const postcss = createRequire(requireRoot.resolve("@tailwindcss/postcss"))(
  "postcss",
);
const tailwind = requireRoot("@tailwindcss/postcss");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rift-github-sidebar-"));
let server;
function cleanup() {
  server?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
process.once("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.once("SIGINT", () => {
  cleanup();
  process.exit(0);
});
(async () => {
  const services = JSON.stringify(
    path.join(__dirname, "github-sidebar-services.ts"),
  );
  await esbuild.build({
    entryPoints: [path.join(__dirname, "github-sidebar-entry.tsx")],
    bundle: true,
    jsx: "automatic",
    platform: "browser",
    outfile: path.join(temp, "app.js"),
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [
      {
        name: "github-service-boundaries",
        setup(build) {
          build.onResolve({ filter: /^convex\/react$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export {useQuery,useMutation} from ${services};`,
            loader: "js",
            resolveDir: root,
          }));
          build.onLoad(
            {
              filter: /(contexts\/GlobalState|hooks\/useChatNavigation)\.tsx?$/,
            },
            (args) => ({
              contents: `export {${args.path.includes("GlobalState") ? "useGlobalState" : "useChatNavigation"}} from ${services};`,
              loader: "js",
            }),
          );
          // Preserve the exact production class helpers reexported by SidebarHeader.
          build.onLoad({ filter: /components\/SidebarHeader\.tsx$/ }, () => ({
            contents: `export {sidebarNavRowClass,SIDEBAR_SECTION_LABEL_CLASS} from ${JSON.stringify(path.join(root, "lib/ui/workspace-chrome.ts"))};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const globals = fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const css = await postcss([tailwind({ base: root })]).process(
    globals +
      fs.readFileSync(path.join(root, "app/styles/workspace.css"), "utf8") +
      fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8") +
      '\n@source "./components/SidebarGithub.tsx";\n@source "./components/GithubConnectButton.tsx";\n@source "../lib/ui/workspace-chrome.ts";\n@source "../components/ui";\n@source "../e2e/mobile-fixture/github-sidebar-entry.tsx";',
    { from: path.join(root, "app/github-fixture.css") },
  );
  fs.writeFileSync(path.join(temp, "styles.css"), css.css);
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (["/app.js", "/styles.css", "/app.css"].includes(pathname)) {
      res.setHeader(
        "Content-Type",
        pathname.endsWith(".js") ? "text/javascript" : "text/css",
      );
      const file = path.join(temp, pathname.slice(1));
      res.end(fs.existsSync(file) ? fs.readFileSync(file) : "");
    } else if (pathname === "/" || pathname === "/health") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
      );
    } else {
      res.writeHead(404);
      res.end("Fixture route unavailable");
    }
  });
  server.listen(3058, "127.0.0.1", () =>
    console.log("GitHub sidebar fixture: http://127.0.0.1:3058"),
  );
})().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
