"use client";

import { useEffect, useState } from "react";

import { listDocuments } from "@/lib/phase7-api";

export function ExplorerDocumentCount({ projectId }: { projectId: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listDocuments(projectId)
        .then((result) => {
          if (active) setCount(result.documents.length);
        })
        .catch(() => {
          if (active) setCount(0);
        });
    };
    refresh();
    window.addEventListener("chemdft:documents-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("chemdft:documents-changed", refresh);
    };
  }, [projectId]);

  return <span data-testid="explorer-document-count">{count}</span>;
}
