"use client";

import { ChevronDown, House, Images, LogOut, Settings, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const navigation = [
  { label: "首页", href: "/home", icon: House, available: false },
  { label: "智能创作", href: "/create", icon: Sparkles, available: true },
  { label: "资产库", href: "/assets", icon: Images, available: true },
  { label: "系统设置", href: "/settings", icon: Settings, available: true }
] as const;

const systemNavigation = [
  { label: "用户管理", available: false },
  { label: "角色管理", available: false },
  { label: "额度管理", available: false },
  { label: "模型配置", available: true },
  { label: "操作日志", available: false }
] as const;

export function AppShell({
  children,
  displayName
}: Readonly<{ children: ReactNode; displayName: string }>) {
  const pathname = usePathname();
  const isAgentLibrary = pathname === "/create";
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const logout = async () => {
    await fetch("/api/auth/development-session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className={cn("app-frame", isAgentLibrary && "agent-library-shell")}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <Image src="/brand/chaoren-logo.png" alt="超韧AI" width={52} height={52} priority />
          <strong>超韧AI</strong>
        </div>

        <nav aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.available && pathname.startsWith(item.href);
            if (!item.available) {
              return (
                <button
                  className="sidebar-link"
                  key={item.href}
                  type="button"
                  disabled
                  aria-label={item.label}
                  title="后续阶段开放"
                >
                  <Icon />
                  <span>{item.label}</span>
                  <small>后续</small>
                </button>
              );
            }
            if (item.label === "系统设置") {
              return (
                <div className="sidebar-nav-group" key={item.href}>
                  <Link
                    className={cn("sidebar-link", active && "is-active")}
                    href={item.href}
                    aria-label={item.label}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    <ChevronDown className="sidebar-link-caret is-expanded" />
                  </Link>
                  <div className="sidebar-subnav">
                    {systemNavigation.map((subItem) =>
                      subItem.available ? (
                        <Link href="/settings" key={subItem.label}>
                          {subItem.label}
                        </Link>
                      ) : (
                        <button key={subItem.label} type="button" disabled title="后续阶段开放">
                          {subItem.label}
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            }
            return (
              <Link
                className={cn("sidebar-link", active && "is-active")}
                href={item.href}
                key={item.href}
                aria-label={item.label}
              >
                <Icon />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-promo-card">
          <Image
            src="/illustrations/sidebar-promo.png"
            alt="超韧AI，让电商内容创作更智能"
            width={220}
            height={186}
            loading="eager"
          />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="user-menu">
            <button
              type="button"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span>{displayName.slice(0, 1).toUpperCase()}</span>
              <strong>{displayName}</strong>
              <ChevronDown />
            </button>
            {userMenuOpen && (
              <div className="user-menu-popover">
                <p>开发环境账号</p>
                <strong>{displayName}</strong>
                <button type="button" onClick={logout}>
                  <LogOut />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
