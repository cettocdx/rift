"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { searchSettingsSections } from "@/lib/settings/registry";
import { SettingsIcon } from "./SettingsIcon";
import { SettingsPageHeader } from "./SettingsShell";
import { useSettingsNavigation } from "./useSettingsNavigation";

/**
 * The settings landing page, and the results page for `?q=`. Both are the same
 * list, which is why a search result is a link you can send someone.
 */
export function SettingsIndex() {
  const searchParams = useSearchParams();
  const { hrefFor } = useSettingsNavigation();
  const query = (searchParams.get("q") ?? "").trim();
  const sections = searchSettingsSections(query);

  return (
    <>
      <SettingsPageHeader
        title={query ? `Results for “${query}”` : "Settings"}
        description={
          query
            ? `${sections.length} ${
                sections.length === 1 ? "section" : "sections"
              } found`
            : "Everything that configures this workspace, by section."
        }
      />

      {sections.length > 0 ? (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {sections.map((section) => (
            <Link
              key={section.id}
              href={hrefFor(section.id)}
              data-testid={`settings-index-${section.id}`}
              className="flex min-h-14 w-full touch-manipulation items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none"
            >
              <SettingsIcon
                icon={section.icon}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0">
                <span className="block text-ui font-medium leading-5">
                  {section.label}
                </span>
                <span className="block text-ui-label leading-5 text-muted-foreground">
                  {section.description}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/25 px-4 py-8 text-center"
        >
          <Search
            aria-hidden
            className="mx-auto size-4 text-muted-foreground"
          />
          <h2 className="mt-2 text-ui font-medium text-foreground">
            No settings found
          </h2>
          <p className="mt-1 text-ui-label leading-4 text-muted-foreground">
            Try a section, feature, or control name.
          </p>
        </div>
      )}
    </>
  );
}
