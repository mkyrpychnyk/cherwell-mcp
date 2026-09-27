import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { CherwellApi } from "./api.js";
import { compactRecord, compactSearchResult, compactSummaries, compactTemplate } from "./format.js";

const businessObject = z
  .string()
  .min(1)
  .describe('Business object name (e.g. "Incident") or its 32-character busObId.');

const recId = z.string().min(1).describe("Internal record ID (busObRecId) of the record.");

const publicId = z.string().min(1).describe("Public ID of the record (e.g. incident number).");

const raw = z
  .boolean()
  .default(false)
  .describe(
    "Return the untouched Cherwell response instead of the compact form. Verbose — a single record can exceed 100 KB."
  );

const filterSchema = z.object({
  fieldName: z.string().min(1).describe('Field name or display name, e.g. "Status".'),
  operator: z.enum(["eq", "gt", "lt", "contains", "startswith"]).describe("Comparison operator."),
  value: z.string().describe("Value to compare against."),
});

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export function registerTools(server: McpServer, api: CherwellApi): void {
  server.registerTool(
    "list_business_object_summaries",
    {
      description:
        "List Cherwell business objects (names and busObIds). Use this to discover which objects exist " +
        "and to find the busObId or exact name needed by the other tools.",
      inputSchema: z.object({
        type: z
          .enum(["All", "Major", "Supporting", "Lookup", "Groups"])
          .default("Major")
          .describe('Which category of business objects to list. "Major" covers Incident, Problem, Change, etc.'),
        raw,
      }),
    },
    async ({ type, raw: rawOutput }) => {
      try {
        const summaries = await api.getSummaries(type);
        return ok(rawOutput ? summaries : compactSummaries(summaries));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "get_business_object_template",
    {
      description:
        "Get the field schema (template) of a business object: field IDs, names, display names and required flags. " +
        "Use this to learn which fields exist before creating, updating or searching records.",
      inputSchema: z.object({
        businessObject,
        requiredOnly: z
          .boolean()
          .default(false)
          .describe("If true, return only the fields required to create a record."),
        raw,
      }),
    },
    async ({ businessObject: busOb, requiredOnly, raw: rawOutput }) => {
      try {
        const busObId = await api.resolveBusObId(busOb);
        const template = await api.getTemplate(busObId, !requiredOnly);
        return ok(rawOutput ? template : compactTemplate(template));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "get_business_object",
    {
      description:
        "Read a single business object record with its field values, addressed by record ID (busObRecId) " +
        "or public ID (e.g. incident number). Provide exactly one of recId / publicId. Records can have " +
        "hundreds of fields — pass `fields` to keep the response small.",
      inputSchema: z.object({
        businessObject,
        recId: recId.optional(),
        publicId: publicId.optional(),
        fields: z
          .array(z.string())
          .optional()
          .describe("Field names to return. Omit to return every field on the record."),
        raw,
      }),
    },
    async ({ businessObject: busOb, recId: rec, publicId: pub, fields, raw: rawOutput }) => {
      if (!rec === !pub) {
        return fail(new Error("Provide exactly one of recId or publicId."));
      }
      try {
        const busObId = await api.resolveBusObId(busOb);
        const record = await api.getBusinessObject(busObId, { recId: rec, publicId: pub });
        return ok(rawOutput ? record : compactRecord(record, fields));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "create_business_object",
    {
      description:
        "Create a new business object record. Pass field values as a map of field name (or display name) to value. " +
        "Use get_business_object_template with requiredOnly=true to see which fields are mandatory. " +
        "Returns the new record's busObRecId and public ID.",
      inputSchema: z.object({
        businessObject,
        fields: z
          .record(z.string(), z.string())
          .describe('Field values, e.g. {"Description": "Printer is down", "Priority": "2"}.'),
      }),
    },
    async ({ businessObject: busOb, fields }) => {
      if (Object.keys(fields).length === 0) {
        return fail(new Error("fields must contain at least one field."));
      }
      try {
        const busObId = await api.resolveBusObId(busOb);
        return ok(await api.save(busObId, fields));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "update_business_object",
    {
      description:
        "Update fields of an existing business object record, addressed by record ID (busObRecId) or public ID. " +
        "Only the provided fields are changed. Provide exactly one of recId / publicId.",
      inputSchema: z.object({
        businessObject,
        recId: recId.optional(),
        publicId: publicId.optional(),
        fields: z
          .record(z.string(), z.string())
          .describe('Field values to change, e.g. {"Status": "Resolved"}.'),
      }),
    },
    async ({ businessObject: busOb, recId: rec, publicId: pub, fields }) => {
      if (!rec === !pub) {
        return fail(new Error("Provide exactly one of recId or publicId."));
      }
      if (Object.keys(fields).length === 0) {
        return fail(new Error("fields must contain at least one field."));
      }
      try {
        const busObId = await api.resolveBusObId(busOb);
        return ok(await api.save(busObId, fields, { recId: rec, publicId: pub }));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "delete_business_object",
    {
      description:
        "Permanently delete a business object record by its record ID (busObRecId). This cannot be undone.",
      inputSchema: z.object({
        businessObject,
        recId,
      }),
    },
    async ({ businessObject: busOb, recId: rec }) => {
      try {
        const busObId = await api.resolveBusObId(busOb);
        return ok(await api.delete(busObId, rec));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "search_business_objects",
    {
      description:
        "Search business object records with field filters. Filters on the SAME field are OR-ed together; " +
        "filters on DIFFERENT fields are AND-ed (Cherwell semantics). Supports paging and an optional list " +
        "of fields to return (defaults to all fields).",
      inputSchema: z.object({
        businessObject,
        filters: z.array(filterSchema).min(1).describe("One or more field filters."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Field names to include in results. Omit to return all fields."),
        pageNumber: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(500).default(50),
        raw,
      }),
    },
    async ({ businessObject: busOb, filters, fields, pageNumber, pageSize, raw: rawOutput }) => {
      try {
        const busObId = await api.resolveBusObId(busOb);
        const result = await api.search(busObId, filters, { fields, pageNumber, pageSize });
        return ok(rawOutput ? result : compactSearchResult(result));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
