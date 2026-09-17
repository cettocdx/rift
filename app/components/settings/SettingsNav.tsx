"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SECTIONS } from "@/lib/settings/registry";
import { SettingsIcon } from "./SettingsIcon";
import { useSettingsNavigation } from "./useSettingsNavigation";
import { sidebarNavRowClass } from "@/lib/ui/workspace-chrome";

/**
 * The section list. It is a <nav> of links rather than a tablist because each
 * section is a URL now — Back works, a section is linkable, and the browser
 * prefetches the one you are about to open.
 *
 * `SettingsShell` renders this into its own rail today. It takes no props that
 * tie it there, so the sidebar can render the same component later without a
 * rewrite.
 */
export function SettingsNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const { hrefFor } = useSettingsNavigation();

  return (
    <nav
      aria-label="Settings sections"
      className={`flex flex-col gap-px ${className ?? ""}`}
    >
      {SETTINGS_SECTIONS.map((section) => {
        const href = hrefFor(section.id);
        const active = pathname === href;
        return (
          <Link
            key={section.id}
            href={href}
            data-testid={`settings-nav-${section.id}`}
            aria-current={active ? "page" : undefined}
            className={sidebarNavRowClass(active)}
          >
            <SettingsIcon icon={section.icon} />
            <span className="min-w-0 flex-1 truncate">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
