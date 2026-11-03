# planboard

A small client for the Beck agent plan board. Beck keeps the
shared state an agent team works from — workspaces, planning
documents, epics, tasks, progress checks and open decisions —
behind a REST API, and planboard exposes that API as 34 MCP
tools plus a matching command line, so an agent (or a human
at a terminal) can read the board, move tasks along, guard
document edits with etags, and answer the decisions that
block work.

## What it covers

- **Identity and workspaces** — `whoami`, `list_workspaces`,
  `create_workspace`.
- **API tokens** — `list_api_tokens`, `create_api_token`,
  `revoke_api_token`.
- **Documents** — `list_documents`, `read_document`,
  `create_document`, `write_document`, `delete_document`,
  `list_document_versions`, `restore_document`. Writes and
  deletes are guarded by the document's etag, sent as an
  `If-Match` header, so a stale editor cannot silently
  overwrite someone else's revision.
- **Epics** — `list_epics`, `get_epic`, `plan_it`,
  `get_epic_github`, `link_epic_github`.
- **Tasks** — `list_tasks` (filterable by status, epic,
  assignee and icebox), `get_task`, `get_task_context`,
  `recommend_task`, `start_task`, `finish_task` (with a
  what-was-attempted report), `accept_task`, `reject_task`
  (a reason is required), `update_task` (only the fields you
  provide are sent), `add_comment`, `list_comments`.
- **Progress** — `log_progress` (passed/total checks with an
  optional note and label) and `list_progress`.
- **Decisions** — `list_decisions` (filterable by `open` /
  `answered` status and epic), `ask_decision` (every question
  carries a default answer), and `answer_decision`, which
  accepts exactly one of an explicit answer or
  `keepDefault: true`.

Workspace scoping is explicit everywhere: every
workspace-scoped tool takes a required `workspaceId`, sent as
a query parameter on reads and deletes and inside the JSON
body on writes.

## Configuration

```bash
export BECK_API_TOKEN="..."          # required
export BECK_API_URL="https://beck.bot"   # optional override
export BECK_REPO="owner/repo"        # optional, sent as X-Beck-Repo
export BECK_BRANCH="main"            # optional, sent as X-Beck-Branch
```

Without `BECK_API_TOKEN`, every tool returns the error text
`BECK_API_TOKEN is not set` and no request is made. Each
process also generates one random run id, sent as
`X-Beck-Run` on every request, so the server can group the
calls a single agent run makes. The token itself never
appears in any tool output.

Successful calls return the upstream JSON body,
pretty-printed. A non-2xx response becomes an error result
of the form `upstream error: HTTP <status> from beck-api`,
with `: <message>` appended when the response body carries a
`message` or `error` string; a request that never completes
becomes `upstream unreachable: beck-api`.

## CLI

Each tool is a subcommand taking one JSON argument string:

```bash
npx @reneturcios/planboard whoami '{}'
npx @reneturcios/planboard list_tasks '{"workspaceId":"w1","status":"open"}'
npx @reneturcios/planboard write_document '{"workspaceId":"w1","path":"plan.md","content":"...","etag":"etag-7"}'
npx @reneturcios/planboard answer_decision '{"workspaceId":"w1","decisionId":"d1","keepDefault":true}'
npx @reneturcios/planboard --version
```

Output is the same text the MCP tool returns. Exit codes:
`0` on success, `1` when the tool result is an error, `2` on
a usage error.

## MCP server

```bash
npx -y @reneturcios/planboard mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "planboard": {
      "command": "npx",
      "args": ["-y", "@reneturcios/planboard", "mcp"],
      "env": {
        "BECK_API_TOKEN": "..."
      }
    }
  }
}
```

## Docker

```bash
docker run -i -e BECK_API_TOKEN="..." ghcr.io/cloudcorprecords/planboard
docker run --rm -e BECK_API_TOKEN="..." ghcr.io/cloudcorprecords/planboard list_epics '{"workspaceId":"w1"}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch only, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
