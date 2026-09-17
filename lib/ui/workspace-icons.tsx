import type { ComponentProps } from "react";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { CubeIcon } from "@phosphor-icons/react/dist/ssr/Cube";
import { FilmSlateIcon } from "@phosphor-icons/react/dist/ssr/FilmSlate";
import { ShieldChevronIcon } from "@phosphor-icons/react/dist/ssr/ShieldChevron";
import { PuzzlePieceIcon } from "@phosphor-icons/react/dist/ssr/PuzzlePiece";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { ListChecksIcon } from "@phosphor-icons/react/dist/ssr/ListChecks";
import { StackSimpleIcon } from "@phosphor-icons/react/dist/ssr/StackSimple";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { DotsThreeOutlineIcon } from "@phosphor-icons/react/dist/ssr/DotsThreeOutline";

// Claude compact navigation scale: 16px, regular outline weight.
// One unfilled, outline family for workspace navigation. Individual SSR imports
// keep the icon module small and usable by both client and server components.
type NavigationIconProps = ComponentProps<typeof CubeIcon>;
function navigationIcon(Glyph: typeof CubeIcon, name: string) {
  function NavigationIcon(props: NavigationIconProps) {
    return (
      <Glyph
        size={16}
        weight="regular"
        aria-hidden
        {...props}
        data-workspace-icon={name}
      />
    );
  }
  return NavigationIcon;
}
export const NewChatIcon = navigationIcon(PaperPlaneTiltIcon, "newchat");
export const BuildIcon = navigationIcon(CubeIcon, "build");
export const StudioIcon = navigationIcon(FilmSlateIcon, "studio");
export const HackIcon = navigationIcon(ShieldChevronIcon, "hack");
export const PluginsIcon = navigationIcon(PuzzlePieceIcon, "plugins");
export const AgentsIcon = navigationIcon(RobotIcon, "agents");
export const RunsIcon = navigationIcon(ClockCounterClockwiseIcon, "runs");
export const TasksIcon = navigationIcon(ListChecksIcon, "tasks");
export const ArtifactsIcon = navigationIcon(StackSimpleIcon, "artifacts");
export const FolderIcon = navigationIcon(FolderSimpleIcon, "folder");
export const SettingsIcon = navigationIcon(GearSixIcon, "settings");
export const SearchIcon = navigationIcon(MagnifyingGlassIcon, "search");
export const MoreIcon = navigationIcon(DotsThreeOutlineIcon, "more");
