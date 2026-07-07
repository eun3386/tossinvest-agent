import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TossInvest Agent",
  description: "Codex-backed investment status agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
