import { getFunctionName } from "convex/server";
const projects = [
  { _id: "fixture-project", type: "app", name: "Fixture project" },
];
const runs = [
  {
    id: "fixture-run",
    chat_id: "fixture-chat",
    status: "completed",
    goal: "Fixture completed run",
    started_at: 1,
    ended_at: 2,
  },
];
export function useQuery(
  reference: Parameters<typeof getFunctionName>[0],
  args?: unknown,
) {
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  if (name === "artifacts:listForUser")
    return [1, 2, 3].map((time) => ({
      url:
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#789"/></svg>',
        ),
      mediaType: "image/svg+xml",
      kind: "generated",
      chat_id: "fixture-chat",
      time,
    }));
  if (
    name === "tasks:listForUser" &&
    new URLSearchParams(location.search).has("taskRows")
  )
    return [
      {
        _id: "fixture-task",
        title: "Review dependencies",
        prompt: "Review dependency changes.",
        purpose: "app",
        status: "open",
        enabled: true,
        schedule_type: "manual",
        created_at: 1,
        updated_at: 1,
      },
    ];
  if (name === "runs:listRuns") return runs;
  if (name === "projects:listForUser") return projects;
  if (
    [
      "tasks:listForUser",
      "tasks:listRecentRuns",
      "projectBots:list",
      "skills:listForUser",
    ].includes(name)
  )
    return [];
  throw Error(`Unexpected workspace fixture query: ${name}`);
}
declare global {
  interface Window {
    __workspaceFixtureWriteAttempts: number;
  }
}
window.__workspaceFixtureWriteAttempts = 0;
export function useMutation() {
  return async () => {
    window.__workspaceFixtureWriteAttempts += 1;
    throw Error("Backend mutations are disabled in workspace fixture");
  };
}
export const useAction = useMutation;
