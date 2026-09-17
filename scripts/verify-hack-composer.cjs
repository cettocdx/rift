// Bounded WebKit layout fixture using the production CSS and autosizing effects.
// Does not exercise accounts, model calls, or physical on-screen keyboards.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const store = path.join(root, 'node_modules/.pnpm');
const installed = fs.readdirSync(store).find(name => name.startsWith('esbuild@'));
const esbuild = require(path.join(store, installed, 'node_modules/esbuild'));
const source = fs.readFileSync(path.join(root, 'app/components/HackerMode.tsx'), 'utf8');
const css = ['CSS', 'CURSOR_OVERRIDES', 'REFERENCE_OVERRIDES', 'PRODUCT_TYPOGRAPHY', 'WORKBENCH_REFINEMENT']
  .map(name => source.split('const ' + name + ' = `')[1].split('`;')[0]).join('\n');
const effects = source.slice(source.indexOf('  const resizeCommand ='), source.indexOf('  const sidebarToggleRef ='));
assert(effects.includes('ResizeObserver'));
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rift-hack-composer-'));
  let browser;
  try {
    const bundle = await esbuild.build({
      stdin: { contents: `import React,{useRef,useState,useCallback,useLayoutEffect} from 'react';import{createRoot}from'react-dom/client';
        function App(){const[cmd,setCmd]=useState('');const cmdRef=useRef(null);${effects}
        return <div className="fui sidebar-closed"><main className="term"><div className="prompt"><textarea aria-label="Draft" ref={cmdRef} value={cmd} onChange={e=>setCmd(e.target.value)}/></div></main></div>}
        createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'tsx' },
      bundle: true, write: false, define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.writeFileSync(path.join(temp, 'app.js'), bundle.outputFiles[0].contents);
    browser = await webkit.launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${css}</style><div id="root"></div>`);
    await page.addScriptTag({ path: path.join(temp, 'app.js') });
    const input = page.getByRole('textbox', { name: 'Draft' });
    const draft = 'Keep my draft visible when the screen changes width. '.repeat(5);
    await input.fill(draft);
    const results = [];
    for (const width of [1000, 320, 390, 800, 1000]) {
      await page.setViewportSize({ width, height: 844 });
      // Allow the browser to deliver ResizeObserver and paint its size update.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => {
        const el = document.querySelector('textarea');
        return parseFloat(el.style.height) === Math.min(144, Math.max(24, el.scrollHeight));
      });
      const result = await input.evaluate(el => ({ width: innerWidth, height: el.clientHeight, scrollHeight: el.scrollHeight,
        fontSize: getComputedStyle(el).fontSize, value: el.value, overflow: document.documentElement.scrollWidth - innerWidth }));
      assert.equal(result.value, draft);
      assert.equal(result.overflow, 0);
      if (width <= 800) assert.equal(result.fontSize, '16px');
      results.push(result);
    }
    assert(results[1].height > results[0].height, 'Narrow draft should grow');
    assert.equal(results.at(-1).height, results[0].height, 'Wide draft should shrink again');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine: 'webkit', results: results.map(({value,...result}) => result), errors }));
  } finally {
    await browser?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
