import type { Metadata } from "next";

export const SITE = {
  name: "LIBERO EDA",
  description:
    "Explore Original LIBERO demonstrations and LIBERO-Plus training trajectories and evaluation conditions.",
  url: "https://libero-eda.vercel.app",
  author: "ekunish",
  github: "https://github.com/ekunish/libero-eda",
  socialImage: "/brand/social-card.png",
} as const;

export function createPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: `/${string}/`;
}): Metadata {
  const socialTitle = `${title} · ${SITE.name}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: path,
      siteName: SITE.name,
      title: socialTitle,
      description,
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
      title: socialTitle,
      description,
      creator: "@ekunish",
      images: [SITE.socialImage],
    },
  };
}
