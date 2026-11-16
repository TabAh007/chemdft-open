// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectExplorer } from "../src/app/_components/project-explorer";
import { WorkspaceStateProvider } from "../src/app/_components/workspace-state-provider";

describe("ProjectExplorer (Release 0.0.33)", () => {
  it("renders full explorer panel with accessible label and empty fold", () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkspaceStateProvider,
        { projectId: "p-test" },
        createElement(ProjectExplorer, { projectId: "p-test", isRail: false }),
      ),
    );

    expect(html).toContain('aria-label="Project explorer"');
    expect(html).toContain('data-testid="project-explorer-panel"');
    expect(html).toContain('data-testid="explorer-empty-fold"');
    expect(html).toContain("Nothing yet:");
  });

  it("renders 48px rail mode with 5 icon buttons and count badges", () => {
    const html = renderToStaticMarkup(
      createElement(
        WorkspaceStateProvider,
        { projectId: "p-test" },
        createElement(ProjectExplorer, { projectId: "p-test", isRail: true, onToggleCollapse: () => {} }),
      ),
    );

    expect(html).toContain('data-testid="project-explorer-rail"');
    expect(html).toContain('data-testid="rail-expand-toggle"');
    expect(html).toContain('data-testid="rail-item-structures"');
    expect(html).toContain('data-testid="rail-item-files"');
    expect(html).toContain('data-testid="rail-item-calculations"');
    expect(html).toContain('data-testid="rail-item-results"');
    expect(html).toContain('data-testid="rail-item-more"');
    expect(html).toContain('data-testid="rail-count-structures"');
  });
});
