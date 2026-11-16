import type { Metadata } from "next";
import { SITE_URL } from "./site";

export interface PublicMetadataOptions {
  title: string;
  description: string;
  path: string; // e.g. "/en" or "/en/validation"
}

/**
 * Creates canonical, hreflang, OpenGraph, and Twitter metadata for public pages.
 * Enforces:
 * - Absolute canonical URL = SITE_URL + path
 * - Hreflang with only 'en' and 'x-default'
 * - OpenGraph og:title, og:description, og:url, og:type=website, og:site_name=ChemDFT, og:locale=en_US
 * - Twitter twitter:card=summary_large_image
 * - Exactly matching title and description
 */
export function createPublicMetadata({
  title,
  description,
  path,
}: PublicMetadataOptions): Metadata {
  const canonicalUrl = `${SITE_URL}${path}`;

  return {
    title: {
      absolute: title,
    },
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: {
        en: canonicalUrl,
        "x-default": canonicalUrl,
      },
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: "website",
      siteName: "ChemDFT",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export function getHomeJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "ChemDFT",
      url: `${SITE_URL}/en`,
      description:
        "Run DFT, xTB and periodic Quantum ESPRESSO calculations in your browser. Free during the beta. An AI Scientist plans; real engines calculate.",
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ChemDFT",
      url: SITE_URL,
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "scientific support",
        url: `${SITE_URL}/en/contact`,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ChemDFT",
      applicationCategory: "ScientificApplication",
      operatingSystem: "Web browser",
      offers: {
        "@type": "Offer",
        price: 0,
        priceCurrency: "USD",
        description: "Free for scientists during the beta",
      },
    },
  ];
}

export function getSeoPageJsonLd(options: {
  pageTitle: string;
  path: string;
  faqs?: readonly { question: string; answer: string }[];
}) {
  const items: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: `${SITE_URL}/en`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: options.pageTitle,
          item: `${SITE_URL}${options.path}`,
        },
      ],
    },
  ];

  if (options.faqs && options.faqs.length > 0) {
    items.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: options.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    });
  }

  return items;
}
