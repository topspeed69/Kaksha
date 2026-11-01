"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@/components/ui";

export function AppHeader() {
  const pathname = usePathname() ?? "/";
  const links = [
    { href: "/library", label: "Library" },
    { href: "/create", label: "Create" },
  ];
  return (
    <header className="border-b border-rule">
      <div className="shell flex items-center justify-between py-4">
        <div className="flex items-baseline gap-8">
          <Link href="/library" className="type-h2 text-ink">
            Lumen
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
        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            aria-label="Settings"
            className={cn(
              "flex items-center gap-2 border border-rule px-3 py-2 transition-colors hover:border-ink",
              pathname.startsWith("/settings") ? "border-ink" : "",
            )}
          >
            <Settings size={16} strokeWidth={1.5} />
            <span className="type-label hidden sm:inline">Settings</span>
          </Link>
        </div>
      </div>
      <nav aria-label="Main" className="shell flex gap-6 border-t border-rule py-2 md:hidden">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="type-label text-muted">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="shell flex flex-col gap-2 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="type-body-sm text-muted">Lumen · AI classroom</p>
        <p className="type-label text-muted">Local first · your material stays on this machine</p>
      </div>
    </footer>
  );
}
