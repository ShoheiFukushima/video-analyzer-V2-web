import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers/QueryProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Analyzer V2 - AI-Powered Video Transcription & OCR",
  description: "Upload videos and get AI-powered transcription (Whisper) and OCR (Gemini Vision) in Excel format",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <ClerkProvider>
          <Providers>
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
