"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowUpRight,
  UsersRound,
  Check,
  ChevronRight,
  Folder,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  PROJECT_BOT_TEMPLATES,
  parseProjectBotProfile,
} from "@/lib/ai/agents/project-bot-templates";
import {
  MANAGED_AGENT_ROSTER_SKILL_ID,
  type CustomAgentProfileConfig,
} from "@/lib/ai/agents/pet-roster";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CODEX_NATIVE_UI_STYLE } from "@/app/components/page-shell/CodexPageShell";
import { BotAvatar } from "./BotAvatar";
import { SKILL_CATALOG } from "@/lib/ai/skills/catalog";
import {
  canLeadProjectMeeting,
  MEETING_LEADER_ERROR,
} from "@/lib/ai/agents/meeting-leader";
import styles from "./project-bots.module.css";

const AgentsWorkbench = dynamic(() =>
  import("./AgentsWorkbench").then((module) => module.AgentsWorkbench),
);
const AgentProfileDialog = dynamic(() =>
  import("./AgentProfileDialog").then((module) => module.AgentProfileDialog),
);

export function ProjectBotsWorkbench() {
  const params = useSearchParams();
  if (params.get("view") === "profiles")
    return (
      <div className={styles.advanced}>
        <Link href="/agents" className={styles.back}>
          <ArrowLeft size={14} /> Project bots
        </Link>
        <AgentsWorkbench />
      </div>
    );
  return <ProjectBots />;
}

