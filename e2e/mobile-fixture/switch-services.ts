import { useSyncExternalStore } from "react";
let enabled = true;
let count = 0;
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
export function useQuery() {
  const checked = useSyncExternalStore(subscribe, () => enabled);
  return location.search.includes("disabled")
    ? undefined
    : { include_memory_entries: checked };
}
export function useMutation() {
  return async ({
    include_memory_entries,
  }: {
    include_memory_entries: boolean;
  }) => {
    count++;
    enabled = include_memory_entries;
    listeners.forEach((callback) => callback());
  };
}
export function useFixtureCount() {
  return useSyncExternalStore(subscribe, () => count);
}
