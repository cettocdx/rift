import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SettingsNotFound() {
  return (
    <div className="py-6">
      <h1 className="text-[18px] font-semibold leading-6 tracking-[-0.01em]">
        No such settings section
      </h1>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
        That address does not match a settings section. Older links are
        redirected automatically, so this one was probably mistyped.
      </p>
      <Button asChild size="sm" className="mt-5 h-8 rounded-md text-[13px]">
        <Link href="/settings">Back to settings</Link>
      </Button>
    </div>
  );
}
