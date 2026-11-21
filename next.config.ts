import type { NextConfig } from "next";
const nextConfig:NextConfig={
  devIndicators:false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ] }];
  },
  serverExternalPackages:["postgres","@supabase/supabase-js","@huggingface/transformers","onnxruntime-node","@electric-sql/pglite","unpdf","mammoth","docx","cheerio"],
  outputFileTracingIncludes:{"/*":["./supabase/schema.sql","./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/*"]},
  outputFileTracingExcludes:{"/*":[
    "./data/**/*","./.cache/**/*","./.verification/**/*","./.env*","./.git/**/*",
    "./node_modules/@electric-sql/**/*",
    "./node_modules/onnxruntime-node/bin/napi-v6/win32/**/*",
    "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**/*",
    "./node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**/*",
    "./node_modules/onnxruntime-node/bin/**/*cuda*","./node_modules/onnxruntime-node/bin/**/*tensorrt*",
    "./node_modules/onnxruntime-web/dist/*.wasm",
  ]},
};
export default nextConfig;
