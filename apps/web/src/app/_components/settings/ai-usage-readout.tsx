import type { AIUsageSummary } from "@chemdft/schemas";

/** Token and charge observations from a billing snapshot. Not shown during the beta (Billing makes no request); kept, with its tests, for when usage returns. */
export function AIUsageReadout({ usage }: { usage: AIUsageSummary }) {
  const total = usage.input_tokens === null || usage.output_tokens === null
    ? null : usage.input_tokens + usage.output_tokens;
  const subtotal = usage.reported_input_tokens === undefined || usage.reported_output_tokens === undefined
    ? "unavailable" : `${usage.reported_input_tokens + usage.reported_output_tokens} tokens`;
  return <>
    <p>{total === null ? "Token total unavailable" : `${total} reported tokens`}</p>
    {!usage.usage_complete && <p>Usage is incomplete. Reported subtotal: {subtotal}.
      {" "}{usage.unknown_entries ?? "Unavailable"} unknown, {usage.legacy_entries ?? "unavailable"} historical, {usage.pending_entries ?? "unavailable"} pending entries.</p>}
    {total !== null && usage.cached_tokens === null && <p>Cache usage was not reported.</p>}
    <p>Platform charges: {usage.billable.currency} {usage.billable.minor_units} minor units</p>
    <p>{!usage.provider_cost ? "Provider cost unavailable" : `Provider cost: ${usage.provider_cost.currency} ${usage.provider_cost.minor_units} minor units`}</p>
    <p>Managed entries: {usage.managed_entries}; BYOK entries: {usage.byok_entries}</p>
  </>;
}
