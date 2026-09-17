"use client";

import { KeyboardSettingsTab } from "@/app/components/KeyboardSettingsTab";

export function KeyboardSection() {
  // The palette used to need the dialog closed first; a route has nothing to
  // close, so opening it is the whole action.
  return <KeyboardSettingsTab onOpenPalette={() => {}} />;
}
