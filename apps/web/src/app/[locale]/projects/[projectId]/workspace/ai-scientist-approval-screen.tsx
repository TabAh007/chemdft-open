"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AIApprovalView, StructureEditDiffView } from "@chemdft/schemas";
import { ActionButton, AppIcon } from "@chemdft/ui";
import { ScientificTimestamp } from "@/app/_components/scientific-timestamp";
import { approvalGeometryKey } from "@/lib/approval-geometry";
import { aiTimestamp } from "@/lib/ai-scientist-workflow";
import {
  basisLabel, eligibilityLabel, engineLabel, expiryCountdown, humanizeDetail, MATCH_OUTCOME, matchValueLabel, methodLabel,
  multiplicityLabel, parameterLabel, providerLabel, requestCheckSummary, samplingLabel, taskLabel,
} from "@/lib/scientific-labels";
import { CalculationProposal, type ResolvedProposalStructure } from "./ai-scientific-workflow";

const record = (value: unknown) => (value && typeof value === "object" ? value as Record<string, unknown> : null);

function formatCoordinates(coords: unknown): string {
  if (!Array.isArray(coords)) return "";
  return coords.map((c) => (typeof c === "number" ? c.toFixed(3) : String(c))).join(", ");
}

/**
 * Dedicated approval screen. Every value shown comes from the server-normalized approval
 * arguments or from the exact saved structure version they name; Approve stays disabled until
 * all bound fields are present and well typed, the exact geometry resolves, and the approval is
 * PENDING and unexpired. The backend re-validates on decision; this screen only informs it.
 */
const COMPUTE_PREFERENCE: Record<string, string> = {
  AUTO: "Automatic — chosen by the server at submission", LOCAL: "Local compute", CLOUD: "Cloud compute",
};

