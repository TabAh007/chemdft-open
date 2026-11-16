import Link from "next/link";
import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import type { ExampleSummary } from "@chemdft/schemas";
import { publicExamples } from "@/lib/examples-api";
import { exampleMessage } from "@/lib/example-messages";
import { createPublicMetadata } from "@/lib/seo";
import { HOME_STRUCTURES } from "../../_components/home/structures";
import { StructureStatic } from "../../_components/home/structure-static";
import { Formula } from "../../_components/home/formula";
import styles from "../../_components/examples/examples.module.css";

export async function generateMetadata(): Promise<Metadata> {
  return createPublicMetadata({
    title: "Scientific examples & reference structures | ChemDFT",
    description:
      "Browse reference structures and worked examples in ChemDFT, including α-Cr₂O₃ (COD 9014036), benzene (PubChem CID 241), and caffeine (PubChem CID 2519).",
    path: "/en/examples",
  });
}
export default async function ExamplesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = (key: string) => exampleMessage(locale, key);
  let examples: ExampleSummary[] | null;
  try {
    examples = await publicExamples<ExampleSummary[]>();
  } catch {
    examples = null;
  }
  return (
    <main id="main-content" className={styles.catalogue}>
      <header className={styles.heading}>
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
      </header>
      {examples === null ? (
        <p role="status">{t("unavailable")}</p>
      ) : examples.length === 0 ? (
        <p role="status" className={styles.empty}>{t("empty")}</p>
      ) : (
        <ul className={styles.specimens}>
          {examples.map((example) => {
            const entry = HOME_STRUCTURES.find(
              (item) =>
                item.id ===
                (example.slug === "cr2o3-eskolaite"
                  ? "cr2o3"
                  : example.slug === "benzene"
                    ? "c6h6"
                    : "c8h10n4o2"),
            );
            return (
              <li key={example.slug}>
                <div className={styles.thumbnail}>
                  {entry && (
                    <StructureStatic
                      entry={{ ...entry, supercell: [1, 1, 1] }}
                      id={`example-${example.slug}`}
                    />
                  )}
                </div>
                <div>
                  <h2>
                    <Link href={`/${locale}/examples/${example.slug}`}>
                      {example.title}
                    </Link>
                  </h2>
                  <p className={styles.formula}>
                    <Formula formula={example.formula} />{" "}
                    <span className={styles.kind}>
                      {example.type === "crystal" ? "Crystal" : "Molecule"}
                    </span>
                  </p>
                  <p>{example.description}</p>
                  <p className={styles.source}>
                    <a href={example.source_url}>{example.source_identifier}</a>
                  </p>
                  <p className={styles.classification}>
                    {t("reference")} · {t("noResults")}
                  </p>
                </div>
                <Link
                  className="bp6-button"
                  href={`/${locale}/examples/${example.slug}`}
                >
                  {t("open")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
