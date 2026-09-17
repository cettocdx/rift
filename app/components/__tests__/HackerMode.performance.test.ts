import { OPERATIONS } from "@/lib/operations/operations";
import {
  HACK_WORKBENCH_OPERATION_IDS,
  capLiveText,
  joinBoundedText,
} from "../HackerMode";

describe("Hack Workbench transcript bounds", () => {
  it("retains pentest operation entry inside Hack Workbench", () => {
    for (const operation of OPERATIONS) {
      expect(HACK_WORKBENCH_OPERATION_IDS).toContain(operation.id);
    }
  });

  it("keeps normal terminal output unchanged", () => {
    expect(joinBoundedText(["nmap start", "443/tcp open https"], 1_000)).toBe(
      "nmap start\n443/tcp open https",
    );
    expect(capLiveText("ready", 100)).toBe("ready");
  });

  it("keeps the command header and newest output inside a hard limit", () => {
    const first = `COMMAND:${"a".repeat(4_000)}`;
    const middle = `MIDDLE:${"b".repeat(4_000)}`;
    const last = `LATEST:${"c".repeat(4_000)}:DONE`;

    const result = joinBoundedText([first, middle, last], 2_000);

    expect(result.length).toBeLessThanOrEqual(2_000);
    expect(result).toContain("COMMAND:");
    expect(result).toContain(":DONE");
    expect(result).toContain("earlier output omitted");
  });

  it("bounds a single pathological tool payload without losing its tail", () => {
    const result = capLiveText(`HEADER:${"x".repeat(20_000)}:EXIT=1`, 1_000);

    expect(result.length).toBeLessThanOrEqual(1_000);
    expect(result.startsWith("HEADER:")).toBe(true);
    expect(result.endsWith(":EXIT=1")).toBe(true);
  });
});
