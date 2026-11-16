import { deriveGeometry } from "../molecular-renderer/derive";
import { elementDisplay } from "../molecular-renderer/elements";
import type { HomeStructure } from "./structures";
import { staticProjection } from "./static-projection";

/**
 * Server-rendered, JavaScript-free illustration of a reference structure: the same derived geometry the WebGL renderer
 * draws, as a flat orthographic view. It is what a visitor sees before the 3D scene loads, without WebGL, or with data
 * saving on. `mini` renders a tiny decorative glyph for the structure selector.
 */
export function StructureStatic({ entry, showCell = true, mini = false, id }: { entry: HomeStructure; showCell?: boolean; mini?: boolean; id?: string }) {
  const geometry = deriveGeometry(entry.structure, entry.supercell);
  const polar = entry.view.polar;
  const pitch = Math.PI / 2 - polar; // elevation above the horizon
  const yaw = entry.view.azimuth;
  const extent = Math.max(geometry.bounds.horizontalRadius, geometry.bounds.halfHeight) + 0.6;
  const scale = (mini ? 12 : 118) / extent;
  const view = (p: readonly [number, number, number]) => {
    const q = staticProjection(p, geometry.bounds.center, yaw, pitch);
    return { x: Math.round(q.x * scale * 100) / 100, y: Math.round(q.y * scale * 100) / 100, depth: q.depth };
  };
  const radiusOf = (element: string) => (mini ? 0.62 : 0.5) * Math.pow(elementDisplay(element).covalentRadius, 0.6) * scale * 0.95;
  const atoms = geometry.atoms
    .filter((atom) => atom.role !== "polyhedron-image")
    .map((atom) => ({ atom, v: view(atom.position) }))
    .sort((p, q) => p.v.depth - q.v.depth);
  const bonds = geometry.bonds.filter((bond) => !bond.polyhedraOnly);
  const edges = showCell && geometry.cell ? geometry.cell.edges : [];
  const box = mini ? 16 : 150;
  return (
    <svg
      className={mini ? "structure-glyph" : "structure-static"}
      viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`}
      {...(mini ? { "aria-hidden": true } : { role: "img", "aria-labelledby": `${id}-title ${id}-desc` })}
    >
      {mini ? null : (
        <>
          <title id={`${id}-title`}>{entry.structure.title}</title>
          <desc id={`${id}-desc`}>{entry.description} Flat illustration of a reference structure, not a calculated result.</desc>
        </>
      )}
      {edges.length ? (
        <g stroke="#2b3a49" strokeOpacity="0.6" strokeWidth={mini ? 0.6 : 1.1} fill="none" aria-hidden="true">
          {edges.map(([i, j], k) => {
            const a = view(geometry.cell!.corners[i]!);
            const b = view(geometry.cell!.corners[j]!);
            return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </g>
      ) : null}
      <g stroke="#8a98a5" strokeWidth={mini ? 0.9 : 2.4} strokeLinecap="round" aria-hidden="true">
        {bonds.map((bond, i) => {
          const a = view(geometry.atoms[bond.a]!.position);
          const b = view(geometry.atoms[bond.b]!.position);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      <g aria-hidden="true">
        {atoms.map(({ atom, v }, i) => (
          <circle key={i} cx={v.x} cy={v.y} r={radiusOf(atom.element)} fill={elementDisplay(atom.element).color} stroke="#18212b" strokeOpacity="0.35" strokeWidth={mini ? 0.3 : 0.6} />
        ))}
      </g>
    </svg>
  );
}
