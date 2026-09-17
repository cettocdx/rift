// Actual panel, session layout, Radix menus and app styles; no PTY or backend.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const req = createRequire(path.join(root, "package.json"));
module.exports = async function buildTerminalHeaderFixture() {
  const store = path.join(root, "node_modules/.pnpm");
  const esbuild = require(
    path.join(
      store,
      fs.readdirSync(store).find((n) => n.startsWith("esbuild@")),
      "node_modules/esbuild",
    ),
  );
  const replacements = {
    "app/components/workbench/WorkbenchInteractiveTerminal.tsx":
      "export const WorkbenchInteractiveTerminal=()=>null;",
    "app/components/workbench/WorkbenchProvider.tsx": `const headers={};const actions={openBottomPanel(){},closeBottomPanel(){},toggleTerminalFullscreen(){}};export const useWorkbenchRequestHeaders=()=>headers;export const useWorkbench=()=>({state:{terminalFullscreen:false},actions});`,
    "app/hooks/useTauri.ts": "export const isTauriEnvironment=()=>true;",
    "app/hooks/useDesktopWorkspaceAccess.ts": `const access={grants:[{grantId:'fixture-grant',name:'Fixture workspace',rootPath:'/fixture',writable:true,grantedAt:1}],requestAccess:async()=>{},busyAction:null,error:null};export const useDesktopWorkspaceAccess=()=>access;`,
    "app/components/terminal/RiftAgentConsoleContext.tsx":
      "export const useHasRiftAgentConsoleProvider=()=>true;",
    "app/components/terminal/RiftAgentConsole.tsx":
      "export const RiftAgentConsole=()=>null;",
    "app/services/desktop-profile-terminal.ts": `export const listDesktopTerminalProfiles=async()=>({backend:'local',profiles:['shell','claude','codex','grok'].map(profile=>({profile,available:true,runtimeLabel:profile,unavailableReason:null}))});export const closeDesktopProfileTerminalTab=async()=>{};`,
  };
  const result = await esbuild.build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{WorkbenchTerminalPanel}from'./app/components/workbench/WorkbenchTerminalPanel';window.fixtureStats={mounts:0,unmounts:0};function App(){const[full,setFull]=useState(false);return <main style={{width:window.fixtureWidth,height:560}}><WorkbenchTerminalPanel compact hostFullscreen={full} onToggleFullscreen={()=>setFull(v=>!v)}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "browser",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-panel",
        setup(build) {
          build.onResolve(
            { filter: /^next\/(dynamic|navigation)$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "tsx",
            resolveDir: root,
            contents:
              args.path === "next/navigation"
                ? "const params=new URLSearchParams();export const useSearchParams=()=>params;"
                : `import{useEffect}from'react';export default()=>function Terminal(props){useEffect(()=>{window.fixtureStats.mounts++;props.onConnectionChange?.(props.clientTerminalId,'connected');return()=>{window.fixtureStats.unmounts++}},[props.clientTerminalId,props.onConnectionChange]);return <div data-fixture-terminal={props.clientTerminalId} style={{height:200}}>Shell fixture</div>}`,
          }));
          build.onLoad({ filter: /\.[tj]sx?$/ }, (args) => {
            const content = replacements[path.relative(root, args.path)];
            if (content)
              return { contents: content, loader: "tsx", resolveDir: root };
          });
        },
      },
    ],
  });
  const globals = fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const css = await postcss([
    req("@tailwindcss/postcss")({ base: root }),
  ]).process(
    globals +
      fs.readFileSync(path.join(root, "app/styles/workspace.css"), "utf8") +
      fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8") +
      '\n@source "./components/workbench/WorkbenchTerminalPanel.tsx";\n@source "../components/ui";',
    { from: path.join(root, "app/terminal-header-fixture.css") },
  );
  return { js: result.outputFiles[0].text, css: css.css };
};
