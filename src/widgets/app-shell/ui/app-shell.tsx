"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CircleDot,
  Code2,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  Info,
  LibraryBig,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GlobalSearch } from "@/features/global-search";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "@/shared/ui/primitives";

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

const aboutLinks = [
  { href: "/privacy/", label: "Privacy notice", icon: ShieldCheck, external: false },
  { href: "/terms/", label: "Terms of use", icon: Scale, external: false },
  { href: "/sources/", label: "Data sources", icon: FileText, external: false },
  {
    href: "https://github.com/ekunish/libero-eda",
    label: "Source code",
    icon: Code2,
    external: true,
  },
  {
    href: "https://github.com/ekunish/libero-eda/blob/main/LICENSE",
    label: "Apache-2.0 license",
    icon: ExternalLink,
    external: true,
  },
] as const;

function AboutMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton size="xs" variant="ghost" aria-label="About LIBERO EDA">
          <Info size={16} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[70] w-56 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-2">
            <span className="block text-sm font-semibold">LIBERO EDA</span>
            <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-base-content/55">
              <span className="status status-success status-xs" />
              Hosted data available
            </span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-base-300" />
          {aboutLinks.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenu.Item key={item.href} asChild>
                <Link
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noreferrer" : undefined}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-field px-3 text-sm text-base-content/70 outline-none hover:bg-base-200 focus:bg-base-200 focus:text-base-content"
                >
                  <Icon size={15} className="text-base-content/45" />
                  {item.label}
                </Link>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
          className="mx-auto grid size-10 place-items-center overflow-hidden rounded-field"
        >
          <Image src="/brand/libero-eda-mark.svg" alt="" width={40} height={40} priority />
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
            <Image
              src="/brand/libero-eda-mark.svg"
              alt=""
              width={28}
              height={28}
              className="rounded-sm"
              priority
            />
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
            <AboutMenu />
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
