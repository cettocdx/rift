"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FilePenLine, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  DESKTOP_LOCAL_ACCESS_CHANGED_EVENT,
  listDesktopWorkspaceGrants,
  requestDesktopFileAccess,
  revokeDesktopWorkspaceAccess,
  type DesktopWorkspaceGrant,
} from "@/app/services/desktop-local-access";
import {
  setWorkingFile,
  useWorkingFile,
} from "@/lib/composer/working-file-store";
import styles from "./WorkingFilePicker.module.css";

export function WorkingFilePicker({
  chatId,
  disabled = false,
}: {
  chatId?: string;
  disabled?: boolean;
}) {
  const file = useWorkingFile(chatId);
  const { desktopBridgeActive } = useGlobalState();
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const statusId = useId();

  useEffect(() => {
    if (!file) return;
    let disposed = false;
    const check = (grants: DesktopWorkspaceGrant[]) => {
      if (!disposed)
        setAvailable(
          grants.some(
            (grant) =>
              grant.kind === "file" &&
              grant.grantId === file.grantId &&
              grant.relativePath === file.relativePath &&
              grant.writable,
          ),
        );
    };
    void listDesktopWorkspaceGrants()
      .then(check)
      .catch(() => {
        if (!disposed) setAvailable(false);
      });
    const onChange = (event: Event) => {
      const grants = (event as CustomEvent<DesktopWorkspaceGrant[]>).detail;
      if (Array.isArray(grants)) check(grants);
    };
    window.addEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, onChange);
    return () => {
      disposed = true;
      window.removeEventListener(DESKTOP_LOCAL_ACCESS_CHANGED_EVENT, onChange);
    };
  }, [file]);

  const chooseFile = async () => {
    if (!chatId || busy || disabled) return;
    if (!isTauriEnvironment()) {
      toast.info("Open RIFT Desktop to work on the original file.", {
        description: "In the browser, use + to attach a copy for reference.",
      });
      return;
    }
    setBusy(true);
    try {
      const grant = await requestDesktopFileAccess();
      if (!grant) return;
      if (grant.kind !== "file" || !grant.relativePath || !grant.writable) {
        throw new Error("Update RIFT Desktop to open a file for editing.");
      }
      setWorkingFile(chatId, {
        grantId: grant.grantId,
        name: grant.name,
        relativePath: grant.relativePath,
      });
      setAvailable(true);
      if (file && file.grantId !== grant.grantId) {
        await revokeDesktopWorkspaceAccess(file.grantId);
      }
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not open this file. Try again.",
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const removeFile = async () => {
    if (!chatId || !file || busy || disabled) return;
    setBusy(true);
    try {
      await revokeDesktopWorkspaceAccess(file.grantId);
      setWorkingFile(chatId, null);
      setAvailable(null);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch {
      toast.error("Could not close this file. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const status =
    available === false
      ? "Reselect file"
      : desktopBridgeActive
        ? "On your computer"
        : "Connecting to your computer…";

  return (
    <div className={styles.control} data-selected={Boolean(file)}>
      <button
        ref={triggerRef}
        data-rift-composer-trigger
        type="button"
        className={styles.trigger}
        onClick={() => void chooseFile()}
        disabled={busy || disabled || !chatId}
        aria-label={
          file
            ? `Working file: ${file.name}. Choose another file`
            : "Open a file from your computer"
        }
        aria-describedby={file ? statusId : undefined}
        title={
          file
            ? `${file.name} · ${status}. Changes are saved to the original file.`
            : "Choose a text or code file to work on"
        }
      >
        {busy ? (
          <LoaderCircle
            aria-hidden
            className={styles.spinner}
            size={14}
            strokeWidth={1.8}
          />
        ) : (
          <FilePenLine aria-hidden size={14} strokeWidth={1.8} />
        )}
        <span className={styles.label}>{file?.name ?? "Open file"}</span>
        {file && (
          <span
            className={styles.dot}
            data-ready={desktopBridgeActive && available === true}
            data-expired={available === false}
            aria-hidden
          />
        )}
      </button>
      {file && (
        <>
          <span
            id={statusId}
            className={
              available === false || !desktopBridgeActive
                ? styles.status
                : "sr-only"
            }
            role="status"
          >
            {status}
          </span>
          <button
            type="button"
            className={styles.remove}
            aria-label={`Close ${file.name}`}
            title="Close file and stop sharing it with this chat"
            disabled={busy || disabled}
            onClick={() => void removeFile()}
          >
            <X aria-hidden size={12} strokeWidth={1.8} />
          </button>
        </>
      )}
    </div>
  );
}
