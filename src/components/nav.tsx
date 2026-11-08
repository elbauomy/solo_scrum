"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "./ui";

type NavItem = { href: string; label: string; icon: keyof typeof ICONS; also?: string[] };

/** Small line icons (24x24, drawn with basic shapes so they stay crisp and match the brand's sharp look). */
const ICONS = {
  dashboard: (<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>),
  squads: (<><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8s5 1.8 5.5 4.8" /><circle cx="17" cy="9.5" r="2.3" /><path d="M16.5 14.4c2.3.1 3.7 1.6 4 4" /></>),
  lobs: (<><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M8.5 7.5v-1.5a2 2 0 012-2h3a2 2 0 012 2v1.5M3.5 13h17" /></>),
  members: (<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.6-3.7 3.4-6 7-6s6.4 2.3 7 6" /></>),
  backlog: (<><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.8" cy="6.5" r="1" /><circle cx="4.8" cy="12" r="1" /><circle cx="4.8" cy="17.5" r="1" /></>),
  sprints: (<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  board: (<><rect x="3.5" y="4" width="5" height="16" rx="1.3" /><rect x="9.5" y="4" width="5" height="11" rx="1.3" /><rect x="15.5" y="4" width="5" height="7" rx="1.3" /></>),
  releases: (<><path d="M12 3.5c3.5 1.5 5.5 4.6 5.5 8.5l-2 2.5h-7L6.5 12c0-3.9 2-7 5.5-8.5z" /><circle cx="12" cy="10" r="1.6" /><path d="M9.5 17.5L8 21M14.5 17.5L16 21" /></>),
  timeline: (<><path d="M3.5 6.5h9M7.5 12h11M5.5 17.5h8" /><circle cx="15.5" cy="6.5" r="1.2" /><circle cx="3.5" cy="12" r="0.01" /></>),
  standup: (<path d="M4 6.5a2.5 2.5 0 012.5-2.5h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 014 13.5v-7z" />),
  reports: (<><path d="M4 20h16" /><rect x="5.5" y="11" width="3.5" height="7" rx="1" /><rect x="10.5" y="6" width="3.5" height="12" rx="1" /><rect x="15.5" y="9" width="3.5" height="9" rx="1" /></>),
  settings: (<><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></>),
  data: (<><path d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5" /><path d="M4.5 15.5v2A2.5 2.5 0 007 20h10a2.5 2.5 0 002.5-2.5v-2" /></>),
  users: (<><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8 1.3 0 2.5.4 3.4 1.1" /><circle cx="17.5" cy="16.5" r="3" /><path d="M17.5 15v1.5l1 .8" /></>),
  roles: (<><path d="M12 3.5l7 3v5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9v-5l7-3z" /><path d="M9 12l2 2 4-4" /></>),
} satisfies Record<string, ReactNode>;

const sections: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/", label: "Dashboard", icon: "dashboard" }] },
  {
    title: "Organization",
    items: [
      { href: "/squads", label: "Squads", icon: "squads" },
      { href: "/lobs", label: "Lines of Business", icon: "lobs" },
      { href: "/members", label: "Members", icon: "members" },
    ],
  },
  {
    title: "Delivery",
    items: [
      { href: "/backlog", label: "Backlog", icon: "backlog", also: ["/items"] },
      { href: "/sprints", label: "Sprints", icon: "sprints" },
      { href: "/board", label: "Sprint Board", icon: "board" },
      { href: "/releases", label: "Releases", icon: "releases" },
      { href: "/timeline", label: "Timeline", icon: "timeline" },
      { href: "/standup", label: "Daily Standup", icon: "standup" },
      { href: "/reports", label: "Reports", icon: "reports" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/data", label: "Import & Backup", icon: "data" },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/users", label: "Users", icon: "users" },
      { href: "/roles", label: "Roles & Permissions", icon: "roles" },
    ],
  },
];

/** The menu. `allowed` lists the pages this user's role may open; the others are not shown. */
export function Nav({ allowed }: { allowed: string[] }) {
  const pathname = usePathname();
  const visible = sections
    .map((section) => ({ ...section, items: section.items.filter((i) => allowed.includes(i.href)) }))
    .filter((section) => section.items.length > 0);
  return (
    <nav aria-label="Main" className="space-y-6">
      {visible.map((section) => (
        <div key={section.title}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{section.title}</div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : [item.href, ...(item.also ?? [])].some((p) => pathname.startsWith(p));
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                      active ? "bg-orange-500/15 font-medium text-orange-300" : "text-neutral-300 hover:bg-white/[0.06] hover:text-white",
                    )}
                  >
                    {active && <span aria-hidden className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-orange-500" />}
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden
                      className={cn("h-[18px] w-[18px] shrink-0 fill-none stroke-current", active ? "text-orange-400" : "text-neutral-500 group-hover:text-neutral-300")}
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {ICONS[item.icon]}
                    </svg>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
