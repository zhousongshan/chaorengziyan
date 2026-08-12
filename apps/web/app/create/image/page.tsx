import type { Metadata } from "next";

import { ImageWorkbench } from "@/features/generation/image-workbench";

export const metadata: Metadata = {
  title: "普通模式生图"
};

export default function ImageCreationPage() {
  return <ImageWorkbench />;
}
