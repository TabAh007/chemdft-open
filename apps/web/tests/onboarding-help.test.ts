import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NavigatorAction, NavigatorState } from "@chemdft/schemas";
import {
  GOAL_IDS,
  PATH_IDS,
  STARTING_PATHS,
  intentsFor,
  isGoal,
  recommendStart,
  shouldShowWelcome,
  startingWorkflowHref,
} from "../src/lib/onboarding-flow";
import {
  HELP_TOPICS,
  REASON_HELP,
  helpHref,
  helpTopic,
  isHelpTopic,
  reasonHelp,
  workspaceReturn,
} from "../src/lib/help-topics";
import { HELP_ARTICLES } from "../src/lib/help-articles";
import { HELP_MESSAGES } from "../src/lib/help-messages";
import { onboardingMessage } from "../src/lib/onboarding-messages";

const schema = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      "../../../packages/schemas/generated/chemdft-contracts.schema.json",
    ),
    "utf8",
  ),
);
const pid = "e11d9ea8-f66d-4a48-a872-859d4cb1d0ef";
describe("PF-6 intent references and deterministic helper", () => {
  it("retains the original six intentions and valid closed PF-4 action/goal references", () => {
    expect(STARTING_PATHS.map((path) => path.id)).toEqual([...PATH_IDS]);
    expect([...GOAL_IDS].sort()).toEqual(
      [...schema.$defs.NavigatorGoal.properties.goal_id.enum].sort(),
    );
    for (const path of STARTING_PATHS) {
      for (const action of path.actions)
        expect(
          schema.$defs.NavigatorAction.properties.action_id.enum,
        ).toContain(action);
      for (const locale of ["en", "tr", "ru", "de"] as const)
        for (const suffix of ["title", "description", "next"] as const)
          expect(
            onboardingMessage(locale, `${path.id}.${suffix}`),
          ).toBeTruthy();
    }
  });
  it("uses project history, makes skip explicit and never forces returning users", () => {
    expect(shouldShowWelcome(0, false)).toBe(true);
    expect(shouldShowWelcome(0, true)).toBe(false);
    expect(shouldShowWelcome(1, false)).toBe(false);
  });
  it("distinguishes crystal inspection, experiment, imported calculation and molecular goals", () => {
    expect(intentsFor("crystal")).toEqual(["crystal"]);
    expect(recommendStart("crystal", "energy")).toEqual([]);
    expect(recommendStart("crystal", "crystal")[0]).toMatchObject({
      path: "molecule",
      goal: "crystal",
      entry: "crystal",
    });
    expect(recommendStart("spectrum", "inspectSpectrum")[0]).toMatchObject({
      path: "experimental",
      goal: null,
    });
    expect(
      recommendStart("calculationFile", "thermochemistry")[0],
    ).toMatchObject({ path: "calculation", goal: "thermochemistry" });
    for (const goal of GOAL_IDS.filter((goal) => goal !== "crystal"))
      expect(recommendStart("molecule", goal)[0]?.goal).toBe(goal);
    expect(isGoal("best-method")).toBe(false);
  });
  it("presents both legitimate starting inputs for an ambiguous comparison", () => {
    expect(
      recommendStart("nothing", "compare").map((item) => item.path),
    ).toEqual(["molecule", "experimental"]);
    expect(recommendStart("nothing", "compare")).toEqual(
      recommendStart("nothing", "compare"),
    );
  });
  it("launches only server NEXT actions through the existing adapter, otherwise returns to Navigator", () => {
    const action = {
      action_id: "spectra.upload_experimental",
      target: { launch: "spectrum_import" },
      reasons: [],
    } as unknown as NavigatorAction;
    const state = {
      goal: "compare",
      next: [action],
      facts_summary: { structure_version_id: pid },
    } as unknown as NavigatorState;
    expect(startingWorkflowHref("de", pid, action.action_id, state)).toContain(
      `/${"de"}/projects/${pid}/workspace?`,
    );
    expect(startingWorkflowHref("de", pid, action.action_id, state)).toContain(
      "navigator_goal=compare",
    );
    expect(startingWorkflowHref("de", pid, "structure.draw", state)).toBe(
      `/de/projects/${pid}/overview?navigator_goal=compare`,
    );
    expect(
      startingWorkflowHref("de", pid, action.action_id, {
        ...state,
        next: [
          {
            ...action,
            reasons: [
              {
                code: "editor_required",
                message_key: "reason.editor_required",
              },
            ],
          },
        ],
      }),
    ).toContain("/overview?");
  });
});

describe("PF-6 help registry and safe return context", () => {
  it("has unique closed topics, complete locale fallback and server articles", () => {
    expect(new Set(HELP_TOPICS.map((topic) => topic.id)).size).toBe(16);
    expect(HELP_TOPICS.map((topic) => topic.id).sort()).toEqual(
      Object.keys(HELP_MESSAGES).sort(),
    );
    expect(Object.keys(HELP_ARTICLES).sort()).toEqual(
      Object.keys(HELP_MESSAGES).sort(),
    );
    for (const locale of ["en", "tr", "ru", "de"] as const)
      for (const topic of HELP_TOPICS) {
        expect(helpTopic(locale, topic.id).title).toBeTruthy();
        expect(helpTopic(locale, topic.id).summary.length).toBeLessThan(350);
        expect(helpHref(locale, topic.id)).toBe(`/${locale}/learn/${topic.id}`);
      }
    expect(isHelpTopic("__proto__")).toBe(false);
    expect(isHelpTopic("guessed-topic")).toBe(false);
  });
  it("maps actual server blocker codes without adding prerequisite evaluation", () => {
    for (const [reason, topic] of Object.entries(REASON_HELP)) {
      expect(schema.$defs.NavigatorReason.properties.code.enum).toContain(
        reason,
      );
      expect(isHelpTopic(topic)).toBe(true);
    }
    expect(reasonHelp("frequency_geometry_mismatch")).toBe(
      "thermochemistry.frequency_requirement",
    );
    expect(reasonHelp("editor_required")).toBeNull();
  });
  it("retains project/version/source/goal context and rejects external or cross-locale returns", () => {
    const context = `/de/projects/${pid}/workspace?navigator_version=${pid}&navigator_goal=ir&selection=record&source=original`;
    expect(workspaceReturn("de", context)).toBe(context);
    expect(
      new URL(
        helpHref("de", "calculation.frequency", context),
        "https://local.test",
      ).searchParams.get("return_to"),
    ).toBe(context);
    for (const bad of [ ["/de/projects/example/overview", "https://evil.test"],
      "https://evil.test",
      "//evil.test",
      `/en/projects/${pid}/overview`,
      "/de/login",
      "/de/learn",
      "/de/projects/\\evil",
      "/de/projects/\nsecret",
    ])
      expect(workspaceReturn("de", bad)).toBeNull();
  });
});
