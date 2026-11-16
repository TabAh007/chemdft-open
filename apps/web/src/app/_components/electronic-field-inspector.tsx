"use client";
import type { ElectronicInspectorContext } from "@/lib/electronic-workbench";

export function ElectronicFieldInspector({ context }: { context: ElectronicInspectorContext }) {
  const { result, grid, potential, calculationId, mode, orbital } = context;
  return <div className="electronic-inspector" aria-label="Electronic-structure provenance">
    <h2>{mode === "MO" ? `MO ${orbital.index + 1}` : mode === "Density" ? "Electron density" : "ESP surface"}</h2>
    <dl className="mo-facts">
      <div><dt>Authority</dt><dd>CALCULATED</dd></div>
      <div><dt>Review</dt><dd>NOT REVIEWED</dd></div>
      <div><dt>Engine</dt><dd>PySCF {result.engine_version}</dd></div>
      <div><dt>Method / basis</dt><dd>{result.method.toUpperCase()}/{result.basis.toUpperCase()}</dd></div>
      <div><dt>Input</dt><dd>Committed StructureVersion</dd></div>
      <div><dt>SCF electron count</dt><dd>{result.electron_count} e · authoritative</dd></div>
      {mode !== "MO" && grid ? <div><dt>Integrated density over finite grid</dt><dd>{grid.manifest.density_integral_electrons?.toFixed(4)} e<br /><small>QA only · finite box · {((grid.manifest.density_integral_relative_error ?? 0) * 100).toFixed(2)}% discrepancy</small></dd></div> : null}
      {grid ? <><div><dt>Grid</dt><dd>{grid.manifest.dimensions.join(" × ")} · {grid.manifest.spacing_angstrom} Å</dd></div><div><dt>Field units</dt><dd>{potential ? "ESP / a.u.; density / e/a₀³" : mode === "MO" ? "a₀⁻³ᐟ²" : "e/a₀³"}</dd></div></> : null}
    </dl>
    <div className="inspector-hash"><strong>Result hash</strong><code title={result.result_sha256}>{result.result_sha256}</code></div>
    {grid ? <div className="inspector-hash"><strong>Field hash</strong><code title={(potential ?? grid).manifest.grid_sha256}>{(potential ?? grid).manifest.grid_sha256}</code></div> : null}
    <details className="electronic-provenance"><summary>Advanced provenance</summary>
      <dl className="mo-facts">
        <div><dt>StructureVersion</dt><dd>{result.input_structure_version_id}</dd></div>
        <div><dt>Calculation</dt><dd>{calculationId}</dd></div>
        <div><dt>Result</dt><dd>{context.resultId}</dd></div>
        <div><dt>Coefficient hash</dt><dd>{result.coefficient_artifact.sha256}</dd></div>
      </dl>
      {[grid, potential].filter(field => Boolean(field)).map(field => field ? <section key={field.manifest.artifact.artifact_id}>
        <h3>{field.manifest.field_quantity.replaceAll("_", " ")}</h3>
        <dl className="mo-facts">
          <div><dt>Artifact hash</dt><dd>{field.manifest.artifact.sha256}</dd></div>
          <div><dt>Grid hash</dt><dd>{field.manifest.grid_sha256}</dd></div>
          <div><dt>Spec hash</dt><dd>{field.manifest.grid_specification_hash}</dd></div>
          <div><dt>Density matrix hash</dt><dd>{field.manifest.density_matrix_sha256}</dd></div>
          <div><dt>trace(DS)</dt><dd>{field.manifest.density_matrix_electron_count} e</dd></div>
          <div><dt>Provenance record</dt><dd>{field.manifest.provenance_record_id}</dd></div>
          <div><dt>Artifact</dt><dd>{field.manifest.artifact.artifact_id}</dd></div>
          <div><dt>Profile</dt><dd>STANDARD v{field.manifest.grid_profile_version}</dd></div>
          <div><dt>Producer</dt><dd>{field.manifest.producer} · {field.manifest.grid_generator_version}</dd></div>
          <div><dt>Created</dt><dd>{field.manifest.created_at}</dd></div>
          <div><dt>Field method</dt><dd>{field.manifest.potential_method ?? (field.manifest.field_quantity === "MO_AMPLITUDE" ? "AO(r) C orbital" : "AO(r) D AO(r)ᵀ")}</dd></div>
          <div><dt>Singularities</dt><dd>{field.manifest.singularity_treatment}</dd></div>
        </dl>
      </section> : null)}
      <p>{mode === "MO" ? "Signed orbital amplitude controls geometry; phase colors do not indicate charge." : "Density controls geometry; ESP controls scalar color. Trilinear interpolation preserves the saved grids."}</p>
      <p>Current renderer: VTK.js 37.3.1 marching cubes; trilinear-1.0.0. Saved default surface statistics retain their original marching-tetrahedra-2.0.0 definition.</p>
    </details>
  </div>;
}
