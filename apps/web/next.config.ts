import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@chaoren/contracts"]
};

export default nextConfig;
