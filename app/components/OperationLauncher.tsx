"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  getOperation,
  type OperationDef,
  type OperationValues,
} from "@/lib/operations/operations";
import { launchOperation } from "@/lib/utils/launch-operation";
import { onOpenOperationLauncher } from "@/lib/utils/operation-launcher";

const asString = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? v.join(", ") : (v ?? "");

function initialValues(
  op: OperationDef,
  initialTarget?: string,
): OperationValues {
  const out: OperationValues = {};
  for (const f of op.fields) {
    if (f.defaultValue !== undefined) out[f.id] = f.defaultValue;
    else out[f.id] = f.type === "chips" ? [] : "";
  }
  if (initialTarget && op.targetField) out[op.targetField] = initialTarget;
  return out;
}

interface OperationLauncherProps {
  operation: OperationDef | null;
  initialTarget?: string;
  onClose: () => void;
}

/** Dialog shell — the form is keyed by operation id so it resets each open. */
export function OperationLauncher({
  operation,
  initialTarget,
  onClose,
}: OperationLauncherProps) {
  return (
    <Dialog
      open={!!operation}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <DialogTitle className="sr-only">
          {operation?.label ?? "Operation"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Configure and authorize this RIFT operation before launching it.
        </DialogDescription>
        {operation && (
          <OperationForm
            key={`${operation.id}:${initialTarget ?? ""}`}
            operation={operation}
            initialTarget={initialTarget}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OperationForm({
  operation,
  initialTarget,
  onClose,
}: {
  operation: OperationDef;
  initialTarget?: string;
  onClose: () => void;
}) {
  const [values, setValues] = useState<OperationValues>(() =>
    initialValues(operation, initialTarget),
  );
  const [authorized, setAuthorized] = useState(false);

  const setValue = (id: string, value: string | string[]) =>
    setValues((prev) => ({ ...prev, [id]: value }));

  const toggleChip = (id: string, value: string) =>
    setValues((prev) => {
      const cur = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      return {
        ...prev,
        [id]: cur.includes(value)
          ? cur.filter((x) => x !== value)
          : [...cur, value],
      };
    });

  const preview = useMemo(() => operation.build(values), [operation, values]);

  const canLaunch = useMemo(() => {
    if (!authorized) return false;
    return operation.fields.every((f) => {
      if (!f.required) return true;
      const v = values[f.id];
      const s = Array.isArray(v) ? v.join("") : (v ?? "");
      return s.trim().length > 0;
    });
  }, [operation, authorized, values]);

  const handleLaunch = () => {
    if (!canLaunch) return;
    launchOperation({
      prompt: operation.build(values),
      operationId: operation.id,
      operationLabel: operation.label,
      target: operation.targetField
        ? asString(values[operation.targetField])
        : undefined,
      mode: operation.ask ? "ask" : "agent",
    });
    onClose();
  };

  const Icon = operation.icon;

  return (
    <div className="flex max-h-[80vh] flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border px-4 pt-4 pb-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium text-foreground">
              {operation.label}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {operation.ask ? "Research" : "Operation"}
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {operation.desc}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3.5 overflow-y-auto px-4 py-4">
        {operation.fields.map((f) => {
          const FieldIcon = f.icon;
          const val = values[f.id];
          const strVal = typeof val === "string" ? val : "";
          const hint = f.validate && strVal.trim() ? f.validate(strVal) : null;

          return (
            <div key={f.id}>
              <label className="mb-1.5 block text-[11.5px] font-medium text-foreground/80">
                {f.label}
                {f.required && (
                  <span className="ml-0.5 text-muted-foreground">*</span>
                )}
              </label>

              {f.type === "text" && (
                <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-2 transition-colors focus-within:border-ring">
                  {FieldIcon && (
                    <FieldIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <input
                    value={strVal}
                    onChange={(e) => setValue(f.id, e.target.value)}
                    placeholder={f.placeholder}
                    className={cn(
                      "min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60",
                      f.mono && "font-mono",
                    )}
                  />
                  {hint === null && strVal.trim() && (
                    <Check className="size-3.5 shrink-0 text-[var(--success)]" />
                  )}
                </div>
              )}

              {f.type === "textarea" && (
                <textarea
                  value={strVal}
                  onChange={(e) => setValue(f.id, e.target.value)}
                  placeholder={f.placeholder}
                  rows={4}
                  className={cn(
                    "w-full resize-y rounded-lg border border-input bg-background px-2.5 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-ring placeholder:text-muted-foreground/60",
                    f.mono && "font-mono",
                  )}
                />
              )}

              {f.type === "chips" && (
                <div className="grid grid-cols-2 gap-1.5">
                  {f.options?.map((opt) => {
                    const selected = (Array.isArray(val) ? val : []).includes(
                      opt.value,
                    );
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleChip(f.id, opt.value)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                          selected
                            ? "border-foreground/25 bg-accent text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                            selected
                              ? "border-foreground bg-foreground text-background"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {selected && <Check className="size-2.5" />}
                        </span>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {f.type === "segment" && (
                <div className="inline-flex overflow-hidden rounded-lg border border-border text-[12px]">
                  {f.options?.map((opt) => {
                    const selected = strVal === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setValue(f.id, opt.value)}
                        className={cn(
                          "px-3.5 py-1.5 transition-colors",
                          selected
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {hint && (
                <p className="mt-1 text-[11px] text-[var(--warning)]">{hint}</p>
              )}
            </div>
          );
        })}

        {/* Authorization */}
        <button
          type="button"
          onClick={() => setAuthorized((a) => !a)}
          className="flex items-center gap-2.5 pt-0.5 text-left text-[12px] text-foreground/80"
        >
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
              authorized
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/40",
            )}
          >
            {authorized && <Check className="size-3" />}
          </span>
          <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
          I&apos;m authorized to test this target
        </button>

        {/* Live preview */}
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <span className="text-muted-foreground/60">preview › </span>
          {preview}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 border-t border-border bg-card px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleLaunch}
          disabled={!canLaunch}
          data-testid="operation-launch"
          className="ml-auto inline-flex items-center gap-2 rounded-[9px] bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {operation.ask ? "Ask RIFT" : "Launch operation"}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Single global launcher instance (mounted in ChatLayout). Opens in response to
 * openOperationLauncher() from the Arsenal list or the operation-mode next-step
 * suggestions.
 */
export function OperationLauncherController() {
  const [state, setState] = useState<{
    op: OperationDef;
    initialTarget?: string;
  } | null>(null);

  useEffect(
    () =>
      onOpenOperationLauncher((detail) => {
        const op = getOperation(detail.operationId);
        if (op) setState({ op, initialTarget: detail.initialTarget });
      }),
    [],
  );

  return (
    <OperationLauncher
      operation={state?.op ?? null}
      initialTarget={state?.initialTarget}
      onClose={() => setState(null)}
    />
  );
}
