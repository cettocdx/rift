import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { listDesktopWorkspaceGrants } from "@/app/services/desktop-local-access";
import { readWorkingFileRequestContext } from "./working-file-store";

/** Fail before sending a run if its original-file capability has expired. */
export async function prepareWorkingFileRequest(
  chatId: string,
  bridgeReady: boolean,
) {
  const file = readWorkingFileRequestContext(chatId);
  if (!file) return undefined;
  if (!isTauriEnvironment() || !bridgeReady) {
    throw new Error(
      "Your working file is offline. Open RIFT Desktop and reconnect or close the file before sending.",
    );
  }
  const grants = await listDesktopWorkspaceGrants();
  if (
    !grants.some(
      (grant) =>
        grant.kind === "file" &&
        grant.grantId === file.grantId &&
        grant.relativePath === file.relativePath &&
        grant.writable,
    )
  ) {
    throw new Error(
      "Access to your working file has ended. Open the file again before sending.",
    );
  }
  return file;
}
