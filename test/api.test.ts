import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CherwellApi } from "../src/api.js";
import { TokenManager } from "../src/auth.js";
import { CherwellClient } from "../src/client.js";
import { FetchMock, testConfig } from "./helpers/mock-fetch.js";

const INCIDENT_ID = "6dd53665c0c24cab86870a21cf6434ae";

const incidentSummary = [{ busObId: INCIDENT_ID, name: "Incident", displayName: "Incident" }];

const incidentTemplate = {
  fields: [
    { fieldId: `BO:${INCIDENT_ID},FI:desc1`, name: "Description", displayName: "Description", value: "", dirty: false },
    { fieldId: `BO:${INCIDENT_ID},FI:stat1`, name: "Status", displayName: "Incident Status", value: "", dirty: false },
  ],
};

describe("CherwellApi", () => {
  let fetchMock: FetchMock;
  let api: CherwellApi;

  beforeEach(() => {
    fetchMock = new FetchMock().install();
    const config = testConfig();
    api = new CherwellApi(new CherwellClient(config, new TokenManager(config)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("resolveBusObId", () => {
    it("passes a 32-hex busObId through without any request", async () => {
      await expect(api.resolveBusObId(INCIDENT_ID)).resolves.toBe(INCIDENT_ID);
      expect(fetchMock.requests).toHaveLength(0);
    });

    it("resolves a name via getbusinessobjectsummary and caches the result", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentSummary);

      await expect(api.resolveBusObId("Incident")).resolves.toBe(INCIDENT_ID);
      expect(fetchMock.last().url).toContain("api/V1/getbusinessobjectsummary/busobname/Incident");

      await expect(api.resolveBusObId("incident")).resolves.toBe(INCIDENT_ID);
      expect(fetchMock.requests).toHaveLength(2); // token + one summary lookup
    });

    it("throws a helpful error for an unknown name", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson([]);

      await expect(api.resolveBusObId("Nonsense")).rejects.toThrow(
        /"Nonsense" was not found.*list_business_object_summaries/
      );
    });
  });

  describe("getTemplate", () => {
    it("requests the full template and caches it per busObId", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);

      await api.getTemplate(INCIDENT_ID);
      const request = fetchMock.last();
      expect(request.url).toContain("api/V1/getbusinessobjecttemplate");
      expect(JSON.parse(request.body!)).toEqual({ busObId: INCIDENT_ID, includeAll: true, includeRequired: false });

      await api.getTemplate(INCIDENT_ID);
      expect(fetchMock.requests).toHaveLength(2); // token + one template fetch
    });

    it("does not cache required-only templates", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);
      fetchMock.queueJson(incidentTemplate);

      await api.getTemplate(INCIDENT_ID, false);
      await api.getTemplate(INCIDENT_ID, false);

      expect(fetchMock.requests).toHaveLength(3); // token + two template fetches
      expect(JSON.parse(fetchMock.last().body!)).toEqual({
        busObId: INCIDENT_ID,
        includeAll: false,
        includeRequired: true,
      });
    });
  });

  describe("save", () => {
    it("maps field names to template field IDs and marks only them dirty", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);
      fetchMock.queueJson({ busObRecId: "rec-1", busObPublicId: "10001" });

      const result = await api.save(INCIDENT_ID, { Description: "Printer is down" });

      expect(result).toMatchObject({ busObRecId: "rec-1", busObPublicId: "10001" });
      const body = JSON.parse(fetchMock.last().body!);
      expect(body.busObId).toBe(INCIDENT_ID);
      expect(body.persist).toBe(true);
      expect(body.busObRecId).toBeUndefined();
      expect(body.busObPublicId).toBeUndefined();
      expect(body.fields).toHaveLength(1);
      expect(body.fields[0]).toMatchObject({
        fieldId: `BO:${INCIDENT_ID},FI:desc1`,
        name: "Description",
        value: "Printer is down",
        dirty: true,
      });
    });

    it("matches fields by display name, case-insensitively", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);
      fetchMock.queueJson({ busObRecId: "rec-1", busObPublicId: "10001" });

      await api.save(INCIDENT_ID, { "incident status": "Resolved" });

      const body = JSON.parse(fetchMock.last().body!);
      expect(body.fields[0]).toMatchObject({ name: "Status", value: "Resolved", dirty: true });
    });

    it("includes busObRecId only for updates", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);
      fetchMock.queueJson({ busObRecId: "rec-1", busObPublicId: "10001" });

      await api.save(INCIDENT_ID, { Description: "updated" }, { recId: "rec-1" });

      const body = JSON.parse(fetchMock.last().body!);
      expect(body.busObRecId).toBe("rec-1");
      expect(body.busObPublicId).toBeUndefined();
    });

    it("rejects unknown field names and lists the available fields", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);

      await expect(api.save(INCIDENT_ID, { Nope: "x" })).rejects.toThrow(
        /Field "Nope" was not found.*Description, Status/
      );
    });
  });

  describe("search", () => {
    it("resolves filter field names to field IDs and defaults paging", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);
      fetchMock.queueJson({ businessObjects: [], totalRows: 0 });

      await api.search(INCIDENT_ID, [{ fieldName: "Status", operator: "eq", value: "New" }]);

      const body = JSON.parse(fetchMock.last().body!);
      expect(body).toEqual({
        busObId: INCIDENT_ID,
        filters: [{ fieldId: `BO:${INCIDENT_ID},FI:stat1`, operator: "eq", value: "New" }],
        includeAllFields: true,
        pageNumber: 1,
        pageSize: 50,
      });
    });

    it("sends resolved field IDs instead of includeAllFields when fields are requested", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson(incidentTemplate);
      fetchMock.queueJson({ businessObjects: [], totalRows: 0 });

      await api.search(INCIDENT_ID, [{ fieldName: "Status", operator: "eq", value: "New" }], {
        fields: ["Description"],
        pageNumber: 2,
        pageSize: 10,
      });

      const body = JSON.parse(fetchMock.last().body!);
      expect(body.fields).toEqual([`BO:${INCIDENT_ID},FI:desc1`]);
      expect(body.includeAllFields).toBeUndefined();
      expect(body.pageNumber).toBe(2);
      expect(body.pageSize).toBe(10);
    });
  });

  describe("delete", () => {
    it("issues a DELETE with URL-encoded IDs", async () => {
      fetchMock.queueToken();
      fetchMock.queueJson({});

      await api.delete(INCIDENT_ID, "rec 1");

      const request = fetchMock.last();
      expect(request.method).toBe("DELETE");
      expect(request.url).toContain(`api/V1/deletebusinessobject/busobid/${INCIDENT_ID}/busobrecid/rec%201`);
    });
  });
});
