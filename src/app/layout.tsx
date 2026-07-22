import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { brandConfig } from "@/lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: brandConfig.name,
    template: brandConfig.titleTemplate,
  },
  description: brandConfig.description.en,
  applicationName: brandConfig.name,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: brandConfig.shortName,
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: brandConfig.name,
    description: brandConfig.description.en,
    type: "website",
  },
  twitter: { card: "summary", title: brandConfig.name, description: brandConfig.description.en },
};

export const viewport: import("next").Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#101214" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Runs before React hydration to avoid a flash of incorrect theme/language.
// Theme → `dark` class; language → `lang` attribute (read back by useLang).
const themeBootstrap = `(function(){try{var s=localStorage.getItem("theme");var d=s==="dark"||(s==null&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");var l=localStorage.getItem("lang");document.documentElement.lang=l==="en"?"en":"cs";}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="cs"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
