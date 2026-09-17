"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/** Local-only browser verification fixture. Never sends a model request. */
export default function BrowserFixture() {
  const page = useSearchParams().get("page") === "2" ? 2 : 1;
  const [note, setNote] = useState("");
  return (
    <main
      style={{
        padding: 32,
        fontFamily: "system-ui",
        color: "#222",
        background: "#fff",
        minHeight: "100vh",
      }}
    >
      <h1>Browser check · page {page}</h1>
      <p>Local test page for navigation and tab preservation.</p>
      <label>
        Tab note{" "}
        <input
          aria-label="Tab note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          style={{ border: "1px solid #bbb", padding: 8, margin: 12 }}
        />
      </label>
      <p>
        <a href={`/lab/browser?page=${page === 1 ? 2 : 1}`}>
          Go to page {page === 1 ? 2 : 1}
        </a>
      </p>
      <p>
        <a target="_blank" rel="noreferrer" href="/lab/browser?page=2">
          Open page 2 in a new window
        </a>
      </p>
    </main>
  );
}
