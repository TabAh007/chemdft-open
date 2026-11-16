import type { ReactNode } from "react";
import type { StartingPathId } from "@/lib/onboarding-flow";
import { staticProjection } from "../home/static-projection";
import { formulaParts, homeStructure, type HomeStructureId } from "../home/structures";
import { deriveGeometry } from "../molecular-renderer/derive";
import { elementDisplay } from "../molecular-renderer/elements";

/**
 * Plate illustrations for the onboarding paths. One drawing language on a 240 × 120 plate: white instrument panels with a
 * soft contact shadow, hairline strokes, shaded spheres, the ChemDFT blue as the only strong colour and the existing
 * phase-orange token for "measured" traces. They are decorative (aria-hidden) and honest about what they are:
 *  - molecules and library tiles project the repository's own reference geometries (PubChem benzene and caffeine,
 *    COD Cr₂O₃) through the same derivation the homepage renderer uses, so no coordinate is invented here;
 *  - every curve, stick set and document line is abstract: no axis values, no numerals, no data.
 * Server components; nothing here ships to the client bundle.
 */

const INK = "#18212b";
const SOFT = "var(--cdf-line-strong)";
const LINE = "var(--cdf-line)";
const ACCENT = "var(--cdf-accent)";
const ACCENT_DEEP = "var(--cdf-accent-hover)";
const TINT = "var(--cdf-accent-soft)";
const MEASURED = "var(--cdf-phase-negative)";
const SURFACE = "var(--cdf-surface)";
const INDIGO = "var(--ob-indigo)";
const INDIGO_LINE = "var(--ob-indigo-line)";

/* ------------------------------------------------------------------ plate */

