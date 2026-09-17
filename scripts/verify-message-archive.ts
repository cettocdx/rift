import { config } from "dotenv";
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
config({path: '.env.local', quiet: true});
async function main() {
  const userId = process.env.RIFT_QA_USER_ID;
  if (!userId) throw new Error('RIFT_QA_USER_ID required');
  const { saveChat, saveMessage } = await import('../lib/db/actions');
  const { archiveMessage } = await import('../lib/db/archive-message');
  const { getConvexClient } = await import('../lib/db/convex-client');
  const { api } = await import('../convex/_generated/api');
  const chatId = randomUUID();
  const message = {id: randomUUID(), role: 'assistant' as const, parts: [
    {type:'tool-get_terminal_files', toolCallId:randomUUID(), state:'output-available', input:{}, output:'ğ🙂'.repeat(230000)},
    {type:'text',text:'Archive verification completed.'},
  ] as any[]};
  // Actual blob round-trip, independently of the message compaction test.
  const archived = await archiveMessage({message,userId,serviceKey:process.env.CONVEX_SERVICE_ROLE_KEY!});
  const response = await fetch(archived.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const restored = await response.text();
  const hash = (s:string) => createHash('sha256').update(s).digest('hex');
  if (hash(restored) !== hash(JSON.stringify(message))) throw new Error('Archive bytes changed');
  await saveChat({id:chatId,userId,title:'QA: large message archive',purpose:'app'});
  await saveMessage({chatId,userId,message,mode:'agent',finishReason:'stop'});
  const results = await getConvexClient().query(api.messages.getLastAssistantMessage,{serviceKey:process.env.CONVEX_SERVICE_ROLE_KEY!,chatId,userId});
  if (!results || !results.parts.some((p:any)=>p.isRunArchive === true)) throw new Error('Saved archive reference missing');
  writeFileSync('docs/qa/2026-09-10-storage-recovery/live.json', JSON.stringify({chatId,archiveRoundTrip:true,bytes:Buffer.byteLength(restored),saved:true,resultCount:Array.isArray(results)?results.length:undefined},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
