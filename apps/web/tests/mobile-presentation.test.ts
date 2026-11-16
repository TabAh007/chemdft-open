import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProvenanceProducerFacts } from "../src/app/_components/provenance-inspector";
import { summarizeProvenance } from "../src/lib/provenance-view";
import { approvalCoordinate } from "../src/lib/approval-geometry";
import { ApprovalGeometryTable } from "../src/app/[locale]/projects/[projectId]/workspace/ai-scientific-workflow";
import { NextIntlClientProvider } from "next-intl";
import { StructureVersionInspector } from "../src/app/_components/structure-version-inspector";
import type { StructureInspectorContext } from "../src/lib/structure-workbench";
import type { CoordinateSet, StructureVersionDetail } from "@chemdft/schemas";

describe("Result created uses the shared timezone formatter", () => {
  it.each(["2026-10-14T14:50:11.528304", "2026-10-14T18:50:11.528304+04:00"])("formats %s without changing the lineage export", created => {
    const document = { schema: "chemdft.result-lineage-export.v1", result: { created_at: created, trusted_producer_id: "local.pyscf.worker" } };
    const before = JSON.stringify(document);
    const summary = summarizeProvenance(document)!;
    const html = renderToStaticMarkup(createElement(ProvenanceProducerFacts, { producer: summary.producer }));
    expect(html).toContain("Result created");
    expect(html).toContain('dateTime="2026-10-14T14:50:11.528Z"');
    expect(html).toContain("UTC: 2026-10-14T14:50:11.528Z");
    expect(html).toContain("local.pyscf.worker");
    expect(summary.producer.find(row => row.label === "Result created")?.value).toBe(created);
    expect(JSON.stringify(document)).toBe(before);
  });
  it("shows unavailable for a malformed date, never a fabricated timestamp", () => {
    const html = renderToStaticMarkup(createElement(ProvenanceProducerFacts, { producer: [{ label: "Result created", value: "invalid" }] }));
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("dateTime=");
  });
});

describe("scrollable coordinate presentation retains numerical precision", () => {
  it("keeps small coordinates, every stored digit and signed zero", () => {
    expect(approvalCoordinate(0.123456789012345)).toBe("0.123456789012345");
    expect(approvalCoordinate(1e-11)).toBe("1e-11");
    expect(approvalCoordinate(-0)).toBe("-0.00");
  });
  it("provides a keyboard-focusable region and all indexed H2 values with units", () => {
    const coordinates: CoordinateSet = {
      structure_version_id: "v", coordinate_system: "CARTESIAN", unit: "angstrom",
      source: { project_id: "p", entity_type: "structure.version", entity_id: "v" },
      atoms: [{ index: 0, element: "H", atomic_number: 1, x: 0, y: 0, z: -0.37 }, { index: 1, element: "H", atomic_number: 1, x: 0, y: 0, z: 0.37 }],
    };
    const before = JSON.stringify(coordinates);
    const html = renderToStaticMarkup(createElement(ApprovalGeometryTable, { coordinates }));
    expect(html).toContain('tabindex="0"'); expect(html).toContain('role="region"');
    expect(html).toContain("Scroll horizontally to see all coordinates");
    for (const label of ["Angstrom", "Element", "X", "Y", "Z", "-0.37", "0.37", "0.00"]) expect(html).toContain(label);
    expect(JSON.stringify(coordinates)).toBe(before);
  });
});

 it("keeps exact inspector coordinates and identifies its scroll region and column headers", () => {
  const detail = {structure:{id:"s",name:"H2"}, version:{id:"v",revision:1,origin:"IMPORTED", coordinates:{coordinate_system:"CARTESIAN",unit:"angstrom",atoms:[{index:0,element:"H",x:1e-11,y:-0,z:-0.370000000000001}]}}} as unknown as StructureVersionDetail;
  const context: StructureInspectorContext = {detail,scene:null,visualBonds:[],visualBondsEnabled:true,selectedAtomIndex:null,measurementKind:"none",measurementAtomIndices:[],measurement:null};
  const before=JSON.stringify(detail);
  const props={locale:"en",timeZone:"UTC",messages:{}} as ComponentProps<typeof NextIntlClientProvider>;
  const html=renderToStaticMarkup(createElement(NextIntlClientProvider, props, createElement(StructureVersionInspector,{context})));
  expect(html).toContain('aria-label="Exact atomic coordinates (angstrom)"');
  expect(html).toContain("Scroll horizontally to see all coordinates");
  expect(html).toContain('tabindex="0"');expect(html).toContain('scope="col"');
  for(const value of ["1e-11","-0.00","-0.370000000000001",">X<",">Y<",">Z<"]) expect(html).toContain(value);
  expect(JSON.stringify(detail)).toBe(before);
 });
