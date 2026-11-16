"use client";

import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AppIcon } from "@chemdft/ui";
import type { MolecularRendererProps } from "../molecular-renderer";
import type { RendererHandle, ScientificStructure } from "../molecular-renderer/types";
import { elementDisplay } from "../molecular-renderer/elements";
import { hasWebGL, useMediaQuery, usePrefersReducedMotion } from "../home/use-media";
import styles from "./overview.module.css";

class RendererBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onFailure();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const FIT_MIN = 1;
const FIT_MAX = 2.2;
const TARGET_HEIGHT = 0.8;
const TARGET_WIDTH = 0.78;

function projectedBounds(handle: RendererHandle): { width: number; height: number } | null {
  const [x0, y0, x1, y1] = handle.framing().bounds as [number, number, number, number];
  if (!Number.isFinite(x1 - x0) || x1 - x0 < 0.01 || y1 - y0 < 0.01) return null; // not measured yet: never guess
  return { width: x1 - x0, height: y1 - y0 };
}

/**
 * A deterministic camera zoom that makes the drawn structure fill most of the viewport, found by closed-loop
 * measurement: wait until the renderer's own projected bounds of the real atoms stop changing, scale the zoom toward
 * the target fill, and repeat. It only changes the camera (coordinates, bonds and orientation are untouched), it
 * never zooms out below the renderer's default fit (so nothing large is clipped), and it settles before reporting.
 */
function fitCamera(api: RendererHandle, onFit: (zoom: number) => void): () => void {
  let timer = 0;
  let zoom = api.getView().zoom > 0 ? api.getView().zoom : 1;
  let last: { width: number; height: number } | null = null;
  let stable = 0;
  let iterations = 0;
  let tries = 0;
  const finish = () => onFit(zoom);
  // The renderer draws on demand, so the projected bounds are only fresh after a frame: ask for one, then read.
  const measure = () => {
    tries += 1;
    let bounds: { width: number; height: number } | null = null;
    try { bounds = projectedBounds(api); } catch { bounds = null; }
    if (bounds) {
      stable = last && Math.abs(bounds.height - last.height) < 0.01 && Math.abs(bounds.width - last.width) < 0.01 ? stable + 1 : 0;
      last = bounds;
      // A slow or busy page may never read three identical frames: after ~4 s act on the latest reading rather than stay unfitted.
      if (stable >= 3 || (tries >= 25 && tries % 5 === 0)) {
        const scale = Math.min(TARGET_HEIGHT / bounds.height, TARGET_WIDTH / bounds.width);
        const next = Math.min(FIT_MAX, Math.max(FIT_MIN, zoom * scale));
        if (Math.abs(scale - 1) < 0.04 || iterations >= 5 || Math.abs(next - zoom) < 0.01) { finish(); return; }
        zoom = next;
        api.setView({ zoom }, false);
        iterations += 1;
        stable = 0;
        last = null;
      }
    }
    if (tries < 120) request(); else finish();
  };
  const request = () => {
    try { api.zoomBy(1); } catch { /* the handle is gone */ }
    timer = window.setTimeout(measure, 110);
  };
  timer = window.setTimeout(request, 60);
  return () => window.clearTimeout(timer);
}

/**
 * Interactive 3D view of the committed coordinates, using the product's own renderer (the one the sealed examples and
 * the home page use). The renderer loads after hydration and only when WebGL is available and the viewer is on screen;
 * otherwise (or if it fails) the static drawing of the same coordinates stays in place. Rotation and zoom only move
 * the camera: geometry is never edited here.
 */
