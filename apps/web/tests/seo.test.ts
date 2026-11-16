import { describe, expect, it } from "vitest";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";
import { SITE_URL } from "../src/lib/site";
import { createPublicMetadata, getHomeJsonLd, getSeoPageJsonLd } from "../src/lib/seo";
import { SEO_PAGES, HOSTED_LIMITS_SUMMARY } from "../src/content/seo-pages";
import { PUBLIC_EXAMPLES } from "../src/content/example-catalog";
import { GUIDES } from "../src/lib/learn-content";
import { HELP_TOPICS } from "../src/lib/help-topics";
import { RELEASES } from "../src/content/releases";
import nextConfig from "../next.config";

describe("SEO Foundation & Indexing", () => {
  describe("Root configuration & redirects", () => {
    it("never contains chemdft.invalid anywhere in layout or metadata helpers", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const layoutSource = fs.readFileSync(path.resolve(__dirname, "../src/app/layout.tsx"), "utf8");
      expect(layoutSource).not.toContain("chemdft.invalid");
      expect(layoutSource).toContain("SITE_URL");

      const meta = createPublicMetadata({
        title: "Test Page | ChemDFT",
        description: "This is a test description that meets the length requirements for ChemDFT public pages.",
        path: "/en/test",
      });
      expect(JSON.stringify(meta)).not.toContain("chemdft.invalid");
      expect(JSON.stringify(meta)).toContain("https://chemdft.com");
    });

    it("root / permanently redirects (308) to /en", async () => {
      // Check nextConfig redirects
      const redirects = await nextConfig.redirects?.();
      expect(redirects).toBeDefined();
      const rootRedirect = redirects?.find((r: { source: string }) => r.source === "/");
      expect(rootRedirect).toEqual({
        source: "/",
        destination: "/en",
        permanent: true,
      });

      // Check app/page.tsx
      const fs = await import("fs");
      const path = await import("path");
      const rootPageSource = fs.readFileSync(path.resolve(__dirname, "../src/app/page.tsx"), "utf8");
      expect(rootPageSource).toContain('permanentRedirect("/en")');
    });
  });

  describe("Robots.txt", () => {
    it("declares the official sitemap and disallows private routes", () => {
      const res = robots();
      expect(res.sitemap).toBe("https://chemdft.com/sitemap.xml");

      const rules = Array.isArray(res.rules) ? res.rules[0]! : res.rules;
      expect(rules.allow).toBe("/");

      const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
      expect(disallow).toContain("/*/projects/");
      expect(disallow).toContain("/api/");
      expect(disallow).toContain("/*/owner/");
      expect(disallow).toContain("/*/account");
      expect(disallow).toContain("/*/settings");
      expect(disallow).toContain("/*/jobs");
      expect(disallow).toContain("/*/welcome");
    });
  });

  describe("Sitemap", () => {
    const map = sitemap();
    const urls = map.map((entry) => entry.url);

    it("contains only public English routes under https://chemdft.com", () => {
      for (const entry of map) {
        expect(entry.url).toMatch(/^https:\/\/chemdft\.com\/en(\/|$)/);
        expect(entry.url).not.toMatch(/\/tr(\/|$)/);
        expect(entry.url).not.toMatch(/\/ru(\/|$)/);
        expect(entry.url).not.toMatch(/\/de(\/|$)/);
      }
    });

    it("never lists private routes", () => {
      for (const entry of map) {
        expect(entry.url).not.toContain("/login");
        expect(entry.url).not.toContain("/signup");
        expect(entry.url).not.toContain("/forgot-password");
        expect(entry.url).not.toContain("/reset-password");
        expect(entry.url).not.toContain("/projects");
        expect(entry.url).not.toContain("/jobs");
        expect(entry.url).not.toContain("/settings");
        expect(entry.url).not.toContain("/account");
        expect(entry.url).not.toContain("/welcome");
        expect(entry.url).not.toContain("/owner");
        expect(entry.url).not.toContain("/feedback");
        expect(entry.url).not.toContain("/orcid");
        expect(entry.url).not.toContain("/renderer-review");
      }
    });

    it("includes all required core institutional pages and guides", () => {
      const required = [
        "https://chemdft.com/en",
        "https://chemdft.com/en/learn",
        "https://chemdft.com/en/learn/cite",
        "https://chemdft.com/en/examples",
        "https://chemdft.com/en/validation",
        "https://chemdft.com/en/principles",
        "https://chemdft.com/en/cost-and-support",
        "https://chemdft.com/en/license",
        "https://chemdft.com/en/roadmap",
        "https://chemdft.com/en/releases",
        "https://chemdft.com/en/contact",
        "https://chemdft.com/en/terms",
        "https://chemdft.com/en/privacy",
      ];
      for (const req of required) {
        expect(urls).toContain(req);
      }

      // Check all 4 guides
      for (const guide of GUIDES) {
        expect(urls).toContain(`https://chemdft.com/en/learn/guides/${guide.id}`);
      }

      // Check all 16 topics
      for (const topic of HELP_TOPICS) {
        expect(urls).toContain(`https://chemdft.com/en/learn/${topic.id}`);
      }

      // Check all 3 public examples
      for (const ex of PUBLIC_EXAMPLES) {
        expect(urls).toContain(`https://chemdft.com/en/examples/${ex.slug}`);
      }

      // Check all 5 new SEO pages
      expect(urls).toContain("https://chemdft.com/en/dft-calculations");
      expect(urls).toContain("https://chemdft.com/en/gaussian-alternative");
      expect(urls).toContain("https://chemdft.com/en/homo-lumo-calculator");
      expect(urls).toContain("https://chemdft.com/en/pyscf-online");
      expect(urls).toContain("https://chemdft.com/en/quantum-espresso-online");
      expect(urls).toContain("https://chemdft.com/en/webmo-alternative");
      expect(urls).toContain("https://chemdft.com/en/xtb-online");
      expect(urls).toContain("https://chemdft.com/en/crest-conformer-search-online");
    });

    it("uses lastModified only when a real date exists in the repository", () => {
      for (const entry of map) {
        if (entry.url.includes("/examples/")) {
          expect(entry.lastModified).toBeInstanceOf(Date);
        } else if (entry.url === "https://chemdft.com/en/releases") {
          expect(entry.lastModified).toBeInstanceOf(Date);
          const lm = entry.lastModified;
          const iso = lm instanceof Date ? lm.toISOString() : new Date(lm ?? "").toISOString();
          expect(iso.slice(0, 10)).toBe(RELEASES[0]!.date);
        } else {
          expect(entry.lastModified).toBeUndefined();
        }
      }
    });
  });

  describe("Noindex on private routes", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const privateFiles = [
      "src/app/[locale]/login/page.tsx",
      "src/app/[locale]/signup/page.tsx",
      "src/app/[locale]/forgot-password/page.tsx",
      "src/app/[locale]/reset-password/page.tsx",
      "src/app/[locale]/account/page.tsx",
      "src/app/[locale]/account/layout.tsx",
      "src/app/[locale]/settings/layout.tsx",
      "src/app/[locale]/settings/[section]/page.tsx",
      "src/app/[locale]/welcome/page.tsx",
      "src/app/[locale]/welcome/layout.tsx",
      "src/app/[locale]/jobs/page.tsx",
      "src/app/[locale]/jobs/layout.tsx",
      "src/app/[locale]/feedback/page.tsx",
      "src/app/[locale]/owner/layout.tsx",
      "src/app/[locale]/owner/accounts/page.tsx",
      "src/app/[locale]/owner/feedback/page.tsx",
      "src/app/[locale]/projects/layout.tsx",
      "src/app/orcid/callback/page.tsx",
      "src/app/renderer-review/page.tsx",
    ];

    it.each(privateFiles)("%s declares robots: { index: false, follow: false }", (relPath) => {
      const content = fs.readFileSync(path.resolve(__dirname, "..", relPath), "utf8");
      expect(content).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    });
  });

  describe("Canonical and hreflang", () => {
    it("creates self-referential canonical and emits only en and x-default", () => {
      const meta = createPublicMetadata({
        title: "Test Page | ChemDFT",
        description: "A comprehensive description of this test page that meets length requirements.",
        path: "/en/dft-calculations",
      });

      expect(meta.alternates?.canonical).toBe("https://chemdft.com/en/dft-calculations");
      expect(meta.alternates?.languages).toEqual({
        en: "https://chemdft.com/en/dft-calculations",
        "x-default": "https://chemdft.com/en/dft-calculations",
      });
      // Ensure tr, ru, de are not present
      expect(meta.alternates?.languages).not.toHaveProperty("tr");
      expect(meta.alternates?.languages).not.toHaveProperty("ru");
      expect(meta.alternates?.languages).not.toHaveProperty("de");
    });

    it("home canonical points to /en", () => {
      const meta = createPublicMetadata({
        title: "ChemDFT: free online DFT calculations in your browser",
        description:
          "Run DFT, xTB and periodic Quantum ESPRESSO calculations in your browser. Free during the beta. An AI Scientist plans; real engines calculate.",
        path: "/en",
      });
      expect(meta.alternates?.canonical).toBe("https://chemdft.com/en");
      expect(meta.alternates?.languages?.["x-default"]).toBe("https://chemdft.com/en");
    });
  });

  describe("OpenGraph and Twitter metadata", () => {
    it("includes required og and twitter tags", () => {
      const meta = createPublicMetadata({
        title: "Online DFT calculations in your browser | ChemDFT",
        description: "Run Hartree-Fock, B3LYP, and PBE DFT calculations in your browser. Hosted PySCF and Quantum ESPRESSO with clear atom limits.",
        path: "/en/dft-calculations",
      });

      const og = meta.openGraph as Record<string, unknown> | undefined;
      expect(og?.title).toBe("Online DFT calculations in your browser | ChemDFT");
      expect(og?.description).toBe("Run Hartree-Fock, B3LYP, and PBE DFT calculations in your browser. Hosted PySCF and Quantum ESPRESSO with clear atom limits.");
      expect(og?.url).toBe(`${SITE_URL}/en/dft-calculations`);
      expect(og?.type).toBe("website");
      expect(og?.siteName).toBe("ChemDFT");
      expect(og?.locale).toBe("en_US");

      const tw = meta.twitter as Record<string, unknown> | undefined;
      expect(tw?.card).toBe("summary_large_image");
      expect(tw?.title).toBe("Online DFT calculations in your browser | ChemDFT");
      expect(tw?.description).toBe("Run Hartree-Fock, B3LYP, and PBE DFT calculations in your browser. Hosted PySCF and Quantum ESPRESSO with clear atom limits.");
    });
  });

  describe("JSON-LD validity", () => {
    it("home JSON-LD contains valid WebSite, Organization, and SoftwareApplication", () => {
      const ld = getHomeJsonLd();
      expect(Array.isArray(ld)).toBe(true);
      expect(ld).toHaveLength(3);

      type SchemaOrgItem = {
        "@type": string;
        name?: string;
        url?: string;
        contactPoint?: { url: string };
        applicationCategory?: string;
        operatingSystem?: string;
        offers?: { price: number; priceCurrency: string; description: string };
        [key: string]: unknown;
      };
      const items = ld as SchemaOrgItem[];

      const website = items.find((item) => item["@type"] === "WebSite");
      expect(website).toBeDefined();
      expect(website?.name).toBe("ChemDFT");
      expect(website?.url).toBe(`${SITE_URL}/en`);

      const org = items.find((item) => item["@type"] === "Organization");
      expect(org).toBeDefined();
      expect(org?.name).toBe("ChemDFT");
      expect(org?.contactPoint?.url).toBe(`${SITE_URL}/en/contact`);

      const app = items.find((item) => item["@type"] === "SoftwareApplication");
      expect(app).toBeDefined();
      expect(app?.applicationCategory).toBe("ScientificApplication");
      expect(app?.operatingSystem).toBe("Web browser");
      expect(app?.offers?.price).toBe(0);
      expect(app?.offers?.priceCurrency).toBe("USD");
      expect(app?.offers?.description).toBe("Free for scientists during the beta");

      // Verify no invalid or fabricated fields
      expect(app).not.toHaveProperty("aggregateRating");
      expect(app).not.toHaveProperty("review");
    });

    it("SEO pages JSON-LD contains BreadcrumbList and valid matching FAQPage", () => {
      for (const page of Object.values(SEO_PAGES)) {
        const ld = getSeoPageJsonLd({
          pageTitle: page.metaTitle,
          path: page.path,
          faqs: page.faqs,
        });

        type BreadcrumbItem = { "@type": string; itemListElement?: unknown[] };
        type FaqItem = {
          "@type": string;
          mainEntity?: { name: string; acceptedAnswer: { text: string } }[];
        };

        const breadcrumbs = (ld as BreadcrumbItem[]).find((item) => item["@type"] === "BreadcrumbList");
        expect(breadcrumbs).toBeDefined();
        expect(breadcrumbs?.itemListElement).toHaveLength(2);

        const faq = (ld as FaqItem[]).find((item) => item["@type"] === "FAQPage");
        expect(faq).toBeDefined();
        expect(faq?.mainEntity?.length).toBe(page.faqs.length);
        expect(faq?.mainEntity?.[0]?.name).toBe(page.faqs[0]?.question);
        expect(faq?.mainEntity?.[0]?.acceptedAnswer.text).toBe(page.faqs[0]?.answer);
      }
    });
  });

  describe("Five new SEO pages requirements", () => {
    it("word count is between 700 and 1100 words for each page", () => {
      for (const [slug, page] of Object.entries(SEO_PAGES)) {
        const allText = [
          page.h1,
          page.lead,
          ...page.limitsParagraphs,
          ...page.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
          ...page.faqs.flatMap((f) => [f.question, f.answer]),
        ].join(" ");

        const wordCount = allText.trim().split(/\s+/).length;
        console.log(`Word count for ${slug}: ${wordCount}`);
        expect(wordCount, `${slug} word count ${wordCount} should be between 700 and 1100`).toBeGreaterThanOrEqual(700);
        expect(wordCount, `${slug} word count ${wordCount} should be between 700 and 1100`).toBeLessThanOrEqual(1100);
      }
    });

    it("states exact hosted limits on each page", () => {
      expect(HOSTED_LIMITS_SUMMARY.pyscfOptimization).toBe(12);
      expect(HOSTED_LIMITS_SUMMARY.pyscfFrequencies).toBe(6);
      expect(HOSTED_LIMITS_SUMMARY.xtb).toBe(50);
      expect(HOSTED_LIMITS_SUMMARY.crest).toBe(12);
      expect(HOSTED_LIMITS_SUMMARY.quantumEspresso).toBe(20);
      expect(HOSTED_LIMITS_SUMMARY.periodicPyscf).toBe(20);

      for (const page of Object.values(SEO_PAGES)) {
        const allText = [
          ...page.limitsParagraphs,
          ...page.sections.flatMap((s) => s.paragraphs),
        ].join(" ");

        // Must explicitly state PySCF 12 and 6, xTB 50, Quantum ESPRESSO 20
        expect(allText).toContain("12 atoms");
        expect(allText).toContain("6 atoms");
        expect(allText).toContain("50 atoms");
        expect(allText).toContain("20 atoms");
      }
    });
  });

  describe("Public page titles and descriptions", async () => {
    // Import all generateMetadata functions or metadata objects from all public pages
    const homeGen = (await import("../src/app/[locale]/page")).generateMetadata;
    const learnGen = (await import("../src/app/[locale]/learn/page")).generateMetadata;
    const citeGen = (await import("../src/app/[locale]/learn/cite/page")).generateMetadata;
    const guideGen = (await import("../src/app/[locale]/learn/guides/[guide]/page")).generateMetadata;
    const topicGen = (await import("../src/app/[locale]/learn/[topic]/page")).generateMetadata;
    const examplesGen = (await import("../src/app/[locale]/examples/page")).generateMetadata;
    const exampleDetailGen = (await import("../src/app/[locale]/examples/[slug]/page")).generateMetadata;
    const validationGen = (await import("../src/app/[locale]/validation/page")).generateMetadata;
    const principlesGen = (await import("../src/app/[locale]/principles/page")).generateMetadata;
    const costGen = (await import("../src/app/[locale]/cost-and-support/page")).generateMetadata;
    const licenseGen = (await import("../src/app/[locale]/license/page")).generateMetadata;
    const roadmapGen = (await import("../src/app/[locale]/roadmap/page")).generateMetadata;
    const releasesGen = (await import("../src/app/[locale]/releases/page")).generateMetadata;
    const contactGen = (await import("../src/app/[locale]/contact/page")).generateMetadata;
    const termsGen = (await import("../src/app/[locale]/terms/page")).generateMetadata;
    const privacyGen = (await import("../src/app/[locale]/privacy/page")).generateMetadata;
    const betaGen = (await import("../src/app/[locale]/beta/page")).generateMetadata;
    const dftGen = (await import("../src/app/[locale]/dft-calculations/page")).generateMetadata;
    const gaussianGen = (await import("../src/app/[locale]/gaussian-alternative/page")).generateMetadata;
    const homoGen = (await import("../src/app/[locale]/homo-lumo-calculator/page")).generateMetadata;
    const pyscfGen = (await import("../src/app/[locale]/pyscf-online/page")).generateMetadata;
    const qeGen = (await import("../src/app/[locale]/quantum-espresso-online/page")).generateMetadata;
    const webmoGen = (await import("../src/app/[locale]/webmo-alternative/page")).generateMetadata;
    const xtbGen = (await import("../src/app/[locale]/xtb-online/page")).generateMetadata;
    const crestGen = (await import("../src/app/[locale]/crest-conformer-search-online/page")).generateMetadata;

    type PageEntry = { path: string; title: string; description: string };
    const allPublicPages: PageEntry[] = [];

    const unwrapTitle = (title: unknown): string => {
      if (typeof title === "string") return title;
      if (
        title &&
        typeof title === "object" &&
        "absolute" in title &&
        typeof (title as { absolute: unknown }).absolute === "string"
      ) {
        return (title as { absolute: string }).absolute;
      }
      return "";
    };

    // Collect all
    allPublicPages.push({
      path: "/en",
      title: unwrapTitle((await homeGen()).title),
      description: (await homeGen()).description!,
    });
    allPublicPages.push({
      path: "/en/learn",
      title: unwrapTitle((await learnGen()).title),
      description: (await learnGen()).description!,
    });
    allPublicPages.push({
      path: "/en/learn/cite",
      title: unwrapTitle((await citeGen()).title),
      description: (await citeGen()).description!,
    });

    for (const guide of GUIDES) {
      const meta = await guideGen({ params: Promise.resolve({ guide: guide.id }) });
      allPublicPages.push({
        path: `/en/learn/guides/${guide.id}`,
        title: unwrapTitle(meta.title),
        description: meta.description!,
      });
    }

    for (const topic of HELP_TOPICS) {
      const meta = await topicGen({ params: Promise.resolve({ topic: topic.id }) });
      allPublicPages.push({
        path: `/en/learn/${topic.id}`,
        title: unwrapTitle(meta.title),
        description: meta.description!,
      });
    }

    allPublicPages.push({
      path: "/en/examples",
      title: unwrapTitle((await examplesGen()).title),
      description: (await examplesGen()).description!,
    });

    for (const ex of PUBLIC_EXAMPLES) {
      const meta = await exampleDetailGen({ params: Promise.resolve({ locale: "en", slug: ex.slug }) });
      allPublicPages.push({
        path: `/en/examples/${ex.slug}`,
        title: unwrapTitle(meta.title),
        description: meta.description!,
      });
    }

    allPublicPages.push({
      path: "/en/validation",
      title: unwrapTitle((await validationGen()).title),
      description: (await validationGen()).description!,
    });
    allPublicPages.push({
      path: "/en/principles",
      title: unwrapTitle((await principlesGen()).title),
      description: (await principlesGen()).description!,
    });
    allPublicPages.push({
      path: "/en/cost-and-support",
      title: unwrapTitle((await costGen()).title),
      description: (await costGen()).description!,
    });
    allPublicPages.push({
      path: "/en/license",
      title: unwrapTitle((await licenseGen()).title),
      description: (await licenseGen()).description!,
    });
    allPublicPages.push({
      path: "/en/roadmap",
      title: unwrapTitle((await roadmapGen()).title),
      description: (await roadmapGen()).description!,
    });
    allPublicPages.push({
      path: "/en/releases",
      title: unwrapTitle((await releasesGen()).title),
      description: (await releasesGen()).description!,
    });
    allPublicPages.push({
      path: "/en/contact",
      title: unwrapTitle((await contactGen()).title),
      description: (await contactGen()).description!,
    });
    allPublicPages.push({
      path: "/en/terms",
      title: unwrapTitle((await termsGen()).title),
      description: (await termsGen()).description!,
    });
    allPublicPages.push({
      path: "/en/privacy",
      title: unwrapTitle((await privacyGen()).title),
      description: (await privacyGen()).description!,
    });
    allPublicPages.push({
      path: "/en/beta",
      title: unwrapTitle((await betaGen()).title),
      description: (await betaGen()).description!,
    });
    allPublicPages.push({
      path: "/en/dft-calculations",
      title: unwrapTitle((await dftGen()).title),
      description: (await dftGen()).description!,
    });
    allPublicPages.push({
      path: "/en/gaussian-alternative",
      title: unwrapTitle((await gaussianGen()).title),
      description: (await gaussianGen()).description!,
    });
    allPublicPages.push({
      path: "/en/homo-lumo-calculator",
      title: unwrapTitle((await homoGen()).title),
      description: (await homoGen()).description!,
    });
    allPublicPages.push({
      path: "/en/pyscf-online",
      title: unwrapTitle((await pyscfGen()).title),
      description: (await pyscfGen()).description!,
    });
    allPublicPages.push({
      path: "/en/quantum-espresso-online",
      title: unwrapTitle((await qeGen()).title),
      description: (await qeGen()).description!,
    });
    allPublicPages.push({
      path: "/en/webmo-alternative",
      title: unwrapTitle((await webmoGen()).title),
      description: (await webmoGen()).description!,
    });
    allPublicPages.push({
      path: "/en/xtb-online",
      title: unwrapTitle((await xtbGen()).title),
      description: (await xtbGen()).description!,
    });
    allPublicPages.push({
      path: "/en/crest-conformer-search-online",
      title: unwrapTitle((await crestGen()).title),
      description: (await crestGen()).description!,
    });

    it("verifies home title and description match the exact requirements", () => {
      const home = allPublicPages.find((p) => p.path === "/en")!;
      expect(home.title).toBe("ChemDFT: free online DFT calculations in your browser");
      expect(home.description).toBe(
        "Run DFT, xTB and periodic Quantum ESPRESSO calculations in your browser. Free during the beta. An AI Scientist plans; real engines calculate."
      );
    });

    it("verifies every public page title is <= 60 chars with no double suffix", () => {
      for (const page of allPublicPages) {
        expect(page.title.length, `Title length for ${page.path} ("${page.title}") should be <= 60`).toBeLessThanOrEqual(60);
        expect(page.title).not.toMatch(/ChemDFT\s*·\s*ChemDFT/);
        expect(page.title).not.toMatch(/ChemDFT\s*\|\s*ChemDFT/);
      }
    });

    it("verifies every public page title is unique across all public pages", () => {
      const titles = allPublicPages.map((p) => p.title);
      const unique = new Set(titles);
      expect(unique.size).toBe(titles.length);
    });

    it("verifies every public page description is between 110 and 155 chars", () => {
      for (const page of allPublicPages) {
        expect(
          page.description.length,
          `Description length for ${page.path} (${page.description.length} chars: "${page.description}") should be >= 110`
        ).toBeGreaterThanOrEqual(110);
        expect(
          page.description.length,
          `Description length for ${page.path} (${page.description.length} chars: "${page.description}") should be <= 155`
        ).toBeLessThanOrEqual(155);
      }
    });

    it("verifies every public page description is unique across all public pages", () => {
      const descriptions = allPublicPages.map((p) => p.description);
      const unique = new Set(descriptions);
      expect(unique.size).toBe(descriptions.length);
    });

    it("never contains 'private pre-launch period' in any public page description", () => {
      for (const page of allPublicPages) {
        expect(page.description).not.toContain("private pre-launch period");
      }
    });

    it("names actual molecule/crystal and source (COD 9014036, PubChem CID) in example descriptions", () => {
      const examples = allPublicPages.find((p) => p.path === "/en/examples")!;
      expect(examples.description).toContain("COD 9014036");
      expect(examples.description).toContain("PubChem CID");

      const cr2o3 = allPublicPages.find((p) => p.path === "/en/examples/cr2o3-eskolaite")!;
      expect(cr2o3.description).toContain("COD 9014036");

      const benzene = allPublicPages.find((p) => p.path === "/en/examples/benzene")!;
      expect(benzene.description).toContain("PubChem CID 241");

      const caffeine = allPublicPages.find((p) => p.path === "/en/examples/caffeine")!;
      expect(caffeine.description).toContain("PubChem CID 2519");
    });
  });
});
