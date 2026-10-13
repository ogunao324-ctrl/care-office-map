import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "花見川 事業所マップ",
  description: "自社（千葉市花見川区浪花町）の周辺にある居宅介護支援・訪問介護・訪問看護・障害福祉の事業所を、地図と距離順の一覧で探す",
  appleWebApp: {
    capable: true,
    // つむぐと同じ理由で "default"（iOS 26 以降のガラス表示がヘッダーに滲むのを避ける）
    statusBarStyle: "default",
    title: "事業所マップ",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
