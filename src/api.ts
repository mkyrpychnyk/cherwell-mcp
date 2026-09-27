import type { CherwellClient } from "./client.js";
import { CherwellApiError } from "./errors.js";

export interface BusObSummary {
  busObId: string;
  name: string;
  displayName?: string;
  major?: boolean;
  supporting?: boolean;
  lookup?: boolean;
  group?: boolean;
}

export interface TemplateField {
  fieldId: string;
  name: string;
  displayName?: string;
  value: string;
  dirty: boolean;
  html?: string | null;
  required?: boolean;
}

export interface BusinessObjectTemplate {
  fields: TemplateField[];
}

export interface BusinessObjectRecord {
  busObId: string;
  busObPublicId: string;
  busObRecId: string;
  fields: TemplateField[];
}

export interface SaveResult {
  busObPublicId: string;
  busObRecId: string;
  cacheKey?: string | null;
}

export interface SearchResult {
  businessObjects: BusinessObjectRecord[];
  totalRows: number;
}

export type SummaryType = "All" | "Major" | "Supporting" | "Lookup" | "Groups";

export type FilterOperator = "eq" | "gt" | "lt" | "contains" | "startswith";

export interface SearchFilter {
  fieldName: string;
  operator: FilterOperator;
  value: string;
}

const BUSOB_ID_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * Typed Cherwell operations plus the ergonomics the raw API lacks:
 * business objects addressable by name, fields addressable by name (resolved
 * to Cherwell field IDs via a cached getbusinessobjecttemplate call).
 */
export class CherwellApi {
  private readonly busObIdCache = new Map<string, string>();
  private readonly templateCache = new Map<string, BusinessObjectTemplate>();

  constructor(private readonly client: CherwellClient) {}

  async getSummaries(type: SummaryType): Promise<BusObSummary[]> {
    return this.client.request<BusObSummary[]>(
      `api/V1/getbusinessobjectsummaries/type/${encodeURIComponent(type.toLowerCase())}`
    );
  }

  /** Accepts a business object name ("Incident") or a 32-hex busObId; returns the busObId. */
  async resolveBusObId(nameOrId: string): Promise<string> {
    const trimmed = nameOrId.trim();
    if (BUSOB_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = this.busObIdCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const summaries = await this.client.request<BusObSummary[]>(
      `api/V1/getbusinessobjectsummary/busobname/${encodeURIComponent(trimmed)}`
    );
    const summary = summaries?.[0];
    if (!summary?.busObId) {
      throw new CherwellApiError(
        `Business object "${trimmed}" was not found. Use list_business_object_summaries to see available objects.`
      );
    }

    this.busObIdCache.set(cacheKey, summary.busObId);
    return summary.busObId;
  }

  async getTemplate(busObId: string, includeAll = true): Promise<BusinessObjectTemplate> {
    if (includeAll) {
      const cached = this.templateCache.get(busObId);
      if (cached) {
        return cached;
      }
    }

    const template = await this.client.request<BusinessObjectTemplate>("api/V1/getbusinessobjecttemplate", {
      method: "POST",
      body: { busObId, includeAll, includeRequired: !includeAll },
    });

    if (includeAll) {
      this.templateCache.set(busObId, template);
    }
    return template;
  }

  async getBusinessObject(busObId: string, id: { recId?: string; publicId?: string }): Promise<BusinessObjectRecord> {
    const path = id.recId
      ? `api/V1/getbusinessobject/busobid/${encodeURIComponent(busObId)}/busobrecid/${encodeURIComponent(id.recId)}`
      : `api/V1/getbusinessobject/busobid/${encodeURIComponent(busObId)}/publicid/${encodeURIComponent(id.publicId!)}`;
    return this.client.request<BusinessObjectRecord>(path);
  }

  async save(
    busObId: string,
    fields: Record<string, string>,
    id: { recId?: string; publicId?: string } = {}
  ): Promise<SaveResult> {
    const dirtyFields = await this.mapToTemplateFields(busObId, fields);

    return this.client.request<SaveResult>("api/V1/savebusinessobject", {
      method: "POST",
      body: {
        busObId,
        ...(id.recId ? { busObRecId: id.recId } : {}),
        ...(id.publicId ? { busObPublicId: id.publicId } : {}),
        fields: dirtyFields,
        persist: true,
      },
    });
  }

  async delete(busObId: string, recId: string): Promise<unknown> {
    return this.client.request(
      `api/V1/deletebusinessobject/busobid/${encodeURIComponent(busObId)}/busobrecid/${encodeURIComponent(recId)}`,
      { method: "DELETE" }
    );
  }

  async search(
    busObId: string,
    filters: SearchFilter[],
    options: { fields?: string[]; pageNumber?: number; pageSize?: number } = {}
  ): Promise<SearchResult> {
    const resolvedFilters = await Promise.all(
      filters.map(async (filter) => ({
        fieldId: (await this.resolveField(busObId, filter.fieldName)).fieldId,
        operator: filter.operator,
        value: filter.value,
      }))
    );

    const returnFieldIds = options.fields
      ? await Promise.all(options.fields.map(async (name) => (await this.resolveField(busObId, name)).fieldId))
      : undefined;

    return this.client.request<SearchResult>("api/V1/getsearchresults", {
      method: "POST",
      body: {
        busObId,
        filters: resolvedFilters,
        ...(returnFieldIds ? { fields: returnFieldIds } : { includeAllFields: true }),
        pageNumber: options.pageNumber ?? 1,
        pageSize: options.pageSize ?? 50,
      },
    });
  }

  private async mapToTemplateFields(busObId: string, fields: Record<string, string>): Promise<TemplateField[]> {
    return Promise.all(
      Object.entries(fields).map(async ([name, value]) => {
        const templateField = await this.resolveField(busObId, name);
        return { ...templateField, value, dirty: true };
      })
    );
  }

  private async resolveField(busObId: string, fieldName: string): Promise<TemplateField> {
    const template = await this.getTemplate(busObId);
    const wanted = fieldName.trim().toLowerCase();
    const field = template.fields.find(
      (f) => f.name.toLowerCase() === wanted || f.displayName?.toLowerCase() === wanted
    );
    if (!field) {
      const available = template.fields.map((f) => f.name).join(", ");
      throw new CherwellApiError(
        `Field "${fieldName}" was not found on this business object. Available fields: ${available}`
      );
    }
    return field;
  }
}
