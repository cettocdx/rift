export const getResumeSection = (finishReason?: string): string => {
  if (finishReason === "tool-calls") {
    return `<resume_context>
Your previous response was interrupted during tool calls before completing the user's original request. \
The last user message in the conversation history contains the original task you were working on. \
If the user says "continue" or similar, resume executing that original task exactly where you left off. \
Follow through on the last user command autonomously without restarting or asking for direction.
</resume_context>`;
  } else if (finishReason === "length") {
    return `<resume_context>
Your previous response was interrupted because the output tokens exceeded the model's context limit. \
The conversation was cut off mid-generation. If the user says "continue" or similar, seamlessly continue \
from where you left off. Pick up the thought, explanation, or task execution exactly where it stopped \
without repeating what was already said or restarting from the beginning. IMPORTANT: Divide your response \
into separate steps to avoid triggering the output limit again. Be more concise and focus on completing \
one step at a time rather than trying to output everything at once.
</resume_context>`;
  } else if (finishReason === "context-limit") {
    return `<resume_context>
Your previous response was stopped because the conversation's accumulated token usage exceeded \
the context limit, even after earlier messages were summarized. The context has been condensed \
but you may be missing details from the earlier conversation. If the user says "continue" or similar, \
resume the task where you left off. Consult the transcript file on the sandbox if you need to recover \
specific details from the earlier conversation.
</resume_context>`;
  } else if (
    finishReason === "preemptive-timeout" ||
    finishReason === "timeout"
  ) {
    return `<resume_context>
Your previous response ended at the request time limit and may contain only partial results. \
When the user asks to continue, inspect the saved files and command results before deciding the next step. \
A command whose observation ended may still be running; check its existing session, process state, \
and saved output. Do not repeat a command with an uncertain outcome. Preserve verified completed work \
and continue only the unfinished work within the user's authorized scope. Follow a new user request \
instead if the user changes the task. Do not claim completion or successful verification without evidence.
</resume_context>`;
  }

  return "";
};
