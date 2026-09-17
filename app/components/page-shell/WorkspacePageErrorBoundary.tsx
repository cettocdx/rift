"use client";
import { Component, type ReactNode } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CodexPageShell,
  CodexPageHeader,
  CodexEmptyState,
} from "./CodexPageShell";

/** A page query must never take the sidebar and the rest of the app with it. */
export class WorkspacePageErrorBoundary extends Component<
  { children: ReactNode; resource: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const title =
      this.props.resource.charAt(0).toUpperCase() +
      this.props.resource.slice(1);
    return (
      <CodexPageShell>
        <CodexPageHeader
          title={title}
          description="This view is temporarily unavailable."
        />
        <div role="alert">
          <CodexEmptyState
            icon={<CircleAlert className="size-4" />}
            title={`Couldn’t load ${this.props.resource}`}
            description="Your work is saved. Try again, or continue in another workspace."
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => this.setState({ failed: false })}
                >
                  Try again
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link href="/">Open workspace</Link>
                </Button>
              </div>
            }
          />
        </div>
      </CodexPageShell>
    );
  }
}
