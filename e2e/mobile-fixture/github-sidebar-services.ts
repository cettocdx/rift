import { getFunctionName } from "convex/server";
const projects = [
  {
    _id: "project-existing",
    name: "Existing workspace",
    type: "app",
    github_repository: {
      id: 1,
      fullName: "fixture-org/very-long-repository-name-for-overflow-acceptance",
      defaultBranch: "main",
      private: true,
    },
  },
];
const status = {
  connected:
    new URLSearchParams(window.location.search).get("connected") !== "false",
  username: "fixture-user",
};
export const useQuery = (query: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(query) === "github:getStatus" ? status : projects;
export const useMutation = () => async () => {
  throw new Error("Auth mutation outside fixture scope");
};
function record(name: string, ...args: unknown[]) {
  const target = window as unknown as { fixtureCalls: unknown[] };
  (target.fixtureCalls ||= []).push({ name, args });
}
export const useGlobalState = () => ({
  initializeNewChat: (...args: unknown[]) =>
    record("initializeNewChat", ...args),
  closeSidebar: () => record("closeSidebar"),
  setChatSidebarOpen: (...args: unknown[]) =>
    record("setChatSidebarOpen", ...args),
  setTemporaryChatsEnabled: (...args: unknown[]) =>
    record("setTemporaryChatsEnabled", ...args),
  setActiveProject: (...args: unknown[]) => record("setActiveProject", ...args),
});
export const useChatNavigation = () => ({
  goPurpose: (...args: unknown[]) => record("goPurpose", ...args),
});
