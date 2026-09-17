"use client";

import type { Ref } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Crosshair,
  Play,
  Square,
  Plus,
  History,
} from "lucide-react";
import { RiftLogo } from "@/components/icons/rift-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import styles from "./HackWorkbenchHeader.module.css";

export function HackWorkbenchHeader({
  target,
  onTargetChange,
  onRun,
  onStop,
  running,
  canRun,
  elapsed,
  taskName,
  sidebarOpen,
  onToggleSidebar,
  onOpenTaskBrowser,
  sidebarToggleRef,
  onNewAssessment,
  onPreviousAssessment,
}: {
  target: string;
  onTargetChange: (value: string) => void;
  onRun: () => void;
  onStop: () => void;
  running: boolean;
  canRun: boolean;
  elapsed: string;
  taskName: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenTaskBrowser?: () => void;
  sidebarToggleRef?: Ref<HTMLButtonElement>;
  onNewAssessment?: () => void;
  onPreviousAssessment?: () => void;
}) {
  const SidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;
  return (
    <header className={styles.header}>
      <div
        className={styles.titlebar}
        data-testid="hack-titlebar"
        data-rift-native-titlebar="hack"
        data-tauri-drag-region
      >
        <Link
          href="/"
          className={styles.back}
          aria-label="Back to the RIFT app"
          title="Back to RIFT"
        >
          <ArrowLeft size={15} strokeWidth={1.6} aria-hidden="true" />
          <span>Back to app</span>
        </Link>
        <button
          ref={sidebarToggleRef}
          type="button"
          className={`${styles.tasks} ${onOpenTaskBrowser ? styles.desktopTasks : ""}`}
          onClick={onToggleSidebar}
          aria-controls="rift-task-sidebar"
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "Hide task sidebar" : "Show task sidebar"}
        >
          <SidebarIcon size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>Tasks</span>
        </button>
        {onOpenTaskBrowser && (
          <button
            type="button"
            className={`${styles.tasks} ${styles.mobileTasks}`}
            onClick={onOpenTaskBrowser}
            aria-haspopup="dialog"
            aria-label="Show security tasks"
          >
            <PanelLeftOpen size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        )}
        <div className={styles.identity} data-tauri-drag-region>
          <span className={styles.logo} aria-hidden="true">
            <RiftLogo size={18} />
          </span>
          <h1 data-tauri-drag-region>Hack Workbench</h1>
          <span className={styles.edition} data-tauri-drag-region>
            Security
          </span>
        </div>
        <div
          className={styles.dragSpace}
          data-tauri-drag-region
          aria-hidden="true"
        />
        {onNewAssessment && (
          <button
            type="button"
            className={styles.navigation}
            onClick={onNewAssessment}
            aria-label="New assessment"
            title="New assessment"
          >
            <Plus size={16} strokeWidth={1.6} aria-hidden="true" />
            <span>New assessment</span>
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={styles.navigation}
              aria-label="Assessment history"
              title="Assessment history"
            >
              <History size={16} strokeWidth={1.6} aria-hidden="true" />
              <span>History</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onPreviousAssessment && (
              <DropdownMenuItem onSelect={onPreviousAssessment}>
                Previous assessment
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href="/runs">All runs</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div
          className={styles.status}
          data-running={running}
          data-tauri-drag-region
        >
          <i aria-hidden="true" />
          <span data-tauri-drag-region>{running ? "Working" : "Ready"}</span>
          {running && <time data-tauri-drag-region>{elapsed}</time>}
        </div>
      </div>
      <div className={styles.scopebar}>
        <label className={styles.scope}>
          <Crosshair size={15} strokeWidth={1.6} aria-hidden="true" />
          <span>Scope</span>
          <input
            name="target"
            aria-label="Security assessment target"
            value={target}
            onChange={(event) => onTargetChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                !running &&
                canRun
              )
                onRun();
            }}
            placeholder="Domain, IP address or CIDR"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <span className={styles.selectedTask} title={taskName}>
          {taskName}
        </span>
        <button
          type="button"
          className={styles.run}
          data-running={running}
          disabled={!running && !canRun}
          onClick={running ? onStop : onRun}
          aria-label={
            running ? "Stop active operation" : "Run active operation"
          }
        >
          {running ? (
            <Square size={12} aria-hidden="true" />
          ) : (
            <Play size={12} aria-hidden="true" />
          )}
          <span>{running ? "Stop" : "Run task"}</span>
        </button>
      </div>
    </header>
  );
}
