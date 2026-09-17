// Compile real controls offline, without loading .env or starting app services.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const requireRoot = createRequire(path.join(root, "package.json"));

module.exports = async function buildAllFilesFixture() {
  const store = path.join(root, "node_modules/.pnpm");
  const installed = fs
    .readdirSync(store)
    .find((name) => name.startsWith("esbuild@"));
  const esbuild = require(path.join(store, installed, "node_modules/esbuild"));
  const postcss = createRequire(requireRoot.resolve("@tailwindcss/postcss"))(
    "postcss",
  );
  const result = await esbuild.build({
    stdin: {
      contents: `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AllFilesDialog} from './app/components/AllFilesDialog';
const files=[{part:{name:'first.txt',url:'https://fixture.invalid/first'},partIndex:0,messageId:'m'},{part:{name:'second.txt',url:'https://fixture.invalid/second'},partIndex:1,messageId:'m'}];
function Fixture(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open files</button><AllFilesDialog open={open} onOpenChange={setOpen} files={files}/></>}
window.fixtureDownloads=[];window.fixtureServiceAttempts=0;
createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "browser",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [
      {
        name: "offline-services",
        setup(build) {
          build.onResolve({ filter: /^convex\/react$/ }, (args) => ({
            path: args.path,
            namespace: "offline",
          }));
          build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            contents:
              "const blocked=()=>{window.fixtureServiceAttempts++;throw Error('Backend disabled')};const client={query:blocked};export const useConvex=()=>client;export const useAction=()=>blocked;",
            loader: "js",
          }));
          build.onLoad(
            { filter: /contexts\/FileUrlCacheContext.tsx$/ },
            () => ({
              contents: "export const useFileUrlCacheContext=()=>null;",
              loader: "js",
            }),
          );
          build.onLoad({ filter: /utils\/file-download.ts$/ }, () => ({
            contents:
              "export const downloadFromUrl=(value)=>window.fixtureDownloads.push(value);export const downloadBlob=()=>{window.fixtureServiceAttempts++;throw Error('ZIP saving disabled in fixture')};",
            loader: "js",
          }));
        },
      },
    ],
  });
  const globals = fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const css = await postcss([
    requireRoot("@tailwindcss/postcss")({ base: root }),
  ]).process(
    globals +
      fs.readFileSync(path.join(root, "app/styles/workspace.css"), "utf8") +
      '\n@source "./components/AllFilesDialog.tsx";\n@source "../components/ui";',
    { from: path.join(root, "app/all-files-fixture.css") },
  );
  return { js: result.outputFiles[0].text, css: css.css };
};
