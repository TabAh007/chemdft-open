import type { ReactNode } from "react";
import { StructureGlyph } from "../onboarding/illustrations";

/**
 * Small educational plates for Learn. Two kinds, never mixed up:
 *  - real reference geometry (the repository's PubChem benzene and stored water geometry, drawn by the same derivation the
 *    homepage renderer uses) — no coordinate is invented here;
 *  - schematic diagrams: boxes, arrows and a generic curve with NO numbers, units or data. The landing page captions every
 *    schematic plate "Schematic" so none can be read as a measurement or a calculation result.
 * Server components; nothing here ships to the client bundle.
 */

const INK = "#18212b";
const SOFT = "var(--cdf-line-strong)";
const LINE = "var(--cdf-line)";
const SURFACE = "var(--cdf-surface)";
const BLUE = "var(--cdf-accent)";
const TEAL = "var(--ob-teal)";
const INDIGO = "var(--ob-indigo)";
const ORANGE = "var(--cdf-phase-negative)";
const FONT = "var(--cdf-font-ui)";

function Plate({ uid, children, square = false }: { uid: string; children: ReactNode; square?: boolean }) {
  return (
    <svg viewBox={square ? "0 0 120 120" : "0 0 240 120"} preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">
      <defs>
        <filter id={`${uid}-lift`} x="-25%" y="-20%" width="150%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor={INK} floodOpacity="0.12" />
        </filter>
      </defs>
      {children}
    </svg>
  );
}
const lift = (uid: string) => `url(#${uid}-lift)`;

function Box({ uid, x, y, w, h, label, tone = BLUE, dashed = false }: { uid: string; x: number; y: number; w: number; h: number; label: string; tone?: string; dashed?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={SURFACE} stroke={tone} strokeWidth="1.6" strokeDasharray={dashed ? "4 3" : undefined} filter={lift(uid)} />
      <text x={x + w / 2} y={y + h / 2 + 3.4} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={INK} fontFamily={FONT}>
        {label}
      </text>
    </g>
  );
}
function Arrow({ x1, y1, x2, y2, tone = SOFT }: { x1: number; y1: number; x2: number; y2: number; tone?: string }) {
  const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const head = horizontal ? `M${x2 - 4} ${y2 - 3}L${x2} ${y2}L${x2 - 4} ${y2 + 3}` : `M${x2 - 3} ${y2 - 4}L${x2} ${y2}L${x2 + 3} ${y2 - 4}`;
  return (
    <g fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <path d={head} />
    </g>
  );
}

/** 01: a real reference geometry with the three Cartesian axes that its coordinates refer to (the axes are a concept). */
export function AxesStructureArt() {
  return (
    <Plate uid="lax" square>
      <StructureGlyph uid="lax" id="h2o" cx={66} cy={50} span={84} pose={{ yaw: 0.35, pitch: 0.7 }} />
      <g fontFamily={FONT} fontSize="10" fontWeight="600" fill={INK} stroke="none">
        <g stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" fill="none">
          <line x1="16" y1="104" x2="46" y2="104" />
          <line x1="16" y1="104" x2="16" y2="74" />
          <line x1="16" y1="104" x2="32" y2="90" />
        </g>
        <text x="50" y="108">x</text>
        <text x="13" y="70">y</text>
        <text x="35" y="89">z</text>
      </g>
    </Plate>
  );
}

/** Real reference geometry only (benzene). */
export function BenzeneThumbArt() {
  return (
    <Plate uid="lbz">
      <StructureGlyph uid="lbz" id="c6h6" cx={120} cy={60} span={150} pose={{ yaw: 0.45, pitch: 0.62 }} />
    </Plate>
  );
}

