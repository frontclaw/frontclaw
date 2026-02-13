"use client";

import { $sidebarAtom } from "@/store";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useAtom } from "jotai";
import { PanelRight, Settings, Sparkle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Chat", icon: Sparkle },
  { href: "/settings", label: "Settings", icon: Settings },
];

const Logo = () => {
  return (
    <Link href={"/"}>
      <div className="flex items-center gap-2">
        <Image
          src={"/logo.png"}
          width={28}
          height={28}
          alt="Logo"
          className="size-7"
        />
        <p className="text-sm font-semibold">frontpanel</p>
      </div>
    </Link>
  );
};

export function TopNav() {
  const [sidebarAtom, setSidebarAtom] = useAtom($sidebarAtom);
  const pathname = usePathname();

  const toggleSidebar = () => {
    setSidebarAtom({ open: !sidebarAtom.open });
  };

  return (
    <header className="fixed top-0 left-0 w-full z-50 flex h-16 items-center justify-between px-2 md:px-2">
      <div
        className={cn(
          "flex items-center justify-between gap-x-2 lg:w-[220px]",
          !sidebarAtom.open && "lg:w-[150px]",
        )}
      >
        <Logo />
        <Button onClick={toggleSidebar} variant={"outline"} size={"icon"}>
          <PanelRight size={16} className="rotate-180" />
        </Button>
      </div>

      <nav className="flex items-center gap-1 rounded-xl border border-[var(--frontui-line)] bg-[var(--frontui-surface)] p-1">
        {navItems.map((item) => {
          const active =
            (item.href === "/" &&
              (pathname === "/" || pathname.startsWith("/c/"))) ||
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-[var(--frontui-accent)] text-[var(--primary-foreground)]"
                  : "text-[var(--frontui-muted)] hover:bg-[var(--frontui-surface-2)] hover:text-[var(--frontui-ink)]"
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
