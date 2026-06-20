import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lonely — Take picture, write code and design product.",
  description:
    "Lonely の Profile！",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Lonely — Take picture, write code and design product.",
    description: "泥嚎。",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={inter.variable}>
      <head>
        {/* Fontshare: Cabinet Grotesk / Boska / Satoshi 变量字体 */}
        <link
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,700,800,900&f[]=boska@400,700,900&f[]=satoshi@400,500,700,900&display=swap"
          rel="stylesheet"
        />
        {/* PWA */}
        <meta name="theme-color" content="#101010" />
        <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
      </head>
      <body className="bg-ink text-white font-inter antialiased">
        {children}
      </body>
    </html>
  );
}