export function StructureViewer({ structure, fallback, name }: { structure: ScientificStructure; fallback: ReactNode; name: string }) {
  const [Renderer, setRenderer] = useState<ComponentType<MolecularRendererProps> | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [labels, setLabels] = useState(false);
  const handle = useRef<RendererHandle | null>(null);
  const fit = useRef(1);
  const [fill, setFill] = useState<{ zoom: number; width: number; height: number } | null>(null);
  const [initialZoom, setInitialZoom] = useState(1);
  const viewport = useRef<HTMLDivElement | null>(null);
  const compact = useMediaQuery("(max-width: 640px)");
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (!hasWebGL() || connection?.saveData) { queueMicrotask(() => setUnavailable(true)); return; }
    let cancelled = false;
    const load = () => {
      void import("../molecular-renderer/MolecularRenderer")
        .then((module) => { if (!cancelled) setRenderer(() => module.default as ComponentType<MolecularRendererProps>); })
        .catch(() => { if (!cancelled) setUnavailable(true); });
    };
    if (typeof IntersectionObserver === "undefined") { load(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { load(); observer.disconnect(); } }, { rootMargin: "120px" });
    if (viewport.current) observer.observe(viewport.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, []);

  // Keep the structure comfortably framed when the viewer is resized, unless the researcher has zoomed by hand.
  useEffect(() => {
    const node = viewport.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let debounce = 0;
    let cancelSettle: (() => void) | null = null;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        const api = handle.current;
        if (!api) return;
        try { if (Math.abs(api.getView().zoom - fit.current) > 1e-3) return; } catch { return; }
        cancelSettle?.();
        cancelSettle = fitCamera(api, (zoom) => {
          if (Math.abs(zoom - fit.current) > 1e-3) { fit.current = zoom; api.setView({ zoom }, false); }
          window.setTimeout(() => { try { const [x0, y0, x1, y1] = api.framing().bounds as [number, number, number, number]; setFill({ zoom, width: x1 - x0, height: y1 - y0 }); } catch { /* metrics are informational */ } }, 1200);
        });
      }, 150);
    });
    observer.observe(node);
    return () => { window.clearTimeout(debounce); cancelSettle?.(); observer.disconnect(); };
  }, []);

  const interactive = Renderer !== null && !unavailable;
  const elements = [...new Set(structure.sites.map((site) => site.element))];
  return (
    <div className={styles.viewer} data-testid="overview-viewer" data-mode={interactive && ready ? "interactive" : "static"} {...(fill ? { "data-fit-zoom": fill.zoom.toFixed(2), "data-fill-width": fill.width.toFixed(2), "data-fill-height": fill.height.toFixed(2) } : {})}>
      <div className={styles.viewport} ref={viewport}>
        {!(interactive && ready) ? <div className={styles.staticView}>{fallback}</div> : null}
        {interactive ? (
          <RendererBoundary onFailure={() => { setUnavailable(true); setReady(false); }}>
            <Renderer
              structure={structure}
              presentation={{ representation: "ball-stick", preset: "scientific", showCell: structure.kind === "periodic", labels: labels ? "element" : "none", autoRotate: false }}
              entrance={false}
              transition={false}
              compact={compact}
              ambientOcclusion={false}
              keyboard
              measureFrame
              ariaLabel={`${name}: interactive 3D view of the committed coordinates. Drag to rotate; arrow keys rotate, plus and minus zoom, zero resets.`}
              initialView={{ zoom: initialZoom }}
              onReady={(api) => {
                handle.current = api;
                setReady(true);
                const apply = (zoom: number) => {
                  fit.current = zoom;
                  setInitialZoom(zoom);
                  api.setView({ zoom }, false);
                  // The camera eases toward the fitted zoom; read the settled bounds for the (informational) fill metrics.
                  window.setTimeout(() => { try { const [x0, y0, x1, y1] = api.framing().bounds as [number, number, number, number]; setFill({ zoom, width: x1 - x0, height: y1 - y0 }); } catch { /* metrics are informational */ } }, 1200);
                };
                // A second, confirming pass once the first has settled corrects any reading taken on a busy frame.
                fitCamera(api, (first) => {
                  apply(first);
                  window.setTimeout(() => { if (Math.abs(api.getView().zoom - fit.current) < 1e-3) fitCamera(api, apply); }, 1500);
                });
              }}
              {...(reduceMotion ? { immediatePresentation: true } : {})}
            />
          </RendererBoundary>
        ) : null}
      </div>
      <div className={styles.viewerBar}>
        <ul className={styles.legend} aria-label="Elements shown">
          {elements.map((element) => (
            <li key={element}><span aria-hidden="true" style={{ background: elementDisplay(element).color }} />{element}</li>
          ))}
        </ul>
        <label className={styles.viewerCheck}>
          <input type="checkbox" checked={labels} disabled={!(interactive && ready)} onChange={(event) => setLabels(event.currentTarget.checked)} />
          Labels
        </label>
        <div className={styles.viewerButtons}>
          <button type="button" className="bp6-button bp6-minimal" disabled={!(interactive && ready)} onClick={() => handle.current?.zoomBy(1.25)} aria-label="Zoom in"><AppIcon icon="zoom-in" /></button>
          <button type="button" className="bp6-button bp6-minimal" disabled={!(interactive && ready)} onClick={() => handle.current?.zoomBy(0.8)} aria-label="Zoom out"><AppIcon icon="zoom-out" /></button>
          <button type="button" className="bp6-button bp6-minimal" disabled={!(interactive && ready)} onClick={() => { handle.current?.resetView(false); handle.current?.setView({ zoom: fit.current }, false); }}>Reset view</button>
        </div>
      </div>
      <p className={styles.caption}>
        {interactive && ready ? "Drag to rotate · zoom with the buttons or the + / − keys · arrow keys rotate · 0 resets." : unavailable ? "Interactive 3D view is unavailable here; showing a static view of the committed coordinates." : "Loading the interactive 3D view; a static view of the committed coordinates is shown meanwhile."}
      </p>
    </div>
  );
}
