import type { ConsoleSnapshot } from "../src/protocol.js";
import { createTestRenderer } from '@opentui/core/testing';
import { mountRiftTui } from '../src/opentui';
import { snapshot } from './fixture.cjs';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
const ui=await createTestRenderer({width:100,height:36});const state: ConsoleSnapshot=snapshot() as ConsoleSnapshot;state.approvals=[];state.status='ready';state.efforts=[{value:'low',label:'Low'},{value:'medium',label:'Medium'},{value:'high',label:'High'},{value:'max',label:'Max'}];state.effort='max';state.entries=[{id:'user',kind:'user',text:'Build a focused project dashboard.'},{id:'a:reasoning',kind:'activity',text:'I’ll check the existing components and keep the layout compact.'},{id:'tool',kind:'activity',text:'Read app/dashboard.tsx'},{id:'reply',kind:'assistant',text:'**The structure is ready.**\nThe dashboard uses your existing components and `project` data.'}];
const events=new EventEmitter();const app=mountRiftTui(ui.renderer,{cwd:'/projects/rift',connect:async()=>({events,snapshot:state,close:async()=>{},send:async()=>{}}) as any,login:async()=>{},openApp:async()=>{}});
async function capture(name:string){await ui.flush();const frame=ui.captureSpans();await writeFile('/tmp/rift-'+name+'.json',JSON.stringify({cols:frame.cols,rows:frame.rows,lines:frame.lines.map(l=>l.spans.map(s=>({text:s.text,width:s.width,fg:s.fg.toInts(),bg:s.bg.toInts(),attributes:s.attributes})))}));}
await ui.flush();await app.submit('/effort');await capture('effort');ui.mockInput.pressEscape();await new Promise(r=>setTimeout(r,90));state.questions=[{id:'q',title:'Which dashboard should we build first?',options:['Project overview','Task activity','Team workload']}];events.emit('snapshot');await capture('question');await app.close();
