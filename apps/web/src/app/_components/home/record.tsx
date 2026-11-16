import type { Locale } from "@chemdft/i18n";

import { PrimaryAction } from "./header-actions";
import { attemptSeconds, fixed, RUN, RUN_IDENTITY, scientific, shortHash, utc } from "./run-record";

type Group = { title: string; rows: readonly (readonly [string, string])[] };

function groups(): readonly Group[] {
  const r = RUN.result;
  const p = RUN.provenance;
  return [
    {
      title: "Structure",
      rows: [
        ["Formula", "H₂O"],
        ["Charge · multiplicity", `${RUN.structure.charge} · ${RUN.structure.multiplicity}`],
        ["Input structure SHA-256", shortHash(RUN.structure.input_structure_sha256)],
      ],
    },
    {
      title: "Method",
      rows: [
        ["Method", RUN.method.method],
        ["Basis set", RUN.method.basis],
        ["SCF threshold · max cycles", `${scientific(RUN.method.scf_convergence_threshold)} · ${RUN.method.scf_max_iterations}`],
        ["Calculation input SHA-256", shortHash(p.calculation_input_sha256)],
      ],
    },
    {
      title: "Engine",
      rows: [
        ["Engine · version", `${RUN.engine.name} ${RUN.engine.version}`],
        ["Backend · hardware", `${RUN.engine.backend} · ${RUN.engine.hardware_class}`],
        ["Environment SHA-256", shortHash(RUN.engine.environment_sha256)],
      ],
    },
    {
      title: "Execution",
      rows: [
        ["Attempt · state", `${RUN.attempt.number} · ${RUN.attempt.state}`],
        ["Started", utc(RUN.attempt.started_utc)],
        ["Finished", utc(RUN.attempt.finished_utc)],
        ["Duration", `${attemptSeconds().toFixed(2)} s`],
      ],
    },
    {
      title: "Result",
      rows: [
        ["SCF", `${r.converged ? "converged" : "not converged"} · ${r.scf_iterations} cycles`],
        ["Total SCF energy", `${fixed(r.total_energy_hartree, 10)} Eh`],
        ["Electrons · basis functions", `${r.electron_count} · ${r.basis_functions}`],
        ["HOMO · LUMO · gap", `${fixed(r.homo.energy_hartree, 6)} · ${fixed(r.lumo.energy_hartree, 6)} · ${fixed(r.gap_hartree, 6)} Eh`],
      ],
    },
    {
      title: "Artifacts and provenance",
      rows: [
        ["Result SHA-256", shortHash(p.result_sha256)],
        ["Coefficient artifact SHA-256", shortHash(p.coefficient_artifact_sha256)],
        ["Authority · source", `${p.authority} · ${p.source_class}`],
        ["Review · validation", `${p.verification_state} · ${p.validation_state}`],
        ["Stored", utc(p.stored_utc)],
      ],
    },
  ];
}

/** Act V — the run record as an instrument report, then the short final action. */
export function Record({ locale }: { locale: Locale }) {
  return (
    <>
      <section className="record" id="reproducibility" aria-labelledby="record-title">
        <header className="record-head">
          <p className="eyebrow">Reproducible science</p>
          <h2 id="record-title">Every result carries its own record</h2>
          <p>
            Configuration and traceability for this stored water calculation. Full identifiers remain in ChemDFT.
          </p>
        </header>
        <div className="record-identity" data-testid="record-identity">
          <strong>{RUN_IDENTITY}</strong>
          <span>Authoritative · calculated</span>
          <span>SCF {RUN.result.converged ? "converged" : "not converged"} · {RUN.result.scf_iterations} cycles</span>
          <span>Not reviewed</span>
        </div>
        <div className="record-sheet" role="group" aria-label="Stored calculation record, water, HF/STO-3G">
          {groups().map((group) => (
            <section key={group.title} className="record-group" aria-label={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.rows.map(([label, value]) => (
                  <div key={label} data-traceability={/SHA-256|Started|Finished|Stored|Duration|Attempt/.test(label) ? "true" : undefined}>
                    <dt>{label}</dt>
                    <dd className="mono">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="record-note">{RUN.result.gap_note} Computed does not mean checked by a person: this result is stored as calculated and not reviewed.</p>
      </section>

      <section className="final-cta" aria-labelledby="final-title">
        <h2 id="final-title">Work with real engines, and keep the record.</h2>
        <div className="final-actions">
          <PrimaryAction locale={locale} className="bp6-button bp6-intent-primary bp6-large" testId="final-primary" />
        </div>
        <p>Private beta · new accounts with Google while beta places last · email sign-up, public sign-up and pricing are not available yet.</p>
      </section>
    </>
  );
}