function Art({ uid, children }: { uid: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 120" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">
      <defs>
        <filter id={`${uid}-lift`} x="-25%" y="-20%" width="150%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.4" floodColor={INK} floodOpacity="0.13" />
        </filter>
        <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1565a7" stopOpacity="0.24" />
          <stop offset="1" stopColor="#1565a7" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-blue`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a7bc0" />
          <stop offset="1" stopColor="#0f548d" />
        </linearGradient>
        <linearGradient id={`${uid}-indigo`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6772c6" />
          <stop offset="1" stopColor="#434c9c" />
        </linearGradient>
      </defs>
      {children}
    </svg>
  );
}

const lift = (uid: string) => `url(#${uid}-lift)`;

/* ------------------------------------------------------------------ real structures */

function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

type Pose = { readonly yaw: number; readonly pitch: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pixels per ångström of a glyph drawn into a `span` box (orthographic, so the 1 Å scale bar is true in the view plane). */
export function glyphScale(id: HomeStructureId, span: number): number {
  const geometry = deriveGeometry(homeStructure(id).structure, [1, 1, 1]);
  return span / 2 / (Math.max(geometry.bounds.horizontalRadius, geometry.bounds.halfHeight) + 0.6);
}

/** A shaded ball-and-stick view of a stored reference structure, centred on (cx, cy) inside a `span` box. */
export function StructureGlyph({
  uid,
  id,
  cx,
  cy,
  span,
  pose,
  detail = 1,
}: {
  uid: string;
  id: HomeStructureId;
  cx: number;
  cy: number;
  span: number;
  pose: Pose;
  detail?: number;
}) {
  const geometry = deriveGeometry(homeStructure(id).structure, [1, 1, 1]);
  const scale = glyphScale(id, span);
  const project = (p: readonly [number, number, number]) => {
    const q = staticProjection(p, geometry.bounds.center, pose.yaw, pose.pitch);
    return { x: q.x * scale, y: q.y * scale, depth: q.depth };
  };
  const radius = (element: string) => 0.56 * Math.pow(elementDisplay(element).covalentRadius, 0.6) * scale * 0.95;
  const atoms = geometry.atoms
    .filter((atom) => atom.role !== "polyhedron-image")
    .map((atom) => ({ atom, v: project(atom.position) }))
    .sort((a, b) => a.v.depth - b.v.depth);
  const bonds = geometry.bonds.filter((bond) => !bond.polyhedraOnly);
  const elements = [...new Set(atoms.map(({ atom }) => atom.element))];
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <defs>
        {elements.map((element) => {
          const base = elementDisplay(element).color;
          return (
            <radialGradient key={element} id={`${uid}-${element}`} cx="0.36" cy="0.3" r="0.8">
              <stop offset="0" stopColor={mix(base, 255, 0.55)} />
              <stop offset="0.55" stopColor={base} />
              <stop offset="1" stopColor={mix(base, 0, 0.32)} />
            </radialGradient>
          );
        })}
      </defs>
      <g strokeLinecap="round">
        {bonds.map((bond, i) => {
          const a = project(geometry.atoms[bond.a]!.position);
          const b = project(geometry.atoms[bond.b]!.position);
          const pts = { x1: r2(a.x), y1: r2(a.y), x2: r2(b.x), y2: r2(b.y) };
          return (
            <g key={i}>
              <line {...pts} stroke="#8795a3" strokeWidth={r2(3 * detail)} />
              <line {...pts} stroke="#fff" strokeOpacity="0.5" strokeWidth={r2(0.9 * detail)} />
            </g>
          );
        })}
      </g>
      {atoms.map(({ atom, v }, i) => {
        const r = radius(atom.element);
        return (
          <circle
            key={i}
            cx={r2(v.x)}
            cy={r2(v.y)}
            r={r2(r)}
            fill={`url(#${uid}-${atom.element})`}
            stroke={mix(elementDisplay(atom.element).color, 0, 0.45)}
            strokeOpacity="0.55"
            strokeWidth={r > 2 ? 0.6 : 0.3}
          />
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ schematic spectra */

type Peak = { readonly x: number; readonly h: number; readonly w: number };

/** Sum of Lorentzians as an SVG path. Purely schematic; peak positions and heights carry no value. */
function trace(peaks: readonly Peak[], baseline: number, x0: number, x1: number, shift = 0, scale = 1): string {
  const points: string[] = [];
  for (let x = x0; x <= x1; x += 1) {
    let y = 0;
    for (const p of peaks) {
      const d = (x - (p.x + shift)) / p.w;
      y += (p.h * scale) / (1 + d * d);
    }
    points.push(`${x === x0 ? "M" : "L"}${x} ${Math.round((baseline - y) * 10) / 10}`);
  }
  return points.join(" ");
}

const SPECTRUM: readonly Peak[] = [
  { x: 74, h: 34, w: 4.4 },
  { x: 108, h: 64, w: 4.8 },
  { x: 142, h: 26, w: 4 },
  { x: 168, h: 44, w: 4.6 },
];

const ALIGNED: readonly Peak[] = [
  { x: 66, h: 26, w: 4.4 },
  { x: 104, h: 38, w: 4.8 },
  { x: 142, h: 20, w: 4 },
  { x: 176, h: 31, w: 4.6 },
];

/* ------------------------------------------------------------------ the six plates */

export function MoleculeArt({ v = "" }: { v?: string }) {
  return (
    <Art uid={`mol${v}`}>
      <StructureGlyph uid={`mol${v}`} id="c6h6" cx={120} cy={60} span={146} pose={{ yaw: 0.45, pitch: 0.62 }} />
    </Art>
  );
}

function Cog({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g fill="#fff">
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x="-1.7" y="-9.4" width="3.4" height="4.6" rx="0.9" transform={`rotate(${i * 45})`} />
        ))}
        <circle r="6.4" />
      </g>
      <circle r="2.5" fill={ACCENT_DEEP} />
    </g>
  );
}

export function CalculationArt({ v = "" }: { v?: string }) {
  const rows: ReadonlyArray<readonly [number, boolean]> = [
    [46, false],
    [38, false],
    [50, true],
    [30, false],
    [42, false],
  ];
  return (
    <Art uid={`calc${v}`}>
      <g transform="rotate(-6 120 60)">
        <rect x="86" y="15" width="68" height="92" rx="4" fill={SURFACE} stroke={LINE} filter={lift(`calc${v}`)} />
      </g>
      <path d="M94 8h42l26 26v70a4 4 0 0 1-4 4H94a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" fill={SURFACE} stroke={SOFT} filter={lift(`calc${v}`)} />
      <path d="M136 8v22a4 4 0 0 0 4 4h22" fill={TINT} stroke={SOFT} strokeLinejoin="round" />
      <rect x="100" y="44" width="30" height="6" rx="3" fill={`url(#calc${v}-blue)`} />
      {rows.map(([w, on], i) => (
        <rect key={i} x="100" y={58 + i * 9} width={w} height="3.4" rx="1.7" fill={on ? ACCENT : LINE} />
      ))}
      <g filter={lift(`calc${v}`)}>
        <circle cx="160" cy="90" r="20" fill={`url(#calc${v}-blue)`} stroke="#fff" strokeWidth="3" />
      </g>
      <Cog x={160} y={90} scale={1.45} />
    </Art>
  );
}

export function SpectrumArt({ v = "" }: { v?: string }) {
  const top = SPECTRUM[1]!;
  const base = 94;
  return (
    <Art uid={`spec${v}`}>
      <rect x="36" y="8" width="168" height="104" rx="5" fill={SURFACE} stroke={LINE} filter={lift(`spec${v}`)} />
      <g stroke={LINE} strokeWidth="1" strokeDasharray="2 3">
        {[30, 50, 70].map((y) => (
          <line key={y} x1="50" y1={y} x2="194" y2={y} />
        ))}
      </g>
      <path d={`M50 20v${base - 20}h144`} fill="none" stroke={SOFT} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <g stroke={SOFT} strokeWidth="1.2">
        {[66, 88, 110, 132, 154, 176].map((x) => (
          <line key={x} x1={x} y1={base} x2={x} y2={base + 3.5} />
        ))}
      </g>
      <path d={`${trace(SPECTRUM, base, 50, 194)} L194 ${base} L50 ${base}Z`} fill={`url(#spec${v}-area)`} />
      <path d={trace(SPECTRUM, base, 50, 194)} fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={top.x} y1={base - top.h - 2} x2={top.x} y2={base} stroke={INK} strokeOpacity="0.4" strokeDasharray="2.5 2.5" />
      <circle cx={top.x} cy={base - top.h - 2} r="3.6" fill={SURFACE} stroke={INK} strokeWidth="1.6" />
      <g filter={lift(`spec${v}`)}>
        <rect x={top.x + 10} y="22" width="46" height="24" rx="4" fill={INK} />
        <rect x={top.x + 17} y="29" width="26" height="3.4" rx="1.7" fill="#fff" fillOpacity="0.85" />
        <rect x={top.x + 17} y="36" width="17" height="3.4" rx="1.7" fill="#fff" fillOpacity="0.45" />
      </g>
    </Art>
  );
}

export function ComparisonArt({ v = "" }: { v?: string }) {
  return (
    <Art uid={`cmp${v}`}>
      <rect x="30" y="7" width="180" height="48" rx="5" fill={SURFACE} stroke={LINE} filter={lift(`cmp${v}`)} />
      <rect x="30" y="65" width="180" height="48" rx="5" fill={SURFACE} stroke={LINE} filter={lift(`cmp${v}`)} />
      <g stroke={SOFT} strokeWidth="1" strokeDasharray="1.6 3.2">
        {ALIGNED.map((p) => (
          <line key={p.x} x1={p.x} y1="11" x2={p.x} y2="109" />
        ))}
      </g>
      <g stroke={ACCENT} strokeWidth="3" strokeLinecap="round">
        {ALIGNED.map((p) => (
          <line key={p.x} x1={p.x} y1="49" x2={p.x} y2={49 - p.h * 0.92} />
        ))}
      </g>
      <path d={trace(ALIGNED, 105, 38, 202, 1.8, 0.86)} fill="none" stroke={MEASURED} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <g filter={lift(`cmp${v}`)}>
        <circle cx="120" cy="60" r="12" fill={SURFACE} stroke={MEASURED} strokeWidth="1.6" />
      </g>
      <path d="M114 57h12m-3.2-3.2L126 57l-3.2 3.2M126 63h-12m3.2-3.2L114 63l3.2 3.2" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Art>
  );
}

function LibraryCard({
  uid,
  id,
  x,
  y,
  rotate,
  pose,
  span,
  v,
}: {
  v: string;
  uid: string;
  id: HomeStructureId;
  x: number;
  y: number;
  rotate: number;
  pose: Pose;
  span: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect x="-32" y="-44" width="64" height="88" rx="4" fill={SURFACE} stroke={INDIGO_LINE} filter={lift(`lib${v}`)} />
      <StructureGlyph uid={uid} id={id} cx={0} cy={-13} span={span} pose={pose} detail={0.8} />
      <rect x="-20" y="20" width="40" height="3.6" rx="1.8" fill={INDIGO_LINE} />
      <rect x="-20" y="28" width="24" height="3.6" rx="1.8" fill={INDIGO} fillOpacity="0.55" />
    </g>
  );
}

export function LibraryArt({ v = "" }: { v?: string }) {
  return (
    <Art uid={`lib${v}`}>
      <LibraryCard v={v} uid={`libl${v}`} id="c6h6" x={70} y={66} rotate={-8} pose={{ yaw: 0.4, pitch: 0.82 }} span={46} />
      <LibraryCard v={v} uid={`libr${v}`} id="cr2o3" x={170} y={66} rotate={8} pose={{ yaw: 0.7, pitch: 0.55 }} span={48} />
      <LibraryCard v={v} uid={`libc${v}`} id="c8h10n4o2" x={120} y={60} rotate={0} pose={{ yaw: 0.5, pitch: 0.95 }} span={54} />
    </Art>
  );
}

function Node({ x, y, v }: { x: number; y: number; v: string }) {
  return (
    <g filter={lift(`guide${v}`)}>
      <circle cx={x} cy={y} r="10" fill={SURFACE} stroke={INDIGO} strokeWidth="2.6" />
      <circle cx={x} cy={y} r="3.4" fill={INDIGO} />
    </g>
  );
}

export function GuideArt({ v = "" }: { v?: string }) {
  return (
    <Art uid={`guide${v}`}>
      <path d="M40 90C40 70 56 62 86 62" fill="none" stroke={INDIGO} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 62C116 62 126 36 162 36" fill="none" stroke={INDIGO} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 62C116 62 126 90 162 90" fill="none" stroke={INDIGO_LINE} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="4 5" />
      <Node v={v} x={40} y={90} />
      <Node v={v} x={86} y={62} />
      <g filter={lift(`guide${v}`)}>
        <rect x="162" y="18" width="52" height="36" rx="5" fill={`url(#guide${v}-indigo)`} />
      </g>
      <path d="M176 36h22m-7-7 7 7-7 7" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="162" y="72" width="52" height="36" rx="5" fill={SURFACE} stroke={INDIGO_LINE} />
      <rect x="171" y="84" width="30" height="3.6" rx="1.8" fill={INDIGO_LINE} />
      <rect x="171" y="93" width="19" height="3.6" rx="1.8" fill={INDIGO_LINE} />
    </Art>
  );
}

/** Keyed by starting path so the server page can hand the client component ready-made nodes. */
export function pathIllustrations(v = ""): Record<StartingPathId, ReactNode> {
  return {
    molecule: <MoleculeArt v={v} />,
    calculation: <CalculationArt v={v} />,
    experimental: <SpectrumArt v={v} />,
    compare: <ComparisonArt v={v} />,
    examples: <LibraryArt v={v} />,
    unsure: <GuideArt v={v} />,
  };
}

/* ------------------------------------------------------------------ hero figure */

/** A labelled specimen plate: real reference geometry, a true 1 Å scale bar, and a caption that says what it is. */
export function HeroFigure({
  structure = "c8h10n4o2",
  pose = { yaw: 0.5, pitch: 0.95 },
  span = 148,
  uid = "hero",
  scaleBar = true,
}: {
  structure?: HomeStructureId;
  pose?: Pose;
  span?: number;
  uid?: string;
  /**
   * The 1 Å bar uses the drawing's true pixels-per-ångström, but the view is an orthographic projection tilted by `pose`:
   * the bar is exact only for distances parallel to the image plane, and bonds that point toward or away from the viewer
   * are foreshortened. Pages where readers may compare bond lengths to the bar should turn it off.
   */
  scaleBar?: boolean;
} = {}) {
  const entry = homeStructure(structure);
  const angstrom = glyphScale(structure, span);
  return (
    <figure>
      <svg viewBox={`0 0 300 ${scaleBar ? 156 : 132}`} focusable="false" aria-hidden="true">
        <StructureGlyph uid={uid} id={structure} cx={150} cy={scaleBar ? 70 : 64} span={span} pose={pose} />
        {scaleBar ? (
          <>
            <path
              d={`M18 142v-7M${18 + angstrom} 142v-7M18 139.5h${angstrom}`}
              stroke={INK}
              strokeWidth="1.4"
              strokeLinecap="square"
              fill="none"
            />
            <text x={18 + angstrom + 8} y="143" fontSize="11" fill={INK} fontFamily="var(--cdf-font-data)">
              1 Å
            </text>
          </>
        ) : null}
      </svg>
      <figcaption>
        <strong>
          {entry.name},{" "}
          {formulaParts(entry.formula).map((part, i) => (part.sub ? <sub key={i}>{part.text}</sub> : part.text))}
        </strong>
        <span>Reference geometry · {entry.sourceLine}. Illustration, not a ChemDFT result.</span>
      </figcaption>
    </figure>
  );
}
