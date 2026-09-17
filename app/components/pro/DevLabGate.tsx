"use client";

import { notFound } from "next/navigation";

/** Blocks /lab/* in production — preview never ships to riftsys.app. */
export function DevLabGate({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return children;
}
