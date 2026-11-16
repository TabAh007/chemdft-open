"use client";

import type { ReactNode } from "react";

import { ATOM_CHIPS, GROUP_CHIPS, MORE_TOOLS, TOOLBAR_GROUPS, tooltipFor, type GlyphId, type ToolbarItem } from "@/lib/molecule-editor/toolbar";
import { editorText } from "@/lib/molecule-editor/strings";
import { PopMenu } from "./molecule-editor-menu";
import styles from "./molecule-editor.module.css";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function glyphPaths(id: GlyphId): ReactNode {
  switch (id) {
    case "select": return <path {...stroke} d="M6 3l12 8-5.2 1.3L15.5 19l-2.4 1-2.7-6.6L6 17z" />;
    case "erase": return <path {...stroke} d="M8 19h11M5.5 13.5l7-7a2 2 0 013 0l3 3a2 2 0 010 3L11.5 19H8l-2.5-2.5a2 2 0 010-3z" />;
    case "single": return <path {...stroke} d="M5 19L19 5" />;
    case "double": return <path {...stroke} d="M3.6 17.4L17.4 3.6M7.6 21.4L21.4 7.6" />;
    case "triple": return <path {...stroke} d="M2.2 15.8L15.8 2.2M6 19.8L19.8 6M9.8 23.6L23.6 9.8" />;
    case "wedge": return <path d="M5 19L19 5l1 6z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />;
    case "hash": return <path {...stroke} strokeWidth={1.6} d="M5 19L6.5 17.5M8 16l2-2M11 13l2.6-2.6M14 10l3-3M17 7l2.4-2.4" />;
    case "benzene": return <g><path {...stroke} d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" /><circle cx="12" cy="12" r="3.6" {...stroke} /></g>;
    case "ring6": return <path {...stroke} d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />;
    case "ring5": return <path {...stroke} d="M12 3.8l8 5.8-3 9.4H7l-3-9.4z" />;
    case "chain": return <path {...stroke} d="M3 16l4.5-8 4.5 8 4.5-8L21 16" />;
    case "plus": return <path {...stroke} d="M12 5v14M5 12h14" />;
    case "minus": return <path {...stroke} d="M5 12h14" />;
    case "undo": return <path {...stroke} d="M9 7L4.5 11.5 9 16M5 11.5h9a5 5 0 010 10h-3" transform="translate(0 -3)" />;
    case "redo": return <path {...stroke} d="M15 7l4.5 4.5L15 16M19 11.5h-9a5 5 0 000 10h3" transform="translate(0 -3)" />;
    case "cleanup": return <path {...stroke} d="M4 20l9-9M12 4l1.2 2.4L15.6 7.6 13.2 8.8 12 11.2 10.8 8.8 8.4 7.6l2.4-1.2zM18 12l.8 1.6L20.4 14.4l-1.6.8L18 16.8l-.8-1.6-1.6-.8 1.6-.8z" />;
    case "rotate": return <path {...stroke} d="M19 12a7 7 0 11-2.1-5M19 4v4h-4" />;
    case "flip": return <path {...stroke} d="M12 3v18M8 7L3.5 17H8zM16 7l4.5 10H16z" />;
    case "addh": return <g><text x="3" y="17" fontSize="13" fontWeight="700" fill="currentColor" fontFamily="inherit">H</text><path {...stroke} d="M17 6v8M13 10h8" /></g>;
    case "properties": return <path {...stroke} d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" />;
    case "more": return <path {...stroke} d="M5 8h14M5 12h14M5 16h14" />;
  }
}

