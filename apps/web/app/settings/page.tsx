import type { Metadata } from "next";

import { ModelSettingsPanel } from "@/features/model-settings/model-settings-panel";

export const metadata: Metadata = {
  title: "模型配置"
};

export default function SettingsPage() {
  return <ModelSettingsPanel />;
}
