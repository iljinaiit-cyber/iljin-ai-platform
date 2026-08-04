import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const description = "개인과 부서의 업무를 연결하는 Enterprise AI Agent Portal";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: {
      default: "ILJIN AI Works",
      template: "%s | ILJIN AI Works",
    },
    description,
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/brand-symbol.png", type: "image/png" },
      ],
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "ILJIN AI Works",
      description,
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "ILJIN AI Works" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "ILJIN AI Works",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
