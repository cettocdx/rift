"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Search,
  Check,
  Plus,
  Loader2,
  Trash2,
  X,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CodexEmptyState,
  CodexPageHeader,
  CodexPageShell,
  CodexSectionHeading,
} from "./page-shell/CodexPageShell";
import {
  SKILL_CATALOG,
  SKILL_CATEGORY_ORDER,
  type SkillCatalogEntry,
  type SkillCategory,
  type SkillScope,
} from "./skillCatalog";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

const SCOPE_LABEL: Record<SkillScope, string> = {
  all: "All modes",
  security: "Hack Workbench",
  app: "Build",
  image: "Image",
};

function SkillBadge({
  entry,
  size = 40,
}: {
  entry: SkillCatalogEntry;
  size?: number;
}) {
  const Icon = entry.Icon;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/40 text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <Icon
        style={{ width: size * 0.5, height: size * 0.5 }}
        strokeWidth={2}
        aria-hidden
      />
    </div>
  );
}

export function SkillsPanel({
  extensionTabs,
  active = true,
}: {
  extensionTabs?: ReactNode;
  active?: boolean;
} = {}) {
  const skills = useQuery(api.skills.listForUser, {});
  const install = useMutation(api.skills.installFromCatalog);
  const createCustom = useMutation(api.skills.createCustom);
  const setEnabled = useMutation(api.skills.setSkillEnabled);
  const remove = useMutation(api.skills.removeSkill);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<SkillCategory | "All">("All");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (!active) setCreateOpen(false);
  }, [active]);

  const installedByCatalog = useMemo(() => {
    const map = new Map<string, NonNullable<typeof skills>[number]>();
    for (const s of skills ?? []) if (s.catalog_id) map.set(s.catalog_id, s);
    return map;
  }, [skills]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SKILL_CATALOG.filter((e) => {
      if (activeCat !== "All" && e.category !== activeCat) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    });
  }, [query, activeCat]);

  const grouped = useMemo(() => {
    const out: Array<{ category: SkillCategory; items: SkillCatalogEntry[] }> =
      [];
    for (const category of SKILL_CATEGORY_ORDER) {
      const items = visible.filter((e) => e.category === category);
      if (items.length) out.push({ category, items });
    }
    return out;
  }, [visible]);

  const handleInstall = async (entry: SkillCatalogEntry) => {
    setInstallingId(entry.id);
    try {
      const res = await install({ catalogId: entry.id });
      if (!res.success) {
        toast.error(res.error ?? "Failed to add skill");
        return;
      }
      toast.success(`Added ${entry.name}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to add skill"));
    } finally {
      setInstallingId(null);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setBusyId(id);
    try {
      await setEnabled({ id: id as never, enabled });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id: string, label: string) => {
    setBusyId(id);
    try {
      await remove({ id: id as never });
      toast.success(`Removed ${label}`);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove"));
    } finally {
      setBusyId(null);
    }
  };

  const installed = skills ?? [];
  const loading = skills === undefined;
  const chips: Array<SkillCategory | "All"> = ["All", ...SKILL_CATEGORY_ORDER];

  return (
    <CodexPageShell busy={loading}>
      <CodexPageHeader
        title="Skills"
        description="Reusable instruction packs that guide RIFT automatically in matching sessions."
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-8 shrink-0 gap-1.5 rounded-md text-ui-nav"
          >
            <Plus className="size-3.5" aria-hidden />
            Create skill
          </Button>
        }
      />

      {/* Search + chips */}
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-4 pt-1 backdrop-blur-md">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills…"
            name="skill-search"
            aria-label="Search skills"
            className="h-9 rounded-md border-border/80 bg-card/20 pl-9 text-ui"
          />
        </div>
        {extensionTabs ? <div className="mt-2.5">{extensionTabs}</div> : null}
        <div
          className="mt-2.5 flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Skill categories"
        >
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={activeCat === c}
              onClick={() => setActiveCat(c)}
              className={`shrink-0 rounded-[4px] px-2.5 py-1.5 text-ui-label font-medium transition-colors duration-(--duration-hover) focus-visible:outline-none ${
                activeCat === c
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          className="mb-5 mt-3 flex items-center gap-2 rounded-md border border-border/70 bg-card/[0.12] px-3 py-2.5 text-ui-nav text-muted-foreground"
        >
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          Syncing installed skills…
        </div>
      ) : null}

      {/* Installed skills are persisted; enabled and disabled are both shown. */}
      {installed.length > 0 && activeCat === "All" && !query && (
        <section
          className="mb-7 mt-2"
          aria-labelledby="installed-skills-heading"
        >
          <CodexSectionHeading meta={`${installed.length} installed`}>
            <span id="installed-skills-heading">Installed</span>
          </CodexSectionHeading>
          <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80 bg-card/[0.12]">
            {installed.map((s) => {
              const cat = SKILL_CATALOG.find((e) => e.id === s.catalog_id);
              return (
                <div
                  key={s._id}
                  className="flex min-h-[58px] items-center gap-3 px-3.5 py-2.5 transition-colors duration-(--duration-hover) hover:bg-accent/25"
                >
                  {cat ? (
                    <SkillBadge entry={cat} size={34} />
                  ) : (
                    <div className="flex size-[34px] shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/40 text-muted-foreground">
                      <Sparkles className="size-4" aria-hidden />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ui font-medium text-foreground">
                      {s.name}
                    </div>
                    <div className="mt-0.5 truncate text-ui-caption text-muted-foreground">
                      {s.catalog_id ? "Built-in" : "Custom"} ·{" "}
                      {s.enabled ? "Enabled" : "Disabled"} ·{" "}
                      {SCOPE_LABEL[s.scope]}
                    </div>
                  </div>
                  <Switch
                    checked={s.enabled}
                    disabled={busyId === s._id}
                    onCheckedChange={(c) => handleToggle(s._id, c)}
                    aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(s._id, s.name)}
                    disabled={busyId === s._id}
                    aria-label={`Remove ${s.name}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--duration-hover) hover:bg-accent hover:text-foreground focus-visible:outline-none disabled:opacity-50"
                  >
                    {busyId === s._id ? (
                      <Loader2
                        className="size-3.5 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Catalog */}
      {grouped.length === 0 ? (
        <CodexEmptyState
          icon={<Search className="size-4" strokeWidth={1.7} aria-hidden />}
          title="No matching skills"
          description={
            <>No results for “{query}”. Try another term or category.</>
          }
        />
      ) : (
        grouped.map(({ category, items }) => (
          <section
            key={category}
            className="mb-6"
            aria-label={`${category} skills`}
          >
            <CodexSectionHeading meta={`${items.length} built-in`}>
              {category}
            </CodexSectionHeading>
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80 bg-card/[0.12]">
              {items.map((entry) => {
                const added = installedByCatalog.has(entry.id);
                const isInstalling = installingId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="flex min-h-[76px] items-start gap-3 px-3.5 py-3 transition-colors duration-(--duration-hover) hover:bg-accent/25"
                  >
                    <SkillBadge entry={entry} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-ui font-medium text-foreground">
                          {entry.name}
                        </span>
                        <span className="rounded-[3px] border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-ui-caption text-muted-foreground">
                          {SCOPE_LABEL[entry.scope]}
                        </span>
                        <span className="rounded-[3px] border border-border/70 bg-muted/20 px-1.5 py-0.5 font-mono text-ui-caption text-muted-foreground">
                          Built-in
                        </span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-ui-label text-muted-foreground">
                        {entry.description}
                      </div>
                      <div className="mt-2">
                        {added ? (
                          <span className="inline-flex items-center gap-1 rounded-[4px] border border-border/80 bg-muted/20 px-2 py-1 text-ui-caption font-medium text-muted-foreground">
                            <Check className="size-3" aria-hidden />
                            Installed
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleInstall(entry)}
                            disabled={isInstalling || loading}
                            aria-label={`Add ${entry.name}`}
                            className="h-7 rounded-md px-3 text-ui-label"
                          >
                            {isInstalling ? (
                              <Loader2
                                className="size-3.5 animate-spin motion-reduce:animate-none"
                                aria-hidden
                              />
                            ) : (
                              "Add skill"
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <CreateSkillDialog
        open={active && createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, description, instructions, scope) => {
          const res = await createCustom({
            name,
            description,
            instructions,
            scope,
          });
          if (!res.success) {
            toast.error(res.error ?? "Failed to create skill");
            return false;
          }
          toast.success(`Created ${name}`);
          return true;
        }}
      />
    </CodexPageShell>
  );
}

function CreateSkillDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    instructions: string,
    scope: SkillScope,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scope, setScope] = useState<SkillScope>("all");
  const [submitting, setSubmitting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setInstructions("");
      setScope("all");
    }
  }

  const canSubmit = name.trim().length > 0 && instructions.trim().length > 0;
  const scopes: SkillScope[] = ["all", "security", "app", "image"];

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onCreate(
        name.trim(),
        description.trim(),
        instructions.trim(),
        scope,
      );
      if (ok) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px]" aria-busy={submitting}>
        <DialogHeader>
          <DialogTitle className="text-ui-section">Create a skill</DialogTitle>
          <DialogDescription className="text-ui leading-5">
            Write instructions RIFT should follow. While enabled, they’re
            applied in matching chats.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="skill-name" className="text-ui-nav">
              Name
            </Label>
            <Input
              id="skill-name"
              name="skill-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cold email writer"
              autoComplete="off"
              className="h-9 text-ui"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-description" className="text-ui-nav">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="skill-description"
              name="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this skill changes"
              autoComplete="off"
              className="h-9 text-ui"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-instructions" className="text-ui-nav">
              Instructions
            </Label>
            <textarea
              id="skill-instructions"
              name="skill-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Tell RIFT how to behave when this skill is enabled…"
              rows={6}
              className="min-h-[120px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-ui leading-5 outline-none transition-colors duration-(--duration-hover) placeholder:text-[var(--cursor-text-tertiary)] focus-visible:border-ring"
            />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-ui-nav font-medium text-foreground">
              Applies to
            </legend>
            <div className="flex flex-wrap gap-1">
              {scopes.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className={`rounded-md border px-2.5 py-1.5 text-ui-label font-medium transition-colors duration-(--duration-hover) focus-visible:outline-none ${
                    scope === s
                      ? "border-border bg-accent text-foreground"
                      : "border-border/80 bg-card/20 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mt-1 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-9 gap-1.5 text-ui"
            >
              <X className="size-3.5" aria-hidden />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={!canSubmit || submitting}
              className="h-9 gap-1.5 text-ui"
            >
              {submitting ? (
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Plus className="size-3.5" aria-hidden />
              )}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
