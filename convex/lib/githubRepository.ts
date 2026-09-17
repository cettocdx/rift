import { v } from "convex/values";

/** Public metadata only. GitHub tokens remain in the user's connection row. */
export const githubRepositoryValidator = v.object({
  id: v.number(),
  fullName: v.string(),
  defaultBranch: v.string(),
  private: v.boolean(),
});
