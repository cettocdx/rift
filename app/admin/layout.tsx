"use client";

import { useState, type ReactNode, type SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  cn,
  Grid,
  Users,
  Chat,
  Pulse,
  Shield,
  Coin,
  Gear,
  Sidebar as SidebarIcon,
} from "./_lib";

type NavItem = {
  label: string;
  href?: string;
  icon: (p: SVGProps<SVGSVGElement>) => ReactNode;
  soon?: boolean;
};
type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", icon: Grid },
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Conversations", href: "/admin/conversations", icon: Chat },
    ],
  },
  {
    title: "Activity",
    items: [
      { label: "Sessions", icon: Pulse, soon: true },
      { label: "Audit Logs", icon: Shield, soon: true },
    ],
  },
  {
    title: "Billing",
    items: [{ label: "Revenue", icon: Coin, soon: true }],
  },
  {
    title: "System",
    items: [{ label: "Settings", icon: Gear, soon: true }],
  },
];

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const inner = (
    <span
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors",
        active
          ? "bg-neutral-800/70 text-neutral-100"
          : item.soon
            ? "text-neutral-600"
            : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-emerald-400"
        />
      )}
      <Icon aria-hidden="true" className="h-[17px] w-[17px]" />
      <span className="flex-1">{item.label}</span>
      {item.soon && (
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neutral-500">
          soon
        </span>
      )}
    </span>
  );
  if (item.href && !item.soon)
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className="block rounded-lg focus-visible:outline-none"
      >
        {inner}
      </Link>
    );
  return <span aria-disabled="true">{inner}</span>;
}

function AdminNavigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/25">
          <SidebarIcon aria-hidden="true" className="h-4 w-4" />
        </div>
        <div className="flex flex-1 items-center gap-2">
          <span className="text-[13.5px] font-semibold text-neutral-100">
            RIFT Admin
          </span>
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
            Dev
          </span>
        </div>
      </div>

      <nav
        aria-label="Admin navigation"
        className="flex-1 space-y-5 overflow-y-auto"
      >
        {NAV.map((group) => (
          <div key={group.title}>
            <div className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-600">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavRow
                  key={item.label}
                  item={item}
                  onNavigate={onNavigate}
                  active={
                    !!item.href &&
                    (item.href === "/admin"
                      ? pathname === "/admin"
                      : pathname.startsWith(item.href))
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4 flex items-center gap-2.5 border-t border-neutral-800/80 px-2 pt-3">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-neutral-800 text-[11px] font-semibold text-neutral-300">
          A
        </div>
        <div className="flex-1 leading-tight">
          <div className="text-[12px] font-medium text-neutral-200">
            Administrator
          </div>
          <div className="text-[10.5px] text-neutral-500">Owner access</div>
        </div>
        <Gear aria-hidden="true" className="h-4 w-4 text-neutral-600" />
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdmin = useQuery(api.admin.isAdmin);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  if (isAdmin === undefined)
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-neutral-950 text-neutral-500">
        <div role="status" className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none"
          />
          Loading admin…
        </div>
      </div>
    );

  if (!isAdmin)
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-neutral-950 px-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-rose-500/10 text-rose-400 ring-1 ring-inset ring-rose-500/20">
            <Shield aria-hidden="true" className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-neutral-100">
            Access denied
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            This area is restricted to RIFT administrators. Sign in with an
            authorized account to continue.
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-neutral-950 text-neutral-200 md:flex-row">
      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-neutral-800/80 bg-neutral-950 px-3 md:hidden">
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open admin navigation"
              className="grid size-8 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none"
            >
              <SidebarIcon aria-hidden="true" className="size-4" />
            </button>
          </SheetTrigger>
          <span className="truncate text-[13px] font-medium text-neutral-100">
            {NAV.flatMap((group) => group.items).find((item) =>
              item.href === "/admin"
                ? pathname === "/admin"
                : item.href && pathname.startsWith(item.href),
            )?.label ?? "RIFT Admin"}
          </span>
        </header>
        <SheetContent
          side="left"
          className="w-[min(18rem,calc(100vw-2rem))] gap-0 border-neutral-800 bg-neutral-950 p-0 text-neutral-200 sm:max-w-72 motion-reduce:duration-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Admin navigation</SheetTitle>
            <SheetDescription>
              Navigate between RIFT administration pages.
            </SheetDescription>
          </SheetHeader>
          <AdminNavigation
            pathname={pathname}
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <aside className="sticky top-0 hidden h-[100dvh] w-[248px] shrink-0 border-r border-neutral-800/80 bg-neutral-950 md:block">
        <AdminNavigation pathname={pathname} />
      </aside>

      {/* main */}
      <main className="min-h-0 min-w-0 flex-1">{children}</main>
    </div>
  );
}
