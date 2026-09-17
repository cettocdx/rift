import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedSession } from '../managed-session';

test('keeps relay identity across runner instances and claims commands only once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rift-session-test-'));
  try {
    const first = new ManagedSession(dir);
    first.save({connectionId:'connection',userId:'owner',wsUrl:'ws://localhost'});
    expect(first.claim('command')).toBe(true);
    const restarted = new ManagedSession(dir);
    expect(restarted.read()?.connectionId).toBe('connection');
    expect(restarted.claim('command')).toBe(false);
    expect(restarted.claim('other')).toBe(true);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
