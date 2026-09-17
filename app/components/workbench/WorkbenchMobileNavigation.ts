"use client";

import { createContext, use } from "react";

export type WorkbenchMobileSurface =
  | "agent"
  | "terminal"
  | "files"
  | "changes"
  | "editor";

export const WorkbenchMobileNavigationContext = createContext<{
  surface: WorkbenchMobileSurface;
  setSurface: (surface: WorkbenchMobileSurface) => void;
} | null>(null);

export function useOptionalMobileNavigation() {
  return use(WorkbenchMobileNavigationContext);
}
