import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["unpdf", "mammoth", "docx", "cheerio"],
};

export default nextConfig;
