"use client";

import type { ProposalBlocker } from "@chemdft/schemas";
import { fieldLabel, matchValueLabel } from "@/lib/scientific-labels";

const PARAMETER_OF_FIELD: Record<string, string> = {
  "specification.task_type": "task",
  "specification.engine_preference.engine": "engine",
  "specification.method.identifier": "method",
  "specification.basis.identifier": "basis",
  "specification.charge": "charge",
  "specification.multiplicity": "multiplicity",
};

/** The server's summary is addressed to the model; the researcher is told in their own terms. */
const HEADLINE: Record<string, string> = { REQUEST_MISMATCH: "The proposals did not match what you asked for." };

/**
 * Why no valid proposal reached approval: the server's last refusal, in the researcher's words.
 * Nothing is shown that the model typed; allowed values come from the server's own tables. An
 * issue that compares the request with the proposal is shown as that comparison; the server's own
 * sentence (written for the model) appears only for issues that carry no request to compare.
 */
export function ProposalBlockerNotice({
  blocker, onRetry, retryDisabled,
}: {
  blocker: ProposalBlocker;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  return (
    <section className="ai-blocker" role="alert" aria-labelledby="ai-blocker-title" data-testid="ai-proposal-blocker">
      <h4 id="ai-blocker-title" className="ai-blocker-title">
        No valid proposal after {blocker.attempts} attempt{blocker.attempts === 1 ? "" : "s"}
      </h4>
      <p className="ai-blocker-summary">{HEADLINE[blocker.code] ?? blocker.summary}</p>
      {(blocker.issues ?? []).length ? (
        <ul className="ai-blocker-issues" aria-label="What blocked the proposal">
          {(blocker.issues ?? []).map((issue, index) => {
            const parameter = issue.field ? PARAMETER_OF_FIELD[issue.field] : undefined;
            const allowed = issue.allowed ?? [];
            const comparison = issue.requested != null;
            const unavailable = comparison && allowed.length > 0 && !allowed.some((value) => value === issue.requested);
            return (
              <li key={`${issue.field ?? "proposal"}-${index}`} className="ai-blocker-issue" data-testid="ai-blocker-issue">
                <strong>{fieldLabel(issue.field)}</strong>
                {comparison ? (unavailable ? <span>Not available here.</span> : null) : <span>{issue.message}</span>}
                {issue.requested != null || issue.proposed != null ? (
                  <span className="ai-blocker-values">
                    {issue.requested != null ? <>You asked <b>{parameter ? matchValueLabel(parameter, issue.requested) : String(issue.requested)}</b></> : null}
                    {issue.requested != null && issue.proposed != null ? " · " : null}
                    {issue.proposed != null ? <>proposed <b>{parameter ? matchValueLabel(parameter, issue.proposed) : String(issue.proposed)}</b></> : null}
                  </span>
                ) : null}
                {issue.allowed?.length ? (
                  <span className="ai-blocker-values">Available here: {issue.allowed.map((value) => (parameter ? matchValueLabel(parameter, value) : value)).join(", ")}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="ai-blocker-note">
        Nothing was submitted or computed, and your request was not changed. Change the request, choose another model, or retry.
      </p>
      <button type="button" className="ai-blocker-retry" onClick={onRetry} disabled={retryDisabled} data-testid="ai-blocker-retry">Retry question</button>
    </section>
  );
}
