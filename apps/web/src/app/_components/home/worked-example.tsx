import { CR2O3_EXAMPLE as X } from "./cr2o3-example";

/** Compact worked example: one real stored calculation, with its caveats printed next to the numbers. */
export function WorkedExample() {
  const rows: [string, string][] = [
    ["System", X.system],
    ["Engine and task", `${X.engine}, ${X.task}`],
    ["Pseudopotentials", X.pseudopotentials],
    ["Cutoffs · k-mesh", `${X.cutoffs} · ${X.kMesh}`],
    ["Method", X.method],
  ];
  const results: [string, string][] = [
    ["Converged", `yes; relaxation converged in ${X.ionicSteps} ionic steps, total force ${X.totalForceRyPerBohr} Ry/bohr`],
    ["Final total energy", `${X.totalEnergyHa} Ha`],
    ["Löwdin local Cr moments", `${X.localCrMomentMuB} μB (antiferromagnetic, total magnetization ${X.totalMagnetizationNote})`],
    ["Kohn–Sham band gap", `${X.bandGapEv} eV`],
    ["Runtime", `${X.runtimeSeconds} s`],
  ];
  return (
    <section className="worked-example" id="worked-example" aria-labelledby="worked-example-title" data-testid="worked-example">
      <p className="eyebrow">Worked example</p>
      <h2 id="worked-example-title">One stored calculation: α-Cr2O3</h2>
      <p className="worked-lede">
        <span className="worked-status">CALCULATED</span> {X.platform}, {X.runDate}. Job <span className="mono" data-testid="worked-job-id">{X.jobId}</span>.
      </p>
      <div className="worked-grid">
        <dl className="worked-list">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <dl className="worked-list" data-testid="worked-results">
          {results.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
          ))}
        </dl>
      </div>
      <p className="worked-second" data-testid="worked-second">
        Same system, different settings (job <span className="mono">{X.second.jobId}</span>): {X.second.settings}; Kohn–Sham gap {X.second.bandGapEv} eV, local Cr moments {X.second.localCrMomentMuB} μB.
      </p>
      <ul className="worked-caveats">
        {X.caveats.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  );
}
