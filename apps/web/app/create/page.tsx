import type { Metadata } from "next";

import { AgentLibrary } from "@/features/agents/agent-library";

export const metadata: Metadata = {
  title: "智能创作"
};

export default function CreationPage() {
  return <AgentLibrary />;
}
