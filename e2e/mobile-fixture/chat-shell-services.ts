// Offline auth, database and router boundaries for the actual Sidebar tree.
// No service calls, credentials or actual Google authorization occur here.
import { getFunctionName } from "convex/server";
export { chatIdFromPathname } from "../../lib/navigation/chat-routes";
const empty: never[] = [];
const chats = { results: empty, status: "Exhausted", loadMore: () => {} };
const github = { connected: true, username: "fixture-google" };
const balance = { balancePoints: 0 };
const user = {
  id: "fixture-only",
  email: "google.fixture@example.invalid",
  name: "Google Fixture",
  firstName: "Google",
  lastName: "Fixture",
  profilePictureUrl: "https://lh3.googleusercontent.com/a/fixture-avatar",
};
const disabled = () => {
  throw Error("Mutation disabled in chat shell fixture");
};
export const useAuth = () => ({ user });
export const useAuthActions = () => ({ signOut: disabled });
export const useChats = () => chats;
export const usePinChat = () => disabled;
export const useUnpinChat = () => disabled;
export const useMutation = () => disabled;
export const useAction = () => disabled;
export const usePaginatedQuery = () => chats;
export const useQueries = () => ({});
export const useConvex = () => ({});
export function useQuery(
  reference: Parameters<typeof getFunctionName>[0],
  args?: unknown,
) {
  if (args === "skip") return undefined;
  switch (getFunctionName(reference)) {
    case "github:getStatus":
      return github;
    case "projects:listForUser":
    case "runs:listRuns":
      return empty;
    case "extraUsage:getExtraUsageSettings":
      return balance;
    default:
      return undefined;
  }
}
function navigate(href: string) {
  const calls = Reflect.get(window, "fixtureNavigation") ?? [];
  calls.push(href);
  Reflect.set(window, "fixtureNavigation", calls);
}
const router = { push: navigate, replace: navigate, prefetch: () => {} };
export const useRouter = () => router;
export const usePathname = () => location.pathname;
export const useSearchParams = () => new URLSearchParams(location.search);
const navigation = {
  goHome: () => navigate("/"),
  goPurpose: (purpose: string, id?: string) =>
    navigate(id ? `/c/${id}` : purpose === "image" ? "/studio" : "/"),
  goChat: (id: string) => navigate(`/c/${id}`),
};
export const useChatNavigation = () => navigation;
