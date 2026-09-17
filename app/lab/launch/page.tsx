"use client";

import { useState } from "react";
import Link from "next/link";
import { AppLaunchScreen } from "@/components/launch/AppLaunchScreen";

/** Review the actual boot design without slowing down a real app launch. */
export default function LaunchPreview() {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  return (
    <>
      <AppLaunchScreen
        key={revision}
        status={error ? "RIFT couldn't connect" : "Opening RIFT"}
        error={error ? "Check your connection and try again." : undefined}
        onRetry={() => setError(false)}
      />
      <nav
        aria-label="Launch preview controls"
        style={{
          position: "fixed",
          top: 20,
          right: 24,
          zIndex: 101,
          display: "flex",
          gap: 18,
          color: "#a0a4a8",
          fontSize: 12,
        }}
      >
        <button onClick={() => setRevision((value) => value + 1)}>
          Replay
        </button>
        <button onClick={() => setError((value) => !value)}>
          {error ? "Loading state" : "Connection issue"}
        </button>
        <Link href="/">Back to app</Link>
      </nav>
    </>
  );
}
