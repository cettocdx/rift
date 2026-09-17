#!/usr/bin/env node
// Verify source provenance before staging the complete engine into desktop resources.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
function hash(file) {
  const digest = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  try { for (let n; (n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) digest.update(chunk.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
function stage(source, destination, sign = process.platform === 'darwin') {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'provenance.json'), 'utf8'));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const required = [`rift${suffix}`, `codex-code-mode-host${suffix}`, 'LICENSE', 'NOTICE', 'models.json'];
  for (const name of required) {
    if (hash(path.join(source, name)) !== manifest.files?.[name]) throw new Error(`Native source checksum mismatch: ${name}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.native-stage-'));
  try {
    for (const name of required) fs.copyFileSync(path.join(source, name), path.join(temporary, name));
    manifest.sourceFiles = { ...manifest.files };
    if (sign) for (const name of required.slice(0, 2)) {
      const result = spawnSync('codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', path.resolve(__dirname, '../src-tauri/entitlements.plist'), path.join(temporary, name)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Native signing failed: ${result.stderr}`);
    }
    for (const name of required) manifest.files[name] = hash(path.join(temporary, name));
    manifest.sha256 = manifest.files[`rift${suffix}`];
    fs.writeFileSync(path.join(temporary, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
    // Resources are staged before building; the installed app remains untouched.
    fs.mkdirSync(destination, { recursive: true });
    for (const name of [...required, 'provenance.json']) fs.renameSync(path.join(temporary, name), path.join(destination, name));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { stage, hash };
if (require.main === module) {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node scripts/stage-native-codex.cjs /path/to/rift/dist');
  stage(path.resolve(source), path.resolve(__dirname, '../src-tauri/native-codex'));
  console.log('Verified native Codex bundle staged for desktop.');
}
