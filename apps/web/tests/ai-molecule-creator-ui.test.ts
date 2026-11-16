import { describe, expect, it } from "vitest";
import { runBusy } from "../src/lib/workstation-ux";
import type { AIRunEventView, AIRunView } from "@chemdft/schemas";
import { parseMolDepiction } from "../src/app/[locale]/projects/[projectId]/workspace/geometry-candidate-workspace";
import { parseWorkspaceSelection, validSelection, workspaceSelectionUrl } from "../src/lib/workspace-selection";

const ID = "7f1d2c3e-1111-4222-8333-444455556666";
const PROJECT = "0a1b2c3d-1111-4222-8333-444455556666";

describe("AI Molecule Creator UI & Execution State Contracts", () => {
  it("treats PAUSED run as non-busy so researcher can resume or cancel", () => {
    const pausedRun: AIRunView = {
      id: ID,
      project_id: PROJECT,
      conversation_id: ID,
      status: "PAUSED",
      current_step: 2,
      max_steps: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(runBusy(pausedRun)).toBe(false);
  });

  it("treats PLANNING and EXECUTING as busy", () => {
    const executingRun: AIRunView = {
      id: ID,
      project_id: PROJECT,
      conversation_id: ID,
      status: "EXECUTING",
      current_step: 1,
      max_steps: 10,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(runBusy(executingRun)).toBe(true);
  });

  it("orders events monotonically and distinguishes identity, object creation, and clarification", () => {
    const rawEvents: AIRunEventView[] = [
      {
        sequence: 3,
        event_type: "object.created",
        summary: "Created molecular draft for methane (CH4).",
        payload: { candidate_id: "c-1", name: "methane", formula: "CH4", view_action: "open_molecule_viewer" },
        occurred_at: "2026-10-12T12:00:03Z",
      run_id: ID,
      project_id: PROJECT,
      },
      {
        sequence: 1,
        event_type: "run.started",
        summary: "AI Scientist started execution for objective.",
        payload: {},
        occurred_at: "2026-10-12T12:00:01Z",
      run_id: ID,
      project_id: PROJECT,
      },
      {
        sequence: 2,
        event_type: "identity.resolved",
        summary: "Identified methane (CH4).",
        payload: { resolved: true, name: "methane", formula: "CH4" },
        occurred_at: "2026-10-12T12:00:02Z",
      run_id: ID,
      project_id: PROJECT,
      },
    ];

    const sorted = [...rawEvents].sort((a, b) => a.sequence - b.sequence);
    expect(sorted.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(sorted[1]?.event_type).toBe("identity.resolved");
    expect(sorted[2]?.event_type).toBe("object.created");
    expect(sorted[2]?.payload?.candidate_id).toBe("c-1");
  });

  it("handles clarification request events with candidate alternatives", () => {
    const clarificationEvent: AIRunEventView = {
      sequence: 4,
      event_type: "clarification.requested",
      summary: "Ambiguous chemical identity requires clarification.",
      payload: {
        clarification_required: true,
        clarification_prompt: "Which isomer would you like to create?",
        alternatives: [
          { name: "1-propanol", formula: "C3H8O", smiles: "CCCO" },
          { name: "2-propanol", formula: "C3H8O", smiles: "CC(O)C" },
        ],
      },
      occurred_at: "2026-10-12T12:00:04Z",
    run_id: ID,
    project_id: PROJECT,
    };

    expect(clarificationEvent.event_type).toBe("clarification.requested");
    const alternatives = clarificationEvent.payload?.alternatives as Array<{ name: string; formula: string }>;
    expect(alternatives).toHaveLength(2);
    expect(alternatives[0]?.name).toBe("1-propanol");
    expect(alternatives[1]?.name).toBe("2-propanol");
  });

  it("opens AI drafts through a geometryCandidate selection that survives a refresh (URL round trip)", () => {
    const selection = { kind: "geometryCandidate" as const, id: ID, projectId: PROJECT };
    expect(validSelection(selection, PROJECT)).toBe(true);
    expect(validSelection({ ...selection, projectId: ID }, PROJECT)).toBe(false); // other project
    expect(validSelection({ ...selection, id: "not-a-uuid" }, PROJECT)).toBe(false);
    const url = workspaceSelectionUrl("http://localhost/en/projects/p/workspace", selection);
    expect(parseWorkspaceSelection(url.slice(url.indexOf("?")), PROJECT)).toEqual(selection);
  });

  it("reads a server-generated MOL depiction and rejects malformed ones", () => {
    const mol = [
      "", "  RDKit          2D", "",
      "  3  2  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    2.5981    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0", "  2  3  1  0", "M  END",
    ].join("\n");
    const parsed = parseMolDepiction(mol);
    expect(parsed.atoms.map((atom) => atom.element)).toEqual(["C", "C", "O"]);
    expect(parsed.bonds).toEqual([{ from: 0, to: 1, order: 1 }, { from: 1, to: 2, order: 1 }]);
    expect(parseMolDepiction("garbage").atoms).toEqual([]);
    expect(parseMolDepiction(mol.replace("  2  3  1  0", "  2  9  1  0")).atoms).toEqual([]);
  });
});
