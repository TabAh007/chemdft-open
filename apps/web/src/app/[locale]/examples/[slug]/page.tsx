import Link from "next/link";
import type { Metadata } from "next";
import { isLocale } from "@chemdft/i18n";
import { notFound } from "next/navigation";
import type { ExampleDetail } from "@chemdft/schemas";
import { publicExamples } from "@/lib/examples-api";
import { exampleMessage } from "@/lib/example-messages";
import { createPublicMetadata } from "@/lib/seo";
import { getPublicExample } from "@/content/example-catalog";
import { ExampleCopyAction } from "../../../_components/examples/copy-action";
import { ExampleViewer } from "../../../_components/examples/viewer";
import { ProjectNavigator } from "../../../_components/project-navigator";
import { Formula } from "../../../_components/home/formula";
import styles from "../../../_components/examples/examples.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const example = getPublicExample(slug);
  if (!example) return {};
  return createPublicMetadata({
    title: example.pageTitle,
    description: example.description,
    path: `/en/examples/${slug}`,
  });
}

export default async function ExamplePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound();
  const detail = await publicExamples<ExampleDetail>(slug);
  if (!detail) notFound();
  const t = (key: string) => exampleMessage(locale, key);
  const example = detail.example;
  const cell = detail.structure.version.periodic_cell;
  return (
    <main id="main-content" className={styles.detail}>
      <nav aria-label="Breadcrumb">
        <Link href={`/${locale}/examples`}>{t("catalogue")}</Link>
      </nav>
      <header className={styles.detailHeading}>
        <div>
          <h1>{example.title}</h1>
          <p className={styles.formula}>
            <Formula formula={example.formula} />
          </p>
          <p className={styles.sealed}>{t("sealed")}</p>
        </div>
        <ExampleCopyAction slug={slug} locale={locale} />
      </header>
      <div className={styles.specimen}>
        <ExampleViewer detail={detail} locale={locale} />
        <section id="provenance" className={styles.provenance}>
          <h2>{t("provenance")}</h2>
          <p>{example.description}</p>
          <dl>
            <dt>{t("origin")}</dt>
            <dd>{t("imported")}</dd>
            <dt>{t("source")}</dt>
            <dd>
              <a href={example.source_url}>{example.source_identifier}</a>
            </dd>
            <dt>{t("citation")}</dt>
            <dd>
              <a href={example.citation_url}>{example.citation}</a>
            </dd>
            <dt>{t("atoms")}</dt>
            <dd>{example.atom_count}</dd>
            {cell && (
              <>
                <dt>{t("group")}</dt>
                <dd>{example.space_group}</dd>
                <dt>Cell / Å</dt>
                <dd>
                  a = {cell.a.toFixed(4)}
                  <br />b = {cell.b.toFixed(4)}
                  <br />c = {cell.c.toFixed(4)}
                </dd>
                <dt>Cell angles / °</dt>
                <dd>
                  α = {cell.alpha.toFixed(2)} · β = {cell.beta.toFixed(2)} · γ = {cell.gamma.toFixed(2)}
                </dd>
              </>
            )}
            <dt>{t("parser")}</dt>
            <dd>
              {detail.structure.provenance?.parser}{" "}
              {detail.structure.provenance?.parser_version}
              <br />
              {detail.structure.provenance?.adapter}{" "}
              {detail.structure.provenance?.adapter_version}
            </dd>
            <dt>{t("author")}</dt>
            <dd>
              <code>{detail.structure.version.created_by}</code>
            </dd>
            <dt>{t("version")}</dt>
            <dd>{example.template_version}</dd>
            <dt>{t("sourceHash")}</dt>
            <dd>
              <code>{example.source_sha256}</code>
            </dd>
            <dt>{t("licence")}</dt>
            <dd>
              {example.reuse_basis}{" "}
              <a href={example.licence_url}>Source policy</a>
            </dd>
            <dt>{t("review")}</dt>
            <dd>{example.review_date}</dd>
          </dl>
          <a
            href={`/api/chemdft/v1/examples/${encodeURIComponent(slug)}/source`}
          >
            {t("sourceFile")}
          </a>
          <p className={styles.caption}>{t("coordinateNote")}</p>
        </section>
      </div>
      {example.related_context && (
        <section className={styles.context}>
          <h2>{t("context")}</h2>
          <p>{example.related_context}</p>
        </section>
      )}
      <div className={styles.navigator}>
        <ProjectNavigator
          projectId={example.template_project_id}
          publicExampleSlug={slug}
        />
      </div>
    </main>
  );
}
