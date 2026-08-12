import type { Metadata } from "next";

import { AssetLibrary } from "@/features/assets/asset-library";

export const metadata: Metadata = {
  title: "资产库"
};

export default function AssetsPage() {
  return <AssetLibrary />;
}
