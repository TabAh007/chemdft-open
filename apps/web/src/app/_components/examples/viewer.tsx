"use client";
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ExampleDetail } from "@chemdft/schemas";
import type { Locale } from "@chemdft/i18n";
import { buildScientificScene } from "@chemdft/scientific-scene";
import { structureFromScene } from "../molecular-renderer/structures/from-scene";
import { deriveGeometry } from "../molecular-renderer/derive";
import { representationStyle } from "../molecular-renderer/radii";
import { elementDisplay } from "../molecular-renderer/elements";
import { CR2O3_STRUCTURE } from "../molecular-renderer/structures/cr2o3";
import type { MolecularRendererProps } from "../molecular-renderer";
import type {
  PresetId,
  RendererHandle,
  Representation,
  Supercell,
} from "../molecular-renderer/types";
import {
  availableRepresentations,
  REPRESENTATION_LABELS,
} from "../molecular-renderer/capabilities";
import { StructureStatic } from "../home/structure-static";
import { HOME_STRUCTURES } from "../home/structures";
import { hasWebGL, useMediaQuery } from "../home/use-media";
import { exampleMessage } from "@/lib/example-messages";
import styles from "./examples.module.css";

class RendererBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ExampleViewer({
  detail,
  locale,
}: {
  detail: ExampleDetail;
  locale: Locale;
}) {
  const [Renderer, setRenderer] =
    useState<ComponentType<MolecularRendererProps> | null>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [representation, setRepresentation] =
    useState<Representation>("ball-stick");
  const [extent, setExtent] = useState("1x1x1");
  const [preset, setPreset] = useState<PresetId>("scientific");
  const [labels, setLabels] = useState(false);
  const [cell, setCell] = useState(detail.example.type === "crystal");
  const handle = useRef<RendererHandle | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const compact = useMediaQuery("(max-width: 640px)");
  const t = (key: string) => exampleMessage(locale, key);
  const structure = useMemo(() => {
    const scene = buildScientificScene(detail.structure);
    const base = structureFromScene(scene, {
      title: detail.example.title,
      provenance: {
        kind: "stored-structure-version",
        label: "Sealed reference structure",
        source: {
          name: detail.example.source,
          id: detail.example.source_identifier,
          url: detail.example.source_url,
          citation: detail.example.citation,
          licence: detail.example.reuse_basis,
        },
      },
    });
    // Reuse the vetted COD presentation rules only. Coordinates always come from the sealed project.
    return detail.example.slug === "cr2o3-eskolaite"
      ? {
          ...base,
          formula: detail.example.formula,
          displayBondRule: CR2O3_STRUCTURE.displayBondRule!,
          coordinationRules: CR2O3_STRUCTURE.coordinationRules!,
          oxidationStates: CR2O3_STRUCTURE.oxidationStates!,
        }
      : base;
  }, [detail]);
  const radiusModel = useMemo(
    () =>
      representationStyle(
        structure,
        representation,
        deriveGeometry(structure, [1, 1, 1]).coordination,
      ).model,
    [structure, representation],
  );
  const supercell = extent.split("x").map(Number) as unknown as Supercell;
  const home = HOME_STRUCTURES.find(
    (entry) =>
      entry.id ===
      (detail.example.slug === "cr2o3-eskolaite"
        ? "cr2o3"
        : detail.example.slug === "benzene"
          ? "c6h6"
          : "c8h10n4o2"),
  )!;
  const staticView = (
    <StructureStatic
      entry={{ ...home, structure, supercell }}
      showCell={cell}
      id={`sealed-${detail.example.slug}`}
    />
  );
  useEffect(() => {
    let cancelled = false;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    const load = () => {
      if (!hasWebGL() || connection?.saveData) {
        setFallback(true);
        return;
      }
      void import("../molecular-renderer/MolecularRenderer")
        .then((module) => {
          if (!cancelled) setRenderer(() => module.default);
        })
        .catch(() => {
          if (!cancelled) setFallback(true);
        });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          load();
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const launch = (event: Event) => {
      const requested = (event as CustomEvent<{ slug: string; launch: string }>)
        .detail;
      if (requested.slug !== detail.example.slug) return;
      if (requested.launch === "cell") {
        setRepresentation("unit-cell");
        setCell(true);
        setExtent("1x1x1");
      }
      if (requested.launch === "supercell") {
        setExtent("2x2x1");
        setCell(true);
      }
    };
    window.addEventListener("chemdft:example-view", launch);
    return () => window.removeEventListener("chemdft:example-view", launch);
  }, [detail.example.slug]);
  return (
    <section id="structure" className={styles.viewer} aria-label={t("view")}>
      <div
        className={styles.viewport}
        ref={viewport}
        data-testid="example-viewport"
      >
        {(!ready || fallback) && (
          <div className={styles.static}>{staticView}</div>
        )}
        {Renderer && !fallback && (
          <RendererBoundary
            fallback={
              <>
                {staticView}
                <p role="status">{t("fallback")}</p>
              </>
            }
          >
            <Renderer
              structure={structure}
              presentation={{
                representation,
                preset,
                supercell,
                showCell: cell,
                labels: labels ? "element" : "none",
                autoRotate: false,
              }}
              entrance={false}
              transition={false}
              compact={compact}
              ambientOcclusion={false}
              ariaLabel={`${detail.example.title}. ${t("help")}`}
              onReady={(api) => {
                handle.current = api;
                setReady(true);
              }}
            />
          </RendererBoundary>
        )}
      </div>
      <ul className={styles.legend} aria-label={t("legend")}>
        {[...new Set(structure.sites.map((site) => site.element))].map(
          (element) => (
            <li key={element}>
              <span
                aria-hidden="true"
                style={{ background: elementDisplay(element).color }}
              />
              {element}
            </li>
          ),
        )}
      </ul>
      <div className={styles.viewControls}>
        <label>
          {t("representation")}
          <select
            disabled={fallback}
            value={representation}
            onChange={(event) =>
              setRepresentation(event.currentTarget.value as Representation)
            }
          >
            {availableRepresentations(structure).map((rep) => (
              <option value={rep} key={rep}>
                {REPRESENTATION_LABELS[rep]}
              </option>
            ))}
          </select>
        </label>
        {structure.lattice && (
          <label>
            {t("extent")}
            <select
              value={extent}
              onChange={(event) => setExtent(event.currentTarget.value)}
            >
              <option value="1x1x1">1×1×1</option>
              <option value="2x2x1">2×2×1</option>
              <option value="2x2x2">2×2×2</option>
            </select>
          </label>
        )}
        <label>
          {t("preset")}
          <select
            disabled={fallback}
            value={preset}
            onChange={(event) =>
              setPreset(event.currentTarget.value as PresetId)
            }
          >
            <option value="scientific">Scientific</option>
            <option value="publication">Publication</option>
          </select>
        </label>
        {structure.lattice && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={cell}
              onChange={(event) => setCell(event.currentTarget.checked)}
            />
            {t("cell")}
          </label>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            disabled={fallback}
            checked={labels}
            onChange={(event) => setLabels(event.currentTarget.checked)}
          />
          {t("labels")}
        </label>
        <button
          type="button"
          className="bp6-button bp6-minimal"
          disabled={!ready || fallback}
          onClick={() => handle.current?.resetView(false)}
        >
          {t("reset")}
        </button>
      </div>
      <p className={styles.caption} data-testid="example-radius-model">
        {fallback ? (
          t("staticRadius")
        ) : (
          <>
            {radiusModel.label} · {radiusModel.citation}
          </>
        )}
      </p>
      {(structure.displayBondRule || structure.inferredBonds) && (
        <p className={styles.caption}>
          {structure.displayBondRule?.label ?? structure.inferredBonds?.label}
        </p>
      )}
      <p className={styles.caption}>{fallback ? t("fallback") : t("help")}</p>
      {representation === "polyhedra" && (
        <p className={styles.caption} role="status">
          {t("polyhedra")}
        </p>
      )}
      <details className={styles.coordinates}>
        <summary>{t("coordinates")}</summary>
        <p>{t("coordinatesNote")}</p>
        <table>
          <caption>
            {detail.structure.version.coordinates?.coordinate_system} ·{" "}
            {detail.structure.version.coordinates?.unit}
          </caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Element</th>
              <th scope="col">x</th>
              <th scope="col">y</th>
              <th scope="col">z</th>
            </tr>
          </thead>
          <tbody>
            {detail.structure.version.coordinates?.atoms.map((atom) => (
              <tr key={atom.index}>
                <td>{atom.index}</td>
                <td>{atom.element}</td>
                <td>{atom.x.toFixed(5)}</td>
                <td>{atom.y.toFixed(5)}</td>
                <td>{atom.z.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
