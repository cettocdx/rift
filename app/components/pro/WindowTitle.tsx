"use client";

import { createPortal } from "react-dom";
import { useWindowStripSlot } from "./window-strip";

/**
 * What you are working on, in the window strip.
 *
 * The strip used to carry the product's own name and mark. The window already
 * says which app this is; the space is better spent on the one thing that
 * changes -- the conversation you are in -- which is what the reference window
 * puts here.
 *
 * Mounts into the strip through a portal so the strip owns the geometry (it is
 * a drag overlay with the traffic lights in it) while the chat owns the text.
 * With no strip -- the web shell -- it renders nothing rather than inventing a
 * second title bar.
 */
export function WindowTitle({
  title,
  badge,
}: {
  title: string | null;
  /** Short qualifier shown after the title, e.g. the project. */
  badge?: string | null;
}) {
  const slot = useWindowStripSlot("rift-window-title-slot");

  if (!slot) return null;

  return createPortal(
    <span
      data-ui="window-title"
      /* Capped, not free to fill the bar. A RIFT chat is named after its first
         message, so an untruncated title runs a full sentence across the
         window and reads as a line of prose sitting in the chrome. The
         reference window's title is always a short name in a short field; the
         cap makes ours behave the same whatever the chat is called. */
      className="flex min-w-0 max-w-[380px] items-center gap-2 text-ui leading-5"
    >
      {/* No leading glyph. With the rail's toggle and search now riding the
          sidebar's right edge, a third icon here made a cluster of three
          unrelated marks in a row -- and the reference's content title is
          bare text. The 12px gap after the divider is the separator. */}
      {title ? (
        <span className="min-w-0 truncate font-medium text-foreground">
          {title}
        </span>
      ) : (
        // Never a placeholder that looks like a name. An untitled conversation
        // is untitled, and saying so is better than borrowing the app's name.
        <span className="min-w-0 truncate text-[var(--cursor-text-tertiary)]">
          New chat
        </span>
      )}
      {badge ? (
        <span className="shrink-0 rounded-[5px] bg-foreground/[0.07] px-1.5 py-px text-ui-label leading-4 text-[var(--cursor-text-secondary)]">
          {badge}
        </span>
      ) : null}
    </span>,
    slot,
  );
}
