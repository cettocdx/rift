import { redirect } from "next/navigation";

/**
 * The former standalone Security notebook is intentionally consolidated into
 * Hack Workbench. `/hack` owns the real server-side session + premium checks,
 * so this compatibility route cannot become a second security surface.
 */
export default function NotebookPage() {
  redirect("/hack");
}