function ProjectBots() {
  const router = useRouter();
  const params = useSearchParams();
  const projects = useQuery(api.projects.listForUser, {});
  const requestedProject = params.get("project");
  const project =
    projects?.find(
      (item) => item._id === requestedProject && item.type === "app",
    ) ?? projects?.find((item) => item.type === "app");
  const bots = useQuery(
    api.projectBots.list,
    project ? { projectId: project._id } : "skip",
  );
  const create = useMutation(api.projectBots.create);
  const update = useMutation(api.projectBots.update);
  const archive = useMutation(api.projectBots.archive);
  const openChat = useMutation(api.projectBots.openChat);
  const createProject = useMutation(api.projects.createProject);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [templateId, setTemplateId] = useState<string>(
    PROJECT_BOT_TEMPLATES[0].id,
  );
  const [botName, setBotName] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installedSkills = useQuery(api.skills.listForUser, {});
  const mcpServers = useQuery(
    api.mcpServers.listForUser,
    editing ? {} : "skip",
  );
  const skillNames = useMemo(() => {
    const names = new Map<string, string>(
      SKILL_CATALOG.map((skill) => [skill.id, skill.name]),
    );
    for (const skill of installedSkills ?? [])
      names.set(skill.catalog_id ?? String(skill._id), skill.name);
    return names;
  }, [installedSkills]);
  const selected = bots?.find((bot) => bot._id === selectedId) ?? bots?.[0];
  const profile = selected
    ? parseProjectBotProfile(selected.profile_json)
    : null;
  const template =
    PROJECT_BOT_TEMPLATES.find((item) => item.id === templateId) ??
    PROJECT_BOT_TEMPLATES[0];
  const selectedTemplate = PROJECT_BOT_TEMPLATES.find(
    (item) => item.id === selected?.template_id,
  );
  const filteredBots = useMemo(
    () =>
      bots?.filter((bot) =>
        `${bot.name} ${bot.mission}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [bots, query],
  );

  async function perform(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This change could not be saved. Please try again.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function selectProject(id: string) {
    setSelectedId(null);
    setConfirmArchive(false);
    setEditing(false);
    setQuery("");
    setError(null);
    router.replace(`/agents?project=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  }

  function showCatalog() {
    requestRef.current = crypto.randomUUID();
    setBotName("");
    setError(null);
    setCatalogOpen(true);
  }

  async function saveProfile(next: CustomAgentProfileConfig) {
    if (!selected) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await update({
        id: selected._id,
        name: next.name,
        mission: next.mission,
        profileJson: JSON.stringify(next),
      });
      setEditing(false);
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Bot settings could not be saved.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.workspace}
      style={CODEX_NATIVE_UI_STYLE}
      aria-label="Project bots"
    >
      <header className={styles.header}>
        <div>
          <h1>Bots</h1>
          <p>A dedicated team for your project.</p>
        </div>
        <Link href="/agents?view=profiles" className={styles.secondary}>
          <Settings2 size={14} /> Agent profiles
        </Link>
      </header>
      <div className={styles.projectBar}>
        <Folder size={15} />
        <select
          aria-label="Project"
          value={project?._id ?? ""}
          onChange={(event) => selectProject(event.target.value)}
          disabled={!projects || busy}
        >
          {!project && <option value="">Choose a project</option>}
          {projects
            ?.filter((item) => item.type === "app")
            .map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
        </select>
        <button
          className={styles.iconButton}
          aria-label="Create project"
          onClick={() => {
            setError(null);
            setNewProjectOpen(true);
          }}
        >
          <Plus size={16} />
        </button>
        <span className={styles.projectCount}>
          {bots ? `${bots.length} ${bots.length === 1 ? "bot" : "bots"}` : ""}
        </span>
        <button
          className={styles.primary}
          disabled={!project || busy}
          onClick={showCatalog}
        >
          <Plus size={14} /> Add bot
        </button>
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {!projects || (project && bots === undefined) ? (
        <div className={styles.loading} role="status">
          Loading your team…
        </div>
      ) : !project ? (
        <div className={styles.empty}>
          <Folder size={26} />
          <h2>Start with a project</h2>
          <p>Keep your bots, conversations and responsibilities together.</p>
          <button
            className={styles.primary}
            onClick={() => setNewProjectOpen(true)}
          >
            Create project
          </button>
        </div>
      ) : !bots?.length ? (
        <div className={styles.empty}>
          <div className={styles.avatarGroup}>
            {PROJECT_BOT_TEMPLATES.slice(0, 3).map((item) => (
              <BotAvatar key={item.id} identity={item.id} size={46} />
            ))}
          </div>
          <h2>Build your project team</h2>
          <p>
            Add a specialist with a clear role and a focused skill pack. Each
            bot has its own saved conversation.
          </p>
          <button className={styles.primary} onClick={showCatalog}>
            <Plus size={14} /> Choose your first bot
          </button>
          <span className={styles.note}>
            Bots start working when you give them a task.
          </span>
        </div>
      ) : (
        <div className={styles.body}>
          <aside className={styles.roster} aria-label="Project team">
            <label className={styles.search}>
              <Search size={14} />
              <input
                aria-label="Find a bot"
                placeholder="Find a bot"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className={styles.botList}>
              {filteredBots?.map((bot) => (
                <button
                  key={bot._id}
                  className={styles.botRow}
                  aria-pressed={selected?._id === bot._id}
                  onClick={() => {
                    setSelectedId(bot._id);
                    setConfirmArchive(false);
                    setError(null);
                  }}
                >
                  <BotAvatar identity={bot.template_id} size={36} />
                  <span>
                    <strong>{bot.name}</strong>
                    <small>
                      {PROJECT_BOT_TEMPLATES.find(
                        (item) => item.id === bot.template_id,
                      )?.role ?? "Project specialist"}
                    </small>
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
              {filteredBots?.length === 0 && (
                <p className={styles.noResults}>No bots match “{query}”.</p>
              )}
            </div>
          </aside>
          {selected && (
            <section
              aria-label="Bot profile"
              className={styles.detail}
              key={selected._id}
            >
              <div className={styles.identity}>
                <BotAvatar identity={selected.template_id} size={56} />
                <div>
                  <h2>{selected.name}</h2>
                  <p>{profile?.roleName ?? selectedTemplate?.role}</p>
                </div>
                <button
                  aria-label={`Edit ${selected.name}`}
                  className={styles.iconButton}
                  disabled={!profile || busy}
                  onClick={() => setEditing(true)}
                >
                  <Settings2 size={16} />
                </button>
              </div>
              <p className={styles.mission}>{selected.mission}</p>
              <button
                className={styles.chatButton}
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const chatId = await openChat({ id: selected._id });
                    router.push(`/c/${encodeURIComponent(chatId)}`);
                  })
                }
              >
                <MessageSquare size={17} />
                <span>
                  <strong>Open conversation</strong>
                  <small>Continue in this bot’s saved chat</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <div className={styles.detailSection}>
                <h3>Skill pack</h3>
                <div className={styles.skills}>
                  {(profile?.skillIds ?? selectedTemplate?.skills ?? []).map(
                    (skill) => (
                      <span key={skill}>
                        {skillNames.get(skill) ?? skill.replace(/-/g, " ")}
                      </span>
                    ),
                  )}
                </div>
              </div>
              {selectedTemplate && (
                <div className={styles.detailSection}>
                  <h3>Expected output</h3>
                  <p>{selectedTemplate.deliverable}</p>
                </div>
              )}
              <div className={styles.detailSection}>
                <h3>Project scope</h3>
                <p>
                  Role and skill changes apply to this bot in {project.name}.
                  Other project bots keep their own settings.
                </p>
              </div>
              <BotTasks
                key={selected._id}
                botId={selected._id}
                projectId={project._id}
                botName={selected.name}
              />
              <div className={styles.detailFooter}>
                {confirmArchive ? (
                  <>
                    <span>Remove from this team? Chat history is kept.</span>
                    <button
                      disabled={busy}
                      onClick={() => setConfirmArchive(false)}
                    >
                      Cancel
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await archive({ id: selected._id });
                          setSelectedId(null);
                          setConfirmArchive(false);
                        })
                      }
                    >
                      Archive bot
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => setConfirmArchive(true)}
                  >
                    <Trash2 size={13} /> Archive bot
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      )}
      {project && bots && bots.length > 0 && (
        <ProjectMeetings
          key={project._id}
          projectId={project._id}
          bots={bots}
        />
      )}
      <Dialog
        open={catalogOpen}
        onOpenChange={(open) => {
          if (!busy) setCatalogOpen(open);
        }}
      >
        <DialogContent className={styles.catalogDialog}>
          <DialogHeader>
            <DialogTitle>Add a project bot</DialogTitle>
            <DialogDescription>
              Choose a role. You can adjust skills and responsibilities after
              adding it.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.catalogGrid}>
            {PROJECT_BOT_TEMPLATES.map((item) => (
              <button
                key={item.id}
                aria-pressed={templateId === item.id}
                onClick={() => {
                  setTemplateId(item.id);
                  setBotName("");
                  requestRef.current = crypto.randomUUID();
                }}
                disabled={busy}
                className={styles.templateRow}
              >
                <BotAvatar identity={item.id} size={36} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.role}</small>
                </span>
                {templateId === item.id && <Check size={14} />}
              </button>
            ))}
          </div>
          <div className={styles.templatePreview}>
            <p>{template.mission}</p>
            <div className={styles.skills}>
              {template.skills.map((skill) => (
                <span key={skill}>
                  {skillNames.get(skill) ?? skill.replace(/-/g, " ")}
                </span>
              ))}
            </div>
          </div>
          <label className={styles.nameField}>
            Bot name
            <input
              maxLength={40}
              value={botName}
              placeholder={template.name}
              onChange={(event) => {
                setBotName(event.target.value);
                requestRef.current = crypto.randomUUID();
              }}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className={styles.dialogError}>
              {error}
            </p>
          )}
          <div className={styles.dialogFooter}>
            <span>Adding a bot does not start a run.</span>
            <button
              className={styles.primary}
              disabled={busy || !project}
              onClick={() =>
                void perform(async () => {
                  if (!project) return;
                  requestRef.current ??= crypto.randomUUID();
                  const result = await create({
                    projectId: project._id,
                    templateId,
                    name: botName.trim() || undefined,
                    requestId: requestRef.current,
                  });
                  setSelectedId(result.botId);
                  setCatalogOpen(false);
                })
              }
            >
              {busy ? "Adding…" : "Add to project"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={newProjectOpen}
        onOpenChange={(open) => {
          if (!busy) setNewProjectOpen(open);
        }}
      >
        <DialogContent className={styles.projectDialog}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A home for your bots and their conversations.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const result = await createProject({
                  name: projectName.trim(),
                  type: "app",
                });
                if (!result.success || !result.id)
                  throw new Error(result.error || "Could not create project.");
                setNewProjectOpen(false);
                setProjectName("");
                selectProject(result.id);
              });
            }}
          >
            <label className={styles.nameField}>
              Project name
              <input
                autoFocus
                maxLength={100}
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                disabled={busy}
              />
            </label>
            {error && (
              <p className={styles.dialogError} role="alert">
                {error}
              </p>
            )}
            <div className={styles.dialogFooter}>
              <button
                className={styles.primary}
                type="submit"
                disabled={!projectName.trim() || busy}
              >
                {busy ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {editing && profile && (
        <AgentProfileDialog
          open
          initialProfile={profile}
          installedSkills={(installedSkills ?? [])
            .filter(
              (skill) => skill.catalog_id !== MANAGED_AGENT_ROSTER_SKILL_ID,
            )
            .map((skill) => ({
              id: skill.catalog_id ?? String(skill._id),
              name: skill.name,
              description: skill.description,
              enabled: skill.enabled,
              source: "installed" as const,
            }))}
          mcpServers={(mcpServers ?? []).map((server) => ({
            id: String(server._id),
            name: server.name,
            enabled: server.enabled,
            connectionStatus: server.connectionStatus,
          }))}
          onClose={() => setEditing(false)}
          onSave={saveProfile}
          saving={busy}
          minSkills={0}
        />
      )}
    </section>
  );
}

