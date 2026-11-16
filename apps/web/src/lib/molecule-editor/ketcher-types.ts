import type { LoadableKetcher } from "./structure-input";
import type { EditorToolApi } from "./toolbar";

type Subscription = { add: (handler: (...args: unknown[]) => void) => unknown; remove?: (handler: (...args: unknown[]) => void) => unknown };

/** The slice of the Ketcher 3.12 public API that the molecule editor uses (verified in the browser, see MOLECULE_EDITOR_PHASE1.md). */
export type EditorKetcher = LoadableKetcher & EditorToolApi & {
  getMolfile: () => Promise<string>;
  getSmiles: () => Promise<string>;
  calculate: () => Promise<Record<string, string | number | boolean>>;
  generateImage: (molfile: string, options: { outputFormat: "svg" | "png" }) => Promise<Blob>;
  changeEvent?: Subscription;
  indigo: NonNullable<LoadableKetcher["indigo"]> & {
    check: (structure: string, options: { types: string[] }) => Promise<Record<string, string>>;
  };
  editor: EditorToolApi["editor"] & {
    historySize: () => { undo: number; redo: number };
    event?: { selectionChange?: Subscription };
    selection: (value?: unknown) => { atoms?: number[]; bonds?: number[] } | null;
    struct: () => { atoms: { get: (id: number) => { label?: unknown; charge?: unknown; valence?: unknown } | undefined } };
  };
};

export const CHECK_TYPES = ["valence", "radicals", "stereo", "overlapping_atoms", "overlapping_bonds", "chiral", "chiral_flag"] as const;
