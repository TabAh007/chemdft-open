import type { JobLogOutput } from "@chemdft/schemas";
import { scientificLog } from "@/lib/scientific-log";

export function ScientificLogView({ log, onDownload }: { log: JobLogOutput; onDownload: () => void }) {
  const evidence = scientificLog(log.text);
  return <section aria-label="Scientific log excerpt" data-testid="scientific-log-excerpt">
    <h4>Scientific output</h4>
    <p>Display-only excerpt from the original native log, with SCF output first. Python source and machine details are omitted; the evidence artifact is unchanged.</p>
    {log.truncated ? <p role="note">The server returned a log tail. Earlier scientific output may be unavailable here; download the original for complete evidence.</p> : null}
    <pre className="scientific-log-output" tabIndex={0}>{evidence.excerpt || "No supported scientific output is available in this excerpt."}</pre>
    <button type="button" className="bp6-button bp6-minimal" onClick={onDownload}>Download original native log</button>
    <p className="scientific-evidence-hash">Original artifact SHA-256: <code>{log.sha256}</code></p>
    <p>The original may include Python source, local paths and machine identifiers. Download requires authorized project access.</p>
  </section>;
}
