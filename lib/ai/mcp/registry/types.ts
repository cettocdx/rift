export interface RegistryPlugin {
  id: string;
  namespace: string;
  version: string;
  name: string;
  description: string;
  url: string;
  transport: "http" | "sse";
  setupUrl: string;
}
export interface RegistrySnapshot {
  entries: RegistryPlugin[];
  fetchedAt: number;
  truncated: boolean;
}
