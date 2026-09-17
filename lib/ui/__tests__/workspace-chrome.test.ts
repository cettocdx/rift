import { SIDEBAR_ROW_HEIGHT_PX, sidebarNavRowClass } from "../workspace-chrome";

describe("the sidebar row", () => {
  it("keeps its height constant and its class in agreement", () => {
    // Two places have to agree: the Tailwind literal in the class, and the
    // number read by anything that reserves a row's space. They drifted once
    // -- the row shrank and a list's `contain-intrinsic-size` placeholder
    // stayed at the old height, padding every row in that list with the
    // difference, which showed up as a rail that had grown gaps nobody set.
    expect(sidebarNavRowClass(false)).toContain(
      SIDEBAR_ROW_HEIGHT_PX === 32 ? `h-8` : `h-[${SIDEBAR_ROW_HEIGHT_PX}px]`,
    );
  });

  it("marks the current destination with fill and colour, not weight", () => {
    // Navigation shares the conversation rows’ 418 weight in both states; selection
    // changes colour and background without changing text geometry.
    const active = sidebarNavRowClass(true);
    const rest = sidebarNavRowClass(false);

    expect(active).toContain("bg-sidebar-accent");
    expect(active).toContain("font-[418]");
    expect(active).toContain("tracking-[-0.08px]");
    expect(active).not.toMatch(/font-(semibold|bold)/);

    // The row you are already on does not light up again under the pointer:
    // it is filled, and hover belongs to the rows that aren't. cursor.com's
    // own rows use ONE fill strength for hover and selection (bg-quaternary,
    // 6% of primary), so rest-hover takes the token at full value.
    expect(active).not.toContain("hover:bg-");
    expect(rest).toContain("hover:bg-sidebar-accent");
  });
});
