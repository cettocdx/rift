"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { useTheme } from "next-themes";
import { AgentActivityPanel } from "@/app/components/AgentActivityPanel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** The real controls, with no model request or subagent creation side effects. */
export default function FocusPreview() {
  const { setTheme } = useTheme();
  return (
    <main className="pro-shell min-h-dvh bg-background p-8 text-foreground">
      <RootShellPresence kind="pro" />
      <header className="mb-8 flex items-center gap-4 text-sm">
        <h1>Focus preview · no tasks run</h1>
        <button onClick={() => setTheme("light")}>Light theme</button>
        <button onClick={() => setTheme("dark")}>Dark theme</button>
      </header>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[300px_minmax(0,520px)]">
        <section className="space-y-5">
          <label className="block space-y-2">
            Shared input
            <Input placeholder="Input focus" />
          </label>
          <label className="block space-y-2">
            Shared textarea
            <Textarea placeholder="Textarea focus" />
          </label>
          <Popover>
            <PopoverTrigger className="rounded-md border px-3 py-2">
              Open popover
            </PopoverTrigger>
            <PopoverContent>
              <label>
                Popover input
                <Input placeholder="Portal focus" />
              </label>
            </PopoverContent>
          </Popover>
        </section>
        <section className="h-[650px] min-h-0 overflow-auto rounded-lg border border-border">
          <AgentActivityPanel
            todos={[]}
            toolExecutions={[]}
            status="ready"
            onCreateSubagent={() => {}}
          />
        </section>
      </div>
    </main>
  );
}
