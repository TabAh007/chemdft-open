"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ScientificDocumentListOutput } from "@chemdft/schemas";
import { AppIcon } from "@chemdft/ui";

import { addManualScientificClaim, listDocuments } from "@/lib/phase7-api";
import {
  validateManualClaimInput,
  type ManualClaimFormData,
  type ManualClaimFormErrors,
} from "@/lib/manual-claim-validation";
import styles from "./manual-claim-dialog.module.css";

export function ManualClaimDialog({
  projectId,
  onClose,
  onSuccess,
}: {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [documents, setDocuments] = useState<ScientificDocumentListOutput["documents"] | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [form, setForm] = useState<ManualClaimFormData>({
    documentId: "",
    system: "",
    quantity: "",
    value: "",
    unit: "",
    page: "1",
    quote: "",
    quantityKey: "",
  });

  const [errors, setErrors] = useState<ManualClaimFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) {
      el.showModal();
    }

    let active = true;
    listDocuments(projectId)
      .then((res) => {
        if (!active) return;
        const docs = res.documents ?? [];
        setDocuments(docs);
        if (docs.length > 0 && docs[0]) {
          setForm((f) => ({ ...f, documentId: docs[0]?.id ?? "" }));
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setDocsError(cause instanceof Error ? cause.message : "Failed to load project documents.");
      })
      .finally(() => {
        if (active) setDocsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  const handleChange = (
    field: keyof ManualClaimFormData,
    value: string,
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setServerError(null);

    const validation = validateManualClaimInput(form);
    if (!validation.valid || !validation.parsed) {
      setErrors(validation.errors);
      return;
    }

    setSubmitting(true);
    try {
      await addManualScientificClaim(projectId, validation.parsed);
      onSuccess();
      onClose();
    } catch (cause: unknown) {
      setServerError(
        cause instanceof Error
          ? cause.message
          : "Failed to store manual paper claim on server.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hasNoDocs = documents !== null && documents.length === 0;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      data-testid="manual-claim-dialog"
    >
      <header className={styles.header}>
        <span className={styles.eyebrow}>Literature Evidence · User-Entered</span>
        <h2 id={titleId} className={styles.title}>
          Add paper claim
        </h2>
        <p className={styles.description}>
          Record a scientific value reported in the literature. It is stored as researcher-entered
          literature evidence (`USER_ENTERED`) anchored to the source paper, kept strictly separate from
          ChemDFT calculated results.
        </p>
      </header>

      {serverError ? (
        <div role="alert" className={styles.errorBanner} data-testid="manual-claim-server-error">
          <AppIcon icon="warning-sign" /> {serverError}
        </div>
      ) : null}

      {hasNoDocs ? (
        <div role="note" className={styles.warningBanner}>
          <AppIcon icon="info-sign" /> This project has no imported documents yet. Import a PDF in Workspace
          → Import document first so this literature claim can be anchored to its source.
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {/* Source Document */}
        <div className={styles.fieldGroup}>
          <label htmlFor="manual-claim-document">Source document</label>
          <select
            id="manual-claim-document"
            data-testid="manual-claim-document-select"
            value={form.documentId}
            onChange={(e) => handleChange("documentId", e.target.value)}
            disabled={docsLoading || hasNoDocs || submitting}
            className={errors.documentId ? styles.hasError : undefined}
          >
            {docsLoading ? (
              <option value="">Loading documents…</option>
            ) : hasNoDocs ? (
              <option value="">No documents available</option>
            ) : (
              (documents ?? []).map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title || doc.doi || doc.id.slice(0, 8)}
                </option>
              ))
            )}
          </select>
          {errors.documentId ? (
            <p className={styles.fieldError} role="alert">
              {errors.documentId}
            </p>
          ) : null}
          {docsError ? (
            <p className={styles.fieldError} role="alert">
              {docsError}
            </p>
          ) : null}
        </div>

        {/* System / Structure */}
        <div className={styles.fieldGroup}>
          <label htmlFor="manual-claim-system">System or structure description</label>
          <input
            id="manual-claim-system"
            data-testid="manual-claim-system-input"
            type="text"
            placeholder="e.g. Complex 3b, Lophine A1, or reaction mixture"
            value={form.system}
            onChange={(e) => handleChange("system", e.target.value)}
            disabled={submitting}
            maxLength={200}
            className={errors.system ? styles.hasError : undefined}
          />
          {errors.system ? (
            <p className={styles.fieldError} role="alert">
              {errors.system}
            </p>
          ) : null}
        </div>

        {/* Quantity Label */}
        <div className={styles.fieldGroup}>
          <label htmlFor="manual-claim-quantity">Quantity label</label>
          <input
            id="manual-claim-quantity"
            data-testid="manual-claim-quantity-input"
            type="text"
            placeholder="e.g. relative energy, reaction temperature, yield"
            value={form.quantity}
            onChange={(e) => handleChange("quantity", e.target.value)}
            disabled={submitting}
            maxLength={120}
            className={errors.quantity ? styles.hasError : undefined}
          />
          {errors.quantity ? (
            <p className={styles.fieldError} role="alert">
              {errors.quantity}
            </p>
          ) : null}
        </div>

        {/* Value and Unit */}
        <div className={styles.gridTwo}>
          <div className={styles.fieldGroup}>
            <label htmlFor="manual-claim-value">Numeric value</label>
            <input
              id="manual-claim-value"
              data-testid="manual-claim-value-input"
              type="number"
              step="any"
              placeholder="e.g. 10.2"
              value={form.value}
              onChange={(e) => handleChange("value", e.target.value)}
              disabled={submitting}
              className={errors.value ? styles.hasError : undefined}
            />
            {errors.value ? (
              <p className={styles.fieldError} role="alert">
                {errors.value}
              </p>
            ) : null}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="manual-claim-unit">Unit</label>
            <input
              id="manual-claim-unit"
              data-testid="manual-claim-unit-input"
              type="text"
              placeholder="e.g. kcal/mol, °C, kJ/mol, Å"
              value={form.unit}
              onChange={(e) => handleChange("unit", e.target.value)}
              disabled={submitting}
              maxLength={40}
              className={errors.unit ? styles.hasError : undefined}
            />
            {errors.unit ? (
              <p className={styles.fieldError} role="alert">
                {errors.unit}
              </p>
            ) : null}
          </div>
        </div>

        {/* Page Number */}
        <div className={styles.fieldGroup}>
          <label htmlFor="manual-claim-page">Page number in source paper</label>
          <input
            id="manual-claim-page"
            data-testid="manual-claim-page-input"
            type="number"
            min={1}
            max={10000}
            placeholder="e.g. 8"
            value={form.page}
            onChange={(e) => handleChange("page", e.target.value)}
            disabled={submitting}
            className={errors.page ? styles.hasError : undefined}
          />
          {errors.page ? (
            <p className={styles.fieldError} role="alert">
              {errors.page}
            </p>
          ) : null}
        </div>

        {/* Verbatim Quote */}
        <div className={styles.fieldGroup}>
          <label htmlFor="manual-claim-quote">Verbatim quote from paper</label>
          <textarea
            id="manual-claim-quote"
            data-testid="manual-claim-quote-input"
            rows={3}
            placeholder="Exact sentence from the literature containing this value (required, min 3 characters)…"
            value={form.quote}
            onChange={(e) => handleChange("quote", e.target.value)}
            disabled={submitting}
            maxLength={500}
            className={errors.quote ? styles.hasError : undefined}
          />
          <span className={styles.hint}>
            Provide the direct quotation so other researchers can verify the claim against the paper text.
          </span>
          {errors.quote ? (
            <p className={styles.fieldError} role="alert">
              {errors.quote}
            </p>
          ) : null}
        </div>

        {/* Quantity Key (Optional) */}
        <div className={styles.fieldGroup}>
          <label htmlFor="manual-claim-quantity-key">
            Quantity key <span className={styles.hint}>(optional)</span>
          </label>
          <input
            id="manual-claim-quantity-key"
            data-testid="manual-claim-key-input"
            type="text"
            placeholder="e.g. literature.energy (default: literature.user_entered)"
            value={form.quantityKey}
            onChange={(e) => handleChange("quantityKey", e.target.value)}
            disabled={submitting}
            maxLength={120}
            className={errors.quantityKey ? styles.hasError : undefined}
          />
          {errors.quantityKey ? (
            <p className={styles.fieldError} role="alert">
              {errors.quantityKey}
            </p>
          ) : null}
        </div>

        {/* Modal Actions */}
        <div className={styles.actions}>
          <button
            type="button"
            className="bp6-button"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bp6-button bp6-intent-primary"
            data-testid="manual-claim-submit-btn"
            disabled={submitting || hasNoDocs}
          >
            {submitting ? "Saving…" : "Save paper claim"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
