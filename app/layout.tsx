import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Textured — Fluxus",
  description:
    "Sounds of words. A musical toy from Fluxus, an AI product studio.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
