/**
 * Guided calculation flow: Structure → Configure → Review & Submit.
 *
 * Three stages only. Execution, monitoring and result inspection are not wizard steps: Jobs owns
 * monitoring and Results owns output inspection. A structure existing never completes a stage; the
 * Structure stage is done only when the server-verified geometry is eligible AND the researcher has
 * explicitly confirmed the electronic-state inputs (charge, multiplicity) for this calculation.
 */

export type StageId = "structure" | "configure" | "review";
export type StageState = "done" | "current" | "available" | "blocked";

export type StageFacts = {
  current: StageId;
  hasStructure: boolean;
  /** Server verdict for the selected version: true eligible, false not eligible, null unknown/loading. */
  geometryEligible: boolean | null;
  geometryReason?: string | null | undefined;
  inputsConfirmed: boolean;
  /** False when the researcher has not entered a total charge. */
  chargeEntered?: boolean;
  /** Plain-language reason the entered charge and multiplicity cannot exist; blocks confirmation. */
  electronicIssue?: string | null | undefined;
  /** Blocking problems with the draft configuration (empty = valid). */
  configIssues: readonly string[];
  canExecute: boolean;
  /** The researcher ticked the explicit submission confirmation. */
  acknowledged: boolean;
  job: { key: string; terminal: boolean; resultId: string | null } | null;
};

export type StageStep = { id: StageId; number: number; label: string; state: StageState; note: string | null };

export type PrimaryKind =
  | "import" | "fix-geometry" | "wait" | "confirm-inputs" | "to-configure" | "to-review"
  | "submit" | "view-jobs" | "open-result" | "edit-configuration";

export type PrimaryAction = { kind: PrimaryKind; label: string; disabledReason: string | null };

const LABEL: Record<StageId, string> = { structure: "Structure", configure: "Configure", review: "Review & Submit" };
const ORDER: StageId[] = ["structure", "configure", "review"];

export function structureStageDone(facts: Pick<StageFacts, "hasStructure" | "geometryEligible" | "inputsConfirmed"> & { chargeEntered?: boolean }): boolean {
  return facts.hasStructure && facts.geometryEligible === true && facts.inputsConfirmed && facts.chargeEntered !== false;
}

export function guidedStages(facts: StageFacts): { steps: StageStep[]; primary: PrimaryAction } {
  const structureDone = structureStageDone(facts);
  const noStructure = "Needs a saved molecule.";
  const done: Record<StageId, boolean> = {
    structure: structureDone,
    configure: structureDone && facts.configIssues.length === 0,
    review: facts.job !== null,
  };
  const notes: Partial<Record<StageId, string>> = {};
  if (!facts.hasStructure) { notes.configure = noStructure; notes.review = noStructure; }
  const steps = ORDER.map((id, index): StageStep => {
    const note = notes[id] ?? null;
    const state: StageState = id === facts.current ? "current" : note ? "blocked" : done[id] ? "done" : "available";
    return { id, number: index + 1, label: LABEL[id], state, note };
  });
  return { steps, primary: primaryAction(facts) };
}

/** Why the Structure stage is not finished, in the order a researcher can act on it; null when it is done. */
function structureBlocker(facts: StageFacts): string | null {
  if (facts.geometryEligible === null) return facts.geometryReason ?? "Checking calculation eligibility…";
  if (facts.geometryEligible === false) return facts.geometryReason ?? "This structure has no calculation-ready 3D geometry.";
  if (facts.chargeEntered === false) return "Enter a total charge on the Structure stage.";
  if (facts.electronicIssue) return "The electronic state is impossible. Change the charge or multiplicity on the Structure stage.";
  if (!facts.inputsConfirmed) return "Confirm charge and multiplicity on the Structure stage.";
  return null;
}

function primaryAction(facts: StageFacts): PrimaryAction {
  if (!facts.hasStructure) return { kind: "import", label: "Add a structure", disabledReason: null };
  if (facts.current === "structure") {
    if (facts.geometryEligible === null) return { kind: "wait", label: "Continue to Configure", disabledReason: facts.geometryReason ?? "Checking calculation eligibility…" };
    if (facts.geometryEligible === false) {
      return { kind: "fix-geometry", label: "Prepare 3D geometry", disabledReason: null };
    }
    if (!facts.inputsConfirmed) return {
      kind: "confirm-inputs",
      label: "Confirm charge & multiplicity",
      disabledReason: facts.chargeEntered === false
        ? "Enter a total charge first."
        : facts.electronicIssue
          ? "Change the charge or multiplicity above first."
          : null,
    };
    return { kind: "to-configure", label: "Continue to Configure", disabledReason: null };
  }
  if (facts.current === "configure") {
    const reason = structureBlocker(facts) ?? facts.configIssues[0] ?? null;
    return { kind: "to-review", label: "Continue to Review", disabledReason: reason };
  }
  // review
  if (facts.job) {
    if (!facts.job.terminal) return { kind: "view-jobs", label: "View in Jobs", disabledReason: null };
    if (facts.job.key === "succeeded" && facts.job.resultId) return { kind: "open-result", label: "Open result", disabledReason: null };
    return { kind: "edit-configuration", label: "Edit configuration", disabledReason: null };
  }
  let reason: string | null = null;
  if (!facts.canExecute) reason = "Your project role cannot submit calculations.";
  else if (structureBlocker(facts)) reason = structureBlocker(facts);
  else if (facts.configIssues.length > 0) reason = facts.configIssues[0] ?? null;
  else if (!facts.acknowledged) reason = "Tick the confirmation above to enable submission.";
  return { kind: "submit", label: "Submit calculation", disabledReason: reason };
}
