"use client";

import { usePathname } from "next/navigation";
import { AppIcon } from "@chemdft/ui";
import { usePublishedAiContext } from "@/lib/ai-context";
import { activeProjectSection } from "@/lib/project-sections";
import styles from "./compare.module.css";

/**
 * A short, honest note above the AI Scientist while the Compare page is open. The Compare page publishes what is being
 * compared through the shared AI context; the server reads their saved values (0.0.18), and answers given under another context stay in their own conversation. It never asks the assistant
 * anything and sends nothing.
 */
export function CompareDockNotice({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const onCompare = activeProjectSection(pathname, projectId) === "compare";
  const published = usePublishedAiContext(projectId);
  if (!onCompare) return null;
  const context = published?.page === "compare" ? published : null;
  const count = context?.resultIds.length ?? 0;
  return (
    <aside className={styles.dockNotice} aria-label="Context of the Compare page" data-testid="compare-dock-notice">
      <strong><AppIcon icon="comparison" /> On the Compare page</strong>
      <p data-testid="compare-dock-context">
        {context && count > 0
          ? <>Comparing {count} result{count === 1 ? "" : "s"} ({context.letters.join(", ")}); reference: {context.referenceLabel ?? "unknown"}.</>
          : "No results are selected for comparison."}
      </p>
      {/* The Read-only / grounding chips live once, in the panel status bar (AiContextTags); no second copy here (0.0.20). */}
      <details className={styles.dockNoticeMore}>
        <summary>What the assistant knows</summary>
        <p className={styles.muted}>
          The AI Scientist reads the saved values of the compared results; it does not compute anything.
          Answers given under another context stay in that context&apos;s history. Nothing is sent unless you ask.
        </p>
      </details>
    </aside>
  );
}
