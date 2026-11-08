import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { logout } from "@/lib/actions/auth";
import { requireSession } from "@/lib/auth";
import { PAGE_ACCESS, hasAny } from "@/lib/permissions";
import { PermissionProvider } from "@/components/role-provider";
import { SidebarShell } from "@/components/sidebar-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireSession();
  // A user with a temporary password chooses their own before anything else.
  const path = (await headers()).get("x-pathname") ?? "";
  if (me.mustChangePassword && path !== "/profile") redirect("/profile");

  const allowed = me.mustChangePassword ? [] : PAGE_ACCESS.filter((p) => hasAny(me.permissions, p.anyOf)).map((p) => p.path);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SidebarShell>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
          <Nav allowed={allowed} />
        </div>
        <div className="border-t border-white/10 p-4">
          <Link href="/profile" className="-m-1.5 flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-white/5" title="Your profile and password">
            <div aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-[#f97a1f] text-sm font-semibold uppercase text-neutral-950">
              {me.displayName.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{me.displayName}</div>
              <span className="block truncate text-xs text-neutral-400">{me.roleName}</span>
            </div>
          </Link>
          <form action={logout} className="mt-3">
            <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/5 hover:text-white">
              <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-none stroke-current" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4h3.5A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5H14M10 8l-4 4m0 0l4 4m-4-4h11" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </SidebarShell>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-9">
        <div className="mx-auto max-w-[1500px]">
          <PermissionProvider permissions={[...me.permissions]}>{children}</PermissionProvider>
        </div>
      </main>
    </div>
  );
}
