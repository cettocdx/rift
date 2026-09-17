"use client";
import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/app/hooks/useAuth";
import Link from "next/link";
export default function ConsoleLogin(){
  const {user}=useAuth();const create=useMutation(api.apiKeys.create);const revoke=useMutation(api.apiKeys.revoke);
  const [state,setState]=useState("ready");const [error,setError]=useState("");
  const [returnTo,setReturnTo]=useState("/console-login");
  useEffect(()=>setReturnTo(location.pathname+location.hash),[]);
  async function connect(){
    setState("busy");setError("");let issued:Awaited<ReturnType<typeof create>>|undefined;
    try{
      const p=new URLSearchParams(location.hash.slice(1));const port=Number(p.get("port"));const nonce=p.get("state");
      if(!Number.isInteger(port)||port<1024||port>65535||!nonce||!/^[a-f0-9]{64}$/.test(nonce))throw new Error("Start login from rift in your Terminal.");
      issued=await create({name:"RIFT Terminal"});
      const r=await fetch(`http://127.0.0.1:${port}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:nonce,key:issued.key}),signal:AbortSignal.timeout(15000)});
      if(!r.ok)throw new Error("Terminal connection failed. Run rift login again.");
      history.replaceState(null,"",location.pathname);setState("done");
    }catch(e){if(issued)await revoke({id:issued.id as any}).catch(()=>undefined);setError(e instanceof Error?e.message:"Login failed");setState("ready");}
  }
  return <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground"><section className="w-full max-w-sm rounded-2xl border border-border p-7"><p className="mb-5 text-sm text-muted-foreground">RIFT Terminal</p><h1 className="text-xl font-medium">{state==="done"?"Terminal connected":"Connect your terminal"}</h1><p className="my-4 text-sm leading-6 text-muted-foreground">{state==="done"?"Return to Terminal and run rift. You can close this window.":"Use your RIFT models, credits and tools from Terminal. Sessions run independently of the app. You can revoke access in Settings → API keys."}</p>{error&&<p role="alert" className="my-3 text-sm text-red-500">{error}</p>}{state!=="done"&&(user?<button disabled={state==="busy"} onClick={connect} className="w-full rounded-lg bg-foreground px-4 py-2 text-sm text-background">{state==="busy"?"Connecting…":`Connect as ${user.email}`}</button>:<Link href={`/login?redirect=${encodeURIComponent(returnTo)}`}>Sign in to RIFT</Link>)}</section></main>;
}
