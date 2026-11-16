import { HELD_BACK_FILES, LICENCE_NOT_RECORDED, LICENSE_ROWS, OPEN_CORE_STATEMENT, OPEN_REPOSITORY_URL, THIRD_PARTY, THIRD_PARTY_STATUS_LABEL, ZENODO_CONCEPT_DOI, ZENODO_SNAPSHOT_DOI } from "../../../content/license";
import styles from "./public-doc.module.css";

/** The License page: the open-core model in plain words, the directory table, SPDX ids and the verified third-party table. */
export function LicenseView() {
  return (
    <>
      <header className={styles.head}>
        <h1>License</h1>
        <p className={styles.lead}>{OPEN_CORE_STATEMENT}</p>
        <p className={styles.lead} data-testid="license-apache-line">
          Source licence: Apache-2.0 for all ChemDFT first-party code. Public source repository:{" "}
          <a href={OPEN_REPOSITORY_URL ?? "https://github.com/TabAh007/chemdft-open"} rel="noopener noreferrer">
            {OPEN_REPOSITORY_URL ?? "https://github.com/TabAh007/chemdft-open"}
          </a>
        </p>
      </header>

      <section className={styles.section} aria-labelledby="model">
        <h2 id="model">The model, in plain words</h2>
        <p>
          <strong>Open (Apache-2.0):</strong> the typed schemas and contracts, the code that runs the scientific engines
          (PySCF, xTB, CREST, Psi4), the examples catalogue, and the test fixtures for them. Apache-2.0 lets you use, change and
          redistribute that code, including commercially, as long as you keep the license and notices.
        </p>
        <p>
          <strong>Not open (all rights reserved):</strong> the web app and molecule editor, the AI gateway and AI Scientist
          logic, the compute gateway and hosting setup, billing, sign-in, and everything not named above. Documentation and
          these release notes can be read here but are not under an open license.
        </p>
        <p>
          <strong>Free to use:</strong> scientists can use the ChemDFT website at no charge. That is permission to use the
          service, not a license to the proprietary code.
        </p>
        <p data-testid="held-back">
          <strong>Held back from the public snapshot:</strong> three files inside the Apache-2.0 paths are not published in the open-core archive:{" "}
          {HELD_BACK_FILES.map((file, index) => (
            <span key={file}>
              {index > 0 ? ", " : ""}
              <code>{file.split("/").pop()}</code>
            </span>
          ))}
          . The Quantum ESPRESSO periodic worker is proprietary as well. Where a path is ambiguous it is treated as proprietary. The open-core part is
          archived on Zenodo, <a href={`https://doi.org/${ZENODO_SNAPSHOT_DOI}`} rel="noopener noreferrer">DOI {ZENODO_SNAPSHOT_DOI}</a> (release 0.0.52), or all versions at <a href={`https://doi.org/${ZENODO_CONCEPT_DOI}`} rel="noopener noreferrer">DOI {ZENODO_CONCEPT_DOI}</a>; that
          archive verifies no scientific result.
        </p>
        <p>
          <strong>No warranty:</strong> the software is provided as is. Scientific results are produced by the stated engines
          and must be checked by you before you rely on them. This page is a plain-language summary, not legal advice.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="where">
        <h2 id="where">Which parts are which</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Where in the repository</th>
                <th scope="col">License</th>
                <th scope="col">SPDX id</th>
              </tr>
            </thead>
            <tbody>
              {LICENSE_ROWS.map((row) => (
                <tr key={row.area}>
                  <td>{row.area}</td>
                  <td>
                    {row.paths.map((path) => (
                      <div key={path}>
                        <code>{path}</code>
                      </div>
                    ))}
                  </td>
                  <td>
                    <span className={`${styles.tag} ${row.group === "open" ? "" : styles.tagProprietary}`}>
                      {row.group === "open"
                        ? "Apache-2.0"
                        : row.group === "third-party"
                          ? "Third party"
                          : row.group === "excluded"
                            ? "Not published"
                            : "Artwork"}
                    </span>
                  </td>
                  <td>
                    <code>{row.spdx}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 10 }}>
          The machine-readable version is <code>REUSE.toml</code> in the repository root. Paths not listed in that table are not part of any published release.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="third-party" style={{ maxWidth: "none" }}>
        <h2 id="third-party">Third-party software</h2>
        <p>
          ChemDFT calls these projects; it does not reimplement them, none of them endorse ChemDFT, and each remains under its own licence. Where a licence
          was read from installed package metadata or a licence file the row says Verified; where only the upstream repository was checked it says
          Upstream checked; anything else is Not verified, and a licence that is not recorded says &ldquo;{LICENCE_NOT_RECORDED}&rdquo;. Running a program as a
          separate process is not the same as bundling it. This page is not legal advice, and the repository records that a legal read of the licence
          structure (including the copyleft licences GPL and LGPL, geomeTRIC&rsquo;s added clause and the CREST per-file review) is still pending; no legal
          conclusion is stated here. There are {THIRD_PARTY.length} rows.
        </p>
        <div className={styles.tableWrap} role="region" aria-label="Third-party software licences, scrollable table" tabIndex={0}>
          <table className={`${styles.table} ${styles.stack}`}>
            <thead>
              <tr>
                <th scope="col">Software</th>
                <th scope="col">Version</th>
                <th scope="col">Licence</th>
                <th scope="col">How ChemDFT uses it</th>
                <th scope="col">Status and evidence</th>
                <th scope="col">Upstream licence text</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {THIRD_PARTY.map((row) => (
                <tr key={row.name} data-testid="third-party-row">
                  <th scope="row">{row.name}</th>
                  <td data-label="Version">{row.version}</td>
                  <td data-label="Licence">{row.short ?? LICENCE_NOT_RECORDED}</td>
                  <td data-label="How ChemDFT uses it">{row.use}</td>
                  <td data-label="Status and evidence">
                    <span>
                      <span className={`${styles.tag} ${row.status === "not verified" ? styles.tagNo : ""}`}>{THIRD_PARTY_STATUS_LABEL[row.status]}</span> {row.evidence}
                    </span>
                  </td>
                  <td data-label="Upstream licence text">
                    {row.upstream ? (
                      <a href={row.upstream} rel="noopener noreferrer" aria-label={`${row.name}: upstream project, which holds the licence text`}>
                        Upstream project
                      </a>
                    ) : (
                      "No upstream link recorded"
                    )}
                  </td>
                  <td data-label="Note">{row.note || "None recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
