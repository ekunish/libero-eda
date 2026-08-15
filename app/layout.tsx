import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-jp";
import "./globals.css";
import { AppProviders } from "@/_app/providers";
import { SITE } from "@/shared/config";
import { AppShell } from "@/widgets/app-shell";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.name,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.author, url: "https://github.com/ekunish" }],
  creator: SITE.author,
  publisher: SITE.author,
  category: "technology",
  keywords: ["LIBERO", "LIBERO-Plus", "robotics", "robot learning", "VLA", "EDA"],
  alternates: { canonical: "/data/" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/libero-eda-mark.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/data/",
    siteName: SITE.name,
    title: SITE.name,
    description: SITE.description,
    images: [
      {
        url: SITE.socialImage,
        width: 1200,
        height: 630,
        alt: "LIBERO EDA — robot demonstrations, training trajectories, and evaluation conditions",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: SITE.description,
    creator: "@ekunish",
    images: [SITE.socialImage],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#2f6f62",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
