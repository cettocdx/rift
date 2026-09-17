"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Blocks,
  Bot,
  Files,
  GitBranch,
  Home,
  Images,
  Keyboard,
  MessageSquare,
  NotebookText,
  PanelLeft,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Terminal,
  Hammer,
  Clapperboard,
  ListTodo,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChats, useChatTitleSearch } from "@/app/hooks/useChats";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { openShortcutsDialog } from "@/app/components/pro/ProShortcutsDialog";
import { onOpenCommandPalette } from "@/lib/utils/command-palette";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { useWorkbench } from "./WorkbenchProvider";
import { shouldPreserveTerminalCtrlChord } from "./terminal-keyboard-target";
import { purposeChatPath } from "@/lib/navigation/chat-routes";

export function WorkbenchCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { results: chats = [] } = useChats(open);
  const indexedChats = useChatTitleSearch(query, open);
  const { state, actions } = useWorkbench();
  const { initializeNewChat, closeSidebar } = useGlobalState();
  const { goHome, goChat } = useChatNavigation();
  const { openSettings } = useSettingsNavigation();
  const router = useRouter();

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        setQuery(detail.query ?? "");
        setOpen(true);
      }),
    [],
  );

  // Keep the idle palette compact. Once the operator types, search every
  // loaded chat plus the server-side title index so older sessions remain
  // reachable even when they are outside the first sidebar page.
  const paletteChats = useMemo(() => {
    if (!query.trim()) return chats.slice(0, 8);

    const byId = new Map<string, (typeof chats)[number]>();
    for (const chat of chats) byId.set(chat.id, chat);
    for (const chat of indexedChats ?? []) {
      if (!byId.has(chat.id)) byId.set(chat.id, chat as (typeof chats)[number]);
    }
    return [...byId.values()];
  }, [chats, indexedChats, query]);
  const activeDocument = state.activePath
    ? state.documents[state.activePath]
    : null;
  const canSave = Boolean(
    activeDocument &&
    activeDocument.status === "ready" &&
    activeDocument.content !== activeDocument.savedContent,
  );

  const run = (action: () => void, navigation = false) => {
    if (navigation && !actions.confirmNavigation()) return;
    action();
    setQuery("");
    setOpen(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search workbench actions and chats…"
      />
      <CommandList>
        <CommandEmpty>No matching action or chat.</CommandEmpty>
        <CommandGroup heading="Workbench">
          <CommandItem
            onSelect={() =>
              run(() => {
                closeSidebar();
                initializeNewChat();
                goHome();
              }, true)
            }
          >
            <Plus /> New agent session
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(actions.toggleSidebar)}>
            <PanelLeft /> Toggle workspace sidebar
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(actions.toggleAgentPane)}>
            <Bot /> Toggle agent pane
          </CommandItem>
          <CommandItem onSelect={() => run(actions.toggleBottomPanel)}>
            <Terminal /> Toggle terminal panel
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
          <CommandItem
            disabled={!canSave}
            onSelect={() =>
              run(() => {
                void actions.saveActiveDocument();
              })
            }
          >
            <Save /> Save active file
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                actions.selectSidebarView("explorer");
              })
            }
          >
            <Files /> Show Explorer
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                actions.selectSidebarView("changes");
              })
            }
          >
            <GitBranch /> Show Changes
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                if (state.sidebarView === "changes") {
                  void actions.refreshGit();
                } else {
                  void actions.loadDirectory("", true);
                }
              })
            }
          >
            <RefreshCw /> Refresh active workspace view
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="RIFT">
          <CommandItem onSelect={() => run(() => openSettings())}>
            <Settings /> Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(openShortcutsDialog)}>
            <Keyboard /> Keyboard shortcuts
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                closeSidebar();
                initializeNewChat("app");
                router.push(purposeChatPath("app"));
              }, true)
            }
          >
            <Hammer /> Build
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                closeSidebar();
                initializeNewChat("image");
                router.push(purposeChatPath("image"));
              }, true)
            }
          >
            <Clapperboard /> Studio
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/tasks"), true)}>
            <ListTodo /> Tasks
          </CommandItem>
          <CommandItem onSelect={() => run(goHome, true)}>
            <Home /> Workspace home
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/plugins"), true)}
          >
            <Blocks /> Plugins
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/artifacts"), true)}
          >
            <Images /> Artifacts
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => router.push("/notebook"), true)}
          >
            <NotebookText /> Pentest notebook
          </CommandItem>
        </CommandGroup>
        {paletteChats.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup
              heading={
                query.trim() ? "Agent sessions" : "Recent agent sessions"
              }
            >
              {paletteChats.map((chat) => (
                <CommandItem
                  key={chat.id}
                  onSelect={() => run(() => goChat(chat.id), true)}
                >
                  <MessageSquare />
                  <span className="truncate">
                    {chat.title?.trim() || "Untitled chat"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
