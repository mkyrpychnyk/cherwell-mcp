import type { BusinessObjectRecord, BusObSummary, BusinessObjectTemplate, SearchResult } from "./api.js";

/**
 * Cherwell returns seven keys of metadata per field (fieldId, fullFieldId, html, dirty,
 * displayName, name, value). A single Incident weighs in around 110 KB that way, which is
 * more than an LLM context can afford, so tools return these compact shapes by default and
 * the untouched API response only when the caller asks for raw output.
 */

export interface CompactRecord {
  busObId: string;
  busObPublicId: string;
  busObRecId: string;
  fields: Record<string, string>;
}

export function compactRecord(record: BusinessObjectRecord, only?: string[]): CompactRecord {
  const wanted = only?.map((name) => name.trim().toLowerCase());

  const fields: Record<string, string> = {};
  for (const field of record.fields ?? []) {
    if (
      wanted &&
      !wanted.includes(field.name?.toLowerCase()) &&
      !wanted.includes(field.displayName?.toLowerCase() ?? "")
    ) {
      continue;
    }
    fields[field.name] = field.value;
  }

  return {
    busObId: record.busObId,
    busObPublicId: record.busObPublicId,
    busObRecId: record.busObRecId,
    fields,
  };
}

export function compactSearchResult(
  result: SearchResult,
  only?: string[]
): { totalRows: number; businessObjects: CompactRecord[] } {
  return {
    totalRows: result.totalRows,
    businessObjects: (result.businessObjects ?? []).map((record) => compactRecord(record, only)),
  };
}

export function compactSummaries(
  summaries: BusObSummary[]
): { busObId: string; name: string; displayName?: string }[] {
  return (summaries ?? []).map(({ busObId, name, displayName }) => ({ busObId, name, displayName }));
}

export function compactTemplate(
  template: BusinessObjectTemplate
): { fields: { name: string; displayName?: string }[] } {
  return {
    fields: (template.fields ?? []).map(({ name, displayName }) => ({ name, displayName })),
  };
}
