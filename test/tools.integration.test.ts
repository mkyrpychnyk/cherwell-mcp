import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { CherwellApi } from "../src/api.js";
import { TokenManager } from "../src/auth.js";
import { CherwellClient } from "../src/client.js";
import { registerTools } from "../src/tools.js";
import { FetchMock, testConfig } from "./helpers/mock-fetch.js";

const INCIDENT_ID = "6dd53665c0c24cab86870a21cf6434ae";

const incidentSummary = [{ busObId: INCIDENT_ID, name: "Incident", displayName: "Incident" }];

const incidentTemplate = {
  fields: [
    { fieldId: `BO:${INCIDENT_ID},FI:desc1`, name: "Description", displayName: "Description", value: "", dirty: false },
  ],
};

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

describe("cherwell-mcp tools over an in-memory MCP connection", () => {
  let fetchMock: FetchMock;
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    fetchMock = new FetchMock().install();

    const config = testConfig();
    const api = new CherwellApi(new CherwellClient(config, new TokenManager(config)));
    server = new McpServer({ name: "cherwell-mcp-test", version: "0.0.0" });
    registerTools(server, api);

    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.unstubAllGlobals();
  });

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  }

  it("exposes all seven CRUD tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "create_business_object",
      "delete_business_object",
      "get_business_object",
      "get_business_object_template",
      "list_business_object_summaries",
      "search_business_objects",
      "update_business_object",
    ]);
  });

  it("rejects get_business_object with both recId and publicId", async () => {
    const result = await callTool("get_business_object", {
      businessObject: "Incident",
      recId: "rec-1",
      publicId: "10001",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exactly one of recId or publicId");
    expect(fetchMock.requests).toHaveLength(0);
  });

  it("rejects get_business_object with neither recId nor publicId", async () => {
    const result = await callTool("get_business_object", { businessObject: "Incident" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exactly one of recId or publicId");
  });

  it("rejects create_business_object with an empty fields map", async () => {
    const result = await callTool("create_business_object", { businessObject: "Incident", fields: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("at least one field");
  });

  it("creates a business object end-to-end", async () => {
    fetchMock.queueToken();
    fetchMock.queueJson(incidentSummary);
    fetchMock.queueJson(incidentTemplate);
    fetchMock.queueJson({ busObRecId: "rec-9", busObPublicId: "10042", hasError: false });

    const result = await callTool("create_business_object", {
      businessObject: "Incident",
      fields: { Description: "Printer is down" },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ busObRecId: "rec-9", busObPublicId: "10042" });

    const saveRequest = fetchMock.last();
    expect(saveRequest.url).toContain("api/V1/savebusinessobject");
    const body = JSON.parse(saveRequest.body!);
    expect(body.persist).toBe(true);
    expect(body.fields[0]).toMatchObject({ name: "Description", value: "Printer is down", dirty: true });
  });

  it("surfaces Cherwell in-band errors as tool errors", async () => {
    fetchMock.queueToken();
    fetchMock.queueJson(incidentTemplate);
    fetchMock.queueJson({ hasError: true, errorMessage: "Required field Priority is missing" });

    const result = await callTool("create_business_object", {
      businessObject: INCIDENT_ID,
      fields: { Description: "no priority" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Required field Priority is missing");
  });

  it("returns compact records by default and the raw shape on request", async () => {
    const rawRecord = {
      busObId: INCIDENT_ID,
      busObPublicId: "867045",
      busObRecId: "rec-1",
      fields: [
        {
          fieldId: `BO:${INCIDENT_ID},FI:desc1`,
          fullFieldId: null,
          html: null,
          dirty: false,
          name: "Description",
          displayName: "Description",
          value: "Printer is down",
        },
      ],
    };
    fetchMock.queueToken();
    fetchMock.queueJson(rawRecord);
    fetchMock.queueJson(rawRecord); // token is cached, so the second call goes straight out

    const compact = await callTool("get_business_object", { businessObject: INCIDENT_ID, publicId: "867045" });
    expect(JSON.parse(compact.content[0].text)).toEqual({
      busObId: INCIDENT_ID,
      busObPublicId: "867045",
      busObRecId: "rec-1",
      fields: { Description: "Printer is down" },
    });

    const verbose = await callTool("get_business_object", {
      businessObject: INCIDENT_ID,
      publicId: "867045",
      raw: true,
    });
    expect(JSON.parse(verbose.content[0].text).fields[0].fieldId).toBe(`BO:${INCIDENT_ID},FI:desc1`);
  });

  it("trims the summaries list to identity fields by default", async () => {
    fetchMock.queueToken();
    fetchMock.queueJson([{ ...incidentSummary[0], major: true, lookup: false, group: false, states: "" }]);

    const result = await callTool("list_business_object_summaries", { type: "Major" });

    expect(JSON.parse(result.content[0].text)).toEqual([
      { busObId: INCIDENT_ID, name: "Incident", displayName: "Incident" },
    ]);
  });

  it("surfaces auth failures as tool errors", async () => {
    fetchMock.queueJson({ error_description: "wrong password" }, 400);

    const result = await callTool("list_business_object_summaries", { type: "Major" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("wrong password");
  });
});