/** 02: the request path. Schematic. */
export function WorkflowArt() {
  return (
    <Plate uid="lwf" square>
      <Box uid="lwf" x={14} y={8} w={92} h={22} label="Structure" tone={TEAL} />
      <Box uid="lwf" x={14} y={36} w={92} h={22} label="Method · basis" tone={BLUE} />
      <Box uid="lwf" x={14} y={64} w={92} h={22} label="You approve" tone={INK} />
      <Box uid="lwf" x={14} y={92} w={92} h={22} label="Result" tone={INDIGO} />
      <Arrow x1={60} y1={30} x2={60} y2={36} />
      <Arrow x1={60} y1={58} x2={60} y2={64} />
      <Arrow x1={60} y1={86} x2={60} y2={92} />
    </Plate>
  );
}

/** Calculations category: a generic potential-energy well. Schematic: no axis values. */
export function EnergyWellArt() {
  return (
    <Plate uid="lew">
      <g fill="none" stroke={SOFT} strokeWidth="1.4" strokeLinecap="round">
        <path d="M46 14v88h156" />
      </g>
      <path d="M62 24C74 70 92 92 118 92S162 70 186 28" fill="none" stroke={BLUE} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="118" cy="92" r="4" fill={SURFACE} stroke={INK} strokeWidth="1.6" />
    </Plate>
  );
}

/** Spectra category: stick and continuous trace with no axes, values or units. Schematic. */
export function SchematicSpectraArt() {
  const peaks = [
    { x: 66, h: 26, w: 4.4 },
    { x: 104, h: 38, w: 4.8 },
    { x: 142, h: 20, w: 4 },
    { x: 176, h: 31, w: 4.6 },
  ];
  const trace = (() => {
    const pts: string[] = [];
    for (let x = 38; x <= 202; x++) {
      let y = 0;
      for (const p of peaks) y += (p.h * 0.86) / (1 + ((x - (p.x + 1.8)) / p.w) ** 2);
      pts.push(`${x === 38 ? "M" : "L"}${x} ${Math.round((105 - y) * 10) / 10}`);
    }
    return pts.join(" ");
  })();
  return (
    <Plate uid="lsp">
      <rect x="30" y="7" width="180" height="48" rx="5" fill={SURFACE} stroke={LINE} filter={lift("lsp")} />
      <rect x="30" y="65" width="180" height="48" rx="5" fill={SURFACE} stroke={LINE} filter={lift("lsp")} />
      <g stroke={BLUE} strokeWidth="3" strokeLinecap="round">
        {peaks.map((p) => (
          <line key={p.x} x1={p.x} y1="49" x2={p.x} y2={49 - p.h * 0.92} />
        ))}
      </g>
      <path d={trace} fill="none" stroke={ORANGE} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
    </Plate>
  );
}

/** Integrity category: kinds of information are kept apart; the AI explanation is dashed because it is not a result. */
export function LabelsArt() {
  const row = (y: number, tone: string, bar: number, dashed = false) => (
    <g key={y}>
      <rect x="40" y={y} width="160" height="24" rx="4" fill={SURFACE} stroke={tone} strokeWidth="1.8" strokeDasharray={dashed ? "5 3" : undefined} filter={lift("llb")} />
      <circle cx="58" cy={y + 12} r="5" fill={dashed ? SURFACE : tone} stroke={tone} strokeWidth="1.8" />
      <rect x="72" y={y + 9} width={bar} height="6" rx="3" fill={dashed ? SOFT : tone} fillOpacity={dashed ? 0.7 : 0.35} />
    </g>
  );
  return (
    <Plate uid="llb">
      {row(12, INDIGO, 96)}
      {row(48, BLUE, 78)}
      {row(84, SOFT, 62, true)}
    </Plate>
  );
}

/** 03: where a result's context lives. Schematic. */
export function ProvenanceChainArt() {
  return (
    <Plate uid="lpc" square>
      <Box uid="lpc" x={10} y={10} w={100} h={26} label="Result" tone={INDIGO} />
      <Box uid="lpc" x={10} y={47} w={100} h={26} label="Provenance" tone={BLUE} />
      <Box uid="lpc" x={10} y={84} w={100} h={26} label="Input · log · hashes" tone={TEAL} />
      <Arrow x1={60} y1={47} x2={60} y2={37} />
      <Arrow x1={60} y1={84} x2={60} y2={74} />
    </Plate>
  );
}
