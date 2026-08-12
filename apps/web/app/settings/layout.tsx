import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { DEVELOPMENT_SESSION_COOKIE } from "@/lib/auth/development-session";

export default async function SettingsLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  const session = cookieStore.get(DEVELOPMENT_SESSION_COOKIE)?.value;
  if (!session) redirect("/login");

  return <AppShell displayName={decodeURIComponent(session)}>{children}</AppShell>;
}
