import {
  ShieldAlert,
  Radar,
  Bug,
  Flag,
  Code2,
  LayoutTemplate,
  Gamepad2,
  Joystick,
  Camera,
  PenTool,
  Megaphone,
  Database,
  PanelsTopLeft,
  Sparkles,
  AlignLeft,
  Globe2,
  Share2,
  BadgeCheck,
  ListTree,
  BookOpenCheck,
  ClipboardCheck,
  Clapperboard,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  SKILL_CATALOG as SERVER_SKILL_CATALOG,
  SKILL_CATEGORY_ORDER,
  type SkillCatalogDefinition,
  type SkillCatalogId,
} from "@/lib/ai/skills/catalog";

export type { SkillCategory, SkillScope } from "@/lib/ai/skills/catalog";
export { SKILL_CATEGORY_ORDER };

/**
 * UI-only presentation metadata; catalog content remains server-safe. The mark
 * is the icon alone — skill badges sit on the shared neutral plate, so a skill
 * carries no colour of its own.
 */
const SKILL_ICON = {
  "assessment-evidence-workflow": ClipboardCheck,
  "pentest-report": ShieldAlert,
  "recon-methodology": Radar,
  "web-vuln-hunting": Bug,
  "ctf-playbook": Flag,
  "ui-ux-pro-max": PanelsTopLeft,
  "design-taste-frontend": Sparkles,
  "react-best-practices": Code2,
  "landing-page": LayoutTemplate,
  "browser-game": Gamepad2,
  controls: Joystick,
  "threejs-scene": Globe2,
  "og-share-card": Share2,
  "brand-identity": BadgeCheck,
  photorealistic: Camera,
  "logo-icon": PenTool,
  "brand-voice": Megaphone,
  "sql-data": Database,
  "concise-expert": AlignLeft,
  "project-coordination": ListTree,
  "evidence-research": BookOpenCheck,
  "quality-verification": ClipboardCheck,
  "video-planning": Clapperboard,
  "project-operations": Workflow,
  "focused-implementation": Wrench,
} satisfies Record<SkillCatalogId, LucideIcon>;

export interface SkillCatalogEntry extends SkillCatalogDefinition {
  Icon: LucideIcon;
}

export const SKILL_CATALOG: SkillCatalogEntry[] = SERVER_SKILL_CATALOG.map(
  (entry) => ({
    ...entry,
    Icon: SKILL_ICON[entry.id],
  }),
);
