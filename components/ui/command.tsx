"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  children,
  ...props
}: React.ComponentProps<typeof Dialog>) {
  return (
    <Dialog {...props}>
      {/* The palette opens from a keyboard shortcut, dozens of times a day.
          At that frequency any open/close transition is a tax paid on every
          invocation — you are waiting on the interface instead of typing. It
          appears instantly, which is also what Raycast does and why it feels
          fast. The dialog's shared fade/zoom is cancelled here rather than in
          DialogContent, because modals that open occasionally should keep it. */}
      <DialogContent
        overlayClassName="bg-black/18 backdrop-blur-none duration-0 data-[state=closed]:animate-none data-[state=open]:animate-none dark:bg-black/30"
        className="flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden p-0 [&_[data-slot=dialog-close]]:right-0 [&_[data-slot=dialog-close]]:top-0 [&_[data-slot=dialog-close]]:size-11 sm:[&_[data-slot=dialog-close]]:right-2 sm:[&_[data-slot=dialog-close]]:top-2 sm:[&_[data-slot=dialog-close]]:size-6 duration-0 data-[state=closed]:animate-none data-[state=open]:animate-none sm:max-w-[520px]"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search available actions, navigation, and recent chats.
        </DialogDescription>
        <Command className="min-h-0 [&_[cmdk-input-wrapper]]:shrink-0 [&_[cmdk-input-wrapper]]:pr-12 [&_[cmdk-input]]:min-h-11 sm:[&_[cmdk-input]]:min-h-9 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-1.5 [&_[cmdk-input-wrapper]_svg]:size-3.5 [&_[cmdk-input]]:h-9 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-1.5 [&_[cmdk-item]_svg]:size-3.5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center border-b px-2.5" cmdk-input-wrapper="">
      <Search className="mr-2 size-3.5 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        className={cn(
          "flex h-9 w-full rounded-md bg-transparent py-2 text-ui outline-none placeholder:text-[var(--cursor-text-tertiary)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        "min-h-0 max-h-[min(380px,60dvh)] overscroll-contain overflow-y-auto overflow-x-hidden",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>,
) {
  return (
    <CommandPrimitive.Empty
      className="py-6 text-center text-xs text-muted-foreground"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-ui-label [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex min-h-7 cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-ui outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto font-mono text-ui-caption tracking-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
