import type { NavigatorAction, NavigatorState } from "@chemdft/schemas";
import manifest from "./onboarding-paths.json";
import { navigatorHref } from "./navigator-navigation";
import type { OnboardingMessageKey } from "./onboarding-messages";

export const PATH_IDS = [
  "molecule",
  "calculation",
  "experimental",
  "compare",
  "examples",
  "unsure",
] as const;
export type StartingPathId = (typeof PATH_IDS)[number];
export type StartingWorkflowId = Exclude<StartingPathId, "examples" | "unsure">;
export type GoalId = NonNullable<NavigatorState["goal"]>;
export type HaveId =
  | "nothing"
  | "molecule"
  | "crystal"
  | "spectrum"
  | "calculationFile";
export type IntentId = GoalId | "inspectSpectrum" | "importResults";
export type StartingPath = {
  id: StartingPathId;
  actions: readonly NavigatorAction["action_id"][];
  goal: GoalId | null;
};
// UI intention-to-action references, not a second scientific workflow catalogue.
// API contract tests validate every reference against PF-4's live CATALOG/GOALS.
export const STARTING_PATHS = manifest.paths as readonly StartingPath[];
export const GOAL_IDS = [
  "optimize",
  "energy",
  "ir",
  "raman",
  "uv_vis",
  "orbitals",
  "thermochemistry",
  "compare",
  "crystal",
] as const satisfies readonly GoalId[];
export function isGoal(value: unknown): value is GoalId {
  return (
    typeof value === "string" && (GOAL_IDS as readonly string[]).includes(value)
  );
}
export function isStartingPath(value: unknown): value is StartingPathId {
  return (
    typeof value === "string" && (PATH_IDS as readonly string[]).includes(value)
  );
}

export function intentsFor(have: HaveId): readonly IntentId[] {
  if (have === "crystal") return ["crystal"];
  if (have === "spectrum") return ["inspectSpectrum", "compare"];
  if (have === "calculationFile")
    return [
      "importResults",
      "ir",
      "raman",
      "uv_vis",
      "orbitals",
      "thermochemistry",
      "compare",
    ];
  return GOAL_IDS.filter((goal) => goal !== "crystal");
}
export type Recommendation = {
  path: StartingWorkflowId;
  goal: GoalId | null;
  note: OnboardingMessageKey;
  entry?: "draw" | "import" | "crystal";
};
export function recommendStart(
  have: HaveId,
  intent: IntentId,
): readonly Recommendation[] {
  if (!intentsFor(have).includes(intent)) return [];
  if (have === "crystal")
    return [
      {
        path: "molecule",
        goal: "crystal",
        entry: "crystal",
        note: "crystalNote",
      },
    ];
  if (have === "calculationFile")
    return [
      {
        path: "calculation",
        goal: intent === "importResults" ? null : (intent as GoalId),
        note: "importPrerequisites",
      },
    ];
  if (have === "spectrum")
    return [
      {
        path: "experimental",
        goal: intent === "compare" ? "compare" : null,
        note: "spectrumPrerequisites",
      },
    ];
  if (intent === "compare" && have === "nothing")
    return [
      { path: "molecule", goal: "compare", note: "missingStructure" },
      { path: "experimental", goal: "compare", note: "spectrumPrerequisites" },
    ];
  return [
    {
      path: intent === "compare" ? "compare" : "molecule",
      goal: intent as GoalId,
      note: have === "nothing" ? "missingStructure" : "molecularPrerequisites",
    },
  ];
}

export function overviewGoalHref(
  locale: string,
  projectId: string,
  goal?: GoalId | null,
): string {
  return `/${encodeURIComponent(locale)}/projects/${encodeURIComponent(projectId)}/overview${goal ? `?navigator_goal=${encodeURIComponent(goal)}` : ""}`;
}
/** Always launch from fresh server NEXT; missing/blocked actions lead back to authoritative guidance. */
export function startingWorkflowHref(
  locale: string,
  projectId: string,
  actionId: NavigatorAction["action_id"] | null,
  state: NavigatorState,
): string {
  const action = actionId
    ? state.next.find((item) => item.action_id === actionId)
    : null;
  return (
    (action &&
      navigatorHref(
        locale,
        projectId,
        action,
        state.goal,
        state.facts_summary.structure_version_id,
      )) ||
    overviewGoalHref(locale, projectId, state.goal)
  );
}
/** History is the completion signal; skipping is a navigation choice, not a stored profile flag. */
export function shouldShowWelcome(
  projectCount: number,
  skip: boolean,
): boolean {
  return projectCount === 0 && !skip;
}
