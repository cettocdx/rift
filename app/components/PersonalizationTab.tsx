"use client";

import { useState } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { SubscriptionTier } from "@/types";

interface PersonalizationTabProps {
  onCustomInstructions: () => void;
  // onManageMemories: () => void;
  onManageNotes: () => void;
  subscription?: SubscriptionTier;
}

const PersonalizationTab = ({
  onCustomInstructions,
  // onManageMemories,
  onManageNotes,
  subscription,
}: PersonalizationTabProps) => {
  const [notesSaveState, setNotesSaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const userCustomization = useQuery(
    api.userCustomization.getUserCustomization,
    {},
  );
  const saveCustomization = useMutation(
    api.userCustomization.saveUserCustomization,
  );

  const handleNotesEnabledChange = async (checked: boolean) => {
    setNotesSaveState("saving");
    try {
      await saveCustomization({ include_memory_entries: checked });
      setNotesSaveState("saved");
    } catch (error) {
      setNotesSaveState("idle");
      console.error("Failed to save customization:", error);
      const errorMessage =
        error instanceof ConvexError
          ? (error.data as { message?: string })?.message ||
            error.message ||
            "Failed to save customization"
          : error instanceof Error
            ? error.message
            : "Failed to save customization";
      toast.error(errorMessage);
    }
  };

  return (
    <div className="space-y-6">
      {/* Personalization Section */}
      <div>
        <div className="space-y-4">
          <button
            type="button"
            className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-md border-b px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none"
            onClick={onCustomInstructions}
          >
            <div>
              <div className="font-medium">Custom instructions</div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Configure
              <ChevronRight className="h-4 w-4" />
            </div>
          </button>
        </div>
      </div>

      {/* Notes Section (formerly Memory Section) */}
      {subscription && (
        <div>
          <h3 className="mb-2 border-b pb-2 text-[13px] font-medium">Notes</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <div className="font-medium">Enable notes</div>
                <div
                  id="notes-enabled-description"
                  className="text-xs text-muted-foreground"
                >
                  Let RIFT save and use notes when responding.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="min-w-10 text-right text-[10px] text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {userCustomization === undefined ||
                  notesSaveState === "saving" ? (
                    <LoaderCircle
                      className="ml-auto size-3 animate-spin motion-reduce:animate-none"
                      aria-label="Saving notes setting"
                    />
                  ) : notesSaveState === "saved" ? (
                    "Saved"
                  ) : null}
                </span>
                <Switch
                  checked={userCustomization?.include_memory_entries ?? true}
                  disabled={
                    userCustomization === undefined ||
                    notesSaveState === "saving"
                  }
                  onCheckedChange={handleNotesEnabledChange}
                  aria-label="Toggle notes"
                  aria-describedby="notes-enabled-description"
                />
              </div>
            </div>

            {/* Same shape as Custom instructions above: both rows open a
                sub-panel, so both are a full-width row with a chevron rather
                than one row-with-a-button and one whole-row target. The row is
                also the larger hit area, and the chevron is what says "this
                goes somewhere" instead of "this does something". */}
            <button
              type="button"
              className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-md px-2 py-3 text-left transition-colors hover:bg-accent/40 motion-reduce:transition-none"
              onClick={onManageNotes}
            >
              <div>
                <div className="font-medium">Manage notes</div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Manage
                <ChevronRight className="h-4 w-4" />
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export { PersonalizationTab };
