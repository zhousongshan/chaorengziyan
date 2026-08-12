import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppProviders } from "@/app/providers";

import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "超韧AI",
    template: "%s · 超韧AI"
  },
  description: "AI生成主图、详情图和营销素材的一站式电商创作平台"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
