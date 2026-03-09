import type { Metadata } from "next";
import { Sora, Cormorant_Garamond, Noto_Sans_JP } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers/QueryProvider";
import { SessionRecoveryProvider } from "./components/SessionRecoveryProvider";
import { BuildInfo } from "./components/BuildInfo";
import "./globals.css";
import { cn } from "@/lib/utils";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["200", "300", "400", "500", "600"],
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-jp",
  weight: ["200", "300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Video Handoff - Transform Video into Structured Data",
  description: "AI-powered video transcription and OCR tool using Whisper and Gemini Vision.",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          sora.variable,
          cormorantGaramond.variable,
          notoSansJP.variable
        )}
      >
        <ClerkProvider>
          <SessionRecoveryProvider>
            <Providers>
              <BuildInfo />
              {children}
            </Providers>
          </SessionRecoveryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