function ProjectMeetings({
  projectId,
  bots,
}: {
  projectId: Id<"projects">;
  bots: Array<{
    _id: Id<"project_bots">;
    name: string;
    template_id: string;
    profile_json: string;
  }>;
}) {
  const router = useRouter();
  const meetings = useQuery(api.botMeetings.list, { projectId });
  const createMeeting = useMutation(api.botMeetings.create);
  const openMeeting = useMutation(api.botMeetings.openChat);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [participants, setParticipants] = useState<Id<"project_bots">[]>([]);
  const [leaderId, setLeaderId] = useState<Id<"project_bots"> | "">("");
  const eligibleLeaders = useMemo(
    () =>
      bots.filter((bot) =>
        canLeadProjectMeeting(parseProjectBotProfile(bot.profile_json)),
      ),
    [bots],
  );
  const validLeader = eligibleLeaders.some((bot) => bot._id === leaderId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const requestRef = useRef<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this meeting. Please try again.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <section className={styles.meetings} aria-label="Project meetings">
      <div className={styles.meetingHeading}>
        <div>
          <h2>Meetings</h2>
          <p>Bring specialists together around one agenda.</p>
        </div>
        <button
          className={styles.secondary}
          disabled={bots.length < 2 || eligibleLeaders.length === 0 || pending}
          onClick={() => {
            setTitle("");
            setAgenda("");
            setScheduledTime("");
            const firstLeader = eligibleLeaders[0];
            setLeaderId(firstLeader?._id ?? "");
            setParticipants(
              firstLeader
                ? [
                    firstLeader._id,
                    ...bots
                      .filter((bot) => bot._id !== firstLeader._id)
                      .slice(0, 1)
                      .map((bot) => bot._id),
                  ]
                : [],
            );
            requestRef.current = crypto.randomUUID();
            setError(null);
            setOpen(true);
          }}
        >
          <Plus size={14} /> New meeting
        </button>
      </div>
      {meetings === undefined ? (
        <p className={styles.note} role="status">
          Loading meetings…
        </p>
      ) : meetings.length === 0 ? (
        <p className={styles.note}>
          {bots.length < 2
            ? "Add another bot to create a shared meeting."
            : eligibleLeaders.length === 0
              ? "Enable delegation for a project bot to lead a meeting."
              : "No meetings yet. Choose participants and set an agenda to begin."}
        </p>
      ) : (
        <div className={styles.meetingList}>
          {meetings.map((meeting) => (
            <button
              className={styles.meetingRow}
              key={meeting._id}
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  const chatId = await openMeeting({ id: meeting._id });
                  router.push(`/c/${encodeURIComponent(chatId)}`);
                })
              }
            >
              <UsersRound size={17} />
              <span>
                <strong>{meeting.title}</strong>
                <small>
                  {meeting.participant_bot_ids.length} participants ·{" "}
                  {meeting.agenda}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      )}
      {error && !open && (
        <p role="alert" className={styles.dialogError}>
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent className={styles.meetingDialog}>
          <DialogHeader>
            <DialogTitle>New meeting</DialogTitle>
            <DialogDescription>
              Choose the bots whose expertise this discussion needs.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (!validLeader || !leaderId)
                  throw new Error(MEETING_LEADER_ERROR);
                requestRef.current ??= crypto.randomUUID();
                const scheduledFor = scheduledTime
                  ? new Date(scheduledTime).getTime()
                  : undefined;
                if (
                  scheduledFor !== undefined &&
                  (!Number.isFinite(scheduledFor) || scheduledFor <= Date.now())
                )
                  throw new Error("Choose a future meeting time.");
                const result = await createMeeting({
                  projectId,
                  title: title.trim(),
                  agenda: agenda.trim(),
                  participantBotIds: [
                    leaderId,
                    ...participants.filter((id) => id !== leaderId),
                  ],
                  ...(scheduledFor === undefined
                    ? {}
                    : {
                        scheduledFor,
                        timezone:
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                      }),
                  requestId: requestRef.current,
                });
                setOpen(false);
                router.push(`/c/${encodeURIComponent(result.chatId)}`);
              });
            }}
          >
            <label className={styles.nameField}>
              Meeting title
              <input
                maxLength={100}
                value={title}
                disabled={pending}
                onChange={(event) => {
                  setTitle(event.target.value);
                  requestRef.current = crypto.randomUUID();
                }}
                placeholder="Design review"
                autoFocus
              />
            </label>
            <label className={styles.nameField}>
              Agenda
              <textarea
                rows={3}
                maxLength={4000}
                value={agenda}
                disabled={pending}
                onChange={(event) => {
                  setAgenda(event.target.value);
                  requestRef.current = crypto.randomUUID();
                }}
                placeholder="What should the team decide or deliver?"
              />
            </label>
            <label className={styles.nameField}>
              Schedule for later (optional)
              <input
                type="datetime-local"
                value={scheduledTime}
                disabled={pending}
                onChange={(event) => {
                  setScheduledTime(event.target.value);
                  requestRef.current = crypto.randomUUID();
                }}
              />
              <small className={styles.note}>
                Your timezone:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Scheduled
                runs require Pro or Max.
              </small>
            </label>
            <label className={styles.nameField}>
              Meeting lead
              <select
                value={leaderId}
                disabled={pending}
                onChange={(event) => {
                  const next = eligibleLeaders.find(
                    (bot) => bot._id === event.target.value,
                  );
                  if (!next) return;
                  requestRef.current = crypto.randomUUID();
                  setLeaderId(next._id);
                  setParticipants((current) =>
                    current.includes(next._id)
                      ? current
                      : [next._id, ...current].slice(0, 6),
                  );
                }}
              >
                {eligibleLeaders.map((bot) => (
                  <option value={bot._id} key={bot._id}>
                    {bot.name}
                  </option>
                ))}
              </select>
              <small className={styles.note}>
                The lead coordinates the discussion and combines contributions.
                Only bots with delegation enabled can lead.
              </small>
            </label>
            <fieldset className={styles.participants}>
              <legend>
                Participants <span>{participants.length}/6</span>
              </legend>
              {bots.map((bot) => (
                <label key={bot._id}>
                  <BotAvatar identity={bot.template_id} size={28} />
                  <span>{bot.name}</span>
                  <input
                    type="checkbox"
                    checked={participants.includes(bot._id)}
                    disabled={
                      pending ||
                      bot._id === leaderId ||
                      (!participants.includes(bot._id) &&
                        participants.length >= 6)
                    }
                    onChange={() => {
                      requestRef.current = crypto.randomUUID();
                      setParticipants((current) =>
                        current.includes(bot._id)
                          ? current.filter((id) => id !== bot._id)
                          : [...current, bot._id],
                      );
                    }}
                  />
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className={styles.dialogError}>
                {error}
              </p>
            )}
            <div className={styles.dialogFooter}>
              <span>
                {scheduledTime
                  ? "The meeting will run at the chosen time."
                  : "Opens a saved group conversation. Send a message to begin."}
              </span>
              <button
                className={styles.primary}
                type="submit"
                disabled={
                  pending ||
                  !title.trim() ||
                  !agenda.trim() ||
                  !validLeader ||
                  participants.length < 2
                }
              >
                {pending ? "Creating…" : "Create meeting"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BotTasks({
  projectId,
  botId,
  botName,
}: {
  projectId: Id<"projects">;
  botId: Id<"project_bots">;
  botName: string;
}) {
  const tasks = useQuery(api.tasks.listForUser, {});
  const createTask = useMutation(api.tasks.createTask);
  const assigned = tasks?.filter(
    (task) => task.project_id === projectId && task.assignee_bot_id === botId,
  );
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  return (
    <section className={styles.detailSection} aria-label={`${botName} tasks`}>
      <div className={styles.taskHeading}>
        <h3>Assigned tasks</h3>
        <button
          className={styles.secondary}
          onClick={() => {
            setTitle("");
            setPrompt("");
            setScheduledTime("");
            setError(null);
            setOpen(true);
          }}
        >
          <Plus size={12} /> Add task
        </button>
      </div>
      {assigned === undefined ? (
        <p role="status">Loading tasks…</p>
      ) : assigned.length === 0 ? (
        <p>No tasks assigned yet.</p>
      ) : (
        <div className={styles.assignedTasks}>
          {assigned.map((task) => (
            <Link href="/tasks" key={task._id}>
              <span>
                <strong>{task.title}</strong>
                <small>
                  {task.status === "completed"
                    ? "Completed"
                    : task.scheduler_state === "scheduled"
                      ? "Scheduled"
                      : "Open"}
                </small>
              </span>
              <ArrowUpRight size={13} />
            </Link>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent className={styles.meetingDialog}>
          <DialogHeader>
            <DialogTitle>Assign a task</DialogTitle>
            <DialogDescription>
              {botName} will use its project role and selected skills.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (pendingRef.current) return;
              pendingRef.current = true;
              setPending(true);
              setError(null);
              try {
                const scheduledFor = scheduledTime
                  ? new Date(scheduledTime).getTime()
                  : undefined;
                if (
                  scheduledFor !== undefined &&
                  (!Number.isFinite(scheduledFor) || scheduledFor <= Date.now())
                )
                  throw new Error("Choose a future task time.");
                const result = await createTask({
                  projectId,
                  assigneeBotId: botId,
                  title: title.trim(),
                  prompt: prompt.trim(),
                  purpose: "app",
                  scheduleType: scheduledFor === undefined ? "manual" : "once",
                  ...(scheduledFor === undefined
                    ? {}
                    : {
                        scheduledFor,
                        timezone:
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                      }),
                });
                if (!result.success)
                  throw new Error(result.error || "Task could not be saved.");
                setOpen(false);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Task could not be saved.",
                );
              } finally {
                pendingRef.current = false;
                setPending(false);
              }
            }}
          >
            <label className={styles.nameField}>
              Task title
              <input
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={pending}
              />
            </label>
            <label className={styles.nameField}>
              Instructions
              <textarea
                rows={4}
                maxLength={8000}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={pending}
                placeholder="Describe the goal and expected result."
              />
            </label>
            <label className={styles.nameField}>
              Run later (optional)
              <input
                type="datetime-local"
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
                disabled={pending}
              />
              <small className={styles.note}>
                Your timezone:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Scheduled
                runs require Pro or Max.
              </small>
            </label>
            {error && (
              <p role="alert" className={styles.dialogError}>
                {error}
              </p>
            )}
            <div className={styles.dialogFooter}>
              <span>
                {scheduledTime
                  ? "Runs at the selected time."
                  : "Saved for you to start from Tasks."}
              </span>
              <button
                className={styles.primary}
                type="submit"
                disabled={pending || !title.trim() || !prompt.trim()}
              >
                {pending ? "Saving…" : "Assign task"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
