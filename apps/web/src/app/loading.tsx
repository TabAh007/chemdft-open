export default function Loading() {
  return (
    <main id="main-content" className="state-page" aria-busy="true">
      <div className="state-code" aria-hidden="true">···</div>
      <div className="state-copy">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line" />
        <div className="skeleton-line skeleton-short" />
        <p className="screen-reader-only">Loading ChemDFT</p>
      </div>
    </main>
  );
}
