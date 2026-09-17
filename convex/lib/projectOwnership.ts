import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";

export type OwnedProjectLookupOptions = {
  includeArchived?: boolean;
};

/**
 * Resolve a project only when it belongs to the supplied user.
 *
 * Returning null for both missing and foreign projects prevents callers from
 * turning project IDs into an ownership oracle. Mutations that need a hard
 * failure should use requireOwnedProject instead.
 */
export async function getOwnedProject(
  db: GenericDatabaseReader<DataModel>,
  projectId: Id<"projects">,
  userId: string,
  options: OwnedProjectLookupOptions = {},
): Promise<Doc<"projects"> | null> {
  const project = await db.get(projectId);
  if (!project || project.user_id !== userId) return null;
  if (!options.includeArchived && project.archived_at !== undefined) {
    return null;
  }
  return project;
}

/**
 * Ownership guard for atomic mutations that create project-bound resources.
 */
export async function requireOwnedProject(
  db: GenericDatabaseReader<DataModel>,
  projectId: Id<"projects">,
  userId: string,
  options: OwnedProjectLookupOptions = {},
): Promise<Doc<"projects">> {
  const project = await getOwnedProject(db, projectId, userId, options);
  if (!project) {
    throw new ConvexError({
      code: "PROJECT_NOT_FOUND_OR_FORBIDDEN",
      message: "Project was not found or is not available to this user",
    });
  }
  return project;
}
