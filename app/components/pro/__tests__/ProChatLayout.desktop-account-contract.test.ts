import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "app/components/pro/ProChatLayout.tsx"),
  "utf8",
);

describe("Pro desktop sidebar account footer", () => {
  it("selects the name-only identity while preserving balanced bottom spacing", () => {
    expect(source).toContain('<SidebarUserNav identityMode="name-only" />');
    // `.pro-sidebar-footer` is a fixed-height box whose CSS lays out its DIRECT
    // child as the account row. A wrapper element between the two collapses the
    // account into a clipped vertical stack, so the footer keeps exactly one
    // child and it is the account nav itself.
    expect(source).toContain(
      // px-1.5, the rail's one inset: the footer used to sit on 8px while the
      // rows above it sat on 12 and 16, so nothing in the rail shared an edge.
      'className="pro-sidebar-footer shrink-0 border-t border-sidebar-border px-1.5 pb-3 pt-2"',
    );
  });
});
