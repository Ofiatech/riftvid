import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Raise the request body limit so Rift Assistant can receive iPhone photos.
  //
  // Why this exists:
  //   Rift Assistant accepts a base64-encoded image so GPT-4o can "see" the
  //   scene. iPhone photos are commonly 5–12 MB, and base64 inflates them by
  //   ~33%. Next.js's proxy buffer defaults to 10 MB, so the JSON body was
  //   being silently truncated mid-string at exactly 10,485,760 bytes,
  //   causing JSON.parse to throw "Unterminated string at position 10485760"
  //   and Rift to return 500. 25 MB gives comfortable headroom for any
  //   iPhone photo while staying memory-safe.
  experimental: {
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;