// Real editor tabs and app CSS; no app services, environment files or Monaco.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const req = createRequire(path.join(root, "package.json"));
module.exports = async function buildEditorTabsFixture() {
  const store = path.join(root, "node_modules/.pnpm");
  const installed = fs
    .readdirSync(store)
    .find((name) => name.startsWith("esbuild@"));
  const esbuild = require(path.join(store, installed, "node_modules/esbuild"));
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const built = await esbuild.build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{WorkbenchEditorTabs}from'./app/components/workbench/WorkbenchEditor';window.fixtureCalls=[];createRoot(document.getElementById('root')).render(<><WorkbenchEditorTabs/><button>After editor</button></>);`,
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
        name: "offline-editor-state",
        setup(build) {
          build.onResolve(
            { filter: /^(next\/dynamic|@monaco-editor\/react)$/ },
            (args) => ({ path: args.path, namespace: "offline" }),
          );
          build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            contents: "export default ()=>()=>null;",
            loader: "js",
          }));
          build.onLoad({ filter: /WorkbenchProvider\.tsx$/ }, () => ({
            contents: `import {useState} from 'react';
const initial=['src/alpha.ts','src/beta.ts',...Array.from({length:10},(_,i)=>'src/long-directory/descriptive-file-name-'+i+'.tsx')];
export function useWorkbench(){const[openTabs,setOpenTabs]=useState(initial);const[activePath,setActivePath]=useState(initial[0]);return{state:{openTabs,activePath,documents:{}},actions:{setActivePath:path=>{window.fixtureCalls.push({type:'select',path});setActivePath(path)},closeDocument:path=>{window.fixtureCalls.push({type:'close',path});const index=openTabs.indexOf(path);const next=openTabs.filter(value=>value!==path);setOpenTabs(next);if(activePath===path)setActivePath(next[Math.min(Math.max(index,0),next.length-1)]??null);}}}}`,
            loader: "js",
            resolveDir: root,
          }));
          build.onLoad({ filter: /computer-sidebar-utils\.tsx$/ }, () => ({
            contents: 'export const getLanguageFromPath=()=>"typescript";',
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
    req("@tailwindcss/postcss")({ base: root }),
  ]).process(
    globals +
      fs.readFileSync(path.join(root, "app/styles/workspace.css"), "utf8") +
      fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8") +
      '\n@source "./components/workbench/WorkbenchEditor.tsx";',
    { from: path.join(root, "app/editor-tabs-fixture.css") },
  );
  return { js: built.outputFiles[0].text, css: css.css };
};
