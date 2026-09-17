"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  SquarePen,
  PanelLeft,
  Settings,
  Terminal,
  Home,
  Keyboard,
  Bot,
  UsersRound,
} from "lucide-react";
import { WORKSPACE_ITEMS } from "@/lib/navigation/workspace-items";
import { SETTINGS_SECTIONS } from "@/lib/settings/registry";
import { useWorkspaceNavigation } from "@/app/hooks/useWorkspaceNavigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { hasHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { PaletteFiles } from "./PaletteFiles";
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
import { useChats, useChatTitleSearch } from "@/app/hooks/useChats";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { onOpenCommandPalette } from "@/lib/utils/command-palette";
import { useRouter } from "next/navigation";
import { openShortcutsDialog } from "./ProShortcutsDialog";

export function ProCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("All");
  const isMobile = useIsMobile();
  const openWorkspace = useWorkspaceNavigation();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { results: chats = [] } = useChats(open);
  const indexedChats = useChatTitleSearch(query, open);
  const { goHome, goChat } = useChatNavigation();
  const { openSettings } = useSettingsNavigation();
  const router = useRouter();
  const {
    toggleChatSidebar,
    initializeNewChat,
    closeSidebar,
    setChatSidebarOpen,
    toggleTerminalDock,
    subscription,
    isSubscriptionReady,
  } = useGlobalState();

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setQuery(detail.query ?? "");
        setScope("All");
        setOpen(true);
      }),
    [],
  );

  // Keep the idle palette compact, but mount every already-loaded chat as soon
  // as the operator searches. cmdk can only filter items present in the DOM;
  // slicing first made every chat after the eighth impossible to find.
  const paletteChats = useMemo(() => {
    if (!query.trim()) return chats.slice(0, 8);

    const byId = new Map<string, (typeof chats)[number]>();
    for (const chat of chats) byId.set(chat.id, chat);
    for (const chat of indexedChats ?? []) {
      if (!byId.has(chat.id)) byId.set(chat.id, chat as (typeof chats)[number]);
    }
    return [...byId.values()];
  }, [chats, indexedChats, query]);

  const run = (fn: () => void) => {
    fn();
    setQuery("");
    setOpen(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) return;
        setQuery("");
        setScope("All");
        // Where the caret was before the palette opened. It was captured on
        // open and then never used, so closing the palette left focus on the
        // document and the next keystroke went nowhere.
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target?.isConnected) {
          requestAnimationFrame(() => target.focus());
        }
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search chats, actions, navigation…"
      />
      <div
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2"
        role="group"
        aria-label="Search scope"
      >
        {["All", "Chats", "Files", "Actions", "Settings"].map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={scope === item}
            onClick={() => setScope(item)}
            className={`min-h-11 shrink-0 rounded-md px-2 py-1 text-ui-label sm:min-h-0 ${scope === item ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
          >
            {item}
          </button>
        ))}
      </div>
      <CommandList>
        {scope !== "Files" ? <CommandEmpty>No results.</CommandEmpty> : null}
        {(scope === "All" || scope === "Chats") && paletteChats.length > 0 ? (
          <CommandGroup heading={query.trim() ? "Chats" : "Recent chats"}>
            {paletteChats.map((chat) => (
              <CommandItem
                key={chat.id}
                value={`chat ${chat.id} ${chat.title}`}
                onSelect={() =>
                  run(() => {
                    if (isMobile) setChatSidebarOpen(false);
                    goChat(chat.id);
                  })
                }
              >
                <MessageSquare />
                <span className="truncate">
                  {chat.title?.trim() || "Untitled chat"}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {scope === "Files" ? (
          <PaletteFiles query={query} clearQuery={() => setQuery("")} />
        ) : null}
        {scope === "All" || scope === "Actions" ? (
          <>
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() =>
                  run(() => {
                    closeSidebar();
                    initializeNewChat("app");
                    goHome();
                  })
                }
              >
                <SquarePen /> New chat <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => run(toggleChatSidebar)}>
                <PanelLeft /> Toggle sidebar{" "}
                <CommandShortcut>⌘B</CommandShortcut>
              </CommandItem>
              {/* This used to navigate to /workspace, which is what ⌘J did before
              the terminal became a dock. The shortcut now opens the shell in
              place, so the palette entry has to do the same thing — a palette
              that advertises a shortcut and then behaves differently from it is
              worse than no entry at all. */}
              <CommandItem onSelect={() => run(toggleTerminalDock)}>
                <Terminal /> Open terminal <CommandShortcut>⌘J</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => run(() => openSettings())}>
                <Settings /> Settings <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => run(openShortcutsDialog)}>
                <Keyboard /> Keyboard shortcuts
              </CommandItem>
              <CommandItem
                onSelect={() => run(() => router.push("/agents?create=agent"))}
              >
                <Bot /> Create agent
              </CommandItem>
              <CommandItem
                onSelect={() => run(() => router.push("/agents?create=team"))}
              >
                <UsersRound /> Create team
              </CommandItem>
              <CommandItem onSelect={() => run(goHome)}>
                <Home /> Go to home
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navigate">
              {WORKSPACE_ITEMS.map(({ id, label, Icon, href }) => (
                <CommandItem
                  key={id}
                  value={`navigate ${label}`}
                  disabled={id === "hack" && !isSubscriptionReady}
                  onSelect={() =>
                    run(() => {
                      if (id === "app" || id === "image") openWorkspace(id);
                      else
                        router.push(
                          id === "hack" && !hasHackWorkbenchAccess(subscription)
                            ? "/upgrade?feature=hack"
                            : href,
                        );
                    })
                  }
                >
                  <Icon />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        {scope === "Settings" || (scope === "All" && query.trim()) ? (
          <CommandGroup heading="Settings sections">
            {SETTINGS_SECTIONS.map((section) => (
              <CommandItem
                key={section.id}
                value={`${section.label} ${section.description} ${section.keywords.join(" ")}`}
                onSelect={() => run(() => openSettings(section.id))}
              >
                <Settings />
                <span>{section.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
