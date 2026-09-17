import { getResumeSection } from "../resume";

describe("timeout continuation guidance", () => {
  it.each(["timeout", "preemptive-timeout"])(
    "recovers %s from verified state without replaying uncertain commands",
    (reason) => {
      const section = getResumeSection(reason);
      expect(section).toContain("<resume_context>");
      expect(section).toContain("When the user asks to continue");
      expect(section).toContain("saved files and command results");
      expect(section).toContain("may still be running");
      expect(section).toContain(
        "Do not repeat a command with an uncertain outcome",
      );
      expect(section).not.toContain("your work is preserved");
    },
  );

  it.each([undefined, "stop", "unknown"])(
    "does not invent interrupted work for %s",
    (reason) => expect(getResumeSection(reason)).toBe(""),
  );
});
