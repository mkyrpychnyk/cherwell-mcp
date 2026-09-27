import { describe, expect, it } from "vitest";
import { compactRecord, compactSearchResult, compactSummaries, compactTemplate } from "../src/format.js";
import type { BusinessObjectRecord } from "../src/api.js";

const record: BusinessObjectRecord = {
  busObId: "bo-1",
  busObPublicId: "867045",
  busObRecId: "rec-1",
  fields: [
    { fieldId: "f1", fullFieldId: "BO:bo-1,FI:f1", name: "IncidentID", displayName: "Incident ID", value: "867045", dirty: false, html: null },
    { fieldId: "f2", name: "Status", displayName: "Incident Status", value: "New", dirty: false, html: null },
    { fieldId: "f3", name: "ShortDescription", displayName: "Description", value: "Printer down", dirty: false, html: null },
  ] as BusinessObjectRecord["fields"],
};

describe("compactRecord", () => {
  it("flattens fields into a name/value map and keeps the identifiers", () => {
    expect(compactRecord(record)).toEqual({
      busObId: "bo-1",
      busObPublicId: "867045",
      busObRecId: "rec-1",
      fields: { IncidentID: "867045", Status: "New", ShortDescription: "Printer down" },
    });
  });

  it("is dramatically smaller than the raw shape", () => {
    const compactSize = JSON.stringify(compactRecord(record)).length;
    expect(compactSize).toBeLessThan(JSON.stringify(record).length / 2);
  });

  it("filters to requested fields by name or display name, case-insensitively", () => {
    const result = compactRecord(record, ["status", "Incident ID"]);
    expect(result.fields).toEqual({ IncidentID: "867045", Status: "New" });
  });

  it("returns an empty field map when no requested field matches", () => {
    expect(compactRecord(record, ["Nonexistent"]).fields).toEqual({});
  });

  it("tolerates a record without a fields array", () => {
    const bare = { busObId: "b", busObPublicId: "p", busObRecId: "r" } as BusinessObjectRecord;
    expect(compactRecord(bare).fields).toEqual({});
  });
});

describe("compactSearchResult", () => {
  it("keeps totalRows and compacts each record", () => {
    const result = compactSearchResult({ businessObjects: [record], totalRows: 1 });
    expect(result.totalRows).toBe(1);
    expect(result.businessObjects[0].fields.Status).toBe("New");
  });

  it("handles an empty result set", () => {
    expect(compactSearchResult({ businessObjects: [], totalRows: 0 })).toEqual({
      totalRows: 0,
      businessObjects: [],
    });
  });
});

describe("compactSummaries", () => {
  it("keeps only the identity fields", () => {
    const summaries = compactSummaries([
      {
        busObId: "bo-1",
        name: "Incident",
        displayName: "Incident",
        major: true,
        lookup: false,
        group: false,
        supporting: false,
      },
    ]);
    expect(summaries).toEqual([{ busObId: "bo-1", name: "Incident", displayName: "Incident" }]);
  });
});

describe("compactTemplate", () => {
  it("reduces template fields to names", () => {
    const template = compactTemplate({
      fields: [
        { fieldId: "f1", name: "Service", displayName: "Service", value: "", dirty: false },
        { fieldId: "f2", name: "UrgencyCustom", displayName: "Urgency", value: "", dirty: false },
      ],
    });
    expect(template).toEqual({
      fields: [
        { name: "Service", displayName: "Service" },
        { name: "UrgencyCustom", displayName: "Urgency" },
      ],
    });
  });
});
