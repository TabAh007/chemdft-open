/**
 * The single source of truth for public ChemDFT releases, newest first.
 *
 * The footer version, the Releases page, the Atom feed, `CITATION.cff` (`version`, `date-released`), the cite page and
 * `apps/web/package.json` (`version`) all derive from or are checked against the first entry (tests/releases.test.ts).
 * Release notes are English only for now. Every statement must stay within what NEXT.md and the implementation documents
 * record as verified; a result from one platform is not evidence for another. No deployment ids, commit hashes, pull
 * request numbers, server addresses, internal paths or test names belong here (the test rejects them).
 * How to add a release: docs/implementation/RELEASES_AND_LICENSE.md.
 */

export interface VerifiedClaim {
  /** What was verified, in plain language, with the numbers the record holds. */
  statement: string;
  /** Where it was executed, for example "Hosted beta, AWS Linux worker". */
  platform: string;
  /** The engine and version as recorded. */
  engine: string;
}

export interface ScientificStatus {
  verified: VerifiedClaim[];
  notYetVerified: string[];
  knownLimits: string[];
}

export interface ReleaseEntry {
  /** SemVer, 0.x until 1.0.0 (reserved). */
  version: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  summary: string;
  added: string[];
  changed: string[];
  fixed: string[];
  scientificStatus: ScientificStatus;
}

