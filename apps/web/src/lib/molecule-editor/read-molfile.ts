/**
 * Read the drawing as a MOL block.
 *
 * Observed with Ketcher 3.12.0 (isolated geometry run): `getMolfile()` now and then returns a bare sequence such as
 * "CCN" instead of a MOL block, while `getSmiles()` is still correct. A sequence is not a structure the server can
 * read, and comparing it to the earlier MOL block would wrongly discard a valid 3D candidate. So the result is checked
 * (a MOL block ends with "M  END"), retried, and finally rebuilt from the drawing's own SMILES with Indigo.
 */
export type MolfileSource = {
  getMolfile: () => Promise<string>;
  getSmiles: () => Promise<string>;
  indigo?: { convert: (structure: string, options?: { outputFormat?: string }) => Promise<{ struct: string }> };
};

const isMolfile = (text: unknown): text is string => typeof text === "string" && /(^|\n)M {2}END\b/.test(text);

export async function readMolfile(source: MolfileSource, attempts = 3): Promise<string> {
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await source.getMolfile();
    if (isMolfile(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const smiles = (await source.getSmiles()).trim();
  if (smiles && source.indigo) {
    const converted = await source.indigo.convert(smiles, { outputFormat: "chemical/x-mdl-molfile" });
    if (isMolfile(converted.struct)) return converted.struct;
  }
  return last;
}
