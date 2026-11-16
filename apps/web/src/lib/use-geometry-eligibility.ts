"use client";

import { useEffect, useState } from "react";
import type { GeometryEligibility } from "@chemdft/schemas";
import { getCalculationEligibility } from "./structure-workspace-api";

type CheckedEligibility = {
  key: string;
  attempt: number;
  value: GeometryEligibility | null;
  error: string | null;
};

/** One request per selection; failures stay closed until an explicit retry. */
export function useGeometryEligibility(
  projectId: string,
  structureId: string,
  versionId: string,
  initial?: GeometryEligibility | null,
) {
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState<CheckedEligibility | null>(null);
  const key = JSON.stringify([projectId, structureId, versionId]);
  const provided = attempt === 0 && initial?.structure_version_id === versionId ? initial : null;
  const current = checked?.key === key && checked.attempt === attempt ? checked : null;
  const eligibility = current ? current.value : provided;
  const error = current?.error ?? null;

  useEffect(() => {
    if (provided) return;
    let active = true;
    void getCalculationEligibility({ projectId, structureId, versionId })
      .then((value) => {
        if (value.structure_version_id !== versionId) {
          throw new Error("Eligibility response does not match the selected StructureVersion.");
        }
        if (active) setChecked({ key, attempt, value, error: null });
      })
      .catch((cause: unknown) => {
        if (active) setChecked({
          key, attempt, value: null,
          error: cause instanceof Error ? cause.message : "Could not verify calculation eligibility.",
        });
      });
    return () => { active = false; };
  }, [projectId, structureId, versionId, key, attempt, provided]);

  return {
    eligibility,
    eligible: eligibility?.eligible === true,
    loading: !eligibility && !error,
    error,
    retry: () => setAttempt((previous) => previous + 1),
  };
}
