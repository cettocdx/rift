import { readSettings } from "./standalone-session.js";
import { validateAppUrl } from "./session.js";
export type Resource = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  tools?: string[];
};
export async function readResources(
  app: string,
  kind: "models" | "skills" | "plugins",
): Promise<Resource[]> {
  const origin = validateAppUrl(app).origin;
  const settings = await readSettings();
  const key =
    process.env.RIFT_API_KEY ||
    (settings?.app === origin ? settings.apiKey : undefined);
  if (!key) throw new Error("Run rift login before listing account resources.");
  const response = await fetch(
    new URL(
      kind === "models"
        ? "/api/console/config"
        : `/api/console/resources?kind=${kind}`,
      origin,
    ),
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(`RIFT ${kind} request failed (${response.status}).`);
  const body = (await response.json()) as {
    models?: { value: string; label: string; description?: string }[];
    items?: Resource[];
  };
  const items =
    kind === "models"
      ? body.models?.map((m) => ({
          id: m.value,
          name: m.label,
          description: m.description,
        }))
      : body.items;
  if (
    !Array.isArray(items) ||
    items.some((i) => typeof i.id !== "string" || typeof i.name !== "string")
  )
    throw new Error("Invalid RIFT resource response.");
  return items;
}
