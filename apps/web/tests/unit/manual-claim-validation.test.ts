import { describe, expect, it } from "vitest";
import {
  validateManualClaimInput,
  type ManualClaimFormData,
} from "../../src/lib/manual-claim-validation";

describe("manual-claim-validation", () => {
  const validForm: ManualClaimFormData = {
    documentId: "doc-123",
    system: "Complex 3b",
    quantity: "relative energy b-a",
    value: "10.2",
    unit: "kcal/mol",
    page: "7",
    quote: "10.2 kcal mol-1 higher than that of the most stable",
    quantityKey: "literature.relative_energy",
  };

  it("accepts valid manual claim input", () => {
    const result = validateManualClaimInput(validForm);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.parsed).toEqual({
      document_id: "doc-123",
      system: "Complex 3b",
      quantity: "relative energy b-a",
      value: 10.2,
      unit: "kcal/mol",
      page: 7,
      quote: "10.2 kcal mol-1 higher than that of the most stable",
      quantity_key: "literature.relative_energy",
    });
  });

  it("accepts empty optional quantity key", () => {
    const result = validateManualClaimInput({
      ...validForm,
      quantityKey: "",
    });
    expect(result.valid).toBe(true);
    expect(result.parsed?.quantity_key).toBeNull();
  });

  it("requires documentId", () => {
    const result = validateManualClaimInput({
      ...validForm,
      documentId: "   ",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.documentId).toBe("Select a source document.");
  });

  it("validates system length and presence", () => {
    const emptyResult = validateManualClaimInput({
      ...validForm,
      system: "",
    });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.system).toBe("System or structure description is required.");

    const tooLongResult = validateManualClaimInput({
      ...validForm,
      system: "a".repeat(201),
    });
    expect(tooLongResult.valid).toBe(false);
    expect(tooLongResult.errors.system).toBe("System description must be 200 characters or fewer.");
  });

  it("validates quantity label length and presence", () => {
    const emptyResult = validateManualClaimInput({
      ...validForm,
      quantity: "",
    });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.quantity).toBe("Quantity label is required.");

    const tooLongResult = validateManualClaimInput({
      ...validForm,
      quantity: "q".repeat(121),
    });
    expect(tooLongResult.valid).toBe(false);
    expect(tooLongResult.errors.quantity).toBe("Quantity label must be 120 characters or fewer.");
  });

  it("validates numeric value", () => {
    const emptyResult = validateManualClaimInput({
      ...validForm,
      value: "",
    });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.value).toBe("Enter a valid numeric value.");

    const nanResult = validateManualClaimInput({
      ...validForm,
      value: "not-a-number",
    });
    expect(nanResult.valid).toBe(false);
    expect(nanResult.errors.value).toBe("Enter a valid numeric value.");

    const scientificResult = validateManualClaimInput({
      ...validForm,
      value: "-1.23e-4",
    });
    expect(scientificResult.valid).toBe(true);
    expect(scientificResult.parsed?.value).toBe(-1.23e-4);
  });

  it("validates unit length and presence", () => {
    const emptyResult = validateManualClaimInput({
      ...validForm,
      unit: "  ",
    });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.unit).toBe("Unit is required.");

    const tooLongResult = validateManualClaimInput({
      ...validForm,
      unit: "u".repeat(41),
    });
    expect(tooLongResult.valid).toBe(false);
    expect(tooLongResult.errors.unit).toBe("Unit must be 40 characters or fewer.");
  });

  it("validates page number integer and range (1..10000)", () => {
    const emptyResult = validateManualClaimInput({
      ...validForm,
      page: "",
    });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.page).toBe("Enter a valid page number (1 to 10,000).");

    const zeroResult = validateManualClaimInput({
      ...validForm,
      page: "0",
    });
    expect(zeroResult.valid).toBe(false);
    expect(zeroResult.errors.page).toBe("Enter a valid page number (1 to 10,000).");

    const floatResult = validateManualClaimInput({
      ...validForm,
      page: "3.5",
    });
    expect(floatResult.valid).toBe(false);
    expect(floatResult.errors.page).toBe("Enter a valid page number (1 to 10,000).");

    const tooHighResult = validateManualClaimInput({
      ...validForm,
      page: "10001",
    });
    expect(tooHighResult.valid).toBe(false);
    expect(tooHighResult.errors.page).toBe("Enter a valid page number (1 to 10,000).");
  });

  it("validates verbatim quote length and presence (3..500 chars)", () => {
    const emptyResult = validateManualClaimInput({
      ...validForm,
      quote: "   ",
    });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.quote).toBe("Verbatim quote is required.");

    const shortResult = validateManualClaimInput({
      ...validForm,
      quote: "ab",
    });
    expect(shortResult.valid).toBe(false);
    expect(shortResult.errors.quote).toBe("Verbatim quote must be at least 3 characters.");

    const longResult = validateManualClaimInput({
      ...validForm,
      quote: "q".repeat(501),
    });
    expect(longResult.valid).toBe(false);
    expect(longResult.errors.quote).toBe("Verbatim quote must be 500 characters or fewer.");
  });

  it("validates quantityKey length", () => {
    const tooLongResult = validateManualClaimInput({
      ...validForm,
      quantityKey: "k".repeat(121),
    });
    expect(tooLongResult.valid).toBe(false);
    expect(tooLongResult.errors.quantityKey).toBe("Quantity key must be 120 characters or fewer.");
  });
});
