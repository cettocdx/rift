"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Save, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useGlobalState } from "@/app/contexts/GlobalState";
import type { QueueBehavior } from "@/types/chat";
import { AgentPetRoster } from "@/app/components/agents/AgentPetRoster";
import { EffectivePolicyTable } from "@/app/components/settings/EffectivePolicyTable";
import {
  type GuardrailConfigUI,
  getDefaultGuardrailsUI,
  parseAndMergeGuardrailsConfig,
  formatGuardrailsConfigForSave,
  hasGuardrailChanges,
} from "@/lib/ai/tools/utils/guardrails";

const severityColors: Record<GuardrailConfigUI["severity"], string> = {
  critical: "text-destructive",
  high: "text-warning",
  medium: "text-muted-foreground",
  low: "text-muted-foreground",
};

const AgentsTab = () => {
  const { queueBehavior, setQueueBehavior, subscription } = useGlobalState();

  const [guardrails, setGuardrails] = useState<GuardrailConfigUI[]>(
    getDefaultGuardrailsUI(),
  );
  const [guardrailsExpanded, setGuardrailsExpanded] = useState(false);
  const [isSavingGuardrails, setIsSavingGuardrails] = useState(false);
  const [guardrailChanges, setGuardrailChanges] = useState(false);

  const userCustomization = useQuery(
    api.userCustomization.getUserCustomization,
    {},
  );
  const saveCustomization = useMutation(
    api.userCustomization.saveUserCustomization,
  );

  // Load guardrails config
  useEffect(() => {
    if (userCustomization?.guardrails_config !== undefined) {
      const mergedGuardrails = parseAndMergeGuardrailsConfig(
        userCustomization.guardrails_config,
      );
      setGuardrails(mergedGuardrails);
    }
  }, [userCustomization?.guardrails_config]);

  // Track changes for guardrails
  useEffect(() => {
    const hasChanges = hasGuardrailChanges(
      guardrails,
      userCustomization?.guardrails_config,
    );
    setGuardrailChanges(hasChanges);
  }, [guardrails, userCustomization?.guardrails_config]);

  const handleToggleGuardrail = (id: string) => {
    setGuardrails((prev) =>
      prev.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g)),
    );
  };

  const queueBehaviorOptions: Array<{
    value: QueueBehavior;
    label: string;
  }> = [
    {
      value: "queue",
      label: "Queue after current message",
    },
    {
      value: "stop-and-send",
      label: "Stop & send right away",
    },
  ];

  const handleSaveGuardrails = async () => {
    setIsSavingGuardrails(true);
    try {
      const guardrailsConfig = formatGuardrailsConfigForSave(guardrails);
      await saveCustomization({
        guardrails_config: guardrailsConfig || undefined,
      });
      toast.success("Guardrails saved successfully");
      setGuardrailChanges(false);
    } catch (error) {
      console.error("Failed to save guardrails:", error);
      const errorMessage =
        error instanceof ConvexError
          ? (error.data as { message?: string })?.message ||
            error.message ||
            "Failed to save guardrails"
          : error instanceof Error
            ? error.message
            : "Failed to save guardrails";
      toast.error(errorMessage);
    } finally {
      setIsSavingGuardrails(false);
    }
  };

  const handleResetGuardrails = () => {
    setGuardrails(getDefaultGuardrailsUI());
  };

  // What the switches below actually add up to. Section 18.4 asks settings to
  // show effective policy and its inheritance; the value alone does not answer
  // "why can an agent do that, and where do I change it".
  const guardrailOverrides = useMemo(() => {
    const defaults = new Map(
      getDefaultGuardrailsUI().map((entry) => [entry.id, entry.enabled]),
    );
    const overrides = new Map<string, boolean>();
    for (const guardrail of guardrails) {
      if (defaults.get(guardrail.id) !== guardrail.enabled) {
        overrides.set(guardrail.id, guardrail.enabled);
      }
    }
    return overrides;
  }, [guardrails]);

  return (
    <div className="space-y-6">
      <AgentPetRoster />

      <EffectivePolicyTable
        userGuardrailOverrides={guardrailOverrides}
        productGuardrailDefaults={getDefaultGuardrailsUI().map((entry) => ({
          id: entry.id,
          name: entry.name,
          enabled: entry.enabled,
        }))}
      />

      {/*
        There is no Caido proxy panel here: lib/api/chat-handler.ts passes
        caidoEnabled false unconditionally, so a control would toggle nothing.
        The switch is that one call site; a panel has to be written against
        whatever the schema looks like when it flips back on.

        The Convex fields stay put. caido_enabled and caido_port are read in
        lib/system-prompt.ts and declared in the return validators of both
        getUserCustomization and getUserCustomizationForBackend, so dropping
        them from the schema first breaks reads on existing rows. The order is
        stop writing, then remove from args and validators, then migrate rows,
        then defineTable.
      */}

      {/* Queue Messages - Only show for Pro/Ultra/Team users */}
      {subscription !== "free" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 border-b gap-3">
            <div className="flex-1">
              <div className="font-medium">Queue messages</div>
              <div className="text-sm text-muted-foreground">
                Adjust the default behavior of sending a message while Agent is
                streaming
              </div>
            </div>
            <Select
              value={queueBehavior}
              onValueChange={(value) =>
                setQueueBehavior(value as QueueBehavior)
              }
            >
              <SelectTrigger className="w-full sm:w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {queueBehaviorOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Security Guardrails Section - Available to all users */}
      <div className="space-y-4 pt-2">
        <button
          onClick={() => setGuardrailsExpanded(!guardrailsExpanded)}
          className="flex items-center justify-between w-full border-b pb-3 hover:opacity-80 transition-opacity"
          type="button"
          aria-expanded={guardrailsExpanded}
          aria-label="Toggle security guardrails section"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Security guardrails</h3>
          </div>
          {guardrailsExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {guardrailsExpanded && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/45 p-3 text-xs">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {/* The heading directly above already names these; the emphasis
                  belongs on what they actually block. */}
              <div className="text-foreground">
                <span className="font-medium">
                  These block destructive system commands, reverse shells, and
                  other malicious patterns.
                </span>{" "}
                <span className="text-muted-foreground">
                  Disable at your own risk.
                </span>
              </div>
            </div>

            <div className="space-y-1">
              {guardrails.map((guardrail) => (
                <div
                  key={guardrail.id}
                  className="flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted/50"
                >
                  <div className="flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={guardrail.id}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {guardrail.name}
                      </Label>
                      <span
                        className={`text-ui-caption font-medium uppercase ${severityColors[guardrail.severity]}`}
                      >
                        {guardrail.severity}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {guardrail.description}
                    </p>
                  </div>
                  <Switch
                    id={guardrail.id}
                    checked={guardrail.enabled}
                    onCheckedChange={() => handleToggleGuardrail(guardrail.id)}
                    aria-label={`Toggle ${guardrail.name}`}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={handleResetGuardrails}
                size="sm"
                type="button"
              >
                Reset to defaults
              </Button>
              <Button
                onClick={handleSaveGuardrails}
                disabled={isSavingGuardrails || !guardrailChanges}
                size="sm"
                type="button"
              >
                <Save className="h-4 w-4 mr-2" />
                {isSavingGuardrails ? "Saving..." : "Save guardrails"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { AgentsTab };
