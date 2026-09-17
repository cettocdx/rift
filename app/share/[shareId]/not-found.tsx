import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function SharedChatNotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-12 text-foreground">
      <section
        aria-labelledby="shared-chat-not-found-title"
        className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card/40 p-6 text-center"
      >
        <AlertCircle
          aria-hidden="true"
          className="h-10 w-10 text-muted-foreground"
        />
        <div>
          <h1
            id="shared-chat-not-found-title"
            className="text-xl font-semibold"
          >
            Invalid share link
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This link is malformed or unavailable. Ask the sender for a new link
            or return to RIFT.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none"
          >
            Open RIFT
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
