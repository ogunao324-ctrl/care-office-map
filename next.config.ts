import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * セキュリティヘッダー（つむぐと同じ方針）
 *
 * 使っている外部ホストだけを許可している。
 * **新しく外部ホスト（地図タイルなど）を足すときは、ここにも追記すること**
 * ―― でないと本番でだけ黙って読み込みがブロックされる。
 *
 * 今使っている外部ホスト:
 * - 地図タイル: cyberjapandata.gsi.go.jp（国土地理院の淡色地図・標準地図）
 *   src/components/OfficeMap.tsx が <img> で直接読む
 * - 事業所データは public/data/offices.json（同じオリジン）なので追記不要
 * - Googleマップ・電話は「リンクで開く」だけなので CSP の対象外
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 位置情報・カメラ・マイクは使わない
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // 事業所データは更新のたびに中身が変わるので、古いものを長く持たせない
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
