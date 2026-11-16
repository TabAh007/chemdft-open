"use client";

/**
 * Shown where a page waits for the project's saved-items inventory, once that request has failed: a plain sentence, a way to try
 * again, and the stored error text one click away. Retrying reuses the event the project explorer already listens to.
 */
export function CatalogUnavailable({ error, heading }: { error: string; heading: string }) {
  return (
    <div className="catalog-unavailable" role="alert" data-testid="catalog-unavailable">
      <strong>{heading}</strong>
      <p>The saved items of this project could not be read from the server. Nothing was changed. Check your connection, then try again.</p>
      <button type="button" className="catalog-unavailable-retry" onClick={() => window.dispatchEvent(new Event("chemdft:workspace-items-changed"))}>Try again</button>
      <details>
        <summary>Details</summary>
        <code>{error}</code>
      </details>
    </div>
  );
}
