import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteUrl } from "@/lib/site-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "EntertainmentAI - Every story universe, intelligently curated";
const description =
  "Personalized recommendations and natural-language discovery across movies, anime, K-dramas, TV series, and documentaries.";
const metadataOrigin = getSiteUrl();

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL(metadataOrigin),
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    url: metadataOrigin,
    title,
    description,
    siteName: "EntertainmentAI",
    images: [
      {
        url: `${metadataOrigin}/og.png`,
        width: 1200,
        height: 630,
        alt: "EntertainmentAI universal entertainment curator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [`${metadataOrigin}/og.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
