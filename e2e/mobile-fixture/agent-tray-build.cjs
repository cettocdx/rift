// Production collaborator tray and theme styles; no worker, account or network.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const req = createRequire(path.join(root, "package.json"));
module.exports = async function buildAgentTrayFixture() {
  const store = path.join(root, "node_modules/.pnpm");
  const esbuild = require(
    path.join(
      store,
      fs.readdirSync(store).find((n) => n.startsWith("esbuild@")),
      "node_modules/esbuild",
    ),
  );
  const result = await esbuild.build({
    stdin: {
      contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AgentWorkingTray}from'./app/components/ChatInput/AgentWorkingTray';
const agents=Array.from({length:12},(_,i)=>({id:'agent-'+i,toolCallId:'call-'+i,name:i===0?'Pixel':'Agent '+i,role:'reviewer',task:'Review a long mixed-media response and preserve the exact visible reading position '+i,status:i===0?'running':i===1?'awaiting-approval':'completed'}));
function App(){const[list,setList]=useState(agents),[run,setRun]=useState('run-1');window.trayFixture={finish:()=>setList(a=>a.map(x=>({...x,status:'completed'}))),next:()=>setRun('run-2'),arrive:()=>setList(a=>[...a,{...agents[0],id:'arrival',toolCallId:'new-call',name:'Arrival'}])};return <main><article aria-label="Transcript">{Array.from({length:90},(_,i)=><p key={i}>Transcript line {i}: keep this reading position.</p>)}</article><footer><AgentWorkingTray agents={list} runKey={run} onSelectAgent={id=>{window.selectedAgent=id}}/><textarea aria-label="Message RIFT" placeholder="Write a follow-up"/></footer></main>}createRoot(document.getElementById('root')).render(<App/>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outfile: "tray-fixture.js",
    jsx: "automatic",
    platform: "browser",
    tsconfig: path.join(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const globals = fs
    .readFileSync(path.join(root, "app/globals.css"), "utf8")
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const css = await postcss([
    req("@tailwindcss/postcss")({ base: root }),
  ]).process(
    globals +
      fs.readFileSync(path.join(root, "app/styles/typography.css"), "utf8"),
    { from: path.join(root, "app/tray-fixture.css") },
  );
  return {
    js: result.outputFiles.find((f) => f.path.endsWith(".js")).text,
    css:
      css.css +
      result.outputFiles
        .filter((f) => f.path.endsWith(".css"))
        .map((f) => f.text)
        .join("\n"),
  };
};
