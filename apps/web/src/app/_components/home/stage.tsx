"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from "react";

import type { MolecularRendererProps } from "../molecular-renderer";
import type { Composition, Representation, RendererHandle } from "../molecular-renderer/types";
import { DEFAULT_STRUCTURE_ID, WATER_ID, homeStructure, type HomeStructure, type HomeStructureId } from "./structures";
import { StructureStatic } from "./structure-static";
import { PresentationTransaction } from "./presentation-transaction";
import { hasWebGL, useMediaQuery, usePrefersReducedMotion } from "./use-media";

/**
 * Shared state of the one persistent 3D stage that spans the hero (Act I) and the process story (Act II). The page
 * chooses *which* authoritative structure to show and *how* (representation, camera, composition); it never touches
 * coordinates. The WebGL renderer is the same `MolecularRenderer` the product uses, loaded after hydration.
 */
export type ProcessStep = { representation: Representation; labels: boolean };
type Bundle = { key: string; entry: HomeStructure; representation: Representation; processing: boolean };
const bundle = (entry: HomeStructure, representation: Representation, processing: boolean): Bundle => ({ key: `${entry.id}:${representation}:${processing ? "run" : "reference"}`, entry, representation, processing });

type StageContextValue = {
  selectedId: HomeStructureId;
  select: (id: HomeStructureId) => void;
  /** The structure the stage shows: the visitor's pick, or water while the process story runs. */
  entry: HomeStructure;
  representation: Representation;
  setRepresentation: (representation: Representation) => void;
  phase: "settled" | "out" | "fitting" | "in";
  presentationKey: string;
  presented: (key: string) => void;
  ready: boolean;
  webgl: boolean;
  desktop: boolean;
  reducedMotion: boolean;
  paused: boolean;
  togglePaused: () => void;
  processing: boolean;
  step: ProcessStep | null;
  /** Called by the renderer once it is drawing: records its handle and switches the page from the illustration to the scene. */
  attach: (api: RendererHandle) => void;
  /** Called by the scroll choreography: show water in the given step, or null to return to the visitor's pick. */
  setProcess: (step: ProcessStep | null) => void;
  handle: RefObject<RendererHandle | null>;
  stageRef: RefObject<HTMLDivElement | null>;
};

const StageContext = createContext<StageContextValue | null>(null);
export const useStage = (): StageContextValue => {
  const value = useContext(StageContext);
  if (!value) throw new Error("useStage must be used inside <StageProvider>");
  return value;
};

/** Where the structure sits on the canvas. The hero keeps the left half for the text; the process story shifts it right. */
export const COMPOSITIONS = {
  explore: { offsetX: 0.215, offsetY: -0.025, regionWidth: 0.58, regionHeight: 0.88 },
  process: { offsetX: 0.025, offsetY: 0.01, regionWidth: 0.37, regionHeight: 0.7 },
  mobile: { offsetX: 0, offsetY: 0, regionWidth: 0.94, regionHeight: 0.9 },
} as const satisfies Record<string, Composition>;

