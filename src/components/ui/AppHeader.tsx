"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ChevronLeft, Plus, Settings } from "lucide-react";
import { cn } from "@/components/ui";

/** Screens that own the whole phone: a player, a board, or a quiz. */
const PLAYER_PATH = /^\/courses\/[^/]+\/(lecture|whiteboard|quiz)(\/|$)/;
/** The plan screen carries its own bottom action bar. */
const ACTION_BAR_PATH = /^\/courses\/[^/]+\/plan(\/|$)/;

export function AppHeader() {
  const pathname = usePathname() ?? "/";
  const inPlayer = PLAYER_PATH.test(pathname);
  const links = [
    { href: "/library", label: "Library" },
    { href: "/create", label: "Create" },
  ];
  return (
    <header className="border-b border-rule">
      <div className="shell flex items-center justify-between py-2 md:py-4">
        <div className="flex items-center gap-8 md:items-baseline">
          {inPlayer ? (
            <Link
              href="/library"
              aria-label="Back to library"
              className="type-label -ml-2 flex h-11 items-center gap-1 pr-3 text-ink md:hidden"
            >
              <ChevronLeft size={22} strokeWidth={1.5} />
              Library
            </Link>
          ) : null}
          <Link
            href="/library"
            className={cn("type-h2 text-ink", inPlayer ? "hidden md:block" : "flex h-11 items-center md:h-auto")}
          >
            Kaksha
          </Link>
          <nav aria-label="Main" className="hidden gap-6 md:flex">
            {links.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "type-label border-b-2 pb-1 transition-colors",
                    active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/settings"
            aria-label="Settings"
            className={cn(
              "flex items-center gap-2 border border-rule px-3 py-2 transition-colors hover:border-ink",
              pathname.startsWith("/settings") ? "border-ink" : "",
            )}
          >
            <Settings size={16} strokeWidth={1.5} />
            <span className="type-label">Settings</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * Phone navigation lives at the thumb, not under the status bar. It steps
 * aside on the player and plan screens, which have their own controls.
 */
export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  if (PLAYER_PATH.test(pathname) || ACTION_BAR_PATH.test(pathname)) return null;
  const items = [
    { href: "/library", label: "Library", Icon: BookOpen },
    { href: "/create", label: "Create", Icon: Plus },
    { href: "/settings", label: "Settings", Icon: Settings },
  ];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-bg md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-3">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "type-label flex h-14 flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-accent" : "text-muted",
                )}
              >
                <Icon size={20} strokeWidth={active ? 2 : 1.5} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppFooter() {
  return (
    <footer className="mt-16 hidden border-t border-rule md:block">
      <div className="shell flex flex-col gap-2 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="type-body-sm text-muted">Kaksha · AI classroom</p>
        <p className="type-label text-muted">Local first · your material stays on this machine</p>
      </div>
    </footer>
  );
}
