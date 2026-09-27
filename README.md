# cherwell-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) for the
**Cherwell CSM REST API**. It lets MCP clients (Claude Code, Claude Desktop, etc.)
create, read, update, delete and search Cherwell business objects — Incidents,
Problems, Changes, or any custom object.

## Requirements

- Node.js ≥ 20
- A Cherwell REST API **client key** (created in CSM Administrator → Security → Edit REST API client settings)
- A Cherwell user account the server will act as

## Configuration

All configuration is provided via environment variables — no config files, no CLI flags:

| Variable | Required | Description |
|---|---|---|
| `CHERWELL_BASE_URL` | yes | CSM host root, e.g. `https://csm.example.com` |
| `CHERWELL_CLIENT_ID` | yes | REST API client key |
| `CHERWELL_USERNAME` | yes | Cherwell user login |
| `CHERWELL_PASSWORD` | yes | Cherwell user password |
| `CHERWELL_AUTH_MODE` | no | `internal` (default), `windows`, `ldap`, or `saml` |
| `CHERWELL_TIMEOUT_MS` | no | Per-request timeout in milliseconds, default `30000` |

The server exits with a descriptive error at startup if a required variable is missing.

## Usage

### Claude Code

```sh
claude mcp add cherwell \
  --env CHERWELL_BASE_URL=https://csm.example.com \
  --env CHERWELL_CLIENT_ID=<client-key> \
  --env CHERWELL_USERNAME=<user> \
  --env CHERWELL_PASSWORD=<password> \
  -- npx -y cherwell-mcp
```

### Claude Desktop / generic MCP client

```json
{
  "mcpServers": {
    "cherwell": {
      "command": "npx",
      "args": ["-y", "cherwell-mcp"],
      "env": {
        "CHERWELL_BASE_URL": "https://csm.example.com",
        "CHERWELL_CLIENT_ID": "<client-key>",
        "CHERWELL_USERNAME": "<user>",
        "CHERWELL_PASSWORD": "<password>"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
|---|---|
| `list_business_object_summaries` | Discover business objects and their IDs (`Major`, `Supporting`, `Lookup`, `Groups`, `All`) |
| `get_business_object_template` | Field schema of an object (names, IDs, required flags) |
| `get_business_object` | Read one record by record ID or public ID |
| `create_business_object` | Create a record from a `{fieldName: value}` map |
| `update_business_object` | Update selected fields of an existing record |
| `delete_business_object` | Permanently delete a record |
| `search_business_objects` | Filtered search with paging and field selection |

Everywhere a business object is expected, tools accept either its **name** (`Incident`) or its
32-character **busObId**. Fields are addressed by **name or display name**; the server resolves
them to Cherwell field IDs internally.

### Response size

Cherwell wraps every field in seven keys of metadata, so one raw Incident is ~110 KB — far more
than an LLM context can afford. The read tools therefore return a compact form by default: a flat
`{fieldName: value}` map alongside the record identifiers. Measured against a live instance:

| Call | Compact | Raw (`raw: true`) |
|---|---|---|
| `get_business_object` (one incident, ~400 fields) | 13.8 KB | 111 KB |
| `get_business_object` with `fields: ["IncidentID","Status","ShortDescription"]` | 260 B | — |
| `list_business_object_summaries` (141 objects) | 20 KB | 61 KB |
| `get_business_object_template` (Incident) | 35 KB | 93 KB |

Pass `fields` on `get_business_object` / `search_business_objects` to request only what you need,
and `raw: true` when you genuinely need Cherwell's original payload (field IDs, HTML, dirty flags).

### Example workflow

1. `list_business_object_summaries` → find `Incident`
2. `get_business_object_template` (`requiredOnly: true`) → see mandatory fields
3. `create_business_object` with `{"Description": "...", "Priority": "3", ...}`
4. `search_business_objects` with `[{"fieldName": "Status", "operator": "eq", "value": "New"}]`
5. `update_business_object` / `delete_business_object` by the returned `busObRecId`

## How it works

- Authenticates with the OAuth **password grant** against `POST /CherwellAPI/token`
  (`auth_mode` configurable). The token is cached and refreshed 10 minutes before expiry;
  a `401` triggers one automatic re-login + retry.
- Cherwell's in-band errors (HTTP 200 with `hasError: true`) are surfaced as tool errors.
- Templates are cached per business object, so repeated saves/searches don't re-fetch schemas.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Development

```sh
npm install
npm run build     # compile to dist/
npm start         # run the compiled server (needs CHERWELL_* env vars)
```

## Security notes

- Credentials live only in environment variables and are never included in tool output or logs.
- The account's Cherwell permissions bound what the tools can do — use a least-privilege account.
- `delete_business_object` is irreversible; grant it deliberately.

## License

MIT
