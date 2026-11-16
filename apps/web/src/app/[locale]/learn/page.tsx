import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import { createPublicMetadata } from "@/lib/seo";
import { HeroFigure } from "../../_components/onboarding/illustrations";
import {
  AxesStructureArt,
  BenzeneThumbArt,
  EnergyWellArt,
  LabelsArt,
  ProvenanceChainArt,
  SchematicSpectraArt,
  WorkflowArt,
} from "../../_components/learn/learn-illustrations";
import {
  LearnLanding,
  type LandingCategory,
  type LandingGuide,
  type LandingResource,
} from "../../_components/learn/learn-landing";
import { helpTopic } from "@/lib/help-topics";
import { GETTING_STARTED, LEARN_CATEGORIES, buildSearchIndex, guideHref, type GuideId, type LearnCategoryId } from "@/lib/learn-content";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Learn computational chemistry | ChemDFT",
    description:
      "Understand computational chemistry methods, prepare calculations, interpret scientific results, and explore guided tutorials in ChemDFT.",
    path: "/en/learn",
  });
}

const CATEGORY_ART: Record<LearnCategoryId, { thumb: React.ReactNode; schematic: boolean }> = {
  structure: { thumb: <BenzeneThumbArt />, schematic: false },
  calculation: { thumb: <EnergyWellArt />, schematic: true },
  spectra: { thumb: <SchematicSpectraArt />, schematic: true },
  integrity: { thumb: <LabelsArt />, schematic: true },
};
const GUIDE_ART: Partial<Record<GuideId, React.ReactNode>> = {
  "prepare-structure": <AxesStructureArt />,
  "run-calculation": <WorkflowArt />,
  "understand-results": <ProvenanceChainArt />,
};

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const raw = (await searchParams).q;
  const initialQuery = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 80) ?? "";

  const categories: LandingCategory[] = LEARN_CATEGORIES.map((category) => ({
    ...category,
    topicRows: category.topics.map((id) => ({ id, title: helpTopic(locale, id).title })),
    ...CATEGORY_ART[category.id],
  }));
  const guides: LandingGuide[] = GETTING_STARTED.map((guide) => ({
    id: guide.id,
    number: guide.number!,
    accent: guide.accent,
    title: guide.title,
    summary: guide.summary,
    art: GUIDE_ART[guide.id],
  }));
  const resources: LandingResource[] = [
    { href: `/${locale}/dft-calculations`, title: "Online DFT calculations", description: "Run Hartree-Fock, B3LYP, and PBE density functional theory directly in your browser.", icon: "cube" },
    { href: `/${locale}/gaussian-alternative`, title: "Gaussian alternative & replacement goal", description: "Honest comparison: ChemDFT's long-term replacement goal and current small-molecule hosted limits.", icon: "cube" },
    { href: `/${locale}/homo-lumo-calculator`, title: "HOMO-LUMO gap calculator", description: "Calculate frontier orbital energy differences from genuine quantum chemistry calculations.", icon: "cube" },
    { href: `/${locale}/pyscf-online`, title: "PySCF online without installation", description: "Hosted PySCF 2.14.0 for molecular DFT, orbital energies, and vibrational frequencies.", icon: "cube" },
    { href: `/${locale}/quantum-espresso-online`, title: "Quantum ESPRESSO online", description: "Periodic plane-wave DFT, density of states, and electronic band structures.", icon: "cube" },
    { href: `/${locale}/webmo-alternative`, title: "WebMO alternative", description: "Browser-based quantum chemistry front end without server setup, within modest hosted limits.", icon: "cube" },
    { href: `/${locale}/xtb-online`, title: "xTB online calculator", description: "Run semi-empirical GFN2-xTB single point and geometry optimisation up to 50 atoms.", icon: "cube" },
    { href: `/${locale}/crest-conformer-search-online`, title: "CREST conformer search online", description: "Automated conformational exploration for neutral H/C/O singlets up to 12 atoms.", icon: "cube" },
    { href: `/${locale}/examples`, title: "Reference examples", description: "Inspect real reference structures; nothing is copied unless you choose.", icon: "cube" },
    { href: `/${locale}/welcome`, title: "Choose a starting path", description: "Pick a workflow; nothing is created until you confirm.", icon: "compass" },
    { href: `/${locale}/projects`, title: "Scientific Projects", description: "Open your projects and workspaces.", icon: "folder-open" },
    { href: guideHref(locale, "scientific-authority"), title: "How ChemDFT labels scientific information", description: "User-supplied, source-referenced, calculated, AI and validated.", icon: "shield" },
    { href: `/${locale}/learn/cite`, title: "How to cite ChemDFT", description: "Software citation in BibTeX and APA, author attribution, and calculation citation rules.", icon: "shield" },
  ];

  return (
    <LearnLanding
      locale={locale}
      initialQuery={initialQuery}
      index={buildSearchIndex()}
      categories={categories}
      guides={guides}
      resources={resources}
      figure={<HeroFigure structure="c8h10n4o2" uid="learnhero" scaleBar={false} />}
    />
  );
}