export function ApprovalCard({
  approval, submitting, onApprove, onReject, onBack, request = null, proposedUnder = null, variant = "screen",
}: {
  approval: AIApprovalView;
  /** The researcher's message that started this run, when it is recorded. */
  request?: string | null;
  /** The context the run was asked under, when the researcher has since moved to another one. */
  proposedUnder?: string | null;
  submitting: boolean;
  onApprove: () => void;
  onReject: (note?: string) => void;
  onBack?: () => void;
  variant?: "screen" | "inline";
}) {
  const expiresAt = aiTimestamp(approval.expires_at);
  const [now, setNow] = useState(() => Date.now());
  const countdown = expiryCountdown(expiresAt, now);
  const expired = countdown.expired;
  const [rejectNote, setRejectNote] = useState("");
  const geometryKey = approvalGeometryKey(approval);
  const [geometryReady, setGeometryReady] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedProposalStructure | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onGeometryReady = useCallback((ready: boolean) => setGeometryReady(ready ? geometryKey : null), [geometryKey]);
  const onResolved = useCallback((value: ResolvedProposalStructure) => setResolved(value), []);

  useEffect(() => {
    if (expired) return;
    const timer = window.setInterval(() => setNow(Date.now()), countdown.urgent ? 1000 : 15_000);
    return () => window.clearInterval(timer);
  }, [expired, countdown.urgent]);
  useEffect(() => { if (variant === "screen") titleRef.current?.focus(); }, [variant, approval.id]);

  const args = approval.normalized_arguments ?? {};
  const spec = record(args.specification);
  const method = record(spec?.method)?.identifier;
  const basis = record(spec?.basis)?.identifier;
  const engine = record(spec?.engine_preference)?.engine;
  const versionId = record(args.structure_version)?.entity_id;
  const methodName = typeof method === "string" && method ? method : null;
  const basisName = typeof basis === "string" && basis ? basis : null;
  const engineName = typeof engine === "string" && engine ? engine : null;
  const structureVersionId = typeof versionId === "string" && versionId ? versionId : null;
  const taskType = typeof spec?.task_type === "string" && spec.task_type ? spec.task_type : null;
  const charge = typeof spec?.charge === "number" && Number.isInteger(spec.charge) ? spec.charge : null;
  const multiplicity = typeof spec?.multiplicity === "number" && Number.isInteger(spec.multiplicity) && spec.multiplicity >= 1 ? spec.multiplicity : null;

  const preference = typeof args.provider_preference === "string" && args.provider_preference ? args.provider_preference : null;
  const computeText = preference ? COMPUTE_PREFERENCE[preference] ?? humanizeDetail(preference) : null;
  const isCalculation = approval.tool_name === "calculation.submit";
  const isStructureEdit = approval.tool_name === "structure.edit.propose";
  const diff = (args.diff as unknown as StructureEditDiffView) ?? null;
  const structureEditVersionId = typeof args.structure_version_id === "string" && args.structure_version_id ? args.structure_version_id : null;
  const missingStructureEditFields = isStructureEdit && (!diff || !structureEditVersionId);

  const periodic = record(spec?.periodic);
  const kMesh = Array.isArray(periodic?.k_mesh) ? (periodic.k_mesh as number[]).join(" × ") : null;
  const ecutwfc = periodic?.ecutwfc_ry ?? periodic?.energy_cutoff_ry;
  const ecutrho = periodic?.ecutrho_ry ?? periodic?.density_cutoff_ry;
  const pseudopotential = periodic?.pseudopotential_family ?? periodic?.pseudopotentials;
  const hubbardU = record(periodic?.hubbard_u);
  const spinPolarized = periodic?.spin_polarized ?? periodic?.spin_polarization;
  const magneticOrdering = typeof periodic?.magnetic_ordering === "string" ? periodic.magnetic_ordering : null;
  const sourceMatch = approval.scientific_summary?.match(/\(settings source:\s*([^)]+)\)/i);
  const periodicSettingsSource = sourceMatch ? sourceMatch[1] : (typeof args.settings_source === "string" ? args.settings_source : null);

  const provenance = approval.proposal_provenance ?? null;
  const repairs = provenance?.repair_attempts ?? 0;
  const requestMatch = approval.request_match ?? [];
  const differsFromRequest = requestMatch.some((item) => item.outcome === "MISMATCH");
  const checkSummary = requestCheckSummary(requestMatch);
  const missingRequiredFields = isCalculation && (!spec || !methodName || !basisName || !engineName || !structureVersionId || !taskType || charge == null || multiplicity == null);
  const geometryBlocked = isCalculation && geometryReady !== geometryKey;
  const approveBlockedReason = approval.status !== "PENDING" ? `This approval is ${humanizeDetail(approval.status)}.`
    : expired ? "This approval has expired. Ask the AI Scientist for a new proposal."
    : differsFromRequest ? "Approve is unavailable: this proposal differs from what your message asked for (see Request check). Ask for a new proposal."
    : (missingRequiredFields || missingStructureEditFields) ? "Approve is unavailable: the proposal is missing or has malformed bound arguments."
    : geometryBlocked ? "Approve is unavailable until the exact saved geometry is resolved."
    : null;
  const structureText = resolved?.structureName
    ? `${resolved.structureName}${resolved.revision != null ? ` V${resolved.revision}` : ""}` : null;
  const structureEditSummary = isStructureEdit && diff
    ? `Create new AI-proposed structure version (${diff.formula_after}, ${diff.atom_count_after} atoms) from parent version ${diff.parent_version_id}`
    : null;
  const summary = isCalculation && !missingRequiredFields
    ? `${engineLabel(engineName)} · ${methodLabel(methodName)} / ${basisLabel(basisName)} · ${taskLabel(taskType)} · charge ${charge} · multiplicity ${multiplicityLabel(multiplicity)}${structureText ? ` · ${structureText}` : ""}${preference ? ` · compute: ${preference === "AUTO" ? "automatic" : (COMPUTE_PREFERENCE[preference] ?? preference).toLowerCase()}` : ""}`
    : structureEditSummary;
  const estimate = approval.estimated_compute;
  const runtime = estimate && (estimate.runtime_low_seconds != null || estimate.runtime_high_seconds != null)
    ? `${estimate.runtime_low_seconds ?? "?"}–${estimate.runtime_high_seconds ?? "?"} s` : null;
  const missing = <span className="ai-proposal-missing">Missing — cannot approve</span>;
  const statusText = expired ? "Expired" : approval.status === "PENDING" ? "Waiting for your decision" : humanizeDetail(approval.status);
  const announce = expired ? "This approval has expired." : countdown.urgent ? "Less than five minutes remain to decide." : "";

  return (
    <section className={`ai-approval-screen is-${variant}`} data-testid="ai-approval-card" aria-labelledby={`ai-approval-title-${approval.id}`}>
      <header className="ai-approval-screen-header">
        {onBack ? (
          <button type="button" className="ai-approval-back" onClick={onBack} data-testid="ai-approval-back">
            <AppIcon icon="arrow-left" /> Conversation
          </button>
        ) : null}
        <div className="ai-approval-title-row">
          <h3 id={`ai-approval-title-${approval.id}`} ref={titleRef} tabIndex={-1} className="ai-approval-title">
            Approval Required — {isCalculation ? "Proposed calculation" : isStructureEdit ? "Proposed structure edit" : humanizeDetail(approval.tool_name)}
          </h3>
          <span className="ai-approval-badges">
            <span className={`ai-proposal-status-badge ${expired ? "is-rejected" : approval.status === "PENDING" ? "is-pending" : approval.status === "APPROVED" ? "is-approved" : "is-rejected"}`}>
              {statusText}
            </span>
            {approval.status === "PENDING" && !expired ? (
              <span className={countdown.urgent ? "ai-approval-countdown is-urgent" : "ai-approval-countdown"} data-testid="ai-approval-countdown">{countdown.label}</span>
            ) : null}
          </span>
        </div>
        {proposedUnder ? <p className="ai-approval-proposed-under" data-testid="ai-approval-proposed-under">Proposed under: {proposedUnder}</p> : null}
        {isCalculation || isStructureEdit ? (
          <dl className="ai-approval-context" data-testid="ai-approval-context">
            {request ? <div><dt>Your request</dt><dd title={request}>{request.length > 220 ? `${request.slice(0, 220)}…` : request}</dd></div> : null}
            <div><dt>Proposed by</dt><dd data-testid="ai-approval-model">
              {provenance ? <>
                <code className="ai-approval-id" title={`${providerLabel(provenance.provider)} · ${provenance.model}`}>{provenance.model}</code>
                <span className="ai-approval-model-provider"> {providerLabel(provenance.provider)}</span>
                {eligibilityLabel(provenance.eligibility) && provenance.eligibility === "DEVELOPMENT" ? <span className="ai-model-dev-tag" data-testid="ai-approval-eligibility">Development use only</span> : null}
              </> : "Not recorded for this proposal"}
            </dd></div>
            {isCalculation ? (
              <>
                <div><dt>Request check</dt><dd data-testid="ai-request-check-summary" className={checkSummary.tone === "danger" ? "ai-request-check-summary is-danger" : "ai-request-check-summary"}>{checkSummary.text}</dd></div>
                {repairs > 0 ? <div><dt>Corrections</dt><dd data-testid="ai-approval-repairs">{`Corrected ${repairs} time${repairs === 1 ? "" : "s"} after the server refused earlier proposals`}</dd></div> : null}
                <div><dt>Compute</dt><dd>{computeText ?? "Not recorded in the proposal"}</dd></div>
                <div><dt>Estimate</dt><dd>{runtime ? `${runtime} (recorded estimate)` : "Unavailable — none recorded"}</dd></div>
                {periodicSettingsSource ? (
                  <div>
                    <dt>Settings source</dt>
                    <dd>
                      <span className="ai-periodic-settings-source" data-testid="ai-periodic-settings-source">
                        {periodicSettingsSource}
                      </span>
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
        ) : null}
      </header>

      <div className="ai-approval-screen-body">
        {missingRequiredFields || missingStructureEditFields ? (
          <div className="ai-proposal-missing-alert" role="alert">
            <strong>Missing required proposal information:</strong> {missingRequiredFields ? "method, basis set, engine, structure version, calculation type, charge and multiplicity must all be bound." : "structure version ID and diff must be present."} Approval is blocked.
          </div>
        ) : null}

        {isStructureEdit ? (
          <section className="ai-approval-section" aria-labelledby={`ai-approval-structure-edit-${approval.id}`}>
            <h4 id={`ai-approval-structure-edit-${approval.id}`}>Proposed structure modification</h4>
            <p className="ai-structure-edit-immutability-notice" data-testid="ai-structure-edit-immutability-notice">
              Committed versions are immutable; approving creates a new AI-proposed version (unverified). Parent version is unchanged.
            </p>
            {diff ? (
              <>
                <dl className="ai-approval-dl">
                  <div><dt>Formula</dt><dd><span>{diff.formula_before || "—"}</span> → <strong>{diff.formula_after || "—"}</strong></dd></div>
                  <div><dt>Atom count</dt><dd><span>{diff.atom_count_before}</span> → <strong>{diff.atom_count_after}</strong></dd></div>
                  <div><dt>Parent version</dt><dd><code className="ai-approval-id">{diff.parent_version_id}</code></dd></div>
                  <div>
                    <dt>Interatomic distance</dt>
                    <dd>
                      {diff.distance_warnings && diff.distance_warnings.length > 0 ? (
                        <span className="ai-structure-edit-warning" data-testid="ai-structure-edit-distance-warning">
                          Warning: {diff.distance_warnings.join("; ")}
                        </span>
                      ) : (
                        <span className="ai-structure-edit-distance-ok" data-testid="ai-structure-edit-distance-ok">
                          Minimum distance: {diff.min_distance_after != null ? `${diff.min_distance_after.toFixed(3)} Å` : "N/A"} (≥ 0.8 Å check passed)
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="ai-structure-edit-diff" data-testid="ai-structure-edit-diff" style={{ marginTop: "12px" }}>
                  {diff.atoms_added && diff.atoms_added.length > 0 ? (
                    <div className="ai-structure-edit-op-group">
                      <h5 style={{ margin: "8px 0 4px", fontSize: "12px", color: "var(--cdf-ink)" }}>Added atoms ({diff.atoms_added.length})</h5>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px" }}>
                        {diff.atoms_added.map((atom, i) => (
                          <li key={i} data-testid="ai-structure-edit-added-atom">
                            Add <strong>{atom.element}</strong> at [{formatCoordinates(atom.coordinates)}]
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {diff.atoms_removed && diff.atoms_removed.length > 0 ? (
                    <div className="ai-structure-edit-op-group">
                      <h5 style={{ margin: "8px 0 4px", fontSize: "12px", color: "var(--cdf-ink)" }}>Removed atoms ({diff.atoms_removed.length})</h5>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px" }}>
                        {diff.atoms_removed.map((atom, i) => (
                          <li key={i} data-testid="ai-structure-edit-removed-atom">
                            Remove atom #{atom.index} ({atom.element})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {diff.atoms_moved && diff.atoms_moved.length > 0 ? (
                    <div className="ai-structure-edit-op-group">
                      <h5 style={{ margin: "8px 0 4px", fontSize: "12px", color: "var(--cdf-ink)" }}>Moved atoms ({diff.atoms_moved.length})</h5>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px" }}>
                        {diff.atoms_moved.map((atom, i) => (
                          <li key={i} data-testid="ai-structure-edit-moved-atom">
                            Move atom #{atom.index} ({atom.element}) to [{formatCoordinates(atom.new_coordinates)}]
                            {atom.old_coordinates ? ` from [${formatCoordinates(atom.old_coordinates)}]` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {diff.elements_replaced && diff.elements_replaced.length > 0 ? (
                    <div className="ai-structure-edit-op-group">
                      <h5 style={{ margin: "8px 0 4px", fontSize: "12px", color: "var(--cdf-ink)" }}>Replaced elements ({diff.elements_replaced.length})</h5>
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px" }}>
                        {diff.elements_replaced.map((atom, i) => (
                          <li key={i} data-testid="ai-structure-edit-replaced-element">
                            Replace atom #{atom.index}: {atom.old_element} → <strong>{atom.new_element}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="ai-approval-muted">Diff details unavailable.</p>
            )}
          </section>
        ) : null}

        {isCalculation ? (
          <section className="ai-approval-section" aria-labelledby={`ai-approval-params-${approval.id}`}>
            <h4 id={`ai-approval-params-${approval.id}`}>Scientific parameters</h4>
            <dl className="ai-approval-dl">
              <div><dt>Engine</dt><dd>{engineName ? engineLabel(engineName) : missing}</dd></div>
              <div><dt>Method</dt><dd>{methodName ? methodLabel(methodName) : missing}</dd></div>
              <div><dt>Basis / Pseudopotentials</dt><dd>{pseudopotential ? String(pseudopotential) : basisName ? basisLabel(basisName) : missing}</dd></div>
              <div><dt>Calculation type</dt><dd>{taskType ? taskLabel(taskType) : missing}</dd></div>
              {kMesh ? <div><dt>k-point mesh</dt><dd>{kMesh}</dd></div> : null}
              {ecutwfc ? <div><dt>Cutoffs</dt><dd>{`${ecutwfc} Ry (wfc)${ecutrho ? ` / ${ecutrho} Ry (rho)` : ""}`}</dd></div> : null}
              {magneticOrdering || spinPolarized != null ? (
                <div><dt>Spin & magnetism</dt><dd>{magneticOrdering ? `${magneticOrdering}${spinPolarized ? " (spin-polarized)" : ""}` : (spinPolarized ? "Spin-polarized" : "Non-spin-polarized")}</dd></div>
              ) : null}
              {hubbardU ? <div><dt>Hubbard +U</dt><dd>{Object.entries(hubbardU).map(([el, u]) => `${el}: ${u} eV`).join(", ")}</dd></div> : null}
              <div><dt>Charge</dt><dd>{charge ?? missing}</dd></div>
              <div><dt>Spin multiplicity</dt><dd>{multiplicity != null ? multiplicityLabel(multiplicity) : missing}</dd></div>
              <div><dt>Structure</dt><dd>
                {structureVersionId ? <>
                  {structureText ?? "Resolving saved structure…"}
                  <code className="ai-approval-id" title={structureVersionId}>{structureVersionId}</code>
                </> : missing}
              </dd></div>
            </dl>
            {periodicSettingsSource ? (
              <p className="ai-periodic-settings-source-note" style={{ marginTop: "8px", fontSize: "12px", color: "var(--cdf-ink-muted, #475569)" }}>
                <strong>
                  Settings source: {periodicSettingsSource}
                </strong>
              </p>
            ) : null}
          </section>
        ) : null}

        {isCalculation ? (
          <section className="ai-approval-section" aria-labelledby={`ai-approval-match-${approval.id}`}>
            <h4 id={`ai-approval-match-${approval.id}`}>Request check</h4>
            {requestMatch.length ? (
              <>
                <p className="ai-approval-muted">ChemDFT compared this proposal with the parameters your message names. Anything it does not name was chosen by the model.</p>
                <ul className="ai-request-check" aria-label="Request check" data-testid="ai-request-check">
                  {requestMatch.map((item) => (
                    <li key={item.parameter} className={`ai-request-check-row is-${item.outcome.toLowerCase().replaceAll("_", "-")}`} data-outcome={item.outcome} data-parameter={item.parameter}>
                      <span className="ai-request-check-name">{parameterLabel(item.parameter)}</span>
                      <span className="ai-request-check-values">
                        {item.outcome === "NOT_SPECIFIED" ? <>Not in your request · model chose <strong>{matchValueLabel(item.parameter, item.proposed)}</strong></>
                          : item.outcome === "AMBIGUOUS" ? <>Several named, not checked · proposed <strong>{matchValueLabel(item.parameter, item.proposed)}</strong></>
                          : <>You asked <strong>{item.excluded ? "something else" : matchValueLabel(item.parameter, item.requested)}</strong> · proposed <strong>{matchValueLabel(item.parameter, item.proposed)}</strong></>}
                      </span>
                      <span className={`ai-proposal-status-badge ${item.outcome === "MATCH" ? "is-approved" : item.outcome === "MISMATCH" ? "is-rejected" : "is-pending"}`}>{MATCH_OUTCOME[item.outcome] ?? item.outcome}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="ai-approval-muted" data-testid="ai-request-check-missing">No request check was recorded for this proposal. Compare it with your request yourself before approving.</p>}
          </section>
        ) : null}

        {isCalculation ? (
          <section className="ai-approval-section" aria-labelledby={`ai-approval-geometry-${approval.id}`}>
            <h4 id={`ai-approval-geometry-${approval.id}`}>Molecular geometry and provenance</h4>
            <CalculationProposal key={geometryKey} approval={approval} variant="geometry" onGeometryReady={onGeometryReady} onResolved={onResolved} />
          </section>
        ) : null}

        <section className="ai-approval-section" aria-labelledby={`ai-approval-resources-${approval.id}`}>
          <h4 id={`ai-approval-resources-${approval.id}`}>Estimated resources</h4>
          {estimate ? (
            <dl className="ai-approval-dl">
              <div><dt>Compute provider</dt><dd>{estimate.provider_summary || "Not recorded"}</dd></div>
              <div><dt>Runtime estimate</dt><dd>{runtime ?? "Not recorded"}</dd></div>
              <div><dt>Confidence</dt><dd>{humanizeDetail(estimate.confidence)}</dd></div>
            </dl>
          ) : <p className="ai-approval-muted">Estimate unavailable — no compute estimate was recorded with this proposal.</p>}
          {estimate ? <details className="ai-approval-raw"><summary>Recorded estimate and assumptions</summary><pre>{JSON.stringify(estimate, null, 2)}</pre></details> : null}
        </section>

        <section className="ai-approval-section" aria-labelledby={`ai-approval-rationale-${approval.id}`}>
          <h4 id={`ai-approval-rationale-${approval.id}`}>Rationale and effect</h4>
          {approval.reason && approval.reason !== approval.scientific_summary ? <p className="ai-approval-text">{approval.reason}</p> : null}
          <p className="ai-approval-recorded"><strong>Recorded summary:</strong> {approval.scientific_summary || "None recorded."}</p>
          {approval.creates_or_changes ? <p className="ai-approval-text"><strong>Records changed:</strong> {String(approval.creates_or_changes)}</p> : null}
        </section>

        <section className="ai-approval-section" aria-labelledby={`ai-approval-record-${approval.id}`}>
          <h4 id={`ai-approval-record-${approval.id}`}>Approval record</h4>
          <dl className="ai-approval-dl">
            <div><dt>Argument check</dt><dd data-testid="ai-proposal-argument-check">
              {missingRequiredFields
                ? <span className="ai-proposal-missing">Incomplete or malformed bound arguments</span>
                : isCalculation
                  ? <>The values above are exactly what will run · {geometryBlocked ? "Exact geometry not yet resolved — approval blocked" : "Exact saved geometry resolved for the bound structure version"}</>
                  : "The values above are exactly what will run"}
            </dd></div>
            <div><dt>Status</dt><dd>{statusText}</dd></div>
            <div><dt>Requested</dt><dd><ScientificTimestamp value={approval.created_at} /></dd></div>
            <div><dt>Expires</dt><dd>
              {expired ? "Expired" : <><span className="ai-approval-countdown-inline">{countdown.label}</span> · <ScientificTimestamp value={approval.expires_at} /></>}
            </dd></div>
            {provenance?.sampling ? <div><dt>Model settings</dt><dd data-testid="ai-approval-sampling">{samplingLabel(provenance.sampling)}</dd></div> : null}
          </dl>
          <details className="ai-approval-raw" data-testid="ai-approval-technical"><summary>Details</summary>
            <dl className="ai-approval-dl">
              <div><dt>Status code</dt><dd><code className="ai-approval-code">{approval.status}</code></dd></div>
              <div><dt>Tool</dt><dd>{approval.tool_name} {approval.tool_version}</dd></div>
              <div><dt>Action fingerprint</dt><dd><code className="ai-approval-id">{approval.action_fingerprint}</code></dd></div>
            </dl>
            <p className="ai-approval-raw-id">Project <code className="ai-approval-id">{approval.project_id ?? "Not recorded"}</code></p>
            <pre>{JSON.stringify(approval.normalized_arguments ?? {}, null, 2)}</pre>
          </details>
        </section>
      </div>

      <footer className="ai-approval-screen-footer">
        <p className="ai-visually-hidden" role="status" aria-live="polite">{announce}</p>
        {summary ? <p className="ai-proposal-decision-summary" data-testid="ai-proposal-decision-summary">Approving submits: {summary}</p> : null}
        {approveBlockedReason ? <p className="ai-proposal-blocked-reason" role="status" data-testid="ai-approve-blocked-reason">{approveBlockedReason}</p> : null}
        <details className="ai-approval-reject-note">
          <summary>Add a reason for rejecting (optional)</summary>
          <label className="ai-approval-note-label">
            Reason
            <textarea value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} rows={2} maxLength={500} data-testid="ai-reject-note" />
          </label>
        </details>
        <div className="ai-proposal-exec-btns">
          <ActionButton intent="none" icon="cross" text="Reject" onClick={() => onReject(rejectNote.trim() || undefined)}
            disabled={submitting || approval.status !== "PENDING" || expired} data-testid="ai-reject-button" />
          <ActionButton intent="primary" icon="tick" text={isCalculation ? "Approve and submit calculation" : isStructureEdit ? "Approve and create new structure version" : "Approve"} onClick={onApprove}
            disabled={submitting || Boolean(approveBlockedReason)} data-testid="ai-approve-button" />
        </div>
        <p className="ai-approval-firewall-note">
          <AppIcon icon="shield" /> Nothing runs until you approve; results appear only after ChemDFT checks them.
        </p>
      </footer>
    </section>
  );
}
