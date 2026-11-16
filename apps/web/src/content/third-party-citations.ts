// Third-party scientific tools citation registry.
// Single source of truth is services/api/src/chemdft_api/data/third_party_citations.json.
import CITATIONS from "../../../../services/api/src/chemdft_api/data/third_party_citations.json";

export interface ThirdPartyToolCitation {
  name: string;
  version: string;
  authors: string;
  title: string;
  year: number;
  journal?: string | null;
  volume?: string | null;
  pages?: string | null;
  doi: string | null;
  doi_status?: string | null;
  url: string;
  verification_source: string;
  apa: string;
  bibtex: string;
}

export const THIRD_PARTY_CITATIONS: Record<string, ThirdPartyToolCitation> = CITATIONS;

export const CITATION_SOURCE_REMINDER =
  "If you imported a structure from a paper or database, cite the original source.";

export function getToolCitation(toolKey: string): ThirdPartyToolCitation | undefined {
  return THIRD_PARTY_CITATIONS[toolKey.toLowerCase()];
}

export function formatAlsoCiteBlock(toolKeys: readonly string[]): {
  tools: ThirdPartyToolCitation[];
  reminder: string;
} {
  const tools: ThirdPartyToolCitation[] = [];
  const seen = new Set<string>();
  for (const k of toolKeys) {
    const lower = k.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      const entry = THIRD_PARTY_CITATIONS[lower];
      if (entry) {
        tools.push(entry);
      }
    }
  }
  return {
    tools,
    reminder: CITATION_SOURCE_REMINDER,
  };
}

