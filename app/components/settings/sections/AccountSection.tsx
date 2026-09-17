"use client";

import { AccountTab } from "@/app/components/AccountTab";

export function AccountSection() {
  // The /pricing link that used to sit above this belongs in billing, where
  // the balance and the plan already are.
  return <AccountTab />;
}
