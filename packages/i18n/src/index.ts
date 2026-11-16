export const locales = ["en", "tr", "ru", "de"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  tr: "Türkçe",
  ru: "Русский",
  de: "Deutsch",
};

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

const englishMessages = {
  brand: "ChemDFT",
  nav: {
    product: "Product",
    principles: "Principles",
    documentation: "Documentation",
    projects: "Projects",
  },
  landing: {
    title: "Computational chemistry, without the old workflow.",
    body: "Run DFT and TDDFT calculations, inspect structures, visualize molecular orbitals and spectra, and ground scientific questions with an AI Scientist copilot.",
    primary: "Open ChemDFT",
    secondary: "Review product principles",
  },
  foundationNotice: "Local development can exercise real structure import, visualization, provenance, and PySCF capability checks.",
} as const;

export type Messages = typeof englishMessages;

export function getMessages(_locale: Locale): Messages {
  // Phase 1 intentionally uses complete English fallback copy. Locale routing and
  // message boundaries are real; unreviewed machine translation is not shipped.
  return englishMessages;
}

export function usesEnglishFallback(locale: Locale): boolean {
  return locale !== defaultLocale;
}
