# planboard — Build Report (Batch 21)

Rebuild of the Beck agent plan board MCP server (npm
`@becklabs/beck-mcp-server`) from the firsthand spec in
`specs-batch21/planboard.md`, as a labelled subset of 34
tools. Built 2026-10-27.

## Identity

- npm: `@reneturcios/planboard` @ 0.1.0, bin `planboard` →
  `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/planboard`
  (matches `package.json` `mcpName`, `server.json` `name`,
  and the Dockerfile `io.modelcontextprotocol.server.name`
  label)
- server.json description (93 chars, verified):
  "Beck agent plan board: workspaces, documents, epics,
  tasks, decisions and progress over REST."
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/planboard:0.1.0`) carries
  **no** `version` field (verified from disk).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/swissreg/tsconfig.json, verified
with `cmp`), .gitignore, package-lock.json, README.md
(fresh prose), LICENSE (MIT, © 2026 Rene Turcios),
CHANGELOG.md (single 0.1.0 entry dated 2026-10-27),
src/index.ts, src/cli.ts, src/mcp.ts, src/types.ts,
src/plan.ts (core), test/plan.test.ts, and the four
workflows under .github/workflows/ (publish-container
adapted: IMAGE ghcr.io/cloudcorprecords/planboard, smoke
assertion on server name `planboard`). Plus this
BUILD-REPORT.md: 20 authored files in total.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`, handlers
  for `ListToolsRequestSchema` / `CallToolRequestSchema`),
  explicit JSON-schema literals for all 34 tools; no
  McpServer/zod registration, so no `$schema` /
  `additionalProperties` keys leak into tools/list.
  Unknown tool names get a protocol `MethodNotFound` error.
- `src/plan.ts`: one REST dispatcher building every wire
  under `<BECK_API_URL>/api/v1` (base default
  `https://beck.bot`, trailing slash trimmed). Headers on
  every request: `Authorization: Bearer <BECK_API_TOKEN>`,
  `X-Beck-Run` (one `randomUUID()` per process, injectable
  for tests), `X-Beck-Repo` / `X-Beck-Branch` only when the
  env vars are set. A missing token short-circuits every
  tool with the exact text `BECK_API_TOKEN is not set`
  before any fetch, and the token never appears in output.
  `workspaceId` is a query parameter on GET/DELETE and a
  JSON body field on POST/PUT/PATCH; path parameters are
  URI-encoded. Document write/delete send the etag as
  `If-Match` (the etag is never duplicated into the body);
  create sends no etag. `update_task` PATCHes only the
  provided fields; optional fields on `link_epic_github`,
  `log_progress` and `ask_decision` are likewise omitted
  when unset. `answer_decision` validates locally: exactly
  one of `answer` / `keepDefault: true`, otherwise the
  exact text `answer_decision requires exactly one of
  answer or keepDefault`, with no request made. Success is
  the upstream JSON pretty-printed with 2-space indent;
  non-2xx maps to `upstream error: HTTP <status> from
  beck-api` plus `: <message>` when the body carries a
  `message` or `error` string; a thrown fetch maps to
  `upstream unreachable: beck-api`. Failures are returned
  as isError outcomes, not thrown.
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version`; unknown subcommand → usage
  on stderr, exit 2; isError results print their text and
  exit 1 (verified: `whoami` with no token prints
  `BECK_API_TOKEN is not set`, exit 1).

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. `npx tsc --noEmit`:
  exit 0.
- `npm test`: **42 tests, 42 pass, 0 fail** — fake fetch
  only, no network. Covers the missing-token text (plain
  and workspace tools, no fetch made), the header set
  (Authorization, X-Beck-Run stable within a process and
  equal to the exported per-process id, repo/branch only
  when env set, injected run id, token absent from
  output), one wire per verb class (GET with query
  parameters, POST bodies, PUT with and without
  `If-Match`, DELETE with query + `If-Match`, PATCH
  partial-field body), `update_task` full-field
  pass-through, `list_tasks` filter query construction
  (including `icebox=true`), `list_decisions` filters,
  the `answer_decision` XOR (neither / both /
  `keepDefault: false` rejected without fetching; answer
  and keepDefault happy paths), and upstream error
  mapping with a `message` body, with an `error` body,
  with neither, with a non-JSON body, and on a thrown
  fetch.
- `node dist/cli.js --version`: `0.1.0`; unknown command:
  usage on stderr, exit 2.
- Parity: `python3 harness/parity.py --original
  harness/fixtures/beck-mcp-server-tools-original.json
  --rebuild "stdio:node builds/planboard/dist/cli.js mcp"
  --out builds/planboard/parity-out` →
  **verdict=PASS parity_pct=100.0, 34/34 tools, no schema
  diffs**.
- Lockfile: Route 3 only — clean temp dir containing
  package.json alone, `npm install --package-lock-only
  --ignore-scripts --offline`; parses, name
  `@reneturcios/planboard`, **128 package entries**.
  Dependencies installed in the build dir with
  `npm install --offline --ignore-scripts` (exit 0, no
  proxy fallback needed).

## Gaps / omissions (labelled subset, from the spec verbatim)

- OMITTED tools (7), wire not pinned by the readable source: `resume`, `record_plan`,
  `create_epic`, `create_tasks`, `bind_workspace`, `set_relevant_files`,
  `import_suggested_tasks`. The parity fixture lists these in its `_source` omissions.
- Deviation: because `bind_workspace` is omitted, `workspaceId` is a required argument on
  every workspace-scoped tool in the rebuild; the original can bind a workspace per session.
- `restore_document` endpoint shape and `add_comment`'s `body` field name are documented
  reconstructions, labelled above. (In the spec: the `restore_document` wire —
  `POST /api/v1/documents/restore` — is a reconstruction; the README names the
  operation and the `version` argument but not the endpoint shape. The
  `add_comment` `body` field name is a reconstruction; the README names the
  operation and that it takes the comment text.)
- No live Beck API call was made from the VM; all behaviour is verified against fake fetch.
- No push, no publish.
