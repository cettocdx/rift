/** @jest-environment node */
import { generateText, streamText, stepCountIs, tool } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { fetchWithProviderCapacityRecovery } from "../provider-capacity-fetch";

it.each([false, true])("recovers the next model step without repeating the tool (stream=%s)", async (stream) => {
  jest.useFakeTimers();
  let executions = 0;
  const completion = (message: object, finish_reason: string) => {
    if (stream) {
      const delta = { ...message } as Record<string, unknown>;
      if (Array.isArray(delta.tool_calls)) delta.tool_calls = delta.tool_calls.map((call, index) => ({...call,index}));
      const chunk = (delta: object, reason: string | null) => JSON.stringify({
        id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture/model',
        choices:[{index:0,delta,finish_reason:reason}],
      });
      return new Response(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, finish_reason)}\n\ndata: [DONE]\n\n`, {headers:{'Content-Type':'text/event-stream'}});
    }
    return new Response(JSON.stringify({
    id: 'fixture', object:'chat.completion', created:1, model:'fixture/model',
    choices:[{index:0, message, finish_reason}], usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},
  }), {headers:{'Content-Type':'application/json'}});
  };
  const fetcher = jest.fn()
    .mockResolvedValueOnce(completion({ role:'assistant', content:null, tool_calls:[{
      id:'once',type:'function',function:{name:'increment',arguments:'{}'},
    }]}, 'tool_calls'))
    .mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'in_flight_budget_exhausted',metadata:{headers:{'Retry-After':'120'}}}}),{status:402}))
    .mockResolvedValueOnce(completion({role:'assistant',content:'Done.'},'stop'));
  const router = createOpenRouter({ apiKey:'fixture-not-a-real-key', fetch:(url,init)=>fetchWithProviderCapacityRecovery(url,init,undefined,fetcher) });
  const request = { model:router('fixture/model'), prompt:'Increment once.', maxRetries:0,
    stopWhen:stepCountIs(3), tools:{increment:tool({inputSchema:z.object({}),execute:async()=>({value:++executions})})},
  };
  const result = stream ? streamText(request).text : generateText(request).then(result => result.text);
  await jest.advanceTimersByTimeAsync(1);
  expect(executions).toBe(1);
  await jest.advanceTimersByTimeAsync(120001);
  expect(await result).toBe('Done.');
  expect(executions).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
  jest.useRealTimers();
});
