import type { Id } from "@/convex/_generated/dataModel";
import type { FileDetails } from "@/types/file";
import { mergeFileMetadataReceipt } from "../file-metadata-receipts";

const file = (id: string, fields: Partial<FileDetails> = {}): FileDetails => ({
  fileId: id as Id<"files">,
  name: `${id}.txt`,
  mediaType: "text/plain",
  ...fields,
});

test("a later same-ID receipt replaces stale name, type and storage without moving the file", () => {
  const old = file("a", { s3Key: "old-key", url: "old-url" });
  const unaffected = file("b");
  const previous = new Map([["message", [old, unaffected]]]);
  const corrected = file("a", {
    name: "corrected.png",
    mediaType: "image/png",
    storageId: "new-storage",
  });
  const next = mergeFileMetadataReceipt(previous, "message", [corrected]);
  expect(next.get("message")).toEqual([corrected, unaffected]);
  expect(next.get("message")?.[0]).not.toHaveProperty("s3Key");
  expect(next.get("message")?.[0]).not.toHaveProperty("url");
  expect(previous.get("message")).toEqual([old, unaffected]);
  expect(next).not.toBe(previous);
});

test("duplicates within one completion batch use the last entry at its first position", () => {
  const first = file("a"),
    middle = file("b"),
    last = file("a", { name: "final.txt" });
  expect(
    mergeFileMetadataReceipt(new Map(), "message", [first, middle, last]).get(
      "message",
    ),
  ).toEqual([last, middle]);
});

test("replaying ordered receipts produces the same corrected state as live delivery", () => {
  const receipts = [
    [file("a")],
    [file("b")],
    [file("a", { name: "renamed.txt" }), file("c")],
  ];
  const apply = (state: Map<string, FileDetails[]>, incoming: FileDetails[]) =>
    mergeFileMetadataReceipt(state, "message", incoming);
  const live = receipts.reduce(apply, new Map<string, FileDetails[]>());
  const replay = receipts.reduce(apply, new Map<string, FileDetails[]>());
  expect(replay).toEqual(live);
  expect(replay.get("message")?.map((item) => item.name)).toEqual([
    "renamed.txt",
    "b.txt",
    "c.txt",
  ]);
  expect(receipts.reduce(apply, replay)).toEqual(live);
});

test("adds new files without replacing another message's receipt array", () => {
  const other = [file("other")];
  const previous = new Map([
    ["other-message", other],
    ["message", [file("a")]],
  ]);
  const next = mergeFileMetadataReceipt(previous, "message", [file("b")]);
  expect(next.get("message")?.map((item) => item.fileId)).toEqual(["a", "b"]);
  expect(next.get("other-message")).toBe(other);
  expect(previous.get("message")).toHaveLength(1);
});
