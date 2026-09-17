// A managed command owns its relay and shell independently of the launcher.
// Parent death must not replay or terminate an admitted command.
import { spawn, type ChildProcess } from 'node:child_process';
import { Centrifuge } from 'centrifuge';
import WebSocket from 'ws';
import { ConvexHttpClient } from 'convex/browser';
import { OutputDelivery } from './output-delivery';
import { buildShellSpawn, getDefaultShell } from './utils';

export interface CommandWorkerInput {
  commandId: string; command: string; timeout: number;
  connectionId: string; userId: string; wsUrl: string;
  token: string; convexUrl: string; relayToken: string;
}
process.on('disconnect', () => { /* Launcher restart does not own this command. */ });
process.once('message', (input: CommandWorkerInput) => { run(input).catch(() => process.exit(1)); });

async function run(input: CommandWorkerInput): Promise<void> {
  const convex = new ConvexHttpClient(input.convexUrl);
  let proc: ChildProcess | undefined;
  let cancelled = false;
  let timedOut = false;
  let escalation: NodeJS.Timeout | undefined;
  const terminate = () => {
    cancelled = true;
    if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return;
    const child = proc;
    const signal = (name: NodeJS.Signals) => {
      try { if (process.platform !== 'win32') process.kill(-child.pid!,name); else child.kill(name); } catch { /* Already exited. */ }
    };
    signal('SIGTERM');
    if (!escalation) escalation = setTimeout(()=>signal('SIGKILL'),1000);
  };
  process.on('SIGTERM', terminate);
  process.on('SIGINT', terminate);
  const client = new Centrifuge(input.wsUrl, {
    token: input.relayToken, websocket: WebSocket as unknown as typeof globalThis.WebSocket,
    getToken: async () => {
      const response = await convex.mutation('localSandbox:refreshCentrifugoToken' as never,
        {token:input.token,connectionId:input.connectionId} as never) as {ok:boolean;centrifugoToken:string};
      if (!response.ok) { terminate(); throw new Error('Command relay authorization ended'); }
      return response.centrifugoToken;
    },
  });
  const subscription = client.newSubscription(`sandbox:connection:${input.connectionId}#${input.userId}`);
  subscription.on('publication', ({data}) => {
    if (data?.type === 'command_cancel' && data.commandId === input.commandId && data.targetConnectionId === input.connectionId) terminate();
  });
  const delivery = new OutputDelivery(data => subscription.publish(data));
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve,reject) => {
      const deadline = setTimeout(()=>reject(new Error('Command relay unavailable')),30000);
      subscription.once('subscribed',()=>{clearTimeout(deadline);resolve();});
      subscription.subscribe();client.connect();
    });
    if (cancelled) { await delivery.send({type:'exit',commandId:input.commandId,exitCode:130}); return; }
    const shell = getDefaultShell(process.platform);
    const spec = buildShellSpawn(shell.shell,shell.shellFlag,input.command);
    proc = spawn(shell.shell,spec.args,{...spec.options,stdio:['ignore','pipe','pipe'],detached:process.platform !== 'win32'});
    if (input.timeout > 0) timer=setTimeout(()=>{timedOut=true;terminate();},input.timeout);
    let deliveryFailure: unknown;
    const send = (type:string,data:string) => { void delivery.send({type,commandId:input.commandId,data}).catch(error=>{deliveryFailure=error;terminate();}); };
    proc.stdout?.on('data',data=>send('stdout',data.toString()));
    proc.stderr?.on('data',data=>send('stderr',data.toString()));
    const exitCode = await new Promise<number>((resolve,reject)=>{
      proc!.once('error',reject);proc!.once('close',code=>resolve(timedOut ? 124 : cancelled ? 130 : code ?? 1));
    });
    if (timer) clearTimeout(timer);
    if (escalation) clearTimeout(escalation);
    if (deliveryFailure) throw deliveryFailure;
    await delivery.send({type:'exit',commandId:input.commandId,exitCode});
  } catch (error) {
    terminate();
    await delivery.send({type:'error',commandId:input.commandId,message:'Local command stopped before output delivery completed'}).catch(()=>{});
    throw error;
  } finally {
    if(timer)clearTimeout(timer);
    if(escalation)clearTimeout(escalation);
    delivery.stop();client.disconnect();
    if(process.connected)process.disconnect?.();
  }
}
