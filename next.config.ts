import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` does an optional require of pg-native that Turbopack rewrites into a
  // hashed external ("pg-<hash>") which Node then cannot resolve at runtime.
  // Keeping it external makes the server require the real package instead.
  serverExternalPackages: ["pg", "@napi-rs/canvas", "sharp"],
  reactStrictMode: true,
};

export default nextConfig;
