import {
  createHackAssessmentDraft,
  getHackAssessmentDraft,
} from "../assessment-drafts";
import type { UploadedFileState } from "@/types/file";

const upload = (name: string): UploadedFileState => ({
  file: new File(["report"], name, { type: "text/plain" }),
  uploading: true,
  uploaded: false,
});

it("retains drafts by both account and session without writing their contents to storage", () => {
  const write = jest.spyOn(Storage.prototype, "setItem");
  const draft = getHackAssessmentDraft("one", "first");
  draft.setTarget("private.example");
  draft.setCmd("draft only");
  draft.setCmd((previous) => `${previous}, revised`);
  draft.setActiveOp("recon");
  draft.uploads.add(upload("private.txt"));
  expect(getHackAssessmentDraft("one", "first")).toBe(draft);
  expect(draft.getSnapshot()).toEqual({
    target: "private.example",
    cmd: "draft only, revised",
    activeOp: "recon",
  });
  expect(getHackAssessmentDraft("one", "second").getSnapshot()).toEqual({
    target: "",
    cmd: "",
    activeOp: "",
  });
  expect(getHackAssessmentDraft("two", "first").uploads.getSnapshot()).toEqual(
    [],
  );
  expect(getHackAssessmentDraft("one:first", "other")).not.toBe(
    getHackAssessmentDraft("one", "first:other"),
  );
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

it("notifies subscribers only when a draft changes and keeps an empty server snapshot", () => {
  const draft = createHackAssessmentDraft();
  const listener = jest.fn();
  const unsubscribe = draft.subscribe(listener);
  const empty = draft.getSnapshot();
  draft.setCmd("");
  expect(draft.getSnapshot()).toBe(empty);
  expect(listener).not.toHaveBeenCalled();
  draft.setCmd("unsent");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(draft.getServerSnapshot()).toBe(empty);
  unsubscribe();
  draft.setTarget("scope");
  expect(listener).toHaveBeenCalledTimes(1);
});

it("pins late uploads to the originating assessment and never resurrects removed files", () => {
  const first = createHackAssessmentDraft().uploads;
  const second = createHackAssessmentDraft().uploads;
  const listener = jest.fn();
  first.subscribe(listener);
  const original = upload("first.txt");
  const id = first.add(original);
  const oldRow = first.getSnapshot()[0];
  first.update(id, { uploading: false, uploaded: true, tokens: 12 });
  expect(first.idOf(oldRow)).toBe(id);
  expect(first.idOf(first.getSnapshot()[0])).toBe(id);
  expect(first.getTotalTokens()).toBe(12);
  expect(second.getSnapshot()).toEqual([]);
  const otherId = first.add(upload("second.txt"));
  first.remove(first.idOf(oldRow)!);
  expect(first.idOf(first.getSnapshot()[0])).toBe(otherId);
  first.update(id, { uploaded: true });
  expect(first.getSnapshot()).toHaveLength(1);
  first.clear();
  const notifications = listener.mock.calls.length;
  first.update(otherId, { uploaded: true });
  first.remove(id);
  first.clear();
  expect(first.getSnapshot()).toEqual([]);
  expect(first.getTotalTokens()).toBe(0);
  expect(listener).toHaveBeenCalledTimes(notifications);
});
