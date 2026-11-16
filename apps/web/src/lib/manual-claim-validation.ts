/**
 * Client-side validation for manual paper claim entry (finding F-024).
 * Matches the backend schema contract (POST /v1/projects/{id}/scientific-claims/manual).
 * Stored as USER_ENTERED literature evidence, never as a CALCULATED result.
 */

export interface ManualClaimFormData {
  documentId: string;
  system: string;
  quantity: string;
  value: string;
  unit: string;
  page: string;
  quote: string;
  quantityKey?: string;
}

export interface ManualClaimFormErrors {
  documentId?: string;
  system?: string;
  quantity?: string;
  value?: string;
  unit?: string;
  page?: string;
  quote?: string;
  quantityKey?: string;
}

export interface ValidatedManualClaimPayload {
  document_id: string;
  system: string;
  quantity: string;
  value: number;
  unit: string;
  page: number;
  quote: string;
  quantity_key?: string | null;
}

export function validateManualClaimInput(data: ManualClaimFormData): {
  valid: boolean;
  errors: ManualClaimFormErrors;
  parsed?: ValidatedManualClaimPayload;
} {
  const errors: ManualClaimFormErrors = {};

  if (!data.documentId || data.documentId.trim() === "") {
    errors.documentId = "Select a source document.";
  }

  const system = data.system.trim();
  if (!system) {
    errors.system = "System or structure description is required.";
  } else if (system.length > 200) {
    errors.system = "System description must be 200 characters or fewer.";
  }

  const quantity = data.quantity.trim();
  if (!quantity) {
    errors.quantity = "Quantity label is required.";
  } else if (quantity.length > 120) {
    errors.quantity = "Quantity label must be 120 characters or fewer.";
  }

  const valTrimmed = data.value.trim();
  const parsedValue = Number(valTrimmed);
  if (!valTrimmed || isNaN(parsedValue) || !Number.isFinite(parsedValue)) {
    errors.value = "Enter a valid numeric value.";
  }

  const unit = data.unit.trim();
  if (!unit) {
    errors.unit = "Unit is required.";
  } else if (unit.length > 40) {
    errors.unit = "Unit must be 40 characters or fewer.";
  }

  const pageTrimmed = data.page.trim();
  const pageNum = Number(pageTrimmed);
  if (!pageTrimmed || isNaN(pageNum) || !Number.isInteger(pageNum) || pageNum < 1 || pageNum > 10000) {
    errors.page = "Enter a valid page number (1 to 10,000).";
  }

  const quote = data.quote.trim();
  if (!quote) {
    errors.quote = "Verbatim quote is required.";
  } else if (quote.length < 3) {
    errors.quote = "Verbatim quote must be at least 3 characters.";
  } else if (quote.length > 500) {
    errors.quote = "Verbatim quote must be 500 characters or fewer.";
  }

  const quantityKey = data.quantityKey?.trim() || null;
  if (quantityKey && quantityKey.length > 120) {
    errors.quantityKey = "Quantity key must be 120 characters or fewer.";
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    ...(valid
      ? {
          parsed: {
            document_id: data.documentId.trim(),
            system,
            quantity,
            value: parsedValue,
            unit,
            page: pageNum,
            quote,
            quantity_key: quantityKey,
          },
        }
      : {}),
  };
}
