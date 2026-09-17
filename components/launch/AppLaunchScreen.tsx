"use client";

import { RiftLogo } from "@/components/icons/rift-logo";
import "./launch-screen.css";

interface AppLaunchScreenProps {
  status?: string;
  error?: string;
  onRetry?: () => void;
}

/** Shared with the offline desktop boot document by its build generator. */
export function AppLaunchScreen({
  status = "Opening RIFT",
  error,
  onRetry,
}: AppLaunchScreenProps) {
  return (
    <main className="rift-launch" data-state={error ? "error" : "loading"}>
      <div
        className="rift-launch__drag"
        data-tauri-drag-region
        aria-hidden="true"
      />
      <div className="rift-launch__identity">
        <span aria-hidden="true">
          <RiftLogo size={44} className="rift-launch__mark" />
        </span>
        <h1 className="rift-launch__wordmark">RIFT</h1>
        <p className="rift-launch__expansion">
          Recursive Intelligence for Technology
        </p>
      </div>
      <div className="rift-launch__connection">
        <div className="rift-launch__signal" aria-hidden="true">
          <i />
        </div>
        <p className="rift-launch__status" role="status" aria-live="polite">
          {status}
        </p>
        {error && <p className="rift-launch__error">{error}</p>}
        {error && onRetry && (
          <button
            type="button"
            className="rift-launch__retry"
            onClick={onRetry}
          >
            Try again
          </button>
        )}
      </div>
    </main>
  );
}
