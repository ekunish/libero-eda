import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-jp";
import "./globals.css";
import { AppProviders } from "@/_app/providers";
import { AppShell } from "@/widgets/app-shell";

export const metadata: Metadata = {
  title: {
    default: "LIBERO EDA",
    template: "%s · LIBERO EDA",
  },
  description:
    "Explore Original LIBERO demonstrations and LIBERO-Plus training and evaluation data",
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
