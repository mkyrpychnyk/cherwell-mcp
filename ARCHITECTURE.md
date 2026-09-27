# cherwell-mcp — Architecture

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing CRUD operations
on Cherwell CSM business objects, published as an npm package with a `cherwell-mcp` executable.

The API contract (auth flow, routes, payload shapes) is ported from the internal .NET solution
`CherwellApi` (`CherwellApiAuthProvider`, `CherwellApiRequestExecutor`, `ApiRoutes`).

## Layers

```
┌─────────────────────────────────────────────────────┐
│ src/index.ts        entry point (bin), stdio wiring │
├─────────────────────────────────────────────────────┤
│ src/tools.ts        MCP tool definitions (zod)      │
├─────────────────────────────────────────────────────┤
│ src/api.ts          typed Cherwell operations,      │
│                     name→ID resolution, schema cache│
├─────────────────────────────────────────────────────┤
│ src/client.ts       HTTP client: bearer injection,  │
│                     401 → re-login → retry once     │
├─────────────────────────────────────────────────────┤
│ src/auth.ts         token manager (password grant,  │
│                     expiry buffer, single-flight)   │
├─────────────────────────────────────────────────────┤
│ src/config.ts       env-var configuration           │
│ src/errors.ts       typed errors                    │
└─────────────────────────────────────────────────────┘
```

- **config.ts** — reads and validates environment variables at startup; fails fast with a
  message listing every missing variable. No credentials ever appear in tool output or logs.
- **auth.ts** — `TokenManager`. `POST {base}/CherwellAPI/token?auth_mode={mode}&api_key={clientId}`
  with form-urlencoded `grant_type=password`, `client_id`, `username`, `password`. Caches the
  access token and treats it as expired 10 minutes before its actual expiry (same buffer as the
  .NET `CherwellApiAuthProvider`). Concurrent callers share one in-flight login (single-flight,
  mirroring the .NET semaphore).
- **client.ts** — `CherwellClient.request()`. Adds `Authorization: Bearer`, executes via `fetch`,
  and on `401` invalidates the token and retries exactly once (mirroring
  `CherwellApiRequestExecutor`). Non-2xx responses become `CherwellApiError` carrying status and
  response body; Cherwell's in-band errors (`hasError`/`errorMessage` in a 200 response) are also
  surfaced as errors.
- **api.ts** — typed wrappers over the REST routes plus ergonomics the raw API lacks:
  - `resolveBusObId()` — tools accept either a business object **name** (`Incident`) or a
    **busObId** (32-hex); names are resolved via `getbusinessobjectsummary/busobname/{name}`.
  - Template cache — `getbusinessobjecttemplate` results are cached per busObId and used to map
    field **names/display names** to Cherwell field IDs for saves and search filters.
- **tools.ts** — MCP tools (see catalog). Handlers validate input with zod, call `api.ts`, and
  return pretty-printed JSON; failures return `isError: true` with a readable message.
- **index.ts** — `#!/usr/bin/env node` entry. Loads config, builds the server, connects a
  `StdioServerTransport`. Diagnostics go to **stderr only** (stdout is the protocol channel).

## Cherwell REST routes used

| Operation | Route |
|---|---|
| Login | `POST CherwellAPI/token?auth_mode={mode}&api_key={key}` |
| List object summaries | `GET CherwellAPI/api/V1/getbusinessobjectsummaries/type/{type}` |
| Summary by name | `GET CherwellAPI/api/V1/getbusinessobjectsummary/busobname/{name}` |
| Template (schema) | `POST CherwellAPI/api/V1/getbusinessobjecttemplate` |
| Read by RecID | `GET CherwellAPI/api/V1/getbusinessobject/busobid/{id}/busobrecid/{recId}` |
| Read by Public ID | `GET CherwellAPI/api/V1/getbusinessobject/busobid/{id}/publicid/{publicId}` |
| Create / Update | `POST CherwellAPI/api/V1/savebusinessobject` |
| Delete | `DELETE CherwellAPI/api/V1/deletebusinessobject/busobid/{id}/busobrecid/{recId}` |
| Search | `POST CherwellAPI/api/V1/getsearchresults` |

## Tool catalog (v0.1 — CRUD scope)

| Tool | Purpose |
|---|---|
| `list_business_object_summaries` | Discover objects and their busObIds (`All`/`Major`/`Supporting`/`Lookup`/`Groups`) |
| `get_business_object_template` | Field schema (IDs, names, required flags) for an object |
| `get_business_object` | Read one record by RecID or Public ID |
| `create_business_object` | Create a record from a `{fieldName: value}` map |
| `update_business_object` | Update fields of an existing record (by RecID or Public ID) |
| `delete_business_object` | Delete a record by RecID |
| `search_business_objects` | Query records with field filters (`eq`/`gt`/`lt`/`contains`/`startswith`), field selection, paging |

Save semantics: the server fetches the object's template, maps the caller's field names to field
IDs, marks only the provided fields `dirty: true`, and posts `savebusinessobject` (with
`busObRecId`/`busObPublicId` for updates, without for creates).

Search filter semantics (Cherwell's): filters on the **same** field OR together; filters on
**different** fields AND together.

## Configuration (environment variables)

| Variable | Required | Description |
|---|---|---|
| `CHERWELL_BASE_URL` | yes | CSM host root, e.g. `https://csm.example.com` (the `CherwellAPI/...` path is appended) |
| `CHERWELL_CLIENT_ID` | yes | REST API client key (from CSM Administrator) |
| `CHERWELL_USERNAME` | yes | Cherwell user login |
| `CHERWELL_PASSWORD` | yes | Cherwell user password |
| `CHERWELL_AUTH_MODE` | no | `internal` (default), `windows`, `ldap`, or `saml` |
| `CHERWELL_TIMEOUT_MS` | no | Per-request timeout, default `30000` |

## npm packaging

- Package `cherwell-mcp`, `"type": "module"`, `bin: { "cherwell-mcp": "dist/index.js" }`.
- Only `dist/`, `README.md`, `LICENSE` are published (`files` allowlist); `prepublishOnly` builds.
- Runtime deps: `@modelcontextprotocol/server`, `zod`. Node ≥ 20 (built-in `fetch`).
- Consumers run it via `npx cherwell-mcp` from any MCP client config.

## Future (out of v0.1 scope)

Attachments (upload/download/remove), related business objects (link/unlink/saverelated),
One-Step actions, teams/users lookups — all present in the .NET solution and mappable onto the
same client layer.
