import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/db/convex-client";
import type { Id } from "@/convex/_generated/dataModel";
export async function GET(req:NextRequest){
  try{const userId=await getUserID(req);const chatId=req.nextUrl.searchParams.get("chatId");if(!chatId)return new Response(null,{status:400});
    return NextResponse.json(await getConvexClient().query(api.approvals.pendingForBackend,{userId,chatId,serviceKey:process.env.CONVEX_SERVICE_ROLE_KEY!}),{headers:{"Cache-Control":"no-store"}});
  }catch{return new Response(null,{status:401});}
}
export async function POST(req:NextRequest){
  try{const userId=await getUserID(req);const b=await req.json();if(typeof b.id!=="string"||typeof b.chatId!=="string"||typeof b.approve!=="boolean")return new Response(null,{status:400});
    await getConvexClient().mutation(api.approvals.decideForBackend,{userId,chatId:b.chatId,id:b.id as Id<"tool_approvals">,approve:b.approve,serviceKey:process.env.CONVEX_SERVICE_ROLE_KEY!});return NextResponse.json({ok:true});
  }catch{return new Response(null,{status:403});}
}
