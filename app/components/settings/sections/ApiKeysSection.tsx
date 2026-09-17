"use client";

import { ApiKeysTab } from "@/app/components/ApiKeysTab";
import { useGlobalState } from "@/app/contexts/GlobalState";

export function ApiKeysSection() {
  const { subscription } = useGlobalState();
  return <ApiKeysTab subscription={subscription} />;
}
