import type { MetadataRoute } from "next";
import { SITE } from "@/shared/config";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/data/",
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/data/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f3ef",
    theme_color: "#2f6f62",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