export function StageProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<HomeStructureId>(DEFAULT_STRUCTURE_ID);
  const [remembered, setRemembered] = useState<Partial<Record<HomeStructureId, Representation>>>({});
  const [processStep, setProcessStep] = useState<ProcessStep | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(true);
  const [transaction] = useState(() => {
    const first = homeStructure(DEFAULT_STRUCTURE_ID);
    return new PresentationTransaction(bundle(first, first.defaultRepresentation, false));
  });
  const display = useSyncExternalStore(transaction.subscribe, transaction.getSnapshot, transaction.getSnapshot);
  const [webgl, setWebgl] = useState(false);
  const handle = useRef<RendererHandle | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const desktop = useMediaQuery("(min-width: 1000px)");

  const target = useMemo(() => {
    const processing = processStep !== null;
    const entry = homeStructure(processing ? WATER_ID : selectedId);
    return bundle(entry, processStep?.representation ?? remembered[selectedId] ?? entry.defaultRepresentation, processing);
  }, [processStep, selectedId, remembered]);
  useEffect(() => {
    transaction.request(target, reducedMotion || !ready);
  }, [transaction, target, reducedMotion, ready]);
  useEffect(() => () => {
    transaction.cancel();
    const diagnostics = window as unknown as { __chemdftRenderer?: RendererHandle };
    if (diagnostics.__chemdftRenderer === handle.current) delete diagnostics.__chemdftRenderer;
    handle.current = null;
  }, [transaction]);
  const { entry, representation, processing } = display.displayed;
  const presentationKey = `${display.displayed.key}:${display.revision}`;
  const presented = useCallback((key: string) => {
    const snapshot = transaction.getSnapshot();
    if (key === `${snapshot.displayed.key}:${snapshot.revision}`) transaction.presented(snapshot.displayed.key, snapshot.revision);
  }, [transaction]);

  useEffect(() => {
    // 3D only when WebGL exists and the visitor has not asked to save data; otherwise the static illustration stays.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const supported = hasWebGL() && !connection?.saveData;
    const timer = window.setTimeout(() => setWebgl(supported), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const select = useCallback((id: HomeStructureId) => setSelectedId(id), []);
  const attach = useCallback((api: RendererHandle) => {
    handle.current = api;
    // development/test builds expose the handle so tests can verify what is actually drawn; production never does
    if (process.env.NODE_ENV !== "production") (window as unknown as { __chemdftRenderer?: RendererHandle }).__chemdftRenderer = api;
    setReady(true);
  }, []);
  const setRepresentation = useCallback((next: Representation) => {
    if (entry.representations.includes(next)) setRemembered((current) => ({ ...current, [entry.id]: next }));
  }, [entry]);
  const togglePaused = useCallback(() => setPaused((value) => !value), []);

  const value = useMemo<StageContextValue>(
    () => ({ selectedId, select, entry, representation, setRepresentation, phase: display.phase, presentationKey, presented, ready, webgl, desktop, reducedMotion, paused, togglePaused, processing, step: processStep, attach, setProcess: setProcessStep, handle, stageRef }),
    [selectedId, select, entry, representation, setRepresentation, display.phase, presentationKey, presented, ready, webgl, desktop, reducedMotion, paused, togglePaused, processing, processStep, attach],
  );

  return (
    <StageContext.Provider value={value}>{children}</StageContext.Provider>
  );
}

/** The sticky stage content: the server-rendered illustration first, the WebGL scene once it is ready. */
export function StageCanvas() {
  const stage = useStage();
  const { entry, representation, desktop, reducedMotion, webgl, ready, paused, processing, step, attach, stageRef, phase, presentationKey, presented } = stage;
  const [Renderer, setRenderer] = useState<ComponentType<MolecularRendererProps> | null>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    if (!webgl) return;
    let cancelled = false;
    const load = () => {
      void import("../molecular-renderer/MolecularRenderer").then((module) => {
        if (!cancelled) setRenderer(() => module.default as ComponentType<MolecularRendererProps>);
      });
    };
    const browser: { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void } = window;
    const idle = browser.requestIdleCallback;
    const handleId = idle ? idle.call(window, load, { timeout: 1200 }) : window.setTimeout(load, 250);
    return () => {
      cancelled = true;
      if (idle) browser.cancelIdleCallback?.(handleId);
      else window.clearTimeout(handleId);
    };
  }, [webgl]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([record]) => setInView(Boolean(record?.isIntersecting)), { rootMargin: "120px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [stageRef]);


  // the composition is a presentation value: the camera rig eases to it whenever it changes, nothing is remounted
  const composition = desktop ? (processing ? COMPOSITIONS.process : COMPOSITIONS.explore) : COMPOSITIONS.mobile;

  const autoRotate = ready && inView && !reducedMotion && !paused && !processing;
  const label = `${entry.name}, ${entry.formula.replaceAll(/(\d+)/g, " $1 ").trim()}. ${entry.kindLabel}. ${entry.description} Drag to rotate; arrow keys rotate, plus and minus zoom, 0 resets.`;

  return (
    <div ref={stageRef} className="stage-canvas" data-ready={ready} data-structure={entry.id} data-phase={phase} data-context={processing ? "stored-run" : "reference"} id="structure-stage">
      <div className="stage-visual">
      {ready ? null : (
        <div className="stage-static" data-region={desktop ? "explore" : "mobile"}>
          <StructureStatic entry={entry} id="stage-static" />
        </div>
      )}
      {Renderer ? (
        <Renderer
          structure={entry.structure}
          presentation={{
            representation,
            preset: "editorial",
            supercell: entry.supercell,
            showCell: true,
            labels: step?.labels ? "element" : "none",
            autoRotate,
          }}
          initialView={{ azimuth: entry.view.azimuth, polar: entry.view.polar }}
          style={{ background: "transparent" }}
          composition={composition}
          compact={!desktop}
          active={inView}
          maxDpr={desktop ? 1.75 : 1.5}
          minFramingRadius={processing ? 1.05 : (entry.view.minRadius ?? 1.8)}
          entrance={false}
          transition={false}
          presentationKey={presentationKey}
          immediatePresentation
          onPresented={presented}
          onReady={attach}
          ariaLabel={label}
        />
      ) : null}
      </div>
    </div>
  );
}

