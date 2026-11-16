"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { AppIcon } from "@chemdft/ui";
import { loadProjectPreview, peekProjectPreview, type PreviewModel, type PreviewResult } from "@/lib/project-structure-preview";
import styles from "./structure-thumbnail.module.css";

/* One shared observer for every card: thumbnails load only when their card is near the viewport. */
let observer: IntersectionObserver | null = null;
const callbacks = new WeakMap<Element, () => void>();
function observe(node: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => {};
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        observer?.unobserve(entry.target);
        callbacks.delete(entry.target);
        callback?.();
      }
    },
    { rootMargin: "240px 0px" },
  );
  callbacks.set(node, onVisible);
  observer.observe(node);
  return () => {
    callbacks.delete(node);
    observer?.unobserve(node);
  };
}

/** Attach `ref` to the card (or row); the preview is requested once, when it approaches the viewport. */
export function useProjectPreview(projectId: string): { ref: (node: Element | null) => void; result: PreviewResult | undefined } {
  const [node, setNode] = useState<Element | null>(null);
  const [result, setResult] = useState<PreviewResult | undefined>(() => peekProjectPreview(projectId));
  useEffect(() => {
    if (result || !node) return;
    let live = true;
    const stop = observe(node, () => {
      void loadProjectPreview(projectId).then((loaded) => {
        if (live) setResult(loaded);
      });
    });
    return () => {
      live = false;
      stop();
    };
  }, [node, projectId, result]);
  return { ref: setNode, result };
}

export function FormulaText({ formula }: { formula: string }): ReactNode {
  const parts: ReactNode[] = [];
  for (const match of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    parts.push(match[1]);
    if (match[2]) parts.push(<sub key={parts.length}>{match[2]}</sub>);
  }
  return <>{parts}</>;
}

export function previewDescription(result: PreviewResult | undefined): string {
  switch (result?.status) {
    case "ready":
      return `${result.model.structureName}, ${result.model.formula}, ${result.model.atomCount} atoms; latest committed structure version ${result.model.revision}.`;
    case "none":
      return "No committed structure yet.";
    case "large":
      return `${result.structureName}, ${result.formula}, ${result.atomCount} atoms; too large for a thumbnail.`;
    case "unavailable":
      return "Structure preview unavailable.";
    default:
      return "Loading structure preview.";
  }
}

function tint(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function Drawing({ model }: { model: PreviewModel }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const colors = [...new Map(model.atoms.map((atom) => [atom.element, atom.color])).entries()];
  return (
    <svg viewBox="-50 -50 100 100" focusable="false" aria-hidden="true">
      <defs>
        {colors.map(([element, color]) => (
          <radialGradient key={element} id={`${uid}-${element}`} cx="0.36" cy="0.3" r="0.8">
            <stop offset="0" stopColor={tint(color, 255, 0.55)} />
            <stop offset="0.55" stopColor={color} />
            <stop offset="1" stopColor={tint(color, 0, 0.32)} />
          </radialGradient>
        ))}
      </defs>
      <g stroke="#18212b" strokeOpacity="0.38" strokeWidth="0.7" strokeLinecap="round" fill="none">
        {model.cell.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </g>
      <g strokeLinecap="round">
        {model.bonds.map((s, i) => (
          <g key={i}>
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#8795a3" strokeWidth="2" />
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6" />
          </g>
        ))}
      </g>
      {model.atoms.map((atom, i) => (
        <circle
          key={i}
          cx={atom.x}
          cy={atom.y}
          r={atom.r}
          fill={`url(#${uid}-${atom.element})`}
          stroke={tint(atom.color, 0, 0.45)}
          strokeOpacity="0.55"
          strokeWidth="0.4"
        />
      ))}
    </svg>
  );
}

/** The decorative, view-only drawing for one project. Always occupies the same box so cards never shift. */
export function StructureThumb({ result, size = "card" }: { result: PreviewResult | undefined; size?: "card" | "row" | "panel" | "fill" }) {
  const label = previewDescription(result);
  let body: ReactNode;
  switch (result?.status) {
    case "ready":
      body = <Drawing model={result.model} />;
      break;
    case "none":
      body = (
        <span className={styles.placeholder}>
          <AppIcon icon="cube" />
          {size === "card" ? <span>No committed structure</span> : null}
        </span>
      );
      break;
    case "large":
      body = (
        <span className={styles.placeholder}>
          <AppIcon icon="cube" />
          {size === "card" ? <span>{result.atomCount} atoms</span> : null}
        </span>
      );
      break;
    case "unavailable":
      body = (
        <span className={styles.placeholder}>
          <AppIcon icon="offline" />
          {size === "card" ? <span>Preview unavailable</span> : null}
        </span>
      );
      break;
    default:
      body = null;
  }
  return (
    <span
      className={styles.thumb}
      data-size={size}
      data-state={result?.status ?? "loading"}
      role="img"
      aria-label={label}
      aria-busy={result ? undefined : true}
    >
      {body}
    </span>
  );
}
