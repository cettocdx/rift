"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SettingsNav } from "./SettingsNav";
import touchStyles from "./SettingsTouchTargets.module.css";
import { useSettingsNavigation } from "./useSettingsNavigation";
import {
  readSettingsReturn,
  subscribeSettingsReturn,
} from "@/lib/navigation/settings-return";

/**
 * The frame every settings route renders into.
 *
 * The nav is a slot rather than a fixture: it renders `<SettingsNav />` into
 * its own rail by default, and when the workspace sidebar grows a settings
 * section the shell is handed `nav={null}` instead of being rewritten.
 *
 * There is deliberately no main landmark here: ProChatLayout owns the
 * authenticated one, and a second would give the shell two.
 */
export function SettingsShell({
  children,
  nav,
}: {
  children: ReactNode;
  nav?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { basePath, hrefFor } = useSettingsNavigation();
  const returnHref = useSyncExternalStore(
    subscribeSettingsReturn,
    () => readSettingsReturn(basePath),
    () => basePath,
  );
  const rootHref = hrefFor(null);
  const onIndex = pathname === rootHref;

  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // The URL is the source of truth so results are linkable and Back works.
  // Local state only exists so typing does not wait on a navigation, and it is
  // resynced during render rather than in an effect — an effect would paint
  // the stale value first and then correct it.
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setQuery(urlQuery);
  }

  const commitQuery = (next: string) => {
    setQuery(next);
    const target = next.trim()
      ? `${rootHref}?q=${encodeURIComponent(next.trim())}`
      : rootHref;
    // Replace while refining a search, push when leaving a section for
    // results, so Back returns to the section rather than to each keystroke.
    if (onIndex) router.replace(target);
    else router.push(target);
  };

  return (
    <div
      data-rift-settings-shell
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row"
    >
      {nav === undefined ? (
        <aside
          data-testid="settings-rail"
          data-rift-sidebar-panel
          className={`shrink-0 flex-col border-b border-border md:flex md:min-h-0 md:w-[var(--rift-navigation-width,269px)] md:border-b-0 md:border-r ${
            onIndex ? "flex" : "hidden"
          }`}
        >
          <div className="shrink-0 border-b border-border px-3 py-3">
            {/* Settings is a place you go, so there has to be a way back. The
                dialog had a close button; a route needs the door drawn. */}
            <Link
              href={returnHref}
              data-testid="settings-exit"
              className="mb-3 -ml-1 flex h-8 w-fit items-center gap-1.5 rounded-[8px] px-1.5 text-ui text-muted-foreground transition-colors duration-(--duration-hover) hover:bg-muted/60 hover:text-foreground focus-visible:outline-none"
            >
              <ChevronLeft aria-hidden className="size-4" />
              Back to app
            </Link>
            <span className="mb-2 hidden px-0.5 text-ui font-medium text-foreground md:block">
              Settings
            </span>
            <div className="relative" role="search">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                id="settings-search-input"
                type="search"
                value={query}
                onChange={(event) => commitQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    commitQuery("");
                  }
                }}
                aria-label="Search settings"
                placeholder="Search settings"
                autoComplete="off"
                className="h-11 touch-manipulation rounded-lg bg-background pl-8 pr-12 text-ui shadow-none md:pr-8 md:pointer-fine:h-8"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear settings search"
                  onClick={() => {
                    commitQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 touch-manipulation items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none md:right-1.5 md:pointer-fine:size-5"
                >
                  <X aria-hidden className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="hidden min-h-0 flex-1 overflow-y-auto px-2 py-3 md:block">
            <SettingsNav />
          </div>
        </aside>
      ) : (
        nav
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {!onIndex ? (
          <Link
            href={rootHref}
            className="sticky top-0 z-10 flex h-11 items-center gap-1 border-b border-border bg-background px-3 text-ui text-muted-foreground hover:text-foreground focus-visible:outline-none md:hidden"
          >
            <ChevronLeft aria-hidden className="size-4" />
            Settings
          </Link>
        ) : null}
        <div
          className={`${touchStyles.content} rift-settings-content rift-page-frame rift-page-inset`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The heading every section page opens with. */
export function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="rift-page-title">{title}</h1>
      {description ? (
        <p className="mt-1 rift-page-description text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}
