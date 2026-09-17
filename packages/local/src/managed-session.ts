import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface RelayIdentity { connectionId: string; userId: string; wsUrl: string }
export class ManagedSession {
  constructor(readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  read(): RelayIdentity | undefined {
    try {
      const value = JSON.parse(readFileSync(join(this.directory, 'relay.json'), 'utf8'));
      if (typeof value.connectionId === 'string' && typeof value.userId === 'string' && typeof value.wsUrl === 'string') return value;
    } catch { /* First start or interrupted state write: authenticate anew. */ }
    return undefined;
  }
  save(identity: RelayIdentity): void {
    const file = join(this.directory, 'relay.json');
    writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(identity), { mode: 0o600 });
    renameSync(`${file}.${process.pid}.tmp`, file);
  }
  claim(commandId: string): boolean {
    const key = createHash('sha256').update(commandId).digest('hex');
    try { mkdirSync(join(this.directory, key), {mode:0o700}); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  }
}
