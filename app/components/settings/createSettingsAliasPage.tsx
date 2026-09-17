import { notFound, redirect } from "next/navigation";
import {
  resolveExternalSettingsAlias,
  resolveSettingsSection,
  settingsHref,
} from "@/lib/settings/registry";

/**
 * The alias page for one shell.
 *
 * Only unmatched slugs reach it: Next resolves the nine static siblings first.
 * That makes it the single home for aliases — old URLs, old dialog tab names,
 * and the sections that moved out of settings entirely — and everything else
 * is a real 404 rather than an empty page.
 *
 * The base path is bound per shell so an alias opened inside the IDE resolves
 * to the IDE's own copy of the section instead of throwing the reader back to
 * the chat shell.
 *
 * In practice next.config resolves these before React runs (see
 * getSettingsAliasRedirects). This is the fallback, and the only path for the
 * aliases that are not URL-shaped.
 */
export function createSettingsAliasPage(basePath: string) {
  return async function SettingsAliasPage({
    params,
  }: {
    params: Promise<{ section: string }>;
  }) {
    const { section } = await params;
    const decoded = decodeURIComponent(section);

    const external = resolveExternalSettingsAlias(decoded);
    if (external) redirect(external);

    const resolved = resolveSettingsSection(decoded);
    if (resolved) redirect(settingsHref(basePath, resolved));

    notFound();
  };
}
