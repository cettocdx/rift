"use client";

import { createContext, use } from "react";

export type ProShellValue = {
  enabled: boolean;
  basePath: string;
};

const ProShellContext = createContext<ProShellValue>({
  enabled: false,
  basePath: "/",
});

export function ProShellProvider({
  children,
  basePath = "/lab/app",
}: {
  children: React.ReactNode;
  basePath?: string;
}) {
  const normalizedBasePath = normalizeProBasePath(basePath);

  return (
    <ProShellContext value={{ enabled: true, basePath: normalizedBasePath }}>
      {children}
    </ProShellContext>
  );
}

export function useProShell() {
  return use(ProShellContext);
}

export function normalizeProBasePath(basePath: string) {
  const value = basePath.trim();
  if (!value || value === "/") return "/";

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

export function proChatRoute(basePath: string, chatId?: string | null) {
  const normalizedBasePath = normalizeProBasePath(basePath);
  if (!chatId) return normalizedBasePath;

  const prefix = normalizedBasePath === "/" ? "" : normalizedBasePath;
  return `${prefix}/c/${chatId}`;
}
