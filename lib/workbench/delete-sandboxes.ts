import "server-only";

import { Sandbox } from "@e2b/code-interpreter";
import { workbenchSandboxOwnerIds } from "./terminal-contract";

async function listAllUserSandboxIds(ownerId: string) {
  const sandboxIds: string[] = [];
  for (const ownerField of ["userID", "ownerUserID"] as const) {
    const paginator = Sandbox.list({
      query: { metadata: { [ownerField]: ownerId } },
    });
    while (paginator.hasNext) {
      const page = await paginator.nextItems();
      sandboxIds.push(...page.map((sandbox) => sandbox.sandboxId));
    }
  }

  return [...new Set(sandboxIds)];
}

/** Delete the agent VM plus current and legacy command-runner VMs. */
export async function deleteUserSandboxes(userId: string) {
  const sandboxIdPages = await Promise.all(
    workbenchSandboxOwnerIds(userId).map(listAllUserSandboxIds),
  );
  const sandboxIds = [...new Set(sandboxIdPages.flat())];

  const results = await Promise.allSettled(
    sandboxIds.map((sandboxId) => Sandbox.kill(sandboxId)),
  );
  if (
    results.some(
      (result) => result.status === "rejected" || result.value !== true,
    )
  ) {
    throw new Error("One or more user sandboxes could not be deleted.");
  }

  return sandboxIds.length;
}
