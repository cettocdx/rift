// Presentation acceptance only. No authentication, network calls or assessment dispatch.
import { useSyncExternalStore } from "react";
import type { FileUploadStore } from "../../app/hooks/useFileUpload";
const disabled = () => {
  throw new Error("Assessment execution is disabled in the mobile fixture");
};
const history = { results: [], status: "Exhausted", loadMore: disabled };
const messages = Array.from({ length: 12 }, (_, i) => [
  {
    id: `user-${i}`,
    role: "user",
    parts: [{ type: "text", text: `Review supplied report section ${i + 1}.` }],
  },
  {
    id: `assistant-${i}`,
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        state: "done",
        text: `Checking the supplied evidence for section ${i + 1}.`,
      },
      {
        type: "text",
        text: `Section ${i + 1}: supplied report review complete. No network scan or command was executed.\n\n${"Evidence remains available while the keyboard and task sidebar open. ".repeat(5)}`,
      },
    ],
  },
]).flat();
const chat = {
  messages,
  status: "ready",
  sendMessage: disabled,
  stop: disabled,
  setMessages: disabled,
  resumeStream: disabled,
};
const state = {
  selectedModel: "model-gpt-6-astra",
  setChatPurpose: () => {},
  uploadedFiles: [],
};
export const useGlobalState = () => state;
export const useRetainedChat = () => chat;
export const useQuery = () => null;
export const usePaginatedQuery = () => history;
export const useMutation = () => disabled;
export const useAction = () => disabled;
export const useConvex = () => ({
  query: disabled,
  mutation: disabled,
  action: disabled,
});
export function useFileUpload(
  _mode: string,
  { store }: { store: FileUploadStore },
) {
  const files = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return {
    uploadedFiles: files,
    fileInputRef: { current: null },
    clearUploadedFiles: store.clear,
    getUploadedFileMessageParts: () => [],
    anyFilesUploading: () => false,
    handleAttachClick: disabled,
    handleFileUploadEvent: disabled,
    handleRemoveFile: disabled,
  };
}
