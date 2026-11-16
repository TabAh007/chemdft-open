import { RELEASES, type ReleaseEntry } from "../../../content/releases";
import { OpenOnHash } from "./open-on-hash";
import styles from "./public-doc.module.css";

function Group({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.group} aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function Verified({ release }: { release: ReleaseEntry }) {
  const { verified, notYetVerified, knownLimits } = release.scientificStatus;
  return (
    <section className={styles.status} aria-labelledby={`verified-${release.version}`}>
      <h3 id={`verified-${release.version}`}>What is verified</h3>
      <div>
        <h4>Verified</h4>
        {verified.length === 0 ? (
          <p className={styles.plain} data-testid="nothing-verified">Nothing in this release was verified yet.</p>
        ) : (
          <ul className={styles.claim}>
            {verified.map((claim) => (
              <li key={claim.statement}>
                {claim.statement}
                <span className={styles.claimMeta}>
                  {claim.platform} · {claim.engine}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4>Not yet verified</h4>
        <ul className={styles.plain}>
          {notYetVerified.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Known limits</h4>
        <ul className={styles.plain}>
          {knownLimits.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Every release, newest first: the latest is expanded, older ones are collapsed `<details>` (native, keyboard-operable, no JavaScript needed). */
export function ReleasesView({ locale }: { locale: string }) {
  return (
    <>
      <header className={styles.head}>
        <h1>Releases</h1>
        <p className={styles.lead}>What changed in each ChemDFT release, and what is and is not scientifically verified.</p>
        <ul className={styles.meta}>
          <li>
            <a href={`/${locale}/releases/feed.xml`} type="application/atom+xml">
              Atom feed
            </a>
          </li>
          <li>
            <a href={`/${locale}/learn/cite`}>How to cite</a>
          </li>
          <li>
            <a href={`/${locale}/license`}>License</a>
          </li>
        </ul>
        <p className={styles.notice}>Release notes are in English only for now. Verified means executed and checked on the named platform with the named engine; a result from one platform is not evidence for another.</p>
      </header>
      <div className={styles.releases}>
        {RELEASES.map((release, index) => (
          <details key={release.version} id={release.version} className={styles.release} open={index === 0}>
            <summary className={styles.summary}>
              <span className={styles.version}>{release.version}</span>
              <span className={styles.relTitle}>{release.title}</span>
              <time className={styles.date} dateTime={release.date}>
                {release.date}
              </time>
            </summary>
            <div className={styles.body}>
              <p>{release.summary}</p>
              <Group title="Added" items={release.added} />
              <Group title="Changed" items={release.changed} />
              <Group title="Fixed" items={release.fixed} />
              <Verified release={release} />
              <a className={styles.permalink} href={`#${release.version}`}>
                Link to version {release.version}
              </a>
            </div>
          </details>
        ))}
      </div>
      <OpenOnHash />
    </>
  );
}
