import type { NextConfig } from "next";
const nextConfig:NextConfig={
 // Product photos arrive as WebP up to 1 MB plus form fields.
 experimental:{serverActions:{bodySizeLimit:"2mb"}},
 images:{remotePatterns:process.env.SUPABASE_URL?[{protocol:"https",hostname:new URL(process.env.SUPABASE_URL).hostname,pathname:"/storage/v1/object/public/product-images/**"}]:[]},
 async headers(){return [{source:"/:path*",headers:[{key:"Strict-Transport-Security",value:"max-age=31536000"},{key:"Content-Security-Policy",value:"base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Content-Type-Options",value:"nosniff"},{key:"X-Frame-Options",value:"DENY"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}]},{source:"/admin/:path*",headers:[{key:"Cache-Control",value:"private, no-store"}]},{source:"/track-order/:path*",headers:[{key:"Cache-Control",value:"private, no-store"}]},{source:"/order-confirmation/:path*",headers:[{key:"Cache-Control",value:"private, no-store"}]}];}
};
export default nextConfig;