export function Glyph({ id }: { id: GlyphId }) {
  return <svg className={styles.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{glyphPaths(id)}</svg>;
}

export function ToolButton({ item, active, disabled, onActivate }: { item: ToolbarItem; active: boolean; disabled?: boolean; onActivate: (item: ToolbarItem) => void }) {
  return (
    <button
      type="button"
      className={`${styles.tool}${active ? ` ${styles.toolActive}` : ""}`}
      // Selectable tools are toggle buttons; one-shot actions have no pressed state.
      {...(item.sticky ? { "aria-pressed": active } : {})}
      aria-label={item.title}
      title={tooltipFor(item)}
      disabled={disabled}
      data-testid={`tool-${item.id}`}
      onClick={() => onActivate(item)}
    >
      <Glyph id={item.glyph} />
      <span className={styles.toolLabel}>{item.label}</span>
    </button>
  );
}

export function EditorToolbar({
  activeItem,
  ready,
  canUndo,
  canRedo,
  onActivate,
  onNative,
}: {
  activeItem: string | null;
  ready: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onActivate: (item: ToolbarItem) => void;
  onNative: (testId: string) => void;
}) {
  // A vertical rail beside the canvas: two columns of icon + label buttons; group headings are thin dividers (and group labels for assistive tech).
  return (
    <div className={styles.toolRail} role="toolbar" aria-orientation="vertical" aria-label={editorText.toolbar} data-testid="editor-toolbar">
      {TOOLBAR_GROUPS.map((group) => (
        <div key={group.id} className={styles.group} role="group" aria-label={group.label} title={group.label} data-testid={`toolbar-group-${group.id}`}>
          <div className={styles.groupButtons}>
            {group.items.map((item) => (
              <ToolButton
                key={item.id}
                item={item}
                active={item.sticky && activeItem === item.id}
                disabled={!ready || (item.id === "undo" && !canUndo) || (item.id === "redo" && !canRedo)}
                onActivate={onActivate}
              />
            ))}
            {group.id === "analyze" ? (
              <PopMenu
                label={editorText.moreTools}
                glyph={<Glyph id="more" />}
                disabled={!ready}
                testId="tool-more-tools"
                items={MORE_TOOLS.map((tool) => ({ id: tool.id, label: tool.label, onSelect: () => onNative(tool.testId) }))}
                variant="tool"
                side
              />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AtomsRail({ activeItem, ready, onAtom, onGroup, onNative }: {
  activeItem: string | null;
  ready: boolean;
  onAtom: (item: string, testId: string) => void;
  onGroup: (item: string, molfile: string) => void;
  onNative: (testId: string) => void;
}) {
  return (
    <div className={styles.atomRail} data-testid="editor-atoms-row">
      <span className={styles.rowLabel} id="editor-atoms-label">{editorText.atoms}</span>
      <div className={styles.chipGrid} role="group" aria-labelledby="editor-atoms-label">
        {ATOM_CHIPS.map((atom) => (
          <button
            key={atom.id}
            type="button"
            className={`${styles.atomChip}${activeItem === atom.id ? ` ${styles.atomChipActive}` : ""}`}
            style={{ color: atom.color }}
            aria-pressed={activeItem === atom.id}
            title={`${atom.title} atom`}
            disabled={!ready}
            data-testid={`atom-${atom.symbol}`}
            onClick={() => onAtom(atom.id, atom.testId)}
          >
            {atom.symbol}
          </button>
        ))}
      </div>
      <button type="button" className={`${styles.textButton} ${styles.railButton}`} disabled={!ready} title="Open Ketcher's periodic table" data-testid="atom-periodic-table" onClick={() => onNative("period-table")}>
        {editorText.periodicTable}
      </button>
      <span className={styles.railRule} aria-hidden="true" />
      <span className={styles.rowLabel} id="editor-groups-label">{editorText.groups}</span>
      <div className={styles.chipGrid} role="group" aria-labelledby="editor-groups-label">
        {GROUP_CHIPS.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`${styles.atomChip} ${styles.groupChip}${activeItem === group.id ? ` ${styles.atomChipActive}` : ""}`}
            aria-pressed={activeItem === group.id}
            aria-label={group.title}
            title={`${group.title}: click an atom to attach it`}
            disabled={!ready}
            data-testid={`group-${group.id}`}
            onClick={() => onGroup(group.id, group.molfile)}
          >
            {group.label}
          </button>
        ))}
      </div>
      <button type="button" className={`${styles.textButton} ${styles.railButton}`} disabled={!ready} title="Open Ketcher's structure library" data-testid="group-more" onClick={() => onNative("template-lib")}>
        {editorText.moreGroups}
      </button>
    </div>
  );
}
