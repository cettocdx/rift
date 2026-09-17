"use client";

import { useState } from "react";
import { CustomizeRIFTDialog } from "@/app/components/CustomizeRIFTDialog";
import { ManageNotesDialog } from "@/app/components/ManageNotesDialog";
import { PersonalizationTab } from "@/app/components/PersonalizationTab";
import { useGlobalState } from "@/app/contexts/GlobalState";

export function GeneralSection() {
  const { subscription } = useGlobalState();
  const [showCustomize, setShowCustomize] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  return (
    <>
      <PersonalizationTab
        onCustomInstructions={() => setShowCustomize(true)}
        onManageNotes={() => setShowNotes(true)}
        subscription={subscription}
      />
      <ManageNotesDialog open={showNotes} onOpenChange={setShowNotes} />
      <CustomizeRIFTDialog
        open={showCustomize}
        onOpenChange={setShowCustomize}
      />
    </>
  );
}
