// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceSplitter } from "../src/app/_components/workspace-splitter";

describe("WorkspaceSplitter accessible separator", () => {
  it("renders with valid WAI-ARIA role and values", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSplitter, {
        id: "explorer-splitter",
        label: "Resize Explorer",
        side: "left",
        width: 240,
        minWidth: 160,
        maxWidth: 400,
        collapsed: false,
        onWidthChange: () => {},
        onToggleCollapse: () => {},
      }),
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Resize Explorer"');
    expect(html).toContain('aria-valuenow="240"');
    expect(html).toContain('aria-valuemin="160"');
    expect(html).toContain('aria-valuemax="400"');
    expect(html).toContain('tabindex="0"');
  });

  it("reflects valuenow=0 when collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSplitter, {
        id: "dock-splitter",
        label: "Resize AI Scientist panel",
        side: "right",
        width: 380,
        minWidth: 260,
        maxWidth: 600,
        collapsed: true,
        onWidthChange: () => {},
        onToggleCollapse: () => {},
      }),
    );

    expect(html).toContain('aria-valuenow="0"');
  });
});
