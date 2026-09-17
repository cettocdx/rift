const servers = [
  { name: "Connected fixture", enabled: true, connectionStatus: "verified" },
  { name: "Disabled fixture", enabled: false, connectionStatus: "verified" },
  {
    name: "Attention fixture",
    enabled: true,
    connectionStatus: "needs_attention",
  },
].map((state, index) => ({
  ...state,
  _id: `fixture-${index}`,
  url: `https://fixture${index}.invalid/mcp`,
  transport: "http",
  hasAuth: false,
  headerKeys: [],
  authKind: "none",
  lastCheckedAt: 1,
  toolCount: 2,
  toolNames: ["fixture_read"],
  created_at: index,
  updated_at: index,
}));
export const useQuery = () => servers;
export const useMutation = () => () => {
  throw Error("Plugin mutation disabled in fixture");
};
