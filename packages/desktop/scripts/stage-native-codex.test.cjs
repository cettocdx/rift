const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stage, hash } = require('./stage-native-codex.cjs');
test('incomplete or corrupted source never replaces the staged engine', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-stage-test-'));
  try {
    const source = path.join(root, 'source'), dest = path.join(root, 'dest');
    fs.mkdirSync(source); fs.mkdirSync(dest);
    const files = {};
    const exe = process.platform === 'win32' ? '.exe' : '';
    for (const name of [`rift${exe}`, `codex-code-mode-host${exe}`, 'LICENSE', 'NOTICE', 'models.json']) {
      fs.writeFileSync(path.join(source, name), name); files[name] = hash(path.join(source, name));
    }
    fs.writeFileSync(path.join(source, 'provenance.json'), JSON.stringify({ files }));
    stage(source, dest, false);
    fs.writeFileSync(path.join(source, `codex-code-mode-host${exe}`), 'corrupt');
    assert.throws(() => stage(source, dest, false), /checksum mismatch/);
    assert.equal(fs.readFileSync(path.join(dest, `codex-code-mode-host${exe}`), 'utf8'), `codex-code-mode-host${exe}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
