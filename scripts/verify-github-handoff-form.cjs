// Exercise the deployed handoff document without consuming a real OAuth ticket.
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium, webkit } = require('playwright');

(async () => {
  const base = process.env.RIFT_VERIFY_URL || 'http://localhost:3020';
  const response = await fetch(`${base}/github-complete?ticket=${'a'.repeat(64)}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const engine of [chromium, webkit]) {
    let submitted;
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.method === 'POST') {
        submitted = { origin: req.headers.origin, path: req.url };
        res.end('<p>Submission captured</p>');
        return;
      }
      for (const header of ['referrer-policy', 'content-security-policy']) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      browser = await engine.launch();
      const page = await browser.newPage();
      await page.goto(`${origin}/github-complete?ticket=${'a'.repeat(64)}`);
      await page.getByText('Submission captured', { exact: true }).waitFor();
      assert.deepEqual(submitted, { origin, path: '/github-complete' });
      console.log(`${engine.name()}: deployed handoff preserves same-origin POST`);
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
