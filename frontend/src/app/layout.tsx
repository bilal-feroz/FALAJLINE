// Root layout: the three typefaces (Geist, Geist Mono, Instrument Serif), page metadata and the theme colour.
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "FALAJLINE · Early warning for the aflaj of Al Ain",
  description:
    "A digital twin of an Al Ain Oasis falaj: live Meteomatics weather, real Sentinel-2 vegetation, a deterministic 21-day water model and warnings that say what to do before the farms run short.",
};

export const viewport: Viewport = {
  themeColor: "#0b0a08",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrument.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
