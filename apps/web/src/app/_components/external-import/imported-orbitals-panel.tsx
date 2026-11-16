"use client";

import type { ImportedOrbitalTablePayload } from "@chemdft/schemas";
import { sentence } from "@/lib/imported-results";

/**
 * Orbital-energy TABLE only. The source output carries energies and (usually) occupations, not the
 * orbital coefficients needed to draw isosurfaces, so no orbital rendering is offered for imported data.
 */
export function ImportedOrbitalsPanel({ payload, sourceLabel }: { payload: ImportedOrbitalTablePayload; sourceLabel: string }) {
  return (
    <div className="imported-orbitals" data-testid="imported-orbitals-panel">
      <header className="imported-section-head">
        <div>
          <h2>Imported orbital energies</h2>
          <p>
            Energies reported by {sourceLabel} · {payload.spin_channels.length === 2 ? "α and β spin channels" : "restricted (single channel)"}
          </p>
        </div>
        <span className="import-chip import-chip--imported">Imported · {sourceLabel}</span>
      </header>
      <p className="imported-note" data-testid="imported-orbital-note">
        Orbital energies only. Orbital coefficients: {sentence(payload.orbital_coefficients)} Isosurfaces, density and ESP are not available for
        imported data. Energies are converted from the parser&apos;s {payload.raw_unit} to Hartree with a fixed constant ({payload.conversion}); the
        raw eV value is kept. Occupation: {sentence(payload.occupation_basis)}
      </p>
      <div className="imported-channels">
        {payload.spin_channels.map((channel) => (
          <section key={channel.label} className="imported-channel" data-testid={`imported-orbital-channel-${channel.label}`} aria-label={`${channel.label} orbitals`}>
            <h3>
              {channel.label} · {channel.orbital_count} orbitals
              {channel.homo_index !== null && channel.homo_index !== undefined ? ` · HOMO = orbital ${channel.homo_index + 1}` : ""}
            </h3>
            <div className="imported-table-scroll imported-orbital-scroll">
              <table className="spectro-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Occupation</th>
                    <th>Energy (Eh)</th>
                    <th>Energy (eV, raw)</th>
                    <th>Symmetry</th>
                  </tr>
                </thead>
                <tbody>
                  {channel.energies_hartree.map((energy, index) => {
                    const isHomo = channel.homo_index === index;
                    const isLumo = channel.homo_index !== null && channel.homo_index !== undefined && channel.homo_index + 1 === index;
                    return (
                      <tr key={index} data-testid={`imported-orbital-${channel.label}-${index + 1}`} data-frontier={isHomo ? "HOMO" : isLumo ? "LUMO" : undefined}>
                        <td>{index + 1}{isHomo ? " · HOMO" : isLumo ? " · LUMO" : ""}</td>
                        <td>{channel.occupations ? channel.occupations[index]?.toFixed(2) ?? "—" : "Not reported"}</td>
                        <td>{energy.toFixed(6)}</td>
                        <td>{channel.raw_energies_ev[index]?.toFixed(4) ?? "—"}</td>
                        <td>{channel.symmetries ? channel.symmetries[index] ?? "—" : "Not reported"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
