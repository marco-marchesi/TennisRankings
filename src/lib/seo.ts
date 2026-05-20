import type { Metadata } from "next";
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "./constants";

interface PageMetaInput {
  title: string;
  description?: string;
  path: string;
  locale?: string;
  ogImagePath?: string;
  noindex?: boolean;
  lastUpdated?: Date;
  alternates?: Record<string, string>;
}

export function buildMetadata(input: PageMetaInput): Metadata {
  const fullTitle = `${input.title} — ${SITE_NAME}`;
  const url = `${SITE_URL}${input.path}`;
  const ogImage = input.ogImagePath
    ? `${SITE_URL}${input.ogImagePath}`
    : `${SITE_URL}/og-default.png`;

  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description: input.description ?? SITE_DESCRIPTION,
    alternates: {
      canonical: url,
      languages: input.alternates,
    },
    openGraph: {
      title: fullTitle,
      description: input.description ?? SITE_DESCRIPTION,
      url,
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1200, height: 630, alt: input.title }],
      locale: input.locale ?? "en_GB",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.description ?? SITE_DESCRIPTION,
      images: [ogImage],
    },
    robots: input.noindex
      ? { index: false, follow: true }
      : { index: true, follow: true, "max-image-preview": "large" },
    other: input.lastUpdated
      ? { "article:modified_time": input.lastUpdated.toISOString() }
      : undefined,
  };
}
