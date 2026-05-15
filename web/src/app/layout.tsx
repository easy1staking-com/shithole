import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Footer } from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "S#!thole",
  description: "Give your dead NFTs a second life. Sort of.",
  // Mobile browser chrome (address bar, splash) picks up theme-color.
  // Matches our dark zinc-950 background so mobile dApp browsers don't
  // flash a white system bar against our dark UI.
  themeColor: "#09090b",
  twitter: {
    card: "summary_large_image",
    site: "@Shithole_App",
    creator: "@Shithole_App",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-zinc-950 antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <Providers>
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
