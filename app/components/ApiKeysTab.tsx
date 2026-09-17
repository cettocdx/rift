"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Copy, Check, KeyRound, Trash2, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Id } from "@/convex/_generated/dataModel";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy to the clipboard");
        }
      }}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}

/** A labeled, copyable code block for the terminal-usage docs. */
function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {label && (
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {label}
          </span>
          <CopyButton text={code} />
        </div>
      )}
      <pre className="overflow-x-auto bg-muted/20 p-3 text-[11.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const PREMIUM_TIERS = new Set(["pro", "pro-plus", "ultra", "team"]);

interface ApiKeysTabProps {
  subscription: string;
}

export function ApiKeysTab({ subscription }: ApiKeysTabProps) {
  const isPremium = PREMIUM_TIERS.has(subscription);

  const keys = useQuery(api.apiKeys.list, isPremium ? {} : "skip");
  const createKey = useMutation(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);
  const createSubscription = useAction(
    api.extraUsageActions.createLemonsqueezySubscription,
  );

  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<Id<"api_keys"> | null>(
    null,
  );
  const revokeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (confirmRevokeId === null) return;
    // WebKit does not focus pointer-activated buttons, so blur alone cannot
    // cancel an armed confirmation after the user taps elsewhere.
    const cancelOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !revokeButtonRef.current?.contains(event.target)
      ) {
        setConfirmRevokeId(null);
      }
    };
    document.addEventListener("pointerdown", cancelOutside, true);
    return () =>
      document.removeEventListener("pointerdown", cancelOutside, true);
  }, [confirmRevokeId]);
  const [upgrading, setUpgrading] = useState<"pro" | "ultra" | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createKey({
        name: keyName.trim() || "Untitled key",
      });
      setRevealedKey(result.key);
      setKeyName("");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create key"));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: Id<"api_keys">) => {
    try {
      await revokeKey({ id });
      toast.success("Key revoked");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to revoke key"));
    } finally {
      setConfirmRevokeId(null);
    }
  };

  const handleUpgrade = async (tier: "pro" | "ultra") => {
    setUpgrading(tier);
    try {
      const result = await createSubscription({ tier, baseUrl });
      if (result.url) {
        window.location.href = result.url;
      } else {
        toast.error(result.error || "Could not start checkout");
        setUpgrading(null);
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not start checkout"));
      setUpgrading(null);
    }
  };

  if (!isPremium) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">API keys are a Pro/Max feature</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Upgrade to generate a personal API key and run the full RIFT agent
          from your own terminal or scripts.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={upgrading !== null}
            onClick={() => handleUpgrade("pro")}
          >
            {upgrading === "pro" ? "Redirecting…" : "Upgrade to Pro, $39/mo"}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={upgrading !== null}
            onClick={() => handleUpgrade("ultra")}
          >
            {upgrading === "ultra" ? "Redirecting…" : "Upgrade to Max, $129/mo"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-4">
      {/* Keys management */}
      <section className="flex flex-col gap-3">
        <div>
          <h4 className="text-sm font-medium">API keys</h4>
          <p className="text-xs text-muted-foreground">
            Personal keys for using RIFT outside the browser. Anyone with a key
            can act as you. Keep it secret.
          </p>
        </div>

        {revealedKey && (
          <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="text-xs font-medium text-warning">
              Copy this now. You won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-[12px]">
                {revealedKey}
              </code>
              <CopyButton text={revealedKey} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="self-end"
              onClick={() => setRevealedKey(null)}
            >
              Done
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 max-[460px]:flex-col max-[460px]:items-stretch">
          <Input
            aria-label="API key name"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name (e.g. MacBook terminal)"
            className="h-9 min-w-0 flex-1 text-[13px]"
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating}
            className="h-9 shrink-0 gap-1.5 whitespace-nowrap"
          >
            {creating ? (
              <Loader2
                aria-hidden
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <KeyRound aria-hidden className="size-3.5" />
            )}
            Create key
          </Button>
        </div>

        <div className="flex flex-col divide-y divide-border rounded-md border border-border">
          {keys === undefined && (
            <div role="status" className="p-3 text-xs text-muted-foreground">
              Loading API keys…
            </div>
          )}
          {keys?.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">
              No API keys yet.
            </div>
          )}
          {keys?.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between gap-2 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium">
                    {k.name}
                  </span>
                  {k.revoked && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Revoked
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {k.keyPrefix}… · created{" "}
                  {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt &&
                    ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`}
                </div>
              </div>
              {!k.revoked && (
                <Button
                  variant={confirmRevokeId === k.id ? "destructive" : "ghost"}
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 text-[12px]"
                  onClick={(event) => {
                    if (confirmRevokeId === k.id) {
                      void handleRevoke(k.id);
                    } else {
                      revokeButtonRef.current = event.currentTarget;
                      setConfirmRevokeId(k.id);
                    }
                  }}
                  onBlur={() => setConfirmRevokeId(null)}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  {confirmRevokeId === k.id ? "Confirm?" : "Revoke"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Terminal usage — minimal, copy-paste commands */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Use RIFT from your terminal</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Requires Node 18+. Paste these two lines. Your key drives the full
          RIFT agent (files, shell, live preview, web search, and media tools).
        </p>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">1. Set your key</p>
          <CodeBlock
            code={`export RIFT_API_KEY=${revealedKey ?? "rift_live_..."}`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">2. Run any prompt</p>
          <CodeBlock
            label="terminal"
            code={`curl -s ${baseUrl}/rift.js | node - "scan example.com for open ports"`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">Switch mode (optional)</p>
          <CodeBlock
            code={[
              `# RIFT_PURPOSE: app (default) | image`,
              `# Authorized security work runs in the Max-only /hack workbench`,
              `export RIFT_PURPOSE=app`,
              `curl -s ${baseUrl}/rift.js | node - "build me a landing page for a coffee shop"`,
            ].join("\n")}
          />
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          Prefer a saved file? <code>curl -o rift.js {baseUrl}/rift.js</code>{" "}
          then <code>node rift.js &quot;your prompt&quot;</code>.
        </p>
      </section>
    </div>
  );
}
