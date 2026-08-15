"use client";

import { CircleDot, Database, FlaskConical, LibraryBig } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GlobalSearch } from "@/features/global-search";
import { cn } from "@/shared/lib/utils";

const dataTabs = [
  { href: "/data", label: "Recorded Data" },
  { href: "/evaluation", label: "Evaluation" },
  { href: "/sources", label: "Sources" },
];

const mobileNavigation = [
  { href: "/data", label: "Data", icon: LibraryBig },
  { href: "/evaluation", label: "Evaluation", icon: FlaskConical },
  { href: "/sources", label: "Sources", icon: Database },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function HealthIndicator() {
  const label = "Hosted data";
  return (
    <div
      role="status"
      className="flex h-8 items-center gap-2 rounded-field px-2 text-xs text-base-content/65"
      title={label}
      aria-label={`System status: ${label}`}
    >
      <span className="status status-success status-xs" />
      <span className="hidden 2xl:inline">{label}</span>
    </div>
  );
}

function WorkspaceRailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Database;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-field px-1 text-[11px] font-medium text-base-content/55 transition-colors",
        "hover:bg-base-200 hover:text-base-content",
        active && "bg-primary/10 text-primary",
      )}
    >
      {active ? <span className="absolute inset-y-2 left-0 w-0.5 bg-primary" /> : null}
      <Icon size={18} strokeWidth={1.8} />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inDataWorkspace = dataTabs.some((item) => isActive(pathname, item.href));
  const tabs = inDataWorkspace ? dataTabs : [];
  const contextLabel = pathname.startsWith("/replay") ? "Replay Editor" : null;

  return (
    <div className="min-h-screen bg-base-200">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] border-r border-base-300 bg-base-100 px-2 py-3 lg:flex lg:flex-col">
        <Link
          href="/data"
          aria-label="LIBERO EDA home"
          className="mono mx-auto grid size-10 place-items-center rounded-field border border-base-content/25 text-xs font-bold"
        >
          LE
        </Link>
        <nav className="mt-5 flex flex-col gap-1" aria-label="Workspaces">
          <WorkspaceRailLink
            href="/data"
            label="Explore"
            icon={Database}
            active={inDataWorkspace}
          />
        </nav>
        <div className="mt-auto grid gap-1 border-t border-base-300 pt-3">
          <div
            className="flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] text-base-content/50"
            title="Metadata and media are loaded from pinned public sources"
          >
            <CircleDot size={14} className="text-success" />
            Public
          </div>
        </div>
      </aside>

      <div className="lg:pl-[72px]">
        <header className="sticky top-0 z-30 flex h-12 items-center border-b border-base-300 bg-base-100 px-3">
          <Link href="/data" className="mr-3 flex items-center gap-2 lg:hidden">
            <span className="mono grid size-7 place-items-center rounded-sm border border-base-content/25 text-xs font-bold">
              LE
            </span>
            <span className="hidden text-sm font-semibold sm:inline">LIBERO EDA</span>
          </Link>

          {tabs.length ? (
            <nav className="flex h-full min-w-0 items-center" aria-label="Workspace views">
              {tabs.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-full items-center px-3 text-xs font-semibold text-base-content/55 transition-colors sm:px-4 sm:text-sm",
                      "hover:text-base-content",
                      active && "text-base-content",
                    )}
                  >
                    {item.label}
                    {active ? (
                      <span className="absolute inset-x-3 bottom-0 h-0.5 bg-primary" />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          ) : contextLabel ? (
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-base-content/45">Workspace</span>
              <span aria-hidden className="text-base-content/30">
                /
              </span>
              <span className="font-semibold">{contextLabel}</span>
            </div>
          ) : null}

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <GlobalSearch />
            <HealthIndicator />
          </div>
        </header>
        <main className="app-main w-full p-3 pb-20 lg:pb-3">{children}</main>
      </div>

      <nav
        className="fixed inset-x-2 bottom-2 z-50 flex min-h-14 rounded-box border border-base-300 bg-base-100 p-1 shadow-sm lg:hidden"
        aria-label="Mobile navigation"
      >
        {mobileNavigation.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-field px-1 py-1 text-base-content/55",
                active && "bg-primary/10 text-primary",
              )}
            >
              <Icon size={17} />
              <span className="text-[11px] leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