export const RELEASES: readonly ReleaseEntry[] = [
  {
    version: "0.0.60",
    date: "2026-11-15",
    title: "AI Scientist chat guidance, structure edit proposals, periodic calculation proposals, failure diagnostics, method advisor, and overview layout resilience",
    summary:
      "Introduced deterministic calculation guidance tailoring available actions by structure type, structure edit proposals with minimum-image covalent distance thresholding and deterministic diffs creating immutable versions upon user approval, periodic calculation proposals copying project settings or engine defaults, failure diagnostics mapping native engine failure signatures to recovery hints without exposing raw log tokens, a deterministic method advisor, composer action buttons, and layout separation on the project overview.",
    added: [
      "Calculation guidance in the chat fact sheet reporting exact available actions for molecular and periodic structures while upholding that execution requires user approval.",
      "Structure edit proposal tool and planning profile supporting atom additions, removals, moves, and element replacements with minimum-image periodic distance checks, deterministic coordinate diffs, and creation of immutable AI-proposed structure versions upon user approval.",
      "Periodic calculation proposal planner and profile resolving calculation settings from user input, recent successful periodic runs, or documented engine defaults without parameter fabrication.",
      "Composer action buttons: 'Prepare periodic calculation for approval' on periodic crystal structures, 'Prepare calculation for approval' on molecular structures, 'Set up in Calculation panel' in More menu and fallback toolbar, and 'Propose structure edit' in More menu.",
      "Dedicated proposal cards in the approval screen displaying structure edit diffs, interatomic distance checks, prominent immutability notices, and periodic settings source annotations.",
      "Failure diagnostics catalog mapping Quantum ESPRESSO, PySCF, and xTB error signatures to actionable recovery hints with sanitized single-line log excerpts.",
      "Deterministic computational method advisor recommending appropriate DFT functionals, basis sets, pseudopotentials, and k-meshes based on system characteristics.",
      "Evaluation prompt test suite expanding offline verification to cover periodic guidance, cannot-run guarantees, and off-topic redirection.",
      "Automated UI responsiveness and interaction audit covering multiple desktop viewports and AI dock widths.",
    ],
    changed: [
      "Project overview CSS layout updated to enforce explicit vertical and horizontal margins between workflow notes and results links.",
      "Dock header and overview interactive elements tested across viewports 1280px, 1440px, and 1920px with AI dock widths 340px, 379px, and 460px.",
    ],
    fixed: [
      "Eliminated 3px bounding box collision between the Results Calculation action link and the firewall HelpTip trigger button on the Project Overview at compact container widths.",
      "Eliminated misleading execution promises and retired planner terminology in AI Scientist chat responses via strengthened deterministic filters.",
    ],
    scientificStatus: {
      verified: [
        {
          statement: "Minimum-image periodic distance calculations accurately enforce covalent radius sum thresholding across unit cell boundaries.",
          platform: "Local verification gate",
          engine: "Pure structure validation engine",
        },
        {
          statement: "Periodic calculation proposal builder faithfully copies settings from previous successful calculations without parameter fabrication.",
          platform: "Local verification gate",
          engine: "Periodic proposal planner",
        },
        {
          statement: "Approving a structure edit proposal creates exactly one new AI-proposed structure version while parent versions remain strictly immutable.",
          platform: "Local verification gate",
          engine: "Structure version authority engine",
        },
      ],
      notYetVerified: [
        "AI-generated structure proposals and periodic calculation settings remain unverified proposals requiring user review and engine computation behind the Scientific Result Firewall.",
        "Version snapshots after 0.0.57 have not yet been archived to Zenodo.",
      ],
      knownLimits: [
        "Periodic energy proposals reject molecular structures, and molecular energy proposals reject periodic structures.",
        "Structure edit proposals enforce a maximum edit cap of 20 operations per proposal.",
        "Desktop-only viewports supported; phone layouts for internal workstation views are deferred per design decisions.",
      ],
    },
  },
  {
    version: "0.0.59",
    date: "2026-11-14",
    title: "AI Scientist history hygiene, end-of-turn reply rules, deterministic chat filters, and dock header tab spacing",
    summary:
      "Introduced chat history hygiene limiting context to the most recent six messages and omitting retired wording, positioned reply rules at the end of the user turn for small-model obedience, added deterministic filters for bare greetings, retired wording, and trailing capability boilerplate, established an explicit chronological calculation ordering key for comparison questions, and added visual spacing between Inspector and AI Scientist tabs in the dock header.",
    added: [
      "History hygiene in the AI Scientist chat execution path sending the last six messages and replacing retired wording ('Plan a calculation', 'Plan mode', 'Chat | Plan') in historical assistant turns with a neutral placeholder.",
      "Fixed end-of-turn reply rules appended to the user prompt instructing the model to answer concisely without unsolicited summaries, capability listings, or direct execution claims.",
      "Pure greeting and thanks short-circuit answering bare greetings without invoking the model gateway or consuming token budget.",
      "Deterministic post-generation filters rewriting retired phrasing to 'the Prepare calculation button' and trimming trailing capability recital boilerplate.",
      "Chronological calculation ordering key in the AI fact sheet presenting records newest-first with explicit indices and timestamps for comparison questions.",
      "Visual tab spacing and layout guarantees separating Inspector and AI Scientist tabs across all supported dock widths.",
    ],
    changed: [
      "AI Scientist capability statements plainly state supported molecular methods (Hartree-Fock, B3LYP, PBE) and clarify that periodic calculation proposals are configured via the Calculation panel.",
      "Removed any language promising or implying direct calculation submission from capability definitions.",
    ],
    fixed: [
      "Resolved visual tab crowding between Inspector and AI Scientist in the Advanced dock header.",
      "Eliminated contradictory method support claims and hallucinated references to retired plan modes copied from conversation history.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Live model behaviour after these changes (the architect re-runs the 8-prompt set after deploy).",
        "Real trackpad swipe-back gesture interaction in the workspace.",
        "Cold-start execution indicator pulse light behaviour on a real worker launch.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release.",
        "The AI Scientist cannot edit committed structures or prepare periodic calculation proposals.",
        "Automatic request routing between chat and evidence paths is not implemented.",
        "The small model may still be verbose; deterministic filters target only known boilerplate patterns.",
      ],
    },
  },
  {
    version: "0.0.58",
    date: "2026-11-14",
    title: "Computed structure measurements in AI facts, honest refusals, streamlined single-input composer, and merged dock header",
    summary:
      "Gave the AI Scientist direct access to deterministic structure measurements computed from stored coordinates and lattice parameters, enforced honest refusals and filtered promises regarding structure alterations, unified the AI composer into a single text input with explicit Ask and Prepare Calculation actions, merged the Advanced dock header to expand conversation reading height above 65%, and updated software citation metadata with the archived 0.0.57 Zenodo DOI.",
    added: [
      "Pure deterministic structure measurement module computing formula, atom counts, cell dimensions, cell angles, volume, nearest-neighbour interatomic distances (minimum-image periodic convention), and coordination counts from stored committed coordinates.",
      "Injected computed structure metrics directly into AI Scientist grounding facts, labeled as computed by ChemDFT from stored coordinates rather than engine calculations.",
      "Explicit capability definition listing real implemented tools and clear boundaries of what the assistant cannot do.",
      "Secondary 'Prepare calculation for approval' action in composer for molecular energy proposals, and 'Set up in Calculation panel' action on periodic structures.",
      "Archived Zenodo version DOI 10.5281/zenodo.24219804 recorded for release 0.0.57.",
    ],
    changed: [
      "The AI Scientist composer removed the Chat and Plan mode toggle, providing a single input with separate Ask and Prepare Calculation buttons.",
      "General planning and run limits moved into an overflow menu labeled 'More: find or draft a structure, extract figures, run limits'.",
      "Merged the two tab rows in the Advanced dock into one header row, expanding conversation area above 65% of panel height.",
      "Suggestion chips tailored strictly by structure type, omitting molecular calculation proposals on periodic crystal records.",
      "AI Scientist system prompt instructs answers to be direct and concise without unprompted inventory summaries or capability boilerplate.",
    ],
    fixed: [
      "Enforced a deterministic filter stripping first-person claims or promises that the assistant will add, edit, or modify atoms or structures, appending instructions to use the structure editor.",
      "Fixed conversation scrolling to jump to bottom on send and align the beginning of incoming answers without disrupting users who scrolled up to read.",
      "Removed stale 'Completed - Refresh run status' workflow strip from the Chat tab after a run finishes.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "No scientific engine ran for this release and no scientific result changed. Nothing here is a new scientific claim.",
        "Live model behavior against prompt set is NOT VERIFIED until the architect runs an authorized live prompt session.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release.",
        "Structure measurements are computed from stored committed coordinates in the database, not recalculated by a quantum engine.",
        "Interatomic distance calculations use a standard periodic minimum-image convention across 27 unit cell lattice shifts.",
        "Calculation proposals in the AI Scientist remain restricted to molecular single-point energy proposals requiring explicit human approval.",
      ],
    },
  },
  {
    version: "0.0.57",
    date: "2026-11-14",
    title: "Honest Quantum ESPRESSO wording, chat submit filter, image citation metadata, AI panel declutter, and pulse light",
    summary:
      "Clarified the Quantum ESPRESSO live check status across all documentation, enforced a deterministic filter in plain chat mode removing unfulfilled assistant promises to submit calculations, embedded standard citation metadata in all exported molecule images with an optional credit line and publication caption, decluttered the AI Scientist panel to increase reading height, and introduced a pulse light indicator built strictly from persisted worker heartbeat signals.",
    added: [
      "Standard citation metadata (software, source URL, and DOI) embedded in all PNG text chunks and SVG image exports.",
      "An optional credit line checkbox in the snapshot dialog ('Add a small \\'Rendered with ChemDFT\\' line') remembered per viewer, off by default.",
      "A 'Copy figure caption' action in the image export dialog and the Cite panel for citing rendered molecular structures and calculation methods.",
      "A dismissible inline citation hint for published calculation results and successful image exports.",
      "A heartbeat pulse light indicator reflecting real worker and scheduler lifecycle stages (starting the compute machine, active worker check-ins, and overdue signals with a cancel action).",
    ],
    changed: [
      "The AI Scientist panel header, top bar, and composer were compacted to maximize question and answer height while keeping all Result Firewall badges and citation provenance intact.",
      "Starter prompt chips on periodic crystal records no longer propose molecule-specific queries.",
      "Project export archives include software citation and Methods text.",
    ],
    fixed: [
      "Corrected the Quantum ESPRESSO crash fix wording to state accurately that after the fix the architect ran one periodic job live and it completed without the crash; one clean run is encouraging, not proof; no independent verification.",
      "Enforced a post-model filter in plain chat mode that removes any first-person promise to submit, queue, or run a calculation, appending instructions to use 'Plan a calculation' in the AI box.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "No scientific engine ran for this release and no scientific result changed. Nothing here is a new scientific claim.",
        "Trackpad swipe-back (from release 0.0.56) remains NOT VERIFIED on real hardware until the owner tests it.",
        "Image citation metadata surviving third-party image compression, re-encoding, or EXIF stripping services is NOT VERIFIED.",
        "Live model re-check against nemotron-3.5-lightning-30b-a3b is NOT VERIFIED until the architect runs an authorized live check.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release.",
        "PNG text chunks and SVG metadata may be discarded by third-party image hosts or social networks that re-encode uploaded images.",
        "The pulse light indicator reflects persisted scheduler leases and reported worker heartbeats; it cannot inspect remote worker processes directly.",
      ],
    },
  },
  {
    version: "0.0.56",
    date: "2026-11-14",
    title: "Trackpad swipe-back restored, and the contact page names the team",
    summary:
      "On Mac Chrome the two-finger swipe to go back did not work on any page because of a page-wide scroll setting. That setting is now limited to the project workspace and to vertical scrolling only. The contact page now says messages go to the ChemDFT team.",
    added: [],
    changed: [
      "The contact page says messages are delivered directly to the ChemDFT team instead of naming a person. The email address is unchanged.",
    ],
    fixed: [
      "The browser's two-finger swipe-back gesture was disabled on every page. The page-wide horizontal scroll lock was removed; only the project workspace keeps a vertical no-bounce setting.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "No scientific engine ran for this release and no scientific result changed. Nothing here is a new scientific claim.",
        "The swipe-back fix is NOT verified with a real trackpad: only the computed browser setting was checked automatically. It stays unconfirmed until the owner tries it.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; it changes one scroll setting and one sentence.",
        "Checked in Chrome on a development build only; other browsers and touch devices were not tested.",
      ],
    },
  },
  {
    version: "0.0.55",
    date: "2026-11-14",
    title: "A tidier top navigation: the Contact and Account overlap is fixed",
    summary:
      "The public top bar was crowded and, when you were signed in, Contact and Account could be drawn on top of each other. The bar now shows the main pages, a More menu for Reproducibility and Contact, the Account link, the Open ChemDFT button and the language switcher, and collapses into a Menu button on narrower screens. This release changes labels and layout only; no calculation, engine or result changed.",
    added: [
      "A More menu in the top bar (Reproducibility and Contact). It opens with the keyboard, closes on Escape or a click outside, and reports its state to screen readers.",
      "On narrower screens (under 1100 px) the links collapse into one Menu button that opens a full-width panel.",
    ],
    changed: [
      "The top-bar label \"Result firewall\" is now \"Result checks\". The formal name, Scientific Result Firewall, is unchanged on the page itself.",
      "\"Coming soon\" for Turkish, Russian and German is now a tooltip on those language codes instead of a loose word in the bar; the language switcher stays visible at every width.",
    ],
    fixed: [
      "Contact and Account (and neighbouring links) could overlap on desktop widths. The links, the More menu and the actions now sit in one row that is checked for overlap and sideways scrolling at 360 to 1920 px in the English and German pages.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "No scientific engine ran for this release and no scientific result changed. Nothing here is a new scientific claim.",
        "Turkish, Russian and German pages are not translated yet; the navigation labels are English in every language, so longer translated labels have not been tested.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; it changes the top navigation only.",
        "The layout was checked in an automated browser (Chrome) on a development build, not on a physical phone or other browsers. Signed-in Account was checked with a stand-in link in that build, not a real session.",
      ],
    },
  },
  {
    version: "0.0.54",
    date: "2026-11-14",
    title: "Wording and record corrections after the live checks, a safer chat reply, and a nightly live-check script",
    summary:
      "After release 0.0.53 went live, the owner ran it on chemdft.com. This release makes the public text match what was found: hosted geometry optimisation is switched on by an owner decision, geomeTRIC is still inside the deployed compute image, and whether its no-AI-training clause applies is an open legal question. The AI Scientist's plain chat mode no longer promises to submit a calculation it cannot submit. A script for a free, read-only live check was written but has not been run.",
    added: [
      "The Validation page lists the live platform checks of 2026-11-14 separately from the one comparison with an independent run, and says what was not done.",
      "A live-check script for the maintainer: it signs in, loads the projects page and a workspace without the error screen, checks the health and capability flags, and can optionally run one H2 HF/STO-3G job and compare its energy. It is not run by this release.",
    ],
    changed: [
      "Text that said hosted optimisation was withdrawn or that the image would be rebuilt was corrected where it stood (release notes, Validation page, licence audit, technology registry, owner decision brief).",
      "In plain chat mode the AI Scientist is told it cannot submit or run anything and must point to \"Plan a calculation\" instead of saying it will submit.",
    ],
    fixed: [
      "In plain chat mode the AI Scientist could write \"Let me submit this for you now\" although nothing was submitted. The instruction to the model now forbids that wording. This is a prompt change and is covered by a test of the instruction text; a model can still deviate, and it has not been re-checked live.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Live on chemdft.com, checked by the owner after release 0.0.53: H2 with HF/STO-3G through the AI-planned path (plan mode, approval card, approve) gave -1.11676 Eh (rounded to 6 digits) and passed the Result Firewall (validated). A manual PySCF geometry optimisation of H2 converged in 4 evaluations (new structure \"H2 - optimized V2\") and passed the Result Firewall.",
          platform: "Hosted AWS pilot instance (one platform)",
          engine: "PySCF 2.14.0; geomeTRIC for the optimisation",
        },
      ],
      notYetVerified: [
        "An AI-proposed geometry optimisation and an AI-proposed xTB calculation (plan mode offers single-point energy only) were not tested live.",
        "Independent verification of both H2 results: none. They are results of this platform only, not evidence for another platform.",
        "The live-check script has not been run, and docker-compose.selfhost.yml has not been run (no Docker on the build machine).",
        "That the chat-mode instruction stops the wording with every model; only the instruction text is tested.",
      ],
      knownLimits: [
        "geomeTRIC 1.1.1 is in the deployed compute image and hosted optimisation is on by owner decision. Its licence clause 4 (no use in AI-training datasets) may or may not apply; that is an open question for a lawyer, and the project's legal reading is not done.",
        "The script that would remove geomeTRIC from the deployed image exists and was not run.",
        "The Zenodo description of version 0.0.53 still carries the older wording about optimisation; it will be updated in the next published version.",
      ],
    },
  },
  {
    version: "0.0.53",
    date: "2026-11-14",
    title: "Fix for the workspace crash when a periodic Quantum ESPRESSO job completes, and PySCF optimisation withdrawn from the hosted version",
    summary:
      "A finished Quantum ESPRESSO periodic job could replace the whole workspace with \"The workspace could not load\" a few seconds after it succeeded. The cause was found and fixed: the results summary assumed every result names a method and basis, and a Quantum ESPRESSO result does not. The same assumption was checked everywhere else it could occur. Hosted PySCF geometry optimisation became switchable by a server setting (off by default in code). geomeTRIC left the repository's lock files, but the owner has since switched hosted optimisation on and the deployed image still contains geomeTRIC; whether its no-AI-training clause applies is an open legal question.",
    added: [
      "A test that mounts the Calculate panel, the energy plate and the Quantum ESPRESSO results with a real stored result at the moment a job changes from running to succeeded, so the exact failure seen live is now covered.",
      "A server setting (CHEMDFT_COMPUTE_AWS_GEOMETRIC_AVAILABLE, default off in code) that controls hosted PySCF geometry optimisation. While it is off, the Calculate panel, the guided panel and the server refuse it with \"not available in the hosted version; see Self-hosting\". The owner has since turned it on for the live site. xTB optimisation is unaffected.",
      "A live smoke-test script and instructions for the maintainer to check a Quantum ESPRESSO job end to end after each deploy (not run by this release).",
    ],
    changed: [
      "geomeTRIC is no longer part of the dependency lock files for a new hosted image build. It remains an optional extra for anyone running ChemDFT themselves. The image actually deployed (chemdft-pilot:runtime-qe-0046) was not rebuilt and still contains it.",
      "The energy plate treats a missing method, basis or engine name as unknown instead of failing.",
    ],
    fixed: [
      "The workspace no longer shows \"The workspace could not load\" when a periodic Quantum ESPRESSO job completes: the Method / basis line falls back to PBE+U (or PBE) and the plane-wave basis when the result carries none.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "After the fix the architect ran one Quantum ESPRESSO periodic job live on chemdft.com and it completed without the crash; one clean run is encouraging, not proof, and there is no independent verification. The fix is also covered by automated regression tests (a test that fails without the fix with the exact production error reading toUpperCase of undefined and passes with it, and a whole-path render test with the real Quantum ESPRESSO result).",
          platform: "Live chemdft.com (AWS pilot) and developer machine automated test suites",
          engine: "Quantum ESPRESSO 7.6 (one live periodic run; no independent verification)",
        },
      ],
      notYetVerified: [
        "Independent verification of the Quantum ESPRESSO crash fix: after the fix the architect ran one QE periodic job live and it completed without the crash; one clean run is encouraging, not proof; no independent verification.",
        "AI-planned proposals on the hosted platform beyond a single-point energy. One AI-planned H2 HF/STO-3G calculation was run live and validated after deployment (PySCF 2.14.0, AWS pilot only); an AI-proposed geometry optimisation and an AI-proposed xTB calculation were not tested, and none of these results was independently verified.",
        "docker-compose.selfhost.yml has not been run: Docker is not available on the build machine.",
        "No new scientific result was produced. The single Cr2O3 agreement check from 0.0.52 (Quantum ESPRESSO 7.6, one structure, one platform) is unchanged.",
      ],
      knownLimits: [
        "The deployed compute image still contains geomeTRIC. The script that would remove it from the image exists and was NOT RUN, and the owner has chosen to keep hosted optimisation usable for now. Whether geomeTRIC 1.1.1 clause 4 (no use in AI-training datasets) applies is an open question for a lawyer.",
        "The legal reading of the licence structure has not been done by a lawyer, and the source repository is not published.",
      ],
    },
  },
  {
    version: "0.0.52",
    date: "2026-11-14",
    title: "A more useful error screen, a regression test for the periodic-result crash, and accessibility fixes on the public pages",
    summary:
      "When the workspace hits an unexpected error, the error screen now shows the message and the component behind it, so a crash can be reported precisely. The earlier Quantum ESPRESSO completion crash is hardened further and covered by a test built from a real completed job, but its live trigger is not confirmed. Links in running text are now underlined and footer links are larger. Decision briefs for the owner were written; no decision was made.",
    added: [
      "The error screen has a collapsed Details section with the error message and the component name, and the error is logged to the browser console with a stable [chemdft-boundary] prefix. Nothing is sent to any server.",
      "A regression test that renders the result views with a real completed Quantum ESPRESSO periodic result and with variants (relaxation or DOS requested, missing Fermi energy, gap or local moments, empty stage list).",
      "Owner decision briefs (geomeTRIC, questions for a lawyer, publish-or-not plan) and a dry-run-only export-preview script. They record options and change nothing public.",
    ],
    changed: [
      "Self-hosting guide: the Postgres connection string now uses the psycopg driver form the API actually installs.",
      "Links inside page text on Principles, Validation, Cost and support and similar pages are underlined, and footer links have a larger click target.",
    ],
    fixed: [
      "Hardening of the periodic result views against incomplete stage output. This is hardened, not confirmed fixed: the live trigger of the workspace crash on job completion has not been reproduced, and the owner re-tests after deployment.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "The web unit tests, including the new render tests for periodic Quantum ESPRESSO results, pass on the merge candidate. They check that the views render; they do not check any scientific value.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "The live trigger of the workspace crash after a periodic job completes. The new tests render the views on the real payload and do not throw, so the cause may lie elsewhere, for example in effects or state changes while the panel is open, which a server-render test cannot exercise.",
        "docker-compose.selfhost.yml was checked only by reading and parsing it. Docker is not available on the build machine, so it was never run.",
        "AI-planned proposals on the hosted platform remain unverified; the human-driven path is the one verified live.",
        "No scientific engine ran for this release. The single Cr2O3 agreement check described on the Validation page is unchanged and covers one structure on one platform.",
      ],
      knownLimits: [
        "The deployed image still installs geomeTRIC, whose licence forbids use in AI-training datasets; the owner has been given options and has not decided.",
        "The legal reading of the licence structure has not been done by a lawyer, and the source repository is not published.",
        "A Zenodo version is needed for this release; its version DOI is 10.5281/zenodo.24207715, and the all-versions DOI is 10.5281/zenodo.24082321.",
      ],
    },
  },
  {
    version: "0.0.51",
    date: "2026-11-13",
    title: "Preparing to publish the whole codebase: Apache-2.0 everywhere, geomeTRIC optional, and four audits",
    summary:
      "ChemDFT is getting ready to be published in full. Every part of ChemDFT's own code and documentation is now licensed Apache-2.0, and the repository no longer contains geomeTRIC, whose licence forbids use in AI-training datasets; geometry optimisation becomes an optional extra you install yourself. This release also publishes the third-party licence audit, the publication-readiness audit, an AI-authorship disclosure and a self-hosting guide. It also records one measured comparison of a stored Quantum ESPRESSO job with a direct run (Validation page), with its limits, and adds Principles and Cost and support pages.",
    added: [
      "A third-party licence audit: every engine and library ChemDFT runs, its licence, how it is used, and what a public release would have to carry.",
      "A publication-readiness audit of the repository and its history. It reports, and changes nothing public.",
      "An AI-authorship disclosure stating which coding agents wrote code, what the owner decides, and what is not verified.",
      "A self-hosting guide for running ChemDFT on your own machine. It is partly tested, and it says which steps were not.",
      "Contributor and governance documents for the coming public repository.",
      "Three public pages: Principles (with an AI-authorship disclosure), Cost and support, and Validation, linked from the footer and the Engines section.",
      "A docker-compose.selfhost.yml with a single Postgres service for the self-hosting guide. It was not run: Docker is not available on the build machine.",
    ],
    changed: [
      "Licence: all ChemDFT first-party code and documentation is Apache-2.0. Third-party material kept in the tree (CREST sources), retained evidence and the owner's artwork are marked explicitly and are not Apache-2.0. The source repository is still not published.",
      "geomeTRIC is no longer a default dependency: its licence forbids use in AI-training datasets. Optimisation now needs the optional 'optimization' extra, and the interface says so plainly instead of failing obscurely. The deployed image is unchanged until it is rebuilt.",
      "The footer and the licence page cite the 0.0.51 version DOI 10.5281/zenodo.24204004 and the all-versions DOI 10.5281/zenodo.24082321; they no longer point at the 0.0.46 record.",
      "The snapshot builder can now produce an all-first-party snapshot with --scope all-first-party; the default stays open-core, so nothing about the published record changes yet.",
    ],
    fixed: [
      "When a Quantum ESPRESSO periodic job finished while the calculate panel was open, the page could show \"The workspace could not load\" until you pressed Try again. A render test reproduced a crash on a null magnetic moment in the result block; null or non-numeric moments and incomplete relaxation blocks are now skipped instead of crashing. The exact payload that triggered the live failure was not captured, so this fix is not confirmed against it.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "α-Cr2O3 (10 atoms, antiferromagnetic), Quantum ESPRESSO 7.6, SSSP PBE Efficiency v2.0, PBE+U Dudarev with U_eff(Cr) 2.0 eV, ecutwfc 45 Ry, ecutrho 540 Ry, Γ only, Fermi-Dirac 0.01 Ry: a stored job run through the live site gave a total energy of -476.0906515824172 Ha in 16 SCF iterations, Fermi energy 12.95961 eV and Löwdin Cr moments -3.0028, -3.0028, +3.0028, +3.0028 μB. The same pw.x input run directly in the same container image on the same machine gave -952.18130316 Ry (-476.09065158 Ha), 16 iterations, 12.9596 eV and the same moments. An earlier stored job with the same settings gave -476.0906515824173 Ha and 16 iterations. This verifies execution, parsing and reproducibility on that platform only.",
          platform: "AWS EC2 pilot machine, 2 vCPU, the QE 7.6 pilot container image",
          engine: "Quantum ESPRESSO 7.6",
        },
        {
          statement:
            "The web unit tests, the type check and the code style check pass on the merge candidate, including the release-consistency, licence-map and third-party-licence table tests.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "The native run used ChemDFT's own input generator, so the comparison does not show that the generated input is the right physics. No comparison against another code or against literature is claimed. It is one structure on one platform; a result from one platform is not evidence for another.",
        "The Cr2O3 comparison above was run before this release by the owner and is recorded here; this release's code changes ran no engine and re-checked no other result. The verification statements in earlier releases still describe their own runs only.",
        "AI-planned proposals remain unverified on the hosted platform; two-account isolation remains unverified live; live Google sign-up with a new account remains unverified.",
      ],
      knownLimits: [
        "Licence questions are open: CREST's GPL scope, the SSSP pseudopotential terms and whether the hosted image conveys GPL binaries. They are recorded as questions for a lawyer, not answered.",
        "The legal reading of the licence structure has not been done by a lawyer.",
        "The public source repository is not published, so no statement here claims that ChemDFT is open source.",
        "A Zenodo version is needed for this release because the licence map changed; the 0.0.51 version DOI is 10.5281/zenodo.24204004.",
      ],
    },
  },
  {
    version: "0.0.50",
    date: "2026-11-13",
    title: "Home page: a worked Cr2O3 example, clearer Engines labels, a header that no longer overlaps, plainer licence wording",
    summary:
      "The home page now shows one real stored calculation (α-Cr2O3, Quantum ESPRESSO 7.6) with its caveats. Psi4, DFT-D4 and GPU4PySCF are labelled Not available with one factual reason each. The header no longer floats over the page when you scroll. The footer line about accounts matches the Google sign-up now open to beta testers, and licence notes use plain status wording. The software citation lists the version DOI of this release.",
    added: [
      "A Worked example block on the home page: one stored job (α-Cr2O3, 10 atoms, antiferromagnetic start, PBE+U with U_eff(Cr) 3.7 eV, relaxation in 3 ionic steps, total energy -475.99968609 Ha, Löwdin Cr moments ±2.9995 μB, Kohn-Sham gap 3.239 eV, 463.6 s) and a second stored run with different settings. Caveats are printed with the numbers; there is no comparison with experiment or literature.",
    ],
    changed: [
      "Psi4, DFT-D4 and GPU4PySCF show Not available with one reason from the technology registry; engines that are only planned keep Not available yet.",
      "Header: it stays one solid row (the Account, Open ChemDFT and language cluster no longer wraps onto the page content); the mobile menu opens as its own panel under the header. Contact leaves the bar between 1000 and 1139 px (it stays in the menu and footer).",
      "Footer line: new accounts through Google while beta places last; email sign-up, public sign-up and pricing are not available yet.",
      "Licence notes say plainly that ChemDFT's use of geomeTRIC (which carries a no-AI-training clause), DFT-D4 and Psi4 is under review, instead of Owner decision pending. The CREST note now records what the upstream repository holds (both GPL-3.0 and LGPL texts).",
      "CITATION.cff and the software citation data list the version DOI 10.5281/zenodo.24201081 for this release; the all-versions DOI stays the citation DOI.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "No new engine run in this release and nothing is newly verified. The worked example repeats a stored result: CALCULATED with Quantum ESPRESSO 7.6 and SSSP PBE Efficiency v2.0 on this platform (Linux x86_64, pilot EC2) only; it is not evidence for any other platform.",
        "Live sign-up with a new Google account is not verified by this release.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; the worked example shows a result stored earlier.",
        "The gap is a Kohn-Sham PBE+U eigenvalue gap, not an optical or experimental gap; U is a platform default, not fitted; one calculation is not a benchmark.",
        "The home page header on touch-size phones still overflows by about 50 px (phone layout is deferred).",
      ],
    },
  },
  {
    version: "0.0.49",
    date: "2026-11-13",
    title: "Licences: ChemDFT's own licence and the licence of every engine and library it uses, in one open table",
    summary:
      "The License page now carries a full table of the engines and libraries ChemDFT calls, with version, licence, how it is used, a link to the upstream project and any clause that matters. The home page has a short Licences section after Engines, each engine card shows its licence from the same data, and the cite page points to it.",
    added: [
      "A third-party licence table on the License page with 39 rows, including Quantum ESPRESSO, the SSSP pseudopotentials, geomeTRIC, xTB, CREST, Psi4, DFT-D4, RDKit, pymatgen, cclib, Libxc, libcint and the main web libraries. Rows whose licence is not recorded say so instead of guessing.",
      "A Licences section on the home page and a licence line on the cite page.",
      "The License page names the three files held back from the public open-core archive and links the Zenodo archive of the open-core part.",
    ],
    changed: [
      "Each Engines card shows its licence, taken from the same table, so the two cannot disagree.",
      "The header no longer wraps onto a second line between 1000 and 1159 pixels wide, and the signed-in header fits narrow windows better.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Some licences are Not verified or Licence not yet recorded: the SSSP pseudopotential files (mixed per-file terms, two sources disagree for some), the CP2K GTH and MOLOPT data, LibXC inside PySCF, ASE, pypdf and the planned QCFractal, Basis Set Exchange, nmrglue and pyOpenMS.",
        "The upstream CREST repository currently shows LGPL-3.0, while the accepted patched 3.0.2 copy records GPL-3.0 with LGPL-3.0 components; this is not resolved.",
        "A legal read of the licence structure, including the copyleft licences and geomeTRIC's added no-AI-training clause, is still pending; the page states no legal conclusion and is not legal advice.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; it documents licences only.",
        "Upstream links point to each project, which holds its licence text; they are not links to pinned licence files.",
        "The Turkish, Russian and German addresses still open the English page when typed directly.",
      ],
    },
  },
  {
    version: "0.0.48",
    date: "2026-11-13",
    title: "Coming soon is now visible for Turkish, Russian and German; citation metadata records the 0.0.46 source snapshot",
    summary:
      "A follow-up to 0.0.47: the language switcher now writes Coming soon next to TR, RU and DE, the Engines cards got a design and accessibility pass, and the citation metadata records the Zenodo version DOI of the release 0.0.46 open-core source snapshot.",
    added: [],
    changed: [
      "Turkish, Russian and German are marked with the visible text Coming soon; they remain disabled. On narrow screens the text sits under the language codes so the header does not wrap.",
      "Engine cards show each version on its own line, and the section heading follows the site's type scale.",
      "CITATION.cff and the software citation data list DOI 10.5281/zenodo.24183501 as the version DOI of the release 0.0.46 open-core source snapshot. The all-versions DOI stays the citation DOI.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "The Zenodo snapshot archives source code and contracts only; it does not verify any scientific result.",
        "Nothing about engine capabilities changed; the Engines cards still make no claim of verification beyond what the registry records.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; it changes the website, citation metadata and documentation only.",
        "The Turkish, Russian and German addresses still open the English page when typed directly.",
      ],
    },
  },
  {
    version: "0.0.47",
    date: "2026-11-13",
    title: "Engines section rebuilt with one card per engine; Turkish, Russian and German marked as coming soon",
    summary:
      "The Engines section of the landing page now shows every engine, including Quantum ESPRESSO and periodic PySCF, as a card with its role, status, recorded version and limits, grouped by job and always visible. Turkish, Russian and German are shown in the language switcher as coming soon.",
    added: [
      "Engine cards for molecular calculations (PySCF, geomeTRIC, xTB, CREST), periodic crystals (Quantum ESPRESSO, periodic PySCF) and structures and imports (RDKit, pymatgen, cclib), each with what it can and cannot do today.",
      "A line linking the release notes, the stored run record and the open-core source snapshot for release 0.0.46 on Zenodo.",
    ],
    changed: [
      "The Engines section moved to directly after How it works and is no longer collapsed; the Engines link in the header follows the same order.",
      "Every item from the earlier Not available yet and Planned lists is kept; periodic limits (no cell relaxation, stress, phonons, hybrid functionals or spin-orbit coupling) were added.",
      "The language switcher shows TR, RU and DE as disabled with a coming-soon hint; English is the only active language. Those pages were English fallback copy before this change.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Nothing scientific changed and no calculation was run for this release; the cards restate what the code and the technology registry record.",
        "Hosted acceptance of Quantum ESPRESSO atom relaxation and of periodic PySCF is not recorded in the repository for release 0.0.46, so the cards do not claim it.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release.",
        "Hosted runs of most engines cover only a few cases and are not independently verified; limits shown are those of the hosted worker.",
        "The Turkish, Russian and German addresses still open the English page when typed directly.",
      ],
    },
  },
  {
    version: "0.0.46",
    date: "2026-11-13",
    title: "Relaxed Quantum ESPRESSO results now report the relaxed structure; hosted periodic PySCF uses the right worker",
    summary:
      "Two defects found by running the hosted site: a Quantum ESPRESSO atom relaxation converged but was rejected because its headline energy described the starting geometry, and hosted periodic PySCF jobs were started with the molecular worker and died within seconds.",
    added: [],
    changed: [
      "After a converged Quantum ESPRESSO relaxation the worker now runs one fixed-geometry calculation at the relaxed positions and reports the energy, band gap, Fermi level, magnetization, k-point count and local moments from it. Its energy must agree with the relaxation's own final energy to 1e-6 Ha, otherwise nothing is published and the message says so.",
      "Hosted periodic PySCF jobs get 2 CPUs, 6 GiB of memory and the disk scratch area (also used for the Quantum ESPRESSO runs).",
    ],
    fixed: [
      "A relaxation that converged was rejected with \"candidate energy contradicts the retained native log\" because the saved result held the first ionic step. The reported energy now describes the relaxed geometry and the strict log check is unchanged.",
      "The reported final force of a relaxation could contradict the engine log; a value larger than the log's own total force is no longer shown (it reads n/a) and the total force is stored.",
      "Hosted periodic PySCF jobs ran the molecular PySCF worker on the crystal and failed within seconds (\"LibXCFunctional: name 'U' not found\"). They now run the periodic worker, and the molecular worker refuses a periodic job with a clear message.",
      "Two failures have plain messages: a relaxed result that could not be confirmed against the engine log, and a hosted worker that fails to start within 30 seconds.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Neither fix has been run on the hosted site yet; they are tested with stand-in programs and simulated hosts only. The Quantum ESPRESSO container image must be refreshed for the fixed worker to run there.",
        "Which ionic step the saved Quantum ESPRESSO result file holds after a relaxation was inferred from the failing job's numbers, not confirmed against the full engine log.",
        "Hosted periodic PySCF memory and scratch use have not been measured; PySCF and Quantum ESPRESSO energies are not comparable with each other.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release.",
        "A relaxation now costs one extra single-point calculation at the relaxed geometry.",
      ],
    },
  },
  {
    version: "0.0.45",
    date: "2026-11-13",
    title: "Bigger Quantum ESPRESSO runs now fit the hosted site; save a relaxed structure as a new version; clearer job messages",
    summary:
      "Running Quantum ESPRESSO jobs through the hosted site exposed three problems that did not show up when the engine was run directly on the compute machine: a job could be refused because it asked for more time than one compute session has, the density-of-states step could be stopped by a per-file size limit, and any job longer than about five minutes could lose its place and be started again. All three are fixed, so larger Quantum ESPRESSO runs, including density of states and band structure, are meant to run on the hosted site. After an atom relaxation you can now save the relaxed positions as a new version of the structure, and failed jobs explain themselves in plain language.",
    added: [
      "Save relaxed structure as a new version: after a converged Quantum ESPRESSO atom relaxation, the result offers a button that creates a new version of the same structure with the relaxed atom positions (cell and elements unchanged, note: cell fixed; positions relaxed with Quantum ESPRESSO 7.6 PBE+U). The new version is recorded as calculated from that calculation, and the earlier version is never changed. The original source of an imported structure still has to be cited.",
    ],
    changed: [
      "Quantum ESPRESSO whole-job time cap is now one hour (it was two), so a job always fits inside one compute session together with its start-up and clean-up time. The per-stage limits are unchanged and none exceeds the whole-job cap.",
      "Quantum ESPRESSO jobs are no longer claimed when too little of the current compute session is left; they wait for the next session instead of failing.",
      "Quantum ESPRESSO and periodic jobs now hold their lease for the length of their own time limit, and a retried job attaches to the run that is already going or finished instead of starting a second one.",
    ],
    fixed: [
      "A Quantum ESPRESSO job could fail at once with \"not enough session time\" because its time cap was longer than a whole compute session.",
      "The density-of-states step could stop with \"File size limit exceeded\": Quantum ESPRESSO now gets a larger per-file limit, bounded by its scratch-space cap, while other engines keep the 64 MiB limit.",
      "Hosted jobs running longer than about five minutes were marked lost and re-run, doubling the compute time. Their lease now lasts as long as the job's own limit.",
      "Quantum ESPRESSO jobs were labelled \"Unrecognized engine\" in the Jobs page; they now read Quantum ESPRESSO periodic energy (PBE+U), and failed attempts show the real engine and worker.",
      "Three known failures now have plain-language messages: session too short, a file-size limit stopping a step (the step is named), and a lost worker heartbeat. The raw engine log stays available.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "None of these fixes has been run on the hosted site yet; they are tested with simulated clocks and fake hosts only. Quantum ESPRESSO runs with density of states and band structure, and runs longer than five minutes, have not been run through the hosted site since the fixes.",
        "Saving a relaxed structure was tested with stored result documents, not with a live relaxation. Hosted PySCF periodic Gamma has not been run through the site either.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; it changes limits, scheduling, labels and one structure-version feature.",
        "A saved relaxed structure keeps the cell fixed; cell relaxation, stress and pressure are not offered.",
        "The relaxed positions are exactly those stored with the Quantum ESPRESSO result; no symmetry clean-up is applied.",
        "The run-time estimates are rough planning figures.",
      ],
    },
  },
  {
    version: "0.0.44",
    date: "2026-11-13",
    title: "Hosted PySCF periodic jobs can now be launched (Gamma point); Quantum ESPRESSO image recipe fixed and tested on AWS",
    summary:
      "Hosted PySCF periodic jobs asked for a three-hour limit that the compute machine does not accept, so they could not start. They now ask for at most one hour and are offered at the Gamma point only; bigger k-point meshes are available with the Quantum ESPRESSO engine on the hosted beta when it is enabled. The Quantum ESPRESSO image recipe was corrected so it builds without manual edits, and the run-time estimate for Quantum ESPRESSO was recalibrated on the runs measured on AWS.",
    added: [],
    changed: [
      "Hosted PySCF periodic: k-mesh Gamma only and a one-hour limit. The refusal for larger meshes says in plain language that bigger k-point meshes are available with the Quantum ESPRESSO engine on the hosted beta when Quantum ESPRESSO is enabled. The 2x2x2 option is shown but not selectable for PySCF.",
      "The estimate for a hosted PySCF periodic Gamma job (10 atoms) is about 17 minutes, from one measured run of 1009 s; it is an estimate and other cells will differ.",
      "The Quantum ESPRESSO run-time estimate was recalibrated against four measured runs (Gamma 57 s, 3x3x3 102 s, relaxation 417 s, 3x3x3 with DOS and 49-point bands 622 s); it was about 2.4 times too high for the two larger ones. Limits and time caps are unchanged.",
    ],
    fixed: [
      "Hosted PySCF periodic jobs could not be launched because the requested time limit (3 hours) was above what the compute machine accepts (1 hour). Every hosted engine's requested time limit is now checked against the machine's cap before release.",
      "Quantum ESPRESSO image recipe: source checksum recorded, git and ca-certificates added, security package snapshot added, and the final code-refresh stage is now a named Dockerfile stage.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Quantum ESPRESSO 7.6 through ChemDFT's own worker, alpha-Cr2O3 antiferromagnetic PBE+U (U = 3.7 eV on Cr): Gamma gap 3.6796 eV with local moments 3.0607 muB; 3x3x3 gap 3.2471 eV with local moments 2.997 muB; relaxation converged with Cr z back to 0.84796; gaps from DOS eigenvalues and along the band path within 0.03 eV of 3.23 eV. These are Kohn-Sham gaps on this platform only.",
          platform: "Hosted AWS Linux worker (2 vCPU, 8 GB)",
          engine: "Quantum ESPRESSO 7.6, SSSP PBE Efficiency v2.0",
        },
        {
          statement:
            "Periodic alpha-Cr2O3 antiferromagnetic PBE+U (U = 3.7 eV on Cr) at Gamma converged to a Kohn-Sham gap of 3.8498 eV with local moments 3.1103 muB in 1009 s.",
          platform: "Hosted AWS Linux worker (2 vCPU, 8 GB)",
          engine: "PySCF 2.14.0 periodic (GTH-PBE, gth-dzvp-molopt-sr)",
        },
      ],
      notYetVerified: [
        "PySCF periodic at 2x2x2 and 3x3x3 was not measured on the hosted machine and is not offered there.",
        "Releases 0.0.41 to 0.0.44 are not deployed yet.",
      ],
      knownLimits: [
        "PySCF uses every k-point of a mesh without symmetry reduction, so larger meshes are expected to exceed the one-hour limit.",
        "The run-time estimates are rough planning figures.",
      ],
    },
  },
  {
    version: "0.0.43",
    date: "2026-11-12",
    title: "Quantum ESPRESSO plane-wave engine for crystals: relaxation, density of states and band structure",
    summary:
      "A second engine for periodic crystals. Quantum ESPRESSO runs plane-wave DFT with a fixed, library-recommended set of pseudopotentials and cutoffs, and adds atom relaxation with the cell held fixed, the density of states with its projections, the band structure along a high-symmetry path, and projected local spin moments. The PySCF periodic engine from the previous releases is unchanged. Nothing in this release has been run by ChemDFT on a compute machine yet: the engine arrives switched off on the hosted beta and is switched on only after the owner has built and tested the compute image.",
    added: [
      "An Engine choice in the periodic setup: PySCF periodic (localized Gaussian basis) or Quantum ESPRESSO (plane waves with the fixed SSSP PBE Efficiency v2.0 library, shown read-only). Every number shows which engine produced it.",
      "Quantum ESPRESSO single-point energy with collinear magnetism (none, ferromagnetic, antiferromagnetic), PBE or PBE+U (Dudarev U per element), Gamma, 2x2x2, 3x3x3 or 4x4x4 k-meshes and Fermi-Dirac smearing.",
      "Optional atom relaxation with the cell fixed, optional density of states and projected DOS (spin up above, spin down below, relative to the Fermi level, with a CSV export of the plotted data), and optional band structure along a high-symmetry path with the gap along that path.",
      "Local spin moments from the Lowdin projection, labelled \"Local spin moment (Lowdin projected)\" so they are never confused with the Mulliken-type populations that PySCF reports.",
      "A clearly labelled rough run-time and memory estimate before you press Run, and plain-language refusals for jobs above the hosted limits (20 atoms, k-mesh up to 4x4x4, DOS mesh up to 6x6x6, band path up to 100 k-points, estimated memory 6 GB, whole job 2 hours).",
      "Citations: every Quantum ESPRESSO periodic calculation lists Quantum ESPRESSO, PBE, the SSSP library and the original library of each pseudopotential used, plus Dudarev (and the ortho-atomic reference) when +U is on, the default-U source when a default was used, and Lowdin when local moments are reported.",
    ],
    changed: [
      "Periodic setup text, Learn and the AI app guide now state exactly what periodic DFT offers and what it does not: no cell relaxation, no stress or pressure, no phonons, no hybrid functionals, no noncollinear or spin-orbit calculations, no molecular dynamics. They also say that antiferromagnetic solutions are local minima that depend on U and on the pseudopotentials.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Quantum ESPRESSO has not been run by ChemDFT. The compute image has not been built, and the engine is switched off on the hosted beta.",
        "The values the owner measured outside ChemDFT on a temporary AWS machine (alpha-Cr2O3, antiferromagnetic, PBE+U with U = 3.7 eV, QE 7.6: Kohn-Sham gap 3.680 eV at Gamma and 3.247 eV at 3x3x3, Lowdin moment about 3.0 muB per Cr, a 6-step relaxation, path gap 3.231 eV) are the targets of the opt-in acceptance tests; they are not results published by ChemDFT.",
        "The Quantum ESPRESSO gaps come out about 0.2 eV below the PySCF ones for the same crystal: different pseudopotentials and +U projectors. Both are Kohn-Sham gaps, not measured gaps.",
        "Saving a relaxed structure as a new structure version is not offered; the final coordinates are shown in the result.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release: Quantum ESPRESSO has not been run by ChemDFT on any machine, so nothing here is a ChemDFT result yet.",
        "Cutoffs and pseudopotentials are fixed by the library; elements without a pseudopotential or without a verified original-library reference (including La, Pa and U) are not offered, and +U needs a 3d projector in the pseudopotential.",
        "The stress printed at these cutoffs is not reliable, so stress, pressure and cell relaxation are not offered.",
        "The gap is always taken from eigenvalues, never from the broadened density-of-states curve; the band-structure gap is the gap along the chosen path only.",
        "The time estimate is scaled from one measured 10-atom run and can be far off.",
      ],
    },
  },
  {
    version: "0.0.42",
    date: "2026-11-12",
    title: "Corrected a reference title, clearer notes on +U defaults and spin populations",
    summary:
      "A small clean-up release on top of the periodic DFT work. It corrects the title of one citation, says plainly what the default Hubbard U values are and are not, and uses more careful names for the periodic results. No calculation or number changed. Periodic DFT is merged in the code but is not yet available on the hosted beta; it will be switched on together with the next release.",
    added: [
      "A short note under the Hubbard U fields: the default U values are Materials Project starting values for oxides, calibrated for formation energies with PAW potentials, not fitted to this basis or to band gaps, so test the sensitivity by changing U.",
      "A hover note on the per-atom spin values explaining that they are a basis-dependent projection and not directly comparable with an experimental magnetisation or neutron moment.",
      "The Methods paragraph for a periodic calculation now states the k-point mesh, the +U treatment, and the same cautions about the Kohn-Sham gap and the local spin populations.",
      "Automated checks that pin all seven periodic references (title, journal, volume, pages, year, DOI) to values checked against Crossref, and that every periodic refusal message is plain language and states its limit.",
    ],
    changed: [
      "\"Local magnetic moments\" is now labelled \"Local spin population (Mulliken-type)\" in the results, the Methods text, Learn and the AI app guide. The numbers are unchanged.",
      "The periodic gap is labelled as a Kohn-Sham gap from the converged SCF at the k-points used, not an optical gap.",
      "The refusal for molecular options on a periodic calculation now names the options and says only a single-point periodic energy is supported.",
      "The 0.0.40 version DOI is recorded in the citation metadata next to the 0.0.36 one. The all-versions DOI remains the one printed in citations.",
    ],
    fixed: [
      "The title of the MOLOPT basis set reference (VandeVondele and Hutter, J. Chem. Phys. 127, 114105, 2007) was wrong; it now reads \"Gaussian basis sets for accurate calculations on molecular systems in gas and condensed phases\" in every export (BibTeX, RIS, plain text, Methods).",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Periodic DFT has not been run on the hosted deployment; this release changes wording, labels, a reference title and tests only.",
        "The default U values have not been checked against this basis or against experimental band gaps; they are starting values.",
        "A new Zenodo version for 0.0.41 and 0.0.42 is not yet created.",
      ],
      knownLimits: [
        "No new scientific calculation was run for this release; the periodic results quoted for 0.0.41 are unchanged.",
        "Local spin populations depend on the basis set and the projection used; they are not measured magnetic moments.",
        "The Kohn-Sham gap is not an optical or transport gap.",
      ],
    },
  },
  {
    version: "0.0.41",
    date: "2026-11-12",
    title: "Phase 1 of Periodic DFT: crystal single-point energy, Dudarev +U, and collinear magnetism",
    summary:
      "ChemDFT can now run periodic density functional theory calculations on imported crystal structures using PySCF's periodic boundary conditions module. This first phase provides single-point energy and electronic structure analysis with PBE or PBE+U, collinear ferromagnetic or antiferromagnetic initial symmetry breaking along the trigonal axis, k-point sampling (Gamma-only and 2x2x2), GTH pseudopotentials with the MOLOPT basis, and Fermi smearing.",
    added: [
      "Periodic single-point DFT calculation setup in the workspace Calculation panel for periodic structures, supporting k-point mesh selection (1x1x1 Gamma-only and 2x2x2), magnetic ordering (non-magnetic KRKS, ferromagnetic KUKS, or antiferromagnetic KUKS with alternating initial 3d spin along the c-axis), and Dudarev +U with per-element U_eff on 3d transition metals.",
      "Results inspection plate for periodic calculations displaying ground-state total energy in Hartree and eV, Kohn-Sham band gap with explicit qualification, k-point mesh, total magnetization, and local Mulliken magnetic moments per magnetic atom.",
      "Isolated proprietary PySCF periodic worker implementing Gaussian density fitting (GDF), Dudarev KUKSpU, Fermi smearing, and scratch directory safety.",
      "Comprehensive scientific citations covering PySCF periodic (Sun 2018, Sun 2020), PBE (Perdew 1996), GTH pseudopotentials (Goedecker 1996, Hartwigsen 1998, Krack 2005), MOLOPT basis (VandeVondele 2007), Dudarev +U (Dudarev 1998), and Materials Project U parameters (Jain 2011).",
    ],
    changed: [
      "Calculation panel unlocks periodic structures for calculation rather than showing a view-only inspection notice.",
      "Basis and pseudopotential for periodic DFT locked to GTH-PBE and gth-dzvp-molopt-sr with validated coverage for elements Z=1-56 and 72-86.",
      "AI Scientist guidance and Learn documentation updated to state the bounded Phase 1 periodic DFT capability.",
      "Version 0.0.41 bumped across frontend, backend, citation metadata, and contracts.",
    ],
    fixed: [
      "Periodic structures were previously limited to visualization only without an electronic-structure calculation route.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Periodic single-point PBE energy for rock-salt MgO (2-atom primitive cell) at Gamma converged to -79.0385 Ha with Kohn-Sham band gap 7.06 eV using GTH-PBE pseudo and gth-dzvp-molopt-sr basis.",
          platform: "Local macOS worker (Apple Silicon, PySCF 2.14.0)",
          engine: "PySCF 2.14.0 (PBC module, KRKS, GDF density fitting, Fermi smearing sigma=0.005 Ha)",
        },
        {
          statement:
            "Periodic alpha-Cr2O3 PBE+U (U_eff=3.7 eV on Cr) at Gamma with collinear AFM start (+ - + - along trigonal axis) converged on reference runs to Kohn-Sham band gap 3.849 eV and local Cr magnetic moments +/-3.11 muB; 2x2x2 k-mesh converged to band gap 3.447 eV and moments +/-3.05 muB.",
          platform: "Reference benchmark runs (Linux/Mac, 2 CPU / 8 GB, PySCF 2.14.0)",
          engine: "PySCF 2.14.0 (PBC module, KUKSpU, Dudarev +U, GDF density fitting)",
        },
      ],
      notYetVerified: [
        "Periodic DFT runs on the hosted AWS EC2 deployment remain unexecuted and unverified (the scientific pilot is stopped).",
        "Elements outside the verified 3d transition metal test set (V, Cr, Mn, Fe, Co, Ni) and non-standard crystal symmetries have not been benchmarked.",
        "Version DOI for 0.0.41 is not yet minted on Zenodo.",
      ],
      knownLimits: [
        "Phase 1 supports single-point energy only: periodic geometry optimization, unit cell relaxation, band structure path interpolation, density of states (DOS), forces, stress tensors, and hybrid functionals are not supported.",
        "Hosted calculation limit is 20 atoms per unit cell and k-mesh 1x1x1 or 2x2x2; 3x3x3 and larger meshes are not offered on the hosted beta.",
        "Lanthanides and actinides (Z=57-71 and Z>86) are not covered by the GTH-DZVP-MOLOPT-SR basis set and are rejected before execution.",
      ],
    },
  },
  {
    version: "0.0.40",
    date: "2026-11-11",
    title: "Viewer controls wrap instead of scrolling sideways, and a tighter action row",
    summary:
      "The controls above the 3D viewer are now grouped into Look and Crystal and wrap onto a second line when the window is narrow, so nothing hides behind a sideways scrollbar. The 0.0.39 Display popover is gone; its controls sit in the Look group. Export, Share and the panel toggles stay on the same row as the actions, right-aligned, and the less-used actions move into a More menu when the row is narrow. The header stack above the viewer is tighter.",
    added: [
      "Look and Crystal control groups that wrap as a whole.",
      "More controls button that holds the Crystal group only in very small windows.",
    ],
    changed: [
      "Representation, Projection, Labels, Palette, Atom size, Label size, Measure, Visual bonds and View are shown directly instead of inside a Display popover.",
      "Explorer and Context toggles show icons only below 1200 px wide.",
      "Action row no longer wraps: Import calculation, Import experimental spectrum, Inspect and Ask AI move into More when the row is narrow.",
      "Version 0.0.40 across the frontend, backend constant, citation files and metadata.",
    ],
    fixed: [
      "The viewer control row scrolled sideways with a tiny scrollbar and hid controls such as Polyhedra on smaller windows.",
      "Export and Share could wrap onto their own line below the actions.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Layout was checked with offline automated browser tests at 1440x800, 1280x720 and 1100x700 on a periodic Cr2O3 structure only; it has not been checked in the hosted app or on other screens.",
        "The version DOI for this release is not yet issued; the Cite page shows only the concept DOI.",
      ],
      knownLimits: [
        "The viewer starts about 188 px from the top at 1440x800 with the side panels open, not the 150 px that was hoped for; the controls need two lines there.",
        "In windows shorter than about 450 px the viewer cannot reach half the window height because the fixed header and toolbars are taller than that.",
        "No new scientific calculation was run or verified for this release; no engine or result changed. Mobile phone layouts were not worked on.",
      ],
    },
  },
  {
    version: "0.0.39",
    date: "2026-11-11",
    title: "Compact structure workspace with the 3D viewer fully in view, and corrected Learn → Cite page",
    summary:
      "The Structure workspace now shows the 3D viewer in full on a 1440x800 and a 1280x720 window without scrolling the page. The structure summary is one slim row, the import controls moved into the toolbar Import button, the redundant Scientific visualization header band is gone, and the display options live in one Display popover. A Fit button joins the view presets, and clicking a view button no longer scrolls the page. The Learn → Cite page now carries a Cite your data sources too section, explains which tools to also cite, and no longer shows the outdated 0.0.26 Zenodo record line.",
    added: [
      "Fit button at the end of the view-preset bar.",
      "Import popover on the toolbar Import button (format, file choice, import).",
      "Display popover holding Labels, Palette, Visual bonds, View and Atom size.",
      "Cite your data sources too section with a worked example and an Also cite list on the Cite page.",
    ],
    changed: [
      "Structure summary is a single slim row of chips; the saved-structure count is kept for screen readers only.",
      "Explorer and Context panel toggles use short labels; their accessible names are unchanged.",
      "The Cite page names the Zenodo concept DOI, which always resolves to the latest version, instead of the 0.0.26 record.",
      "Version 0.0.39 across the frontend, backend constant, citation files and metadata.",
    ],
    fixed: [
      "The 3D viewer was pushed below the fold by stacked bands above it.",
      "Clicking a view button could scroll the page and push the viewer toolbar out of view.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Layout was checked with offline automated browser tests at 1440x800 and 1280x720 only; it has not been checked on other screens or in the hosted app.",
        "The version DOI for this release is not yet issued; the Cite page shows only the concept DOI.",
      ],
      knownLimits: [
        "No new scientific calculation was run or verified for this release; no engine or result changed.",
        "Mobile phone layouts were not worked on.",
      ],
    },
  },
  {
    version: "0.0.38",
    date: "2026-11-11",
    title:
      "Intuitive trackball rotation, crystal view presets, camera-attached lighting, 300 DPI snapshots, third-party citation registry and periodic report corrections",
    summary:
      "The 3D structure viewer rotation has been replaced with an arcball trackball (quaternion-based, non-inverting, cursor-following navigation without gimbal roll) and a turntable mode toggle ('Keep c vertical'). A compact one-click view preset bar (Front, Back, Left, Right, Top, Bottom, Isometric, Along a, Along b, Along c, Along a*, and perspective/orthographic toggle) with keyboard shortcuts 1–7 provides standard crystallographic orientations. Lighting is attached to the camera (headlight + soft fill + ambient + hemisphere in sRGB) so faces remain illuminated upon 360° rotation. Snapshot exports include content auto-cropping with margin, uniform monochrome grey bond styling, and 300 DPI metadata in PNG output. Exports and reports now include an 'Also cite' section referencing verified third-party scientific tools (pymatgen, RDKit, PySCF, xTB, CREST, geomeTRIC, DFT-D4, Three.js) used in the project, extract bibliographic provenance from CIF files, and correct periodic report bond counts (72 for hex Cr2O3 / 24 for rhombohedral) with unit cell geometry.",
    added: [
      "Arcball trackball rotation: front of structure directly tracks cursor drag (left drag rotates left, up drag rotates up) with no gimbal roll accumulation.",
      "Turntable mode ('Keep c vertical') toggle for crystal viewing.",
      "Compact view preset bar and keyboard shortcuts 1–7 (Front, Back, Left, Right, Top, Bottom, Isometric) and crystal axes (Along a, Along b, Along c, Along a*).",
      "Clickable triad axis tips to snap view along Cartesian or crystal axes.",
      "Double-click atom to center camera on it; double-click background to reset camera view.",
      "Headlight camera illumination with soft fill, ambient, and hemisphere lighting in sRGB color space.",
      "Publication snapshot crop-to-content with margin, uniform grey bond option, and 300 DPI pHYs PNG chunk.",
      "Third-party tool citation registry (pymatgen, RDKit, PySCF, xTB, CREST, geomeTRIC, DFT-D4, Three.js) and 'Also cite' export sections.",
      "CIF bibliographic source reference extraction and user-editable provenance source reference.",
    ],
    changed: [
      "Single source of truth for version 0.0.38 across frontend, backend, citations, and metadata.",
      "Report PDF and HTML for periodic structures display unit cell lengths, angles, volume, space group, and accurate inferred periodic bond counts (72 hex / 24 rhombohedral).",
      "Next.js image optimization set to unoptimized to preserve Hobby plan limits.",
    ],
    fixed: [
      "Inverted viewport rotation and gimbal roll drift resolved.",
      "Dark faces upon model rotation resolved by attaching key light to camera.",
      "Report bond count of 378 on hexagonal Cr2O3 cell corrected to 72.",
      "Missing BSD-3-Clause license file added for reuse compliance.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Trackball rotation mathematics verified: left-drag moves front-facing point to -x, up-drag moves it to +y, and closed loops leave no roll about view axis. CrystalNN periodic bond perception produces exactly 72 bonds for hexagonal Cr2O3 and 24 for rhombohedral Cr2O3.",
          platform: "Developer Mac (Apple silicon), local only",
          engine: "Scientific scene trackball & CrystalNN",
        },
      ],
      notYetVerified: [
        "Cloud worker execution and live production rendering across non-Chromium headless environments.",
      ],
      knownLimits: [
        "Periodic DFT execution in the backend is scheduled for a future release.",
        "A backend deploy is required to serve updated release_info and citation endpoints on production.",
      ],
    },
  },
  {
    version: "0.0.37",
    date: "2026-11-11",
    title: "Crystals now show bonds, axis labels, fixed views and high-resolution pictures",
    summary:
      "Crystal structures in the workspace now show periodic display bonds, coordination polyhedra around metal centers, labeled cell axes, an orientation triad, standard crystal viewing directions, and export high-resolution publication figures up to 4× with white or transparent backgrounds. Periodic bonds and polyhedra are display-only visual aids inferred from interatomic distances; no coordinates, stored bonds or exported structure files are changed.",
    added: [
      "Periodic display bonds for crystal structures, connecting atoms across unit cell boundaries without metal–metal bonds in oxides.",
      "Cell contents toggle between complete coordination with dashed boundary bonds and atoms in the cell.",
      "Coordination polyhedra around metal centers built from bonded ligand positions.",
      "Orientation aids including cell axis labels (a, b, c), a corner orientation triad, and standard view presets (Along a, Along b, Along c, Along a*, and Oblique) in both perspective and orthographic projections.",
      "High-resolution 3D view snapshots at 1×, 2×, and 4× (giving at least 3000 pixels on the long side for journal figures) with white or transparent background, including axis labels and legend.",
      "Atom size and label size scaling controls, and an element color legend.",
    ],
    changed: [
      "Visual bonds toggle is now enabled for crystal structures as well as molecules.",
      "Unit cell inspector displays cell volume alongside lengths and angles, reading stored cell data reliably.",
    ],
    fixed: [
      "Importing a second structure into a project with existing structures now displays the format selector and auto-submits reliably.",
      "The contact form service and verification user agent use the release version constant.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Chromium oxide alpha-Cr2O3 in both hexagonal (30 atoms) and rhombohedral (10 atoms) cells verified: every chromium atom has exactly 6 oxygen neighbors (3 at 1.965 Å and 3 at 2.013 Å) and every oxygen atom has 4 chromium neighbors; 72 and 24 unique Cr-O bonds per cell, with zero metal–metal and zero oxygen–oxygen bonds.",
          platform: "Developer Mac (Apple silicon), local only",
          engine: "Scientific scene geometric inference",
        },
      ],
      notYetVerified: [
        "Crystals with disordered fractional occupancies or mixed-valence metal centers.",
      ],
      knownLimits: [
        "Visual bonds and polyhedra are inferred for display only; they are not authoritative connectivity and are not written to exported CIF, XYZ, or SDF files.",
        "A result from one platform is not evidence for another: the local verification does not certify cloud workers.",
      ],
    },
  },
  {
    version: "0.0.36",
    date: "2026-11-11",
    title: "Citations now link to chemdft.com",
    summary:
      "Citations now link to chemdft.com instead of the private code repository; author affiliation corrected. Every software citation ChemDFT prints (APA, BibTeX, RIS, plain text, the cite page and the citation block in HTML, PDF and archive exports) now gives the public website address, so a reader of a paper reaches a page that opens. The DOI is unchanged.",
    added: [],
    changed: [
      "Software citations in all formats print https://chemdft.com instead of the private code repository address.",
      "The cite page links to the website instead of the code repository.",
      "Author affiliation in the software citation metadata corrected to chemdft.com.",
    ],
    fixed: [
      "Readers following the address in a ChemDFT citation no longer land on a page they cannot open.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "The change touches citation text only; no engine, calculation or exported scientific value changes.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release (citation text and metadata only).",
        "Exports produced by the backend show the new address only after the backend is redeployed.",
      ],
    },
  },
  {
    version: "0.0.35",
    date: "2026-11-10",
    title: "Public Contact form with Cloudflare Turnstile anti-abuse protection and workspace spacing polish",
    summary:
      "ChemDFT introduces a public contact form at /[locale]/contact allowing researchers, partners, and institutions to reach the engineering team directly without requiring account creation. The contact pipeline incorporates Cloudflare Turnstile bot verification, honeypot detection, submission rate limits, header injection defense, and fail-closed security with zero personal information stored in the database. In the Advanced Workbench, the molecular viewer panel expands to fill the full container width eliminating empty adjacent columns, viewer toolbar controls streamline into a single compact row, and structure version badges feature clear plain-language explanation.",
    added: [
      "Public Contact page with accessible form validation, honeypot protection, minimum fill time verification, and Cloudflare Turnstile bot detection.",
      "Direct email delivery of contact inquiries to the operator mailbox via Resend with Reply-To set to the inquirer and automatic HTML escaping.",
      "Cryptographic HMAC hashing of client IP addresses for rate limiting with zero personal data stored in the database.",
      "Single-row compact viewer toolbar with primary controls always visible and secondary visual options available inline on wide screens or via popover on narrow screens.",
      "Plain-language explanation caption beside the committed structure version badge clarifying that saved versions are immutable and edits create revisions.",
    ],
    changed: [
      "Expanded 3D molecular viewer panel on the Advanced Workbench Project tab to use full container width.",
      "Increased molecular viewport canvas height to at least 62% of window height on compact displays.",
      "Added Contact navigation links to public site header, footer, landing page, and legal documents.",
      "Updated Privacy Policy with dedicated contact message processing section and sub-processor disclosures.",
    ],
    fixed: [
      "Eliminated blank column beside the scientific viewer panel on the Advanced Workbench Project tab.",
      "Eliminated two-row wrapping in 3D viewer control toolbar on viewports below 1200px width.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Public contact form, Cloudflare Turnstile anti-abuse controls, and workspace viewer layout polish do not alter computational chemistry engines (PySCF, xTB, CREST) or numerical DFT calculations.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release (public contact form and workspace UI layout polish only).",
        "Contact form messages are currently accepted in English across all supported locales.",
        "Server-side contact message delivery requires verified Resend mailer configuration and Cloudflare Turnstile credentials.",
      ],
    },
  },
  {
    version: "0.0.34",
    date: "2026-11-10",
    title: "Scientific viewer priority, compact single-row header, and AI Scientist slide-over ergonomics",
    summary:
      "ChemDFT optimizes workspace ergonomics based on live review findings. The scientific molecular viewer and key structure facts are now positioned first on initial load directly beneath the action row, reserving at least 55% of vertical content height without scrolling. Empty documents and datasets fold into a single compact line, and project knowledge search is streamlined below the viewer. The project header remains a single 44px row down to 834px viewport width with structured collapsible navigation and a dedicated drawer slot preventing button overlap. The AI Scientist slide-over eliminates duplicate title rows and expands the conversation history to at least 200px height. User-facing labels across the interface adopt plain-language terminology while preserving rigorous scientific provenance.",
    added: [
      "Scientific visualization priority placing 3D molecule canvas and structure facts at the top of the Project tab directly under the action row.",
      "Single compact line folding empty documents and datasets with quick import action when no files are attached.",
      "Streamlined single-row project knowledge search located cleanly beneath the scientific viewer.",
      "Single-row header down to 834px width with prioritized collapse into responsive icon navigation, consolidated menus, and breadcrumb truncation.",
      "Dedicated drawer toggle slot preventing overlap between the navigation button and the ChemDFT brand logo.",
      "Compact AI Scientist slide-over layout with unified title row, compact composer, and expanded chat message area.",
    ],
    changed: [
      "Relocated documents, scientific datasets, and project knowledge sections below the primary 3D structure viewer.",
      "Standardized user-facing catalog and structure labels to plain terminology while retaining scientific authority badges and explanatory tooltips.",
    ],
    fixed: [
      "Eliminated redundant header and tab rows in the AI Scientist drawer overlay.",
      "Prevented header item wrapping into secondary rows on viewports down to 834px.",
      "Ensured chat message area maintains at least 200px visible height at 1024x560 viewport dimensions.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Workspace presentation and layout adjustments are frontend ergonomics only; no underlying computational engines, scientific values, file generation algorithms, or evidence provenance structures were altered.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release (workspace ergonomics and responsive layout refinement only).",
        "Phone layout (<834px) is deferred by design and remains unsupported in this release.",
        "3D PDF export remains marked as experimental testing with Adobe Acrobat requirement.",
      ],
    },
  },
  {
    version: "0.0.33",
    date: "2026-11-10",
    title: "Adaptive workspace layout, unified Export control, and plain Explorer",
    summary:
      "ChemDFT introduces an adaptive workspace layout supporting viewports from 1024x600 up to ultra-wide screens, ensuring at least 55% vertical height is dedicated to the molecular viewer. The seven separate export buttons across the workstation are unified into a single persistent Export menu with context-aware item availability, preserving all underlying file formats, citations, and evidence provenance. The Project Explorer folds empty sections into a single summary line and clarifies terminology to 'Saved' with plain-language guidance.",
    added: [
      "Adaptive workspace layout responding to container width across four tiers: full three-column view (>=1500px), icon rail Explorer (1100–1499px), slide-over overlays with focus trapping (<1100px), and compact toolbar layout with wrapped structure facts (1024x600).",
      "Single unified Export menu component in the workspace action row, grouping exports into 'Share and read', 'Structure data', 'Pictures and tables', and 'Whole project', with context-sensitive disabled items explaining prerequisites.",
      "Accessible custom WorkspaceSplitter supporting drag resizing, keyboard adjustments (arrows, Home/End), WAI-ARIA separator semantics, and localStorage width persistence.",
      "Focus mode (Shift+F shortcut and visible button) to collapse side panels and maximize 3D molecular viewer real estate.",
      "Density preference toggle ('Comfortable' and 'Compact') automatically defaulting to compact below 700px viewport height.",
      "Plain Explorer mode folding empty catalog sections into a single 'Nothing yet' summary line and displaying item counts.",
    ],
    changed: [
      "Replaced seven disparate export controls across project overview, comparison workstation, molecular orbital workspace, structure editor, and 3D viewer toolbar with the single unified Export control.",
      "Clarified catalog terminology from 'Committed' to 'Saved' with plain-language tooltips explaining underlying evidence authority.",
      "Streamlined structure viewer toolbar into a single row with wrapped atomic facts on narrow viewports.",
    ],
    fixed: [
      "Prevented action toolbar overflow and horizontal page scrolling on compact viewports down to 1024x600 and 834px tablet portrait.",
      "Ensured AI approval workstation cards and confirmation actions remain fully visible without clipping at 1280x720 and 1024x600.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Workspace layout adaptation and single unified Export component are UI and presentation changes only; no underlying computational engines, scientific values, file generation algorithms, or evidence provenance structures were altered.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release (adaptive layout and unified Export UI only).",
        "Phone layout (<834px) is deferred by design and remains unsupported in this release.",
        "3D PDF export remains marked as experimental testing with Adobe Acrobat requirement.",
      ],
    },
  },
  {
    version: "0.0.32",
    date: "2026-11-10",
    title: "Beta Terms of Service, Privacy Policy, and in-app feedback fixes",
    summary:
      "ChemDFT publishes plain-language beta Terms of Service and Privacy Policy documentation, establishing clear researcher data ownership, age guidelines (13+), sub-processor disclosures, and zero-advertising commitments for the personal beta service operated by Tabriz Ahmadli. Feedback attachment size formatting is unified across emails, file chips, and owner review tools. Feedback submission is hardened to avoid unconfigured pending database records and to fail closed on disabled-account verification failures.",
    added: [
      "Plain-language beta Terms of Service and Privacy Policy detailing individual operator identity, researcher content ownership, sub-processors, zero data sales, zero tracking cookies, and account deletion procedures.",
      "Clear summary callout boxes ('In short: ...') at the top of legal pages and English-version binding notices across supported locales.",
      "Shared attachment size formatter accurately presenting small files (<1024 B as bytes, <10 KB with decimal precision) across notification emails, UI chips, and audit tables.",
    ],
    changed: [
      "Updated terms version to 2026-11-10 for newly registered accounts with no forced re-acceptance for existing beta researchers.",
      "Minimum user age set to 13 with guidance for parental or guardian permission for researchers under 18.",
      "Resolved mailer transport before database record creation to prevent stale pending rows when the email provider is unconfigured.",
    ],
    fixed: [
      "Attachment size display under 1 KB now correctly shows exact byte counts instead of 0 KB.",
      "Disabled-account checks during feedback submission fail closed with HTTP 503 instead of proceeding when account lookup errors occur.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Professional legal review of plain-language beta Terms and Privacy terms before public launch or investment.",
        "Live owner feedback console verification with real submission rows.",
        "Feedback form submission in non-English locales (Turkish, Russian, German).",
      ],
      knownLimits: [
        "No new scientific calculation was performed in this release; changes are restricted to frontend feedback polish and legal documentation.",
        "Legal text represents plain-language beta documentation authored by the operator, not professional legal counsel.",
        "Under engineering rule 25, no Zenodo snapshot version is required for 0.0.32 because no open-core paths were modified.",
      ],
    },
  },
  {
    version: "0.0.31",
    date: "2026-11-10",
    title: "In-app feedback window and public architectural roadmap",
    summary:
      "ChemDFT adds a dedicated, privacy-respecting in-app feedback channel and public roadmap. Signed-in researchers can submit bug reports, feature suggestions, and computational method or engine requests directly from the web workstation without external forms or third-party trackers. All feedback reports are delivered directly to the engineering team via transactional email transport with optional scientific file attachments up to 4 MB in total, with attachment files transmitted in memory and never stored on ChemDFT servers or database disks. Feedback volume is guarded by a rolling 24-hour rate limit. An owner feedback console provides transparent oversight of delivered and failed submissions. In addition, an owner-curated public roadmap gives researchers visibility into planned, active, and completed platform capabilities.",
    added: [
      "In-app feedback window accessible from the primary navigation allowing researchers to report bugs, request features, or request calculation methods.",
      "Support for attaching common computational chemistry files (XYZ, CIF, PDB, MOL, SDF, INP, GJF, OUT, LOG, CSV, JSON, PDF, images, ZIP) up to a 4 MB total ceiling.",
      "Direct email delivery to the engineering team with attachment streaming and zero persistent server file storage.",
      "Owner feedback monitoring console displaying recent submissions and 7-day delivery health statistics.",
      "Public curated roadmap page categorizing platform capabilities into planned, active, and completed milestones.",
    ],
    changed: [
      "Primary navigation includes a direct Feedback link between Releases and Settings.",
      "Privacy Policy explicitly details feedback processing, transactional email delivery, zero file storage, and data retention rules.",
    ],
    fixed: [
      "Account deletion and deactivation procedures automatically prune associated feedback report records to protect researcher privacy.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Live email dispatch on deployed cloud infrastructure remains unverified until configured with production credentials.",
        "Production database persistence on hosted database infrastructure remains unverified until applied.",
      ],
      knownLimits: [
        "No new scientific calculation was performed in this release; changes are restricted to user feedback communication, email transport, roadmap presentation, and account privacy.",
        "Attachment size is capped at 4 MB per submission to respect serverless request limits; larger files should be shared via external data archives.",
        "Gaussian input files are distinguished from executable formats by content inspection; executable binaries remain strictly forbidden.",
        "Under engineering rule 25, no Zenodo snapshot version is required for 0.0.31 because no open-core paths were modified.",
      ],
    },
  },
  {
    version: "0.0.30",
    date: "2026-11-09",
    title: "Database-enforced beta account cap and honest owner console limits",
    summary:
      "ChemDFT hardens beta account management and sign-up boundaries. The non-owner beta account cap is now enforced directly by the database with post-creation verification, preventing capacity overshoots across concurrent serverless instances without relying on in-memory locks. In the owner account console, editable per-user limit overrides that were not enforced by the backend have been decommissioned in favor of an honest, read-only display of the global limits applied by the server. Disabled account enforcement is extended to prevent disabled sessions from minting API tokens or reaching the API proxy. Pre-existing invited accounts are preserved as unlimited and excluded from the beta cap count. Error notices for beta capacity, terms acceptance, email verification, and account status are fully localized across all supported languages.",
    added: [
      "Post-creation database verification in the authentication lifecycle that deterministically cleans up over-quota registrations during concurrent sign-up races.",
      "Clear cap count indicator on the owner console displaying active beta tester registrations relative to the configured capacity.",
      "Dedicated empty and error states for the owner account management console.",
    ],
    changed: [
      "Owner console displays the authoritative global beta limits enforced by the server in read-only format, replacing non-functional per-user limit controls.",
      "Pre-existing invited accounts without self-signup markers are recognized as invited researchers, granted standard unlimited access, and excluded from the beta cap.",
      "Sign-in error messaging for capacity limits, terms acceptance, unverified emails, and disabled accounts is available in English, Turkish, Russian, and German.",
    ],
    fixed: [
      "Disabled user accounts are blocked from generating identity tokens or forwarding calls through the API proxy even if an existing session token is presented.",
      "Concurrent sign-up attempts across separate serverless instances can no longer exceed the configured beta tester limit.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Live Google sign-up and authentication flow on deployed cloud infrastructure remains unverified until deployed and enabled.",
        "Database-backed account cap enforcement is verified in automated database test suites but has not been tested against live Google authentication traffic.",
      ],
      knownLimits: [
        "No new scientific calculation was performed in this release; changes are restricted to authentication, gateway policy enforcement, and administrative console honesty.",
        "Individual per-user resource quotas are not supported by the backend without database schema changes; all beta testers share the global limits configured on the server.",
        "Public sign-up remains closed by default; Google sign-up requires explicit operator configuration.",
        "Under engineering rule 25, no Zenodo snapshot version is required for 0.0.30 because no open-core paths were modified.",
      ],
    },
  },
  {
    version: "0.0.29",
    date: "2026-11-09",
    title: "Google sign-up for beta testers and owner account management",
    summary:
      "ChemDFT introduces self-service Google sign-up for non-commercial beta testers under owner control. When enabled by configuration, users with a verified Google email can create an account via Continue with Google after accepting the Terms of Service and Privacy Policy. An atomic global account cap prevents oversubscription. New beta accounts receive default resource limits, while existing account linking rules remain strict. An owner-only management console allows viewing accounts, toggling active status, and tuning per-user limits.",
    added: [
      "Configurable Google-only sign-up mode allowing verified Google accounts to create ChemDFT accounts without enabling password sign-up.",
      "Atomic global account cap with friendly beta-full notice when capacity is reached.",
      "Mandatory Terms of Service and Privacy Policy acceptance recorded with document version and timestamp during first sign-up.",
      "Owner account management page and administrative interface for monitoring user accounts, toggling access, and adjusting per-user limits.",
      "Localized sign-up notices and error messages across supported languages.",
    ],
    changed: [
      "Default resource limits automatically assigned to new beta sign-ups while owner accounts retain full administrative access.",
      "Login page displays sign-up mode notices and terms acceptance controls when Google sign-up is permitted.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Live Google sign-up and authentication flow on deployed cloud infrastructure remains unverified until deployed and enabled.",
      ],
      knownLimits: [
        "No new scientific calculation was performed in this release; changes are restricted to user authentication, onboarding limits, and account administration.",
        "Sign-up is closed by default and requires explicit configuration by the operator to allow Google-only test registration.",
        "Account caps and limits are applied at the web and API gateway boundaries; scientific job execution pilot remains stopped.",
      ],
    },
  },
  {
    version: "0.0.28",
    date: "2026-11-09",
    title: "Software DOI in citations, project export fixes, and AI/UI polish",
    summary:
      "ChemDFT records its real Zenodo DOIs (all-versions concept DOI 10.5281/zenodo.24082321, 0.0.26 open-core snapshot DOI 10.5281/zenodo.24082322; record https://zenodo.org/records/24082322) across software citation surfaces, exports, and repository metadata. Project archive (ZIP) export 500 error is resolved with fail-soft per-version exports and recorded manifest notes. PDF/HTML reports accurately reflect optimized structures and published results, and calculation citations in reports are streamlined with the full calculation list in archive citation files. AI and UI polish includes safe markdown rendering, synchronized Structures page AI context, and a stable result action row. Under rule 25, a new Zenodo snapshot version upload is not needed for 0.0.28 because no open-core paths were modified.",
    added: [
      "Official software DOIs (concept DOI 10.5281/zenodo.24082321 and snapshot 0.0.26 DOI 10.5281/zenodo.24082322) displayed in Cite panel, How to cite page, CITATION.cff, and exports.",
      "Archive export citations directory (citations/calculations.bib and citations/calculations.txt) with full per-calculation citations for the project.",
      "Fail-soft error handling for individual structure coordinate formats in project archive exports with diagnostic notes recorded in manifest.json.",
    ],
    changed: [
      "PDF and HTML report How-to-cite sections streamlined: shows software citation and citations for selected/summarized results, noting that the full list of calculations is in the archive.",
      "Result action row layout: Cite panel expands cleanly below action buttons without displacing 'Ask AI about this result'.",
      "AI chat explanations render inline markdown safely (bold, lists, code) using pure React elements without raw HTML injection.",
      "Structures page AI context synchronized to current structure selection instead of stale result views.",
      "App guide facts refined so AI only references controls present on the current page and explains real import paths.",
    ],
    fixed: [
      "Project archive (ZIP) export HTTP 500 error caused by invalid attribute access on calculation records.",
      "PDF and HTML reports labelling optimized structures as unoptimized with missing calculation results due to result-type mismatch.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated unit and parity tests verify identical software and calculation citation text between TypeScript and Python builders, including real DOI formatting and golden parity fixture agreement.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
        {
          statement:
            "Project archive ZIP generation regression tests verify multi-version structure exports, calculation JSON serialization, and fail-soft note recording in manifest.json.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
        {
          statement:
            "PDF and HTML report builders verified with optimized geometry and published calculation results to confirm correct 'CALCULATED' origin labels and energy values.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "Live cloud deployment of project archive ZIP export and PDF generation remains unverified on EC2 while backend pilot remains stopped.",
      ],
      knownLimits: [
        "The Zenodo record (DOI 10.5281/zenodo.24082321) is an archival snapshot of open-core parts only (schemas, contracts, engine wrappers, examples); proprietary application components are not included in the Zenodo archive.",
        "Individual calculations have internal calculation IDs and cryptographic hashes; they do not have public scholarly DOIs.",
      ],
    },
  },
  {
    version: "0.0.27",
    date: "2026-11-09",
    title: "A repeatable Zenodo snapshot procedure for the open parts of ChemDFT (no DOI registered yet)",
    summary:
      "ChemDFT now has a written, repeatable procedure for archiving its open-source parts on Zenodo. No DOI is registered yet: nothing has been published to Zenodo, and ChemDFT still shows no DOI anywhere. The only visible change is the version number and the affiliation in the software metadata (chemdft.com).",
    added: [
      "A script that builds the archive of the open-source parts from one release commit, with a check for secrets and local file paths, and a test that the archive can contain only paths the licence map marks as open.",
    ],
    changed: [
      "The author affiliation in the software citation metadata is now chemdft.com.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated tests check that the archive contains only the paths the licence map marks as Apache-2.0 (minus two files that are held back), that every JSON file in it parses, and that the archive scan finds no keys, secrets or local paths.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "ChemDFT has no DOI. No Zenodo record has been published; the owner approves each publish. The software citation shows no DOI until a real one exists.",
        "Whether Zenodo accepts every metadata value has not been checked against Zenodo.",
        "No new scientific result or claim is part of this release.",
      ],
      knownLimits: [
        "A new Zenodo version is needed only when an open-source path changes or at a milestone; otherwise a release says so in its notes.",
        "The record languages (English, German, Turkish, Russian) are set by hand on Zenodo, not in the metadata file in the repository.",
      ],
    },
  },
  {
    version: "0.0.26",
    date: "2026-11-09",
    title: "Google sign-in ready (not switched on), software citation ready for a DOI, citation in every export",
    summary:
      "Sign in with Google is built and tested but stays off until the owner configures it. ChemDFT still has no DOI: the software citation is ready to show one the day the owner publishes a Zenodo record, and until then it prints none. The interactive HTML export, the report PDF and the project archive README now carry the same calculation citation (APA and BibTeX) and ChemDFT software citation as the Cite panel.",
    added: [
      "Sign in with Google (only when the owner has configured it): a \"Continue with Google\" button on the sign-in page and \"Link Google\" / \"Unlink Google\" in Settings. Google never creates a ChemDFT account: it signs in only an account that already exists with the same, verified email address, or one that linked Google while signed in. Unlinking your last way to sign in is refused.",
      "Plain-language messages for Google sign-in problems: no ChemDFT account uses this Google address, Google sign-in was cancelled, Google has not verified the address, and a general failure message.",
      "The interactive HTML export, the report PDF and the project archive README now include a \"How to cite\" block with, for each calculation, the APA and BibTeX citation, and the ChemDFT software citation, in the same words as the Cite panel. Calculations without a stored method or input are left out rather than guessed.",
    ],
    changed: [
      "The ChemDFT software citation is defined in one data file used by the web app and the exports, and shows a DOI only if one has been set.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated tests check Google sign-in rules against the real sign-in library with a mocked Google (no request to Google): an existing account with a verified matching address signs in, an unknown address creates nothing, an unverified Google address is refused, link and unlink work, and the last sign-in method cannot be unlinked. They also check that the web app and the exports build identical citation text from the same records.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "Google sign-in has not been used with Google: it is off, no Google client exists in any environment, and no real Google call was made. Its consent screen, redirect address and the live behaviour are not verified.",
        "ChemDFT has no DOI. No Zenodo record was created, and what would be published and under which licence is the owner's decision. The software citation shows no DOI until one exists.",
        "The citation block was checked in generated files from fixture data, not in a real export from the live site.",
        "No new scientific result or claim is part of this release.",
      ],
      knownLimits: [
        "Only a Google account with the same email address as the ChemDFT account can be linked.",
        "The calculation citation in the exports names ChemDFT as the author; the optional ORCID author of the Cite panel is not added to exports.",
        "The calculation has no DOI and no public link; it is identified by its calculation ID.",
      ],
    },
  },
  {
    version: "0.0.25",
    date: "2026-11-09",
    title: "Clearer result and setup screens, easy citation, one action row on every result, honest report PDF",
    summary:
      "The IR spectrum page is easier to read and the tallest peak is always fully inside the chart. Every result now has the same row of actions: Export, Share, Cite and Ask AI about this result. The report PDF no longer prints a fixed \"PASS\" line. Citing is easier (one \"Copy citation\" button in your last-used format, plus a separate \"Cite ChemDFT\" citation). Calculation setup, Thermochemistry, Geometry optimization, Conformer ensembles and Orbitals screens are also clearer and consistent, and the AI panel and result status no longer show a previous page's result. These are presentation changes only: no scientific value, unit or status changed, and full-precision values stay in the stored record and in exports.",
    added: [
      "One action row on every Results view in Guided and Advanced mode: Export ▾, Share…, Cite and \"Ask AI about this result\" (it selects the result as the AI's context and opens the AI panel; you still type the question).",
      "Cite: the panel opens on one \"Copy citation\" button in the format you used last (APA at first), with the text shown above the format choices (APA, Methods paragraph, BibTeX, RIS, plain text, engine references, reproducibility JSON). A separate \"Cite ChemDFT\" section gives the software citation in APA, BibTeX, RIS and plain text. The citation text is a clean reference; a short note next to it says there is no DOI yet and no public link, and the calculation is identified by its ID. Including your ORCID iD is still an explicit tick box. The Learn > Cite page starts with \"Cite ChemDFT\" and a copy button per format.",
      "One precision rule on result screens (energies in Eh with 6 decimals, frequencies 1 decimal, coordinates 4 decimals, gradients in scientific notation) with the full value in the tooltip and in exports, and one spelling for units (Eh, cm⁻¹).",
      "A shared 3D viewer toolbar (Reset view, Style: Ball and stick / Space filling, Distance and Angle where they exist) on the optimization and conformer pages, and a one-line caption under 3D viewers saying what any motion is (for example: the vibration is an exaggerated illustration of the calculated mode, not a simulation).",
      "Calculation setup: when the method and basis are fixed by the engine they are shown as read-only values with the reason; an inline checklist with a \"Confirm charge & multiplicity\" button replaces the dead-end disabled button (the confirmation is still required and still explicit).",
      "Conformer ensembles: native files grouped into Result files, Logs and Internal/temporary; human labels (\"Member 1 of 2 (lowest energy)\") instead of long ids; one sentence explaining why the engine result is validated but the minimum is not verified.",
      "Peak labels on the IR and Raman charts are placed so they do not overlap each other or the edge of the chart, and the selected mode is marked distinctly.",
    ],
    changed: [
      "The spectrum is now the first thing on the IR and Raman pages, with the 3D viewer and the mode panel below it; the empty area under the mode sliders is gone.",
      "The status of a result is shown once, in one block (authority, validation, independent verification, lineage), instead of repeated in a strip, a chip and a bullet.",
      "Frequencies in headline cards show one decimal and a proper unit (for example 509.8 cm⁻¹, not 509.786118 cm^-1); the full stored value is in the tooltip and in exports.",
      "The Guided sidebar badge for Spectra names the spectrum types that exist (IR, Raman, UV/Vis) instead of always saying TDDFT.",
      "The note that xTB energies are on a different scale now sits under the xTB engine row, not under Psi4; engine availability reasons are in plain words with the original wording under Technical details.",
      "The optimization page has a styled summary card, readable local time (UTC on hover) outside the molecule view, a single unit on the charts, and \"Open optimized structure\" / \"Open starting structure\" instead of internal terms.",
      "The orbital page shows one compact notice instead of a large empty box when the 3D surface is unavailable on the hosted beta, disables the surface-only tabs with the reason, and suggests a geometry optimization only when none exists in the recorded state.",
      "The Navigator's \"not available yet\" wording about the optimizer is accurate: it says what the check on this server found (and that automatic proposals on the hosted path cover energy calculations only), not that the compute worker lacks the optimizer.",
      "Spectrum and thermochemistry animation no longer starts by itself when the page opens; every 3D viewer has a caption saying what any motion is (or that the view is static). The Calculation-setup viewer uses the shared toolbar. The AI panel's context line keeps the first and last part and shortens the middle (full text in the tooltip). The optimization summary shows the real final structure version read from the record.",
      "The Guided page and the top bar both say \"Advanced Workbench\"; the green dot next to a spectrum tab now says \"Result available\".",
      "Report PDF: the fixed \"Firewall status: PASS\" line is replaced by a statement that makes no verdict (statuses are shown per value), the \"Execution platform\" line now states where the report was generated, and the \"verified in Adobe Acrobat\" wording is replaced by an honest limit.",
    ],
    fixed: [
      "The AI panel and the result status could keep showing a previous page's result (for example an IR mode on Calculation setup, or the IR result on an empty Thermochemistry page); each page now announces only its own context.",
      "The tallest IR peak could run past the top of the chart and lose its label; the axis now always leaves room above it.",
      "The \"Displacement arrows\" checkbox was covered by the mode status badge in the 3D viewer.",
      "The Export help text pointed to a menu \"at the top right of this page\" that was not there on some result views.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated tests check: the chart axis ends above the tallest peak for the real 9-mode HNO3 / imidazole IR shape (strongest 363.12 km/mol) and for far larger and smaller intensities; peak labels stay inside the chart and do not overlap at three widths; frequencies show one decimal with a superscript unit while the stored value is unchanged; the Spectra badge never says TDDFT for an IR result; the status text appears once; the action row has the four controls in order on IR, Raman, UV/Vis, optimization, thermochemistry and energy results; Ask AI selects the result and opens the AI panel; and no report PDF or HTML contains a fixed PASS or \"verified\" claim.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
        {
          statement:
            "The IR spectrum page, the action row and the sidebar badge were captured in Chrome at desktop and phone width using a local fixture with the real 9-mode data shape; the 3D animation, arrows label and status badge do not overlap.",
          platform: "Developer machine, Chrome, local fixture (not a real project)",
          engine: "No scientific engine used (fixture values)",
        },
      ],
      notYetVerified: [
        "The software citation is built from the repository's citation metadata and has no DOI: no Zenodo record exists for ChemDFT, and none was created. The citation block is not yet in the HTML export, the PDF report or the archive README (they are generated by the backend and the citation builder is web code).",
        "The conformer-ensemble page and the navigation sequence IR → Calculation setup → Thermochemistry were checked by tests only, not by screenshots; the Advanced Workbench variants of the changed screens were not captured; the \"Final structure V3\" label and the shortened breadcrumb were not done.",
        "The real result screens on the live site with a real project, and the Advanced Workbench views, were not captured; the AI panel opening from \"Ask AI about this result\" was tested by its events, not by a screenshot.",
        "Raman, UV/Vis and thermochemistry pages were checked by tests and shared code, not visually.",
        "Keyboard-only use and accessibility audit tools were not run on these screens.",
      ],
      knownLimits: [
        "Presentation only: no scientific value, unit, authority or evidence label, and no Result Firewall behaviour changed; AI text stays labelled and separate from calculated results.",
        "The report PDF and the interactive HTML still label coordinates as USER_ENTERED when the structure was not produced by a calculation, based on how the structure was stored; that wording was not changed here.",
      ],
    },
  },
  {
    version: "0.0.24",
    date: "2026-11-09",
    title: "New logo in exports, smarter AI answers, simpler AI box and Navigator",
    summary:
      "Five changes in one release. (A) Exported files (interactive HTML, report PDF, 3D PDF, project archive) carry the new ChemDFT logo, a cleaner layout, and the release they were really made by. (B) The AI Scientist now answers how-to questions such as \"i want to import molecule\" with plain steps instead of an \"insufficient evidence\" card. (C) The AI box is one box: the Ask / Plan calculation switch is gone and planning is offered inline. (D) The Project Navigator is compact, with a Goal dropdown that looks like one. (E) The Navigator explains in plain words why each workflow is not available yet. These are presentation and routing changes only: no scientific value, unit, status or engine name changed, and nothing new can run without your approval.",
    added: [
      "(A) The new logo in the interactive HTML (light and dark versions, built into the file so it works offline), in the page header of both PDFs, and in the project archive; a dark appearance, keyboard focus outlines, a narrow-screen layout and a print layout in the interactive HTML; page numbers, export date and release in the PDF footers.",
      "(B) A short built-in guide to ChemDFT (Guided and Advanced Workbench, Draw molecule, importing SDF, MOL, XYZ or CIF files, Files & Data, Calculation setup, Jobs, Results, Compare, Claims, Paper vs ChemDFT, Settings) that the AI uses when you ask how to do something. Ask stays read-only: it only explains where to click.",
      "(C) An inline \"Plan this as a calculation — you approve before anything runs\" choice that appears when your message looks like a calculation request, and a small \"Plan a calculation…\" link.",
      "(E) A summary line, a \"Most of these need a structure first\" banner with an Import / Draw button, a \"You can fix this / Waiting on ChemDFT / Needs access\" tag on every not-available workflow, and a Technical details disclosure that keeps the original wording.",
    ],
    changed: [
      "(A) The report PDF starts with the logo, title, coordinate status and an identity table, then the structure image and the results; the report is two or three pages. The coordinate status is shown once, for example \"USER_ENTERED · NOT OPTIMIZED\". The PDF results table shows the status each result is stored with.",
      "(B) Messages about importing, drawing, uploading or starting something are answered as AI replies (labelled as such) and no longer go through document search. Questions about a paper, a value, a result, a citation or a verification still use the cited path.",
      "(C) One composer and one Send button. The structure prompt (\"Choose the structure to plan this calculation for\") appears only while a calculation is being planned. A calculation proposal is still created only when you choose to plan, and always needs your approval.",
      "(D) \"Browse all workflows\" is one screen with a header row (Goal, counts, Refresh) and three tabs: Next steps, Not available yet, Recorded in this project. The Goal control has a visible arrow, a label and a one-line hint.",
      "(E) \"Blocked\" is now \"Not available yet\", with one plain reason line per workflow instead of repeated technical sentences.",
    ],
    fixed: [
      "(A) Exports said \"0.0.13\" whatever the release; they now show the release that created them. The HTML footer named the wrong licence for the 3D viewer library; it now says BSD-3-Clause.",
      "(B) \"i want to import molecule\" no longer returns \"Insufficient project evidence\" in a project that has a document.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated tests check: the logo is in the HTML and the PDFs; the old version text is gone and the export version equals this release; the status text is not doubled; the HTML asks for nothing from the internet; 20 how-to phrasings go to the plain AI-reply path while science and mixed messages keep the cited path (AI model mocked); the built-in guide lists only the import formats the code supports; the planning choice appears only for calculation-looking messages and planning still needs the approval step; every known not-available reason has a plain sentence, unknown reasons are never guessed, and no next-step button is offered for platform limits.",
          platform: "Developer machine, automated test suites (AI model replaced by a test double)",
          engine: "No scientific engine used",
        },
        {
          statement:
            "Sample exports were opened and looked at (HTML in Chrome at desktop width, phone width and dark appearance; every page of the PDFs as images), and the new AI box and Navigator were captured in Chrome at desktop and phone width with example data, with and without a structure.",
          platform: "Developer machine, Chrome and a PDF page renderer",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "Answers from the real AI model to how-to questions (only a test double was used), and whether the real model follows the built-in guide.",
        "The Navigator and the AI box on the live site with a real project and a real compute worker; whether the compute worker is merely switched off or truly lacks a task is not told apart by the Navigator, so the wording says \"can't run this right now\".",
        "A real signed-in export from the live site; the 3D PDF in Adobe Acrobat; browsers other than Chrome; printing on paper.",
        "Accessibility audit tools were not run on these screens; keyboard use was checked by reading and by the automated tests only.",
      ],
      knownLimits: [
        "Presentation and routing only: no scientific value, unit, status, evidence label or engine name changed, no calculation was run, and AI text stays labelled and separate from calculated results.",
        "The report PDF still carries a fixed \"Firewall status\" line written for earlier releases; it is not a new check.",
        "The built-in guide is written by hand and must be updated when the app changes.",
      ],
    },
  },
  {
    version: "0.0.23",
    date: "2026-11-09",
    title: "New contact address: tab@chemdft.com",
    summary:
      "The address to write to for questions is now tab@chemdft.com. It appears in the footer Contact link and on the Terms, Privacy and Beta notice pages, and the citation file now lists it as the author's email. Nothing about how ChemDFT calculates or stores results changed.",
    added: [
      "The author's email address in the citation file (CITATION.cff).",
    ],
    changed: [
      "The public contact address changed from the old address to tab@chemdft.com (footer Contact link, Terms of Use, Privacy Policy and Beta notice).",
      "The \"updated\" date shown on those pages is now 9 November 2026. The terms version did not change, so nobody has to accept the terms again.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "The contact address in the code and in the citation file is tab@chemdft.com, the citation file still follows the CFF 1.2.0 layout (author email field) and loads as valid YAML, and the terms version still matches the version shown on the legal pages.",
          platform: "Developer machine, automated tests and a file check",
          engine: "No scientific engine used",
        },
        {
          statement:
            "The web tests, the type check, the code style check, the production build and the schema check passed.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "After this release is deployed: that the footer Contact link opens a mail to tab@chemdft.com and that the Terms, Privacy and Beta notice pages show the new address has not been checked on the live site.",
        "Sending email from chemdft.com is not set up. Only receiving at the address was confirmed by the owner with one test mail.",
      ],
      knownLimits: [
        "No scientific calculation was performed for this release.",
        "The Zenodo record has no email field for authors, so it carries no address.",
      ],
    },
  },
  {
    version: "0.0.22",
    date: "2026-11-08",
    title: "New ChemDFT logo and browser tab icon",
    summary:
      "ChemDFT now has its final logo: a small molecule bent into the letter C, next to the name. The same logo is in the header of every page, and the browser tab and phone home-screen icons now show it too. Nothing about how ChemDFT calculates or stores results changed.",
    added: [
      "The new ChemDFT logo in the page header (home page, Projects, the workspace, sign-in and sign-up pages, Examples and the first-run guide).",
      "A browser tab icon (favicon) and icons for phone home screens and app shortcuts.",
    ],
    changed: [
      "The old drawn mark was replaced by the new logo files. The header keeps the same height and the logo link keeps its 44 px touch area on small screens.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "The logo shows once, with the single name \"ChemDFT\" for screen readers, in both its full and its small form; every logo and icon file the site points to exists; the production build serves all icon links and files. Screenshots of the home page, Projects, workspace and sign-in header were taken before and after at three widths on a developer machine with made-up fixture data.",
          platform: "Developer machine, automated tests and browser screenshots with fixture data",
          engine: "No scientific engine used",
        },
        {
          statement:
            "The web tests, the type check, the code style check, the production build and the schema check passed.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "How the logo and the tab icon look on the live site after this release is deployed has not been checked.",
        "Other browsers and phones were not tried. The tab icon at its smallest size (16 pixels) is hard to read: only the yellow and red atoms stand out.",
        "Reports and exports made by the server (the PDF report and the interactive HTML export) were not changed and may still show the old name or mark, as may the product pictures on the home page.",
      ],
      knownLimits: [
        "No scientific calculation was performed for this release.",
        "ChemDFT has no dark theme; the light logo is used everywhere and the dark logo files are stored for later.",
        "No web app manifest and no social sharing image were added; they are possible later steps.",
      ],
    },
  },
  {
    version: "0.0.21",
    date: "2026-11-08",
    title: "Home page text corrected, and tests that keep one researcher's work away from another's",
    summary:
      "The home page said ORCID sign-in was not available yet, but it works for accounts that already linked an ORCID iD. This release corrects that line and adds automatic tests that check one user cannot see or change another user's projects. It also adds a written checklist for the hardening work that comes next.",
    added: [
      "A written checklist for the next stage of hardening (isolation between users, backups, spending limits, licences, benchmarks and hosting), including what still needs the owner's decision.",
    ],
    changed: [
      "Home page: \"ORCID sign-in\" moved from \"not yet\" to what works today, with the condition that the account has already linked an ORCID iD in Settings.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "53 new automatic tests with two made-up users passed. They check that the second user cannot read, list, rename, change, export or run anything on the first user's project, that a made-up id and another person's id get the same answer, that job and claim lists show and count only your own, that AI questions carrying another person's selection are not answered from it, and that billing and usage figures are per user. No leak was found.",
          platform: "Developer machine, automated tests with a fake AI model and local test accounts",
          engine: "No scientific engine used",
        },
        {
          statement:
            "The web tests, the type check, the code style check and the production build passed for the changed home page text.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "The same checks with two real accounts on the live site have not been done (no second test account exists yet).",
        "Questions about a selected job or about compared results have not been tried with a real AI model on the live site.",
        "The case where the value you ask for is not in the stored record has not been tried live.",
        "Release 0.0.21 itself is not yet running on the live site.",
      ],
      knownLimits: [
        "No scientific calculation was performed for this release.",
        "The new tests use a fake AI model and local test accounts. They say nothing about the live site by themselves.",
        "ChemDFT has no dark theme; pages stay light when the system is dark.",
      ],
    },
  },
  {
    version: "0.0.20",
    date: "2026-11-08",
    title: "The AI Scientist now answers from the claim, job or results you selected",
    summary:
      "When you select a claim, a job or results and ask the AI Scientist about them in the chat, it now receives the stored record and answers from it. Before, it asked which claim you meant.",
    added: [
      "A chat answer that quotes your selected records is marked \"AI reply · quotes stored project records\". The quoted values keep their evidence label (for example Calculated or User entered) and \"Not independently verified\" where that applies.",
    ],
    changed: [
      "Questions that point at your selection (\"the selected claim\", \"this job\", \"these results\") are answered from the stored record, not by searching the documents.",
      "If a value you ask for is not in the stored record, the AI Scientist now says so instead of guessing.",
      "Compare page: the AI panel no longer shows the Read-only and grounding notes twice, so more of the starter questions fit above the Ask box.",
    ],
    fixed: [
      "In the chat the AI Scientist did not see the claim, job or results you had selected, so it asked which claim you meant and said the value was not listed. The stored record is now part of what it reads.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated tests with a fake AI model confirm that the selected claim (value, unit, source, review state), job and compared results are in what the chat model receives, that an id from another project is ignored and not shown, and that a chat without a selection sends exactly what it sent before. The web request test confirms the page's ids are sent with the question.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
        {
          statement:
            "On the live site, with a real AI model, a question about a selected claim (a final energy in a test project) was answered with the stored value digit for digit (-58.969224381145), its unit (Eh), its source, its review state (unverified) and the note \"Not independently verified\". The reply was labelled as quoting stored project records. Before this release the same question was answered with a request to say which claim was meant.",
          platform: "Live site, owner's Chrome, checked by hand after the release went live",
          engine: "No scientific engine run for this check",
        },
      ],
      notYetVerified: [
        "Questions about a selected job or about compared results have not been tried with a real AI model on the live site.",
        "The case where the value you ask for is not in the stored record has not been tried live.",
        "The Compare page change has been checked by automated tests only, not in a browser.",
        "The cited document answer cannot quote a stored claim; it still quotes only document passages.",
      ],
      knownLimits: [
        "No scientific calculation was performed for this release.",
        "The AI Scientist only repeats what is stored. It does not recompute, convert or verify a stored value.",
        "ChemDFT has no dark theme; pages stay light when the system is dark.",
      ],
    },
  },
  {
    version: "0.0.19",
    date: "2026-11-08",
    title: "A calmer AI panel and a roomier Paper vs ChemDFT page",
    summary:
      "The AI Scientist panel takes less space and shows the starter questions first. Paper vs ChemDFT keeps its rows and detail side by side when the AI panel is open. The panel's Tools and Runs tabs no longer fail to open.",
    added: [
      "The AI panel explains, under Details, where \"Follow AI\" works. It follows what the AI creates only in the Workspace; on other pages it never moves you away from what you are reading.",
    ],
    changed: [
      "AI panel: the two header rows are now one, with the collapse button next to the tabs.",
      "AI panel: the model, the page the AI is looking at and a Details button share one row. Provider, mode and the \"Follow AI / Stay here\" choice are under Details.",
      "AI panel: the starter questions come first; Investigation tools sit below them.",
      "Paper vs ChemDFT: with the AI panel open, the row detail stays in a narrower column beside the rows instead of dropping underneath them.",
      "Guided navigation: \"Files & Data\" is the only page marked as current when you look at imported results (before, Results and External Imports were marked too), and items that are not available yet are easier to read.",
    ],
    fixed: [
      "The AI panel's Runs and Tools tabs could show \"The workspace could not load\" when the server sent an unexpected reply. They now open, and an unexpected reply is treated as \"not available\".",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Automated checks passed: the web tests, the type check, the code style check and the production build. A new test covers the Runs and Tools tabs, the navigation's current page and these release notes.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
        {
          statement:
            "Looked at in a real Chrome browser with sample data, at 1280 and 1440 pixels wide, with the AI panel open and closed: the Jobs page with all five AI panel tabs, and Paper vs ChemDFT with a row selected. The accessibility scan found no problems (WCAG A and AA), and nothing ran off the page.",
          platform: "Chrome on a Mac, sample data only (not a real project)",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "The Guided workspace, the Results pages and the left navigation were not opened in a browser, because the sample data has no structure or results. The navigation changes are covered by an automated test and a style review only.",
        "Whether \"Follow AI\" could safely work on Result pages was not tested; for now the panel explains that it works in the Workspace only.",
        "The AI approval screen was not opened in a browser at 1280 pixels.",
        "The live site has not been checked for this release.",
      ],
      knownLimits: [
        "No scientific calculation was performed for this release.",
        "ChemDFT has no dark theme; pages stay light when the system is dark, so only the light look was checked.",
        "The sample data cannot show real engines, so the Tools tab lists engines as not on this deployment during these checks.",
      ],
    },
  },
  {
    version: "0.0.18",
    date: "2026-11-08",
    title: "Faster Jobs list and better AI answers about your selection",
    summary:
      "The Jobs list can show your jobs a page at a time and filter them. When you select a claim, a job or results, the AI Scientist can look up what is stored about them and answer from it.",
    added: [
      "Jobs: a \"Load more\" button and filters (state, provider, search) that work on long job lists. If the server is older, the page works as before.",
      "When you select a claim, a job or results on the Jobs, Claims, Compare or Paper vs ChemDFT pages, the AI Scientist looks up the stored record and answers from it. If something is not stored, it says so.",
    ],
    changed: [
      "Job costs are now shown from the whole stored amount (like whole cents), with no decimal arithmetic. The amount you see always matches the stored one. You will only notice a difference if an amount used to be shown slightly wrong.",
      "Opening the billing page no longer creates a billing record by itself.",
    ],
    fixed: [
      "On the Claims page the AI panel could say \"Scientific context unavailable\". The page now tells the AI Scientist which claim you selected, and if that is not possible the AI Scientist simply works without it, with no error.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "The automated tests passed: the backend had the same failures as before this release and none new, and the web checks (1569 tests, type check, code style, production build, data-format check) all passed.",
          platform: "Developer machine, automated test suites",
          engine: "No scientific engine used",
        },
        {
          statement:
            "Checked on the live site on 2026-11-08 with the owner signed in: the Releases page lists this version, the Jobs page loads (57 jobs), Settings loads with the account and ORCID intact, the service reports healthy, and requests without sign-in to the new job options and the billing page are refused.",
          platform: "Hosted beta, chemdft.com",
          engine: "No scientific engine used",
        },
      ],
      notYetVerified: [
        "The AI Scientist answering from stored records has not been tried with a real AI model. A live check on 2026-11-08 found that in the chat the AI did not read the selected claim and asked which claim was meant; this was fixed in 0.0.20.",
        "\"Load more\" and the Jobs filters have not been checked on the live site with one project.",
        "The Guided workspace screen where charge and multiplicity can be edited has not been captured in a browser; the rule behind it is covered by an automated test.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release.",
        "The new Jobs search matches structure name, formula, calculation type, provider and the job or calculation code. The older search also matched task and method labels.",
        "ChemDFT has no dark theme; pages stay light when the system is dark.",
      ],
    },
  },
  {
    version: "0.0.17",
    date: "2026-11-08",
    title: "Project rename, fixed charge for structure files, original paper numbers",
    summary:
      "You can rename a project in Settings. Charge and multiplicity are shown as fixed values when the structure file decides them. Claims show a paper's number exactly as written when it is on record.",
    added: [
      "Rename a project from Settings. Only the name changes; the project address stays the same.",
      "Claims and Paper vs ChemDFT show a number as written in the paper (for example 24.480) when the original text is on record.",
    ],
    changed: [
      "In the guided workspace, charge and multiplicity are shown as fixed values, with a short note, when they come from the structure file and cannot be changed for a calculation.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "The new screens were checked against the local test suites, not yet against a real signed-in project on the live site at the time of writing.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release; only screens and fields changed.",
        "A paper number is shown as written only when it can be matched exactly in the saved quote; otherwise the recorded digits are shown.",
      ],
    },
  },
  {
    version: "0.0.16",
    date: "2026-11-08",
    title: "ChemDFT moves to chemdft.com",
    summary:
      "Sign-in, ORCID and the software and calculation citations now use the address https://chemdft.com. The earlier beta address is no longer supported.",
    added: [],
    changed: [
      "Sign-in tokens, the ORCID return address and the website used in citations (BibTeX, RIS, APA, software citation) now point to chemdft.com.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "ORCID sign-in on the new address depends on the redirect address registered at ORCID and is checked separately by the owner.",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release; only the website address in sign-in and citations changed.",
        "Citations created before this release may still show the earlier beta address.",
      ],
    },
  },
  {
    version: "0.0.15",
    date: "2026-11-05",
    title: "Unified export fixes: workspace result tab control and result page deduplication",
    summary:
      "Completes the unified Export control rollout by rendering the shared ExportMenu on active workspace result tabs (e.g. vibrational and spectroscopy views) and removing redundant export buttons from the results inspector, ensuring exactly one accessible Export control per screen.",
    added: [
      "Unified ExportMenu rendered in the top-right toolbar slot of active workspace result tabs, matching the look, group order, and disabled reason annotations of other views.",
    ],
    changed: [
      "Reduced the legacy Export and reports panel on the results page to an informative pointer note directing users to the unified top-right Export menu, eliminating redundant buttons while preserving citation options and section deep-linking.",
    ],
    fixed: [
      "Fixed missing Export control in the workspace when viewing calculation results in the advanced workbench.",
      "Fixed duplicate export button entries on the individual calculation results page.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "End-to-end user export session workflows across mobile form factors (phone layouts are deferred).",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release (frontend UI control consistency and deduplication only).",
        "Pre-existing scientific export payload formats and server-generated evidence archives remain unchanged.",
      ],
    },
  },
  {
    version: "0.0.14",
    date: "2026-11-05",
    title: "Unified export control: consistent placement, look, keyboard navigation and 4-group menu everywhere",
    summary:
      "Replaces divergent export buttons and inline evidence panels with a single shared Export control on every screen (Overview, Workspace structure tab, Result pages, Comparison workstation, and Molecule Editor). The control uses a consistent Blueprint popover menu with strict group ordering (INTERACTIVE, DOCUMENTS, DATA, IMAGES), mono small-caps group headers, visible disabled items with honest explanatory reasons, and a companion neutral Share button.",
    added: [
      "Shared ExportMenu component deployed across Overview, Workspace structure tab, Result pages, Comparison workstation, and Molecule Editor.",
      "Strict fixed group ordering enforced in the popover menu: INTERACTIVE, DOCUMENTS, DATA, IMAGES with mono small-caps group headers and item subtexts explaining the format.",
      "Visible disabled state with one-line reason annotations for contextual items that cannot yet be exported (e.g. 3D generation required, no optimization frames recorded, or orbital grid only).",
      "Full keyboard navigation: Enter and Space open the popover menu, ArrowDown and ArrowUp navigate between actionable items, Escape closes the menu and returns focus to the trigger button.",
    ],
    changed: [
      "Unified the Export trigger button to an outlined accent style (36px high, 2px radius, Inter semi-bold) on all screens.",
      "Replaced the long inline 'Export stored evidence' panel on Result pages with the unified popover menu.",
      "Replaced separate camera-icon export buttons on 3D visualization panels with a unified 'Snapshot of the 3D view (.png)' menu item calling the same image export handler.",
      "Standardized companion Share button to a neutral outlined style positioned adjacent to Export where sharing applies.",
    ],
    fixed: [
      "Eliminated duplicate export buttons and divergent visual styles across workspace toolbars, result inspector headers, and comparison actions.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "End-to-end user export session workflows across mobile form factors (phone layouts are deferred).",
      ],
      knownLimits: [
        "No new scientific calculation was performed for this release (frontend UI consistency and keyboard navigation unification only).",
        "Pre-existing scientific export payload formats and server-generated evidence archives remain unchanged.",
      ],
    },
  },
  {
    version: "0.0.13",
    date: "2026-11-04",
    title: "Export and share: interactive HTML, static report PDF, structure files, and 3D PDF (in testing)",
    summary:
      "Project-level export menu and share dialog delivering self-contained interactive 3D HTML web pages (primary cross-platform 3D option), static report PDFs, structure files (XYZ, SDF, MOL, SMILES), project archives, drawing exports, and 3D PDF capability detection (held back in testing).",
    added: [
      "First-class standalone interactive HTML export (.html) embedding minified 3Dmol.js (v2.5.5, BSD-3-Clause) offline with zero external network calls; supports rotation, zoom, pan, styles (ball & stick, sticks, spheres, lines), ChemDFT/CPK palettes, projection, labels, hydrogens toggle, Save PNG, multi-structure switcher, and WebGL-missing fallback banner.",
      "Project-level Export menu in the project viewer with exact priority order: interactive HTML (Available), report PDF (Available), 3D PDF (In Testing), structure files (XYZ, SDF, MOL, SMILES), project archive (.zip), and snapshot image (PNG).",
      "Server-side export capability detection (GET /v1/export/capabilities) holding back 3D PDF generation with HTTP 501 on servers without the Asymptote toolchain.",
      "Static report PDF export using ReportLab for universal compatibility across all desktop and mobile PDF viewers with firewall-compliant evidence tables.",
      "Phase 1 Share dialog providing direct artifact download, native device sharing sheet via Web Share API, pre-filled email draft with attachment instructions, and WhatsApp text sharing (no public link hosting controls).",
      "Chemical drawing export controls in Molecule Editor for interactive HTML, 2D PDF drawing, 3D PDF (in testing), XYZ, SDF, MOL, SMILES, project archive, and images (SVG, PNG).",
      "Project archive ZIP export bundling structure files (XYZ, SDF, MOL, SMILES), calculation records, README guidance, and a cryptographic SHA256 integrity manifest.",
    ],
    changed: [
      "Structure version export now supports format=SMILES alongside existing SDF, MOL, XYZ, and CIF formats.",
      "Overview header updated to include prominent project export and share controls alongside administrative details.",
      "Asymptote execution path sanitized to check system PATH and CHEMDFT_ASYMPTOTE_BIN without hardcoded macOS developer paths.",
    ],
    fixed: [
      "Fixed coordinate authority labelling on exported user-built structures, ensuring unoptimized geometries are clearly labelled USER_ENTERED · NOT OPTIMIZED.",
      "Fixed missing pikepdf, reportlab, and pillow dependencies in services/api pyproject.toml, uv.lock, and production api-requirements.lock.",
      "Vendored 3Dmol.js asset in backend package to eliminate reliance on node_modules or CDN during production HTML export.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Self-contained interactive HTML export verified across 5 representative test molecules (3 to 44 atoms, neutral and charged -1) in Chromium under fully blocked offline network conditions with canvas rendering, 3D rotation, and WebGL fallback.",
          platform: "Local macOS development workstation (Chromium 156)",
          engine: "3Dmol.js 2.5.5, ChemDFT project_export.py",
        },
        {
          statement:
            "Static report PDF generation verified with ReportLab and pikepdf, embedding accurate calculated properties and firewall badges.",
          platform: "Local macOS development workstation",
          engine: "ReportLab 5.1.0, pikepdf 10.17.0",
        },
      ],
      notYetVerified: [
        "3D PDF model-tree nodes, camera views, and 3D rotation in desktop Adobe Acrobat or Acrobat Reader (NOT VERIFIED: no machine with Acrobat was available; only the flat poster image is visually confirmed in standard viewers).",
        "Phase 2 hosted read-only share links with expiration and revocation tokens.",
      ],
      knownLimits: [
        "3D PDF export is currently IN TESTING and disabled by default on production Linux servers (requires Asymptote toolchain packaging).",
        "3D rotation and pan in PDF requires Adobe Acrobat or Acrobat Reader on Windows/macOS; standard viewers (Chrome, Safari, macOS Preview) display the 2D poster image only.",
        "Web Share API depends on browser and OS support; desktop browsers without native share sheets fall back to direct download and copy summary.",
        "Mailto and WhatsApp links cannot attach binary files automatically; researchers must attach downloaded files manually.",
      ],
    },
  },
  {
    version: "0.0.12",
    date: "2026-11-04",
    title: "Manual paper claim entry",
    summary:
      "Researchers can now manually enter paper values from project documents, validating client inputs and storing them as literature evidence separate from ChemDFT calculated results.",
    added: [
      "Add paper claim action in Scientific Claims and Paper vs ChemDFT opening a structured literature entry form.",
      "Client-side validation for manual paper claims: numeric values, required units, valid page range (1 to 10,000), and verbatim quotations.",
      "Entered claims are labelled User-entered and entered by you, anchored to project documents and never presented as extracted or calculated results.",
    ],
    changed: [],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Manual claim entry was validated locally with offline transport specs; live backend persistence and comparison reconciliation are verified against the existing manual claims schema.",
      ],
      knownLimits: [
        "No new scientific calculation was performed in this release; manual claims are literature evidence entered by the researcher, not ChemDFT calculated values.",
        "Manual claim entry requires at least one imported document in the project to anchor provenance.",
      ],
    },
  },
  {
    version: "0.0.11",
    date: "2026-11-04",
    title: "Limits shown before you run, charge control, manual paper claims, vibrational arrows",
    summary:
      "A paper-driven user test showed several limits that only appeared after clicking. This release shows the hosted limits before Run, fixes misleading messages, lets you enter paper values yourself, and adds displacement arrows to vibrational modes.",
    added: [
      "The calculation form shows the hosted atom limit for the chosen task and engine, the elements supported for conformer search, and a time note for large PySCF single points; Run is disabled with a plain reason when a limit is exceeded.",
      "A Total charge field in the molecule editor, and a plain message for ion pairs and complexes that points to XYZ import.",
      "Enter a paper value by hand (value, unit, page, verbatim quote, system). It is stored as user-entered literature, never as a calculated result, and appears in Claims and Paper vs ChemDFT.",
      "Displacement arrows for vibrational modes, labelled as scaled for display.",
      "Paper statements such as \"10.2 kcal/mol higher than\u2026\" are extracted as literature claims with page and quote, labelled \"paper reports\".",
    ],
    changed: [
      "Hosted xTB geometry optimization accepts up to 50 atoms (PySCF optimization stays at 12). Hosted PySCF single points may run up to 30 minutes.",
      "Atom labels are larger with a light halo; measurements name the atoms and the quantity; the image export says which file it made.",
      "The Projects page says how many structures a project has and why a count may be lower than the total.",
    ],
    fixed: [
      "A cancelled calculation is shown as Canceled, not as an engine failure.",
      "The availability check refreshes by itself instead of showing \"refresh required\".",
      "Temperatures from non-CVD papers are no longer labelled deposition temperature; a running header is no longer used as a document title.",
      "The vibrational Hessian check no longer rejects normal DFT Hessians (limit 1e-3 for DFT, 1e-4 for Hartree-Fock) and states the measured asymmetry when it refuses one.",
      "A missing 3D surface now says so instead of an endless spinner.",
    ],
    scientificStatus: {
      verified: [
        {
          statement: "The PySCF analytic B3LYP/def2-SVP Hessian of HNO3 at its B3LYP minimum has an asymmetry of 1.3e-4 to 5.9e-4 Eh/bohr^2 that does not shrink with a finer grid; this is why the old 1e-4 check refused it.",
          platform: "Local development machine (macOS), not the hosted worker",
          engine: "PySCF 2.14.0",
        },
        {
          statement: "xTB GFN2 geometry optimization of the 39-atom lophine A1 (run time 53 s) and of a 44-atom lophine-HNO3 complex (run time 1 min 2 s) converged and were published through the Result Firewall, one job each.",
          platform: "Hosted beta, AWS m7i-flex.large Linux worker",
          engine: "xTB 6.7.1",
        },
        {
          statement: "HNO3 optimized at B3LYP/def2-SVP, then B3LYP/def2-SVP vibrational analysis on that geometry: 9 modes, lowest 509.8 cm^-1, no imaginary mode, validated; one case.",
          platform: "Hosted beta, AWS m7i-flex.large Linux worker",
          engine: "PySCF 2.14.0",
        },
      ],
      notYetVerified: [
        "A B3LYP/def2-SVP single point on the 39-atom lophine A1 finished and converged on the hosted worker in 11 min 36 s (one measurement), but the app lost its result at the collection step on both attempts, so no result was published. The cause is not yet found; until it is, the form advises a smaller basis or xTB for molecules of this size.",
        "No B3LYP/def2-SVP single point on a 44-atom complex was run.",
        "Orbital, density and electrostatic-potential surfaces are not produced on the hosted beta; only the orbital energies are.",
        "Conformer search with nitrogen is not verified and stays limited to hydrogen, carbon and oxygen.",
        "The chat can still state a wrong general-knowledge definition (a live test of \"What is lophine?\" gave the correct project formula but a wrong compound name).",
        "The displacement arrows were checked live on one result (HNO3, B3LYP/def2-SVP) only.",
      ],
      knownLimits: [
        "Hosted orbital analysis stays at 12 atoms, frequencies at 6, TDDFT at 6.",
        "Imported structures are labelled externally built; ChemDFT cannot assemble a complex from two structures yet.",
      ],
    },
  },
  {
    version: "0.0.10",
    date: "2026-11-03",
    title: "Beta readiness: signup built behind a switch, limits, data export and deletion",
    summary:
      "ChemDFT can now be opened to new researchers, but signup is still closed: it is switched on only by the owner. This release adds the account safeguards that must exist first: email verification, password reset, per-account limits, export and deletion of your data, and draft Terms, Privacy Policy and Beta notice.",
    added: [
      "Self-service signup with email verification, password reset, a list of blocked disposable email domains, per-address and per-IP rate limits and an accepted-terms record. It is off by default and stays closed until the owner opens it and email delivery works.",
      "Beta limits for self-signup accounts, enforced by the server and shown in Settings: calculations per day and per 30 days, running calculations, AI runs per day, projects, stored files and upload size. Each refusal names its limit.",
      "Settings > General: Download my data (a zip of your projects, structures, jobs and results with provenance) and Delete account (cancels running jobs, deletes the content of your projects, removes stored files and your ORCID link, and anonymises the account).",
      "Draft Terms of Use, Privacy Policy and Beta notice pages, linked in the footer, with a support contact.",
    ],
    changed: [
      "The AI Scientist is not available to new self-signup accounts during the beta. Accounts that existed before, including invited researchers, are unchanged.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Signup, email delivery, verification, password reset, the limits and deletion were tested offline with local accounts only, and account deletion on a local PostgreSQL for a project with a structure and a file. None of it was exercised on the live site, and no scientific result changed.",
        "Deleting a project that contains calculations, results or AI conversations was not tested on PostgreSQL.",
        "The Terms and Privacy Policy are drafts that have not been legally reviewed.",
      ],
      knownLimits: [
        "No new scientific calculation was run or changed in this release.",
        "Signup is closed and no email provider is set up, so no new account can be created yet.",
        "Backups keep deleted data for up to 30 days. The list of disposable email domains is not complete.",
      ],
    },
  },
  {
    version: "0.0.9",
    date: "2026-11-03",
    title: "Engines: conformer search verified on the hosted worker, more citations",
    summary:
      "A conformer search (CREST) now runs on the hosted AWS worker and passes the Result Firewall, after the hand-off the Firewall rejected was fixed. Psi4 and DFT-D4 references are added to Cite this calculation, and the engine status is stated engine by engine.",
    added: [
      "Cite this calculation and the How to cite page list the Psi4 paper that the Psi4 project names for the package and the three papers the DFT-D4 project asks to always cite. QCEngine is marked \"citation text not verified\" because its project page names no paper.",
    ],
    changed: [],
    fixed: [
      "A hosted conformer search finished but the Result Firewall rejected it because the worker recorded the wrong calculation identifier. The worker is now told the real identifier and refuses to run without one. The Firewall check itself was not loosened.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Ethanol conformer search (GFN2, neutral singlet, one run): the job finished, passed the Result Firewall and stored its result. Lowest conformer energy -11.39433939 Eh, the same value as the earlier macOS reference. This is one molecule and one run of a stochastic search.",
          platform: "Hosted beta, AWS Linux worker (m7i-flex.large), runtime image rebuilt for this release",
          engine: "CREST 3.0.2+pf8c-ewinfix-a1 (embedded tblite 0.3.0 fork)",
        },
        {
          statement:
            "Water HF/STO-3G single-point energy on the rebuilt image: -74.9644475827696 Eh, within 1e-13 Eh of the macOS value, to confirm the new image did not change PySCF results.",
          platform: "Hosted beta, AWS Linux worker (m7i-flex.large), runtime image rebuilt for this release",
          engine: "PySCF 2.14.0",
        },
      ],
      notYetVerified: [
        "Psi4, DFT-D4 and QCEngine have no hosted workload. They are blocked: the accepted Psi4 build is a macOS inventory with no verified Linux build, DFT-D4 corrects only a hosted Psi4 energy, and QCEngine has no route and ships only inside the Psi4 build.",
        "Conformer search for other molecules, and a repeat of the same molecule: not run.",
      ],
      knownLimits: [
        "The hosted worker image is the previously accepted CREST binary with the corrected worker script layered on top; a full rebuild produced a different CREST binary, which was not accepted.",
        "Open legal decisions for the owner: the geomeTRIC \"Non-AI\" licence (hosted geometry optimization) and the LGPL status of CREST, Psi4 and DFT-D4. Nothing is distributed.",
        "A result from one image or platform is not evidence for another; hosted results are labelled with the image they ran on.",
      ],
    },
  },
  {
    version: "0.0.8",
    date: "2026-11-03",
    title: "Hardening: queued conformer jobs, ORCID tests, citation polish",
    summary:
      "A conformer-search job can no longer wait silently when the server's lock file cannot be opened, the ORCID refusal paths have more tests, and Cite this calculation marks the chosen format.",
    added: [],
    changed: [
      "Cite this calculation highlights the selected format, and the ORCID and citation checkboxes are larger.",
    ],
    fixed: [
      "On the hosted backend a queued conformer-search (CREST) job could sit waiting with no message when its lock file location was not writable. Once the backend with this change is deployed, the lock defaults to a writable folder and a failure is logged with the cause. Nothing hosted ran to check this; it is covered by offline tests.",
    ],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "The new lock location and the failure log on the hosted backend: offline tests only until the backend is deployed and a conformer job runs.",
        "On the live ORCID flow: unlinking, a second account claiming the same iD, an unlinked iD being refused, denying access, which name fields ORCID returns, and PKCE enforcement. The refusal cases are now covered by offline tests against a locally signed token, which is not evidence about ORCID.",
        "Real Chrome 109 and the live site signed in: not checked in this release.",
      ],
      knownLimits: [
        "No new scientific calculation was run or verified in this release.",
        "Two-account isolation was checked on a local test stack, not on the live site.",
        "ChemDFT has no dark theme; in a dark colour scheme the pages stay light.",
        "Denying access on ORCID's page leaves the unused one-time state to expire after 10 minutes; it cannot be used without a code.",
      ],
    },
  },
  {
    version: "0.0.7",
    date: "2026-11-03",
    title: "ORCID checked on the live site",
    summary:
      "Linking an ORCID iD and signing in with it have now been tried once on the live site; the release notes for those features are updated to say exactly what was and was not checked.",
    added: [],
    changed: [
      "The ORCID verification status is updated: linking and sign-in were tried once by the owner on the live site.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "Linking an ORCID iD from Settings (ORCID's consent screen asked only for the iD, and Settings then showed the iD as authenticated by ORCID with the name kept) and then signing in with ORCID into the same account. One account and one iD, reported by the owner.",
          platform: "Live site, ORCID Public API production client (authenticate only)",
          engine: "ORCID Public API (OpenID Connect, scope openid)",
        },
      ],
      notYetVerified: [
        "Unlinking an ORCID iD on the live site.",
        "A second account trying to link the same iD, and an unlinked iD being refused at sign-in, on the live site (both are covered only by offline tests).",
        "Denying access on ORCID's page, which name fields ORCID returns, and whether ORCID enforces PKCE.",
        "\"Cite this calculation\" on a result in a signed-in browser.",
      ],
      knownLimits: [
        "This is one account and one iD; it shows the happy path works, nothing more.",
        "No new scientific calculation was run or verified in this release.",
        "A calculation has no DOI; Zenodo and DOI registration are not part of ChemDFT yet.",
      ],
    },
  },
  {
    version: "0.0.6",
    date: "2026-11-03",
    title: "ORCID iD and citing a calculation",
    summary:
      "You can link an ORCID iD that ORCID itself has confirmed, sign in with it, and copy a citation, a Methods paragraph and a reproducibility record for any finished calculation.",
    added: [
      "Settings > General has an ORCID iD section: a plain-language consent text, Connect, and Unlink. The iD is shown as the full orcid.org link with the official iD icon and is shown as authenticated only when ORCID itself authenticated it; an iD can never be typed in.",
      "Sign in with ORCID on the sign-in page for accounts that already linked an iD. It never creates an account; an unlinked iD is refused with a plain message.",
      "Cite this calculation on every result and finished job: BibTeX, RIS, APA, plain text, a Methods paragraph built only from the stored record, the engine references, and a reproducibility JSON (no structure or project names, coordinates or logs).",
      "How to cite page: citing a calculation, and the references each engine project asks for (PySCF, xTB, CREST, geomeTRIC; RDKit's requested text).",
    ],
    changed: [],
    fixed: [],
    scientificStatus: {
      verified: [],
      notYetVerified: [
        "Linking and sign-in with a real ORCID account in the browser: not run yet, so ORCID sign-in and linking are not verified against ORCID. The flow is tested offline against a locally signed identity token, which shows ChemDFT's own checks work, not that ORCID accepts the request.",
        "Whether ORCID enforces PKCE: its documentation does not say, so ChemDFT sends it but does not rely on it.",
        "ORCID is off by default and is enabled only by the owner. It uses ORCID's free Public API (authenticate only, non-commercial); an iD from the optional ORCID sandbox test environment is never added to a citation.",
        "Citations for Psi4, QCEngine and DFT-D4 are not included because their citation text has not been verified here yet.",
      ],
      knownLimits: [
        "A calculation has no DOI; Zenodo and DOI registration are not part of ChemDFT yet.",
        "Citation text is generated from the stored record. A fact the record does not hold, such as a container image identifier on older runs, is printed as not recorded.",
        "No new scientific calculation was run or verified in this release.",
      ],
    },
  },
  {
    version: "0.0.5",
    date: "2026-11-03",
    title: "Hosted conformer search: built, not yet accepted",
    summary:
      "The hosted worker now has a Linux build of the conformer-search engine (CREST) and the hosted route accepts small neutral conformer searches. Two hosted runs failed: the first on a missing identity setting (fixed), the second because the platform rejected the finished result on a record-keeping mismatch (fix needs a worker rebuild, not done). A new button starts a second calculation on the same structure from the Guided form.",
    added: [
      "Hosted conformer search (CREST, GFN2) for small neutral molecules of hydrogen, carbon and oxygen, up to 12 atoms, with a 15-minute limit. It passed its acceptance check on the worker host (water, one conformer, the same energy as a developer Mac run), but both runs through the hosted route failed. The first stopped because the worker could not confirm the identity of its own CREST program (fixed). In the second, CREST finished and found the same two ethanol conformers as a developer Mac run, but the platform rejected the result because the worker recorded the wrong calculation identifier, so nothing was published. Hosted conformer search is not verified.",
      "A \"New calculation on this structure\" button on the Guided Review step once a result is open.",
    ],
    changed: [
      "The hosted worker image was replaced by one that includes CREST. A single-point energy for water, Hartree-Fock/STO-3G, was repeated on it and gave the same value as before.",
    ],
    fixed: [
      "The Guided form could not start a second calculation on the same structure; the new button is the fix. It was type-checked and unit-tested, but not yet clicked through in a browser.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Water (PubChem CID 962 geometry), Hartree-Fock/STO-3G single-point energy -74.9644475827696 Eh on the new worker image, accepted by the Result Firewall; it matched a developer Mac run to about 1e-13 Eh.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF 2.14.0",
        },
      ],
      notYetVerified: [
        "Hosted conformer search: two hosted runs (ethanol) failed and nothing was published. In the second, the worker's own output matched the Mac reference, but it was not accepted by the platform, so it is not a verified result. A water run was not attempted because it would have failed for the same reason.",
        "Psi4, QCEngine and DFT-D4 on the hosted worker: not available. Psi4 and QCEngine have a Linux package list prepared but nothing built; DFT-D4 has no hosted calculation because its correction needs a hosted Psi4 energy.",
        "Orbital surface images (cubes) on the hosted worker: not available.",
      ],
      knownLimits: [
        "The conformer-search panel shows the local limits (2 threads, 30 minutes); the hosted worker uses 1 thread and 15 minutes.",
        "CREST is stochastic; a search is not a certified list of all minima, and a result from one platform is not evidence for another.",
        "The server accepts up to 10 TDDFT states on the hosted worker, but only 5 states were checked.",
        "xTB energies are semi-empirical and are on a different scale from PySCF energies.",
      ],
    },
  },
  {
    version: "0.0.4",
    date: "2026-11-03",
    title: "More hosted energy cases and xTB optimization",
    summary:
      "Two more single-point energy cases have now run on the hosted worker, xTB geometry optimization has now run on it for water, and the review step shows expected run times.",
    added: [
      "Expected run time and stop limit on the Review step for tasks that have run on the hosted worker.",
      "Hosted xTB (GFN2) geometry optimization is accepted by the hosted route, with its own 5-minute limit. It was run twice for water: the first run was rejected by the platform's own evidence check because of a bug in how the evidence was passed on (nothing was published), the second, after the fix, was accepted.",
    ],
    changed: [
      "The Guided form now starts TDDFT, infrared and Raman at def2-SVP (the previous release note said both forms did this; the Guided form still started TDDFT at def2-SVPD until now).",
      "Learn says orbital surface images (cubes) are not available on the hosted beta.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "Water (PubChem CID 962 geometry), GFN2-xTB geometry optimization (ANCopt, normal): converged in 4 iterations, final energy -5.070544344326 Eh, accepted by the Result Firewall; it matched a developer Mac run to about 1e-12 Eh. The first hosted attempt failed the platform's evidence check and was fixed before this one.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "xTB 6.7.1 (GFN2, semi-empirical)",
        },
        {
          statement:
            "Water (PubChem CID 962 geometry), Hartree-Fock/STO-3G single-point energy -74.9644475827696 Eh, accepted by the Result Firewall; it matched a developer Mac run to about 1e-13 Eh.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF 2.14.0",
        },
        {
          statement:
            "Water (same geometry), PBE/6-31G single-point energy -76.29896640950217 Eh, accepted by the Result Firewall; it matched a developer Mac run to about 6e-14 Eh.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF 2.14.0",
        },
      ],
      notYetVerified: [
        "xTB frequencies and other xTB tasks on the hosted worker; the optimization is one case (water) and a converged optimization does not establish a minimum without a vibrational analysis.",
        "Orbital surface images (cubes) on the hosted worker: not available.",
        "Each hosted calculation is a single case (water). Other molecules, methods and basis sets are not verified by it, and the Mac comparison is a cross-platform check, not a Linux reference.",
        "CREST, Psi4, QCEngine and DFT-D4 on the hosted worker.",
      ],
      knownLimits: [
        "In the Guided form, the Review step stays tied to the last calculation submitted for the same structure, so a second calculation on that structure cannot be started from Guided; use the Advanced workbench calculation form. This will be fixed in the next batch.",
        "The server accepts up to 10 TDDFT states on the hosted worker, but only 5 states were checked; 10 did not converge for water at def2-SVP.",
        "A result from one platform is not evidence for another.",
        "xTB energies are semi-empirical and are on a different scale from PySCF energies.",
      ],
    },
  },
  {
    version: "0.0.3",
    date: "2026-11-03",
    title: "Failed excited-state runs stop, and clearer defaults",
    summary:
      "A hosted TDDFT calculation that does not converge now fails once with a plain explanation instead of being started again by the queue, and the forms start from the settings that were actually checked on the hosted worker.",
    added: [
      "The calculation panel has an editable number-of-excited-states field for TDDFT.",
      "Every hosted calculation is started at most twice if its worker is lost; after that it fails with a clear message.",
    ],
    changed: [
      "TDDFT starts at 5 excited states in both the Guided form and the calculation panel (it was 10), and the calculation panel starts at def2-SVP (it was def2-SVPD).",
      "The home page and the engine chooser say Psi4 and DFT-D4 are not available for new runs, because Psi4 is not configured on this deployment.",
    ],
    fixed: [
      "A TDDFT run whose excited-state solver did not converge was started again several times by the queue, because its failure was not saved. It now fails once, says how many states did not converge, and is not retried.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "In an offline test with a stand-in worker, a non-converged TDDFT result is saved as one failed attempt with a clear message and is not started again, and a worker that keeps dying is started at most twice.",
          platform: "Automated tests with a stub worker, not the AWS worker",
          engine: "None (no engine ran)",
        },
      ],
      notYetVerified: [
        "The fix has not been run on the hosted AWS worker; no new hosted calculation was run for this release.",
        "The 5-state default is checked for one case (water at B3LYP/def2-SVP). Other molecules, bases and state counts are unverified.",
        "On a developer Mac the same water calculation with 10 states converged, while on the hosted worker it did not, so a state count that works on one platform may fail on another.",
      ],
      knownLimits: [
        "The server still accepts up to 10 TDDFT states on the hosted worker; counts above 5 are unverified and may fail to converge.",
        "A result from one platform is not evidence for another.",
        "xTB energies are semi-empirical and are on a different scale from PySCF energies.",
      ],
    },
  },
  {
    version: "0.0.2",
    date: "2026-11-03",
    title: "xTB energy and TDDFT on the hosted worker",
    summary:
      "The hosted beta can now run two more calculations on its Linux worker: an xTB (GFN2, semi-empirical) single-point energy and a PySCF time-dependent DFT (TDDFT) excited-state calculation. Each has been run once, for water.",
    added: [
      "Hosted xTB 6.7.1 GFN2 single-point energy for neutral singlet molecules, shown as semi-empirical and never compared with ab initio totals.",
      "Hosted PySCF TDDFT for closed-shell singlet molecules of up to 6 atoms and 10 states, with its own time limit.",
    ],
    changed: [
      "Learn and the AI Scientist describe the hosted route as running only the engine and task combinations that have actually been executed and checked there.",
      "The hosted beta now reports xTB as available for single-point energy only, instead of reporting it as unavailable.",
    ],
    fixed: [],
    scientificStatus: {
      verified: [
        {
          statement:
            "Water (the PubChem CID 962 geometry), GFN2-xTB single-point energy -5.07020855616 Eh, accepted by the Result Firewall; it matched the same calculation on a developer Mac to every printed digit (checked at 1e-6 Eh).",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "xTB 6.7.1 (GFN2, semi-empirical)",
        },
        {
          statement:
            "Water, B3LYP/def2-SVP, 5 singlet excited states (7.503, 9.417, 9.820, 11.826 and 13.791 eV), ground-state energy -76.35828206 Eh, accepted by the Result Firewall; all five excitation energies were within 6.1e-7 Eh of a developer Mac reference.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF 2.14.0",
        },
      ],
      notYetVerified: [
        "xTB geometry optimization, frequencies, CREST and Psi4 on the hosted worker. CREST and Psi4 need Linux builds first; Psi4 is not set up for new runs.",
        "Each hosted calculation is a single case (water). Other molecules, methods, basis sets and state counts are not verified by it.",
        "The xTB energy was compared with a Mac run of the same program, not with an independent Linux reference.",
      ],
      knownLimits: [
        "TDDFT with 10 states for water at def2-SVP did not converge on the hosted worker and was refused rather than published; the form currently offers 10 states by default in some places, so choose a smaller number such as 5.",
        "A failed hosted calculation of this kind can be started again by the queue several times before it is stopped; this was seen once and has not been fixed.",
        "xTB energies are semi-empirical and are on a different scale from PySCF energies.",
        "A result from one platform is not evidence for another.",
      ],
    },
  },
  {
    version: "0.0.1",
    date: "2026-11-02",
    title: "First public beta",
    summary:
      "The first numbered release of ChemDFT: a computational chemistry workbench where an AI Scientist plans and explains, and every scientific value comes from a verified engine. Sign-up is currently closed; this release describes the beta as it stands.",
    added: [
      "Projects, with a workspace for molecules and crystals, a 3D viewer, jobs, results, comparison of results, scientific claims, and a comparison of published values with ChemDFT results.",
      "A molecule editor: draw a structure, see its SMILES live, paste SMILES or a MOL file, export SVG or PNG, check the drawing, and generate a 3D structure from it.",
      "AI Scientist Draw mode: describe a molecule in words and the editor builds it step by step. The server checks every step, and a drawing that fails a check is marked as needing attention rather than finished.",
      "AI Scientist chat with human approval of proposed calculations, a choice of language models, and cited answers about uploaded papers.",
      "Three sealed examples: chromium(III) oxide (eskolaite), benzene and caffeine.",
      "A Learn section and a How to cite page with BibTeX and APA citations for the software.",
      "Layouts that work on laptop screens, including older Chrome 109 browsers, with or without the AI Scientist panel open.",
    ],
    changed: [
      "The navigation is a single row on wide screens and shows icons on narrower ones.",
      "The AI Scientist panel becomes a slide-over drawer on screens up to 1200 px wide, so it never covers the work area permanently.",
    ],
    fixed: [
      "The 3D view was clipped on short laptop screens (1093 x 520 up to 1366 x 768); it now fits.",
      "Errors from the AI Scientist are shown in plain language, with the technical text available under Details.",
    ],
    scientificStatus: {
      verified: [
        {
          statement:
            "Hartree-Fock energy of H2 (STO-3G), calculated and accepted by the Result Firewall.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF",
        },
        {
          statement:
            "Water, B3LYP/def2-SVP: a single-point energy, a geometry optimization (converged, -76.35831535542225 Eh) and a frequency run (1638.7, 3791.7 and 3886.8 cm-1, no imaginary mode) were calculated and accepted by the Result Firewall; the frequencies matched an independent Linux reference run.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF",
        },
        {
          statement:
            "Water, B3LYP/def2-SVP: thermochemistry (zero-point energy 55.728 kJ/mol) and orbital energies (HOMO -0.292005 Eh, LUMO +0.046932 Eh) matched the Linux reference, and were accepted by the Result Firewall.",
          platform: "Hosted beta, AWS Linux worker (on-demand)",
          engine: "PySCF",
        },
        {
          statement:
            "PySCF 2.14.0, xTB 6.7.1 and a patched CREST 3.0.2 ran locally and passed their acceptance checks.",
          platform: "Developer Mac (macOS, Apple silicon), local only",
          engine: "PySCF 2.14.0, xTB 6.7.1, CREST 3.0.2 (patched)",
        },
        {
          statement:
            "Cited answers about one uploaded English paper: 19 of 19 test questions answered with exact quotes, including a control question the paper cannot answer.",
          platform: "Hosted beta, one paper",
          engine: "AI Scientist retrieval (not a chemistry engine)",
        },
      ],
      notYetVerified: [
        "xTB, CREST and Psi4 on the hosted AWS worker. CREST and Psi4 need Linux builds first; Psi4 is not set up for new runs.",
        "Time-dependent DFT (TDDFT) on the hosted worker.",
        "Each hosted calculation above is a single case. Other molecules, methods and basis sets are not verified by it.",
        "AI Scientist Draw mode on the hosted site has not been clicked through end to end.",
        "Dark theme, real phone and tablet layouts, and a real Chrome 109 browser (older-browser CSS was tested with emulation only).",
        "Separation of data between two accounts on the hosted site.",
      ],
      knownLimits: [
        "A result from one platform is not evidence for another: the hosted values above do not certify the local runs, and the local runs do not certify the hosted ones.",
        "Draw mode compares a plain molecule name with a table of 31 checked molecules; names outside the table rely on the model and the server's checks, which are a partial safeguard.",
        "AI answers are labelled and kept separate from calculated results; they are not evidence by themselves.",
        "Payments, GPU computing and other cloud compute providers are not available.",
        "Release notes and the AI Scientist are English only for now.",
      ],
    },
  },
];

export const LATEST_RELEASE: ReleaseEntry = RELEASES[0]!;
export const LATEST_VERSION: string = LATEST_RELEASE.version;
