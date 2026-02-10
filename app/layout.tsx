import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers/QueryProvider";
import { SessionRecoveryProvider } from "./components/SessionRecoveryProvider";
import { BuildInfo } from "./components/BuildInfo";
import "./globals.css";
import { cn } from "@/lib/utils";

const fontSans = Inter({ 
  subsets: ["latin"], 
  variable: "--font-sans" 
});

const fontSerif = Lora({
  subsets: ["latin"],
  variable: "--font-serif",
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
    <html lang="ja" className="dark" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable,
          fontSerif.variable
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
