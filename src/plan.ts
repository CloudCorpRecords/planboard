/**
 * planboard core: a REST client for the Beck agent plan board.
 *
 * All paths live under `<BECK_API_URL>/api/v1` (the base URL
 * defaults to https://beck.bot). Every request carries
 * `Authorization: Bearer <BECK_API_TOKEN>` and a per-process
 * `X-Beck-Run` id, plus `X-Beck-Repo` / `X-Beck-Branch` when
 * the matching environment variables are set. Workspace
 * scoping is always explicit: `workspaceId` travels as a query
 * parameter on GET/DELETE and inside the JSON body on
 * POST/PUT/PATCH. Document writes and deletes are guarded by
 * an etag sent as `If-Match`.
 *
 * Failures are values, not exceptions: a missing token, an
 * unreachable upstream, and a non-2xx upstream response each
 * produce an isError outcome carrying the documented text.
 */
import { randomUUID } from "node:crypto";
import type { FetchFn, PlanDeps, ToolOutcome } from "./types.js";

export const VERSION = "0.1.0";

/** One random UUID per process, sent as X-Beck-Run. */
export const RUN_ID = randomUUID();

const DEFAULT_BASE_URL = "https://beck.bot";

const TOOL_NAMES = [
  "whoami",
  "list_workspaces",
  "create_workspace",
  "list_api_tokens",
  "create_api_token",
  "revoke_api_token",
  "list_documents",
  "read_document",
  "create_document",
  "write_document",
  "delete_document",
  "list_document_versions",
  "restore_document",
  "list_epics",
  "get_epic",
  "plan_it",
  "get_epic_github",
  "link_epic_github",
  "list_tasks",
  "get_task",
  "get_task_context",
  "recommend_task",
  "start_task",
  "finish_task",
  "accept_task",
  "reject_task",
  "update_task",
  "add_comment",
  "list_comments",
  "log_progress",
  "list_progress",
  "list_decisions",
  "ask_decision",
  "answer_decision",
] as const;

export const PLAN_TOOL_NAMES: readonly string[] = TOOL_NAMES;

type Args = Record<string, unknown>;

function ok(text: string): ToolOutcome {
  return { text, isError: false };
}

function err(text: string): ToolOutcome {
  return { text, isError: true };
}

const defaultFetch: FetchFn = (url, init) => fetch(url, init);

/** Copy only the keys whose value is not undefined. */
function pick(source: Args, keys: string[]): Args {
  const out: Args = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

interface RequestSpec {
  method: string;
  path: string;
  query?: Args;
  body?: Args;
  etag?: string;
}

async function request(deps: PlanDeps, spec: RequestSpec): Promise<ToolOutcome> {
  const env = deps.env ?? process.env;
  const token = env.BECK_API_TOKEN;
  if (!token) return err("BECK_API_TOKEN is not set");

  const base = (env.BECK_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  let url = base + spec.path;
  if (spec.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(spec.query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Beck-Run": deps.runId ?? RUN_ID,
  };
  if (env.BECK_REPO) headers["X-Beck-Repo"] = env.BECK_REPO;
  if (env.BECK_BRANCH) headers["X-Beck-Branch"] = env.BECK_BRANCH;
  if (spec.etag !== undefined) headers["If-Match"] = spec.etag;
  let body: string | undefined;
  if (spec.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(spec.body);
  }

  const fetchFn = deps.fetchFn ?? defaultFetch;
  let status: number;
  let raw: string;
  try {
    const res = await fetchFn(url, { method: spec.method, headers, body });
    status = res.status;
    raw = await res.text();
  } catch {
    return err("upstream unreachable: beck-api");
  }

  let parsed: unknown;
  let hasJson = false;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
      hasJson = true;
    } catch {
      hasJson = false;
    }
  }

  if (status < 200 || status >= 300) {
    let message: string | undefined;
    if (hasJson && typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.message === "string") message = record.message;
      else if (typeof record.error === "string") message = record.error;
    }
    const baseText = `upstream error: HTTP ${status} from beck-api`;
    return err(message ? `${baseText}: ${message}` : baseText);
  }

  if (hasJson) return ok(JSON.stringify(parsed, null, 2));
  return ok(raw);
}

function seg(value: unknown): string {
  return encodeURIComponent(String(value));
}

/**
 * Dispatch one tool call by name. Unknown names produce an
 * isError outcome; the MCP layer maps those to a protocol
 * error before ever reaching this function.
 */
export async function callTool(
  name: string,
  args: Args,
  deps: PlanDeps = {},
): Promise<ToolOutcome> {
  const env = deps.env ?? process.env;
  if (!env.BECK_API_TOKEN) return err("BECK_API_TOKEN is not set");

  const ws = args.workspaceId;
  switch (name) {
    case "whoami":
      return request(deps, { method: "GET", path: "/api/v1/me" });
    case "list_workspaces":
      return request(deps, { method: "GET", path: "/api/v1/workspaces" });
    case "create_workspace":
      return request(deps, {
        method: "POST",
        path: "/api/v1/workspaces",
        body: pick(args, ["name"]),
      });
    case "list_api_tokens":
      return request(deps, { method: "GET", path: "/api/v1/api-tokens" });
    case "create_api_token":
      return request(deps, {
        method: "POST",
        path: "/api/v1/api-tokens",
        body: pick(args, ["name"]),
      });
    case "revoke_api_token":
      return request(deps, {
        method: "DELETE",
        path: `/api/v1/api-tokens/${seg(args.tokenId)}`,
      });

    case "list_documents":
      return request(deps, {
        method: "GET",
        path: "/api/v1/documents",
        query: { workspaceId: ws },
      });
    case "read_document":
      return request(deps, {
        method: "GET",
        path: "/api/v1/documents/content",
        query: { workspaceId: ws, path: args.path },
      });
    case "create_document":
      return request(deps, {
        method: "PUT",
        path: "/api/v1/documents/content",
        body: pick(args, ["workspaceId", "path", "content"]),
      });
    case "write_document":
      return request(deps, {
        method: "PUT",
        path: "/api/v1/documents/content",
        body: pick(args, ["workspaceId", "path", "content"]),
        etag: String(args.etag),
      });
    case "delete_document":
      return request(deps, {
        method: "DELETE",
        path: "/api/v1/documents/content",
        query: { workspaceId: ws, path: args.path },
        etag: String(args.etag),
      });
    case "list_document_versions":
      return request(deps, {
        method: "GET",
        path: "/api/v1/documents/versions",
        query: { workspaceId: ws, path: args.path },
      });
    case "restore_document":
      return request(deps, {
        method: "POST",
        path: "/api/v1/documents/restore",
        body: pick(args, ["workspaceId", "path", "version"]),
      });

    case "list_epics":
      return request(deps, {
        method: "GET",
        path: "/api/v1/epics",
        query: { workspaceId: ws },
      });
    case "get_epic":
      return request(deps, {
        method: "GET",
        path: `/api/v1/epics/${seg(args.epicId)}`,
        query: { workspaceId: ws },
      });
    case "plan_it":
      return request(deps, {
        method: "POST",
        path: "/api/v1/epics/plan",
        body: { workspaceId: ws },
      });
    case "get_epic_github":
      return request(deps, {
        method: "GET",
        path: `/api/v1/epics/${seg(args.epicId)}/github`,
        query: { workspaceId: ws },
      });
    case "link_epic_github":
      return request(deps, {
        method: "POST",
        path: `/api/v1/epics/${seg(args.epicId)}/github`,
        body: pick(args, ["workspaceId", "repo", "issueNumber"]),
      });

    case "list_tasks":
      return request(deps, {
        method: "GET",
        path: "/api/v1/tasks",
        query: pick(args, ["workspaceId", "status", "epicId", "assignee", "icebox"]),
      });
    case "get_task":
      return request(deps, {
        method: "GET",
        path: `/api/v1/tasks/${seg(args.taskId)}`,
        query: { workspaceId: ws },
      });
    case "get_task_context":
      return request(deps, {
        method: "GET",
        path: `/api/v1/tasks/${seg(args.taskId)}/context`,
        query: { workspaceId: ws },
      });
    case "recommend_task":
      return request(deps, {
        method: "GET",
        path: "/api/v1/tasks/recommend",
        query: { workspaceId: ws },
      });
    case "start_task":
      return request(deps, {
        method: "POST",
        path: `/api/v1/tasks/${seg(args.taskId)}/start`,
        body: { workspaceId: ws },
      });
    case "finish_task":
      return request(deps, {
        method: "POST",
        path: `/api/v1/tasks/${seg(args.taskId)}/finish`,
        body: pick(args, ["workspaceId", "progress"]),
      });
    case "accept_task":
      return request(deps, {
        method: "POST",
        path: `/api/v1/tasks/${seg(args.taskId)}/accept`,
        body: { workspaceId: ws },
      });
    case "reject_task":
      return request(deps, {
        method: "POST",
        path: `/api/v1/tasks/${seg(args.taskId)}/reject`,
        body: pick(args, ["workspaceId", "reason"]),
      });
    case "update_task":
      return request(deps, {
        method: "PATCH",
        path: `/api/v1/tasks/${seg(args.taskId)}`,
        body: pick(args, [
          "workspaceId",
          "title",
          "type",
          "points",
          "tags",
          "epicId",
          "description",
          "blocked",
          "criteria",
          "files",
        ]),
      });
    case "add_comment":
      return request(deps, {
        method: "POST",
        path: `/api/v1/tasks/${seg(args.taskId)}/comments`,
        body: pick(args, ["workspaceId", "body"]),
      });
    case "list_comments":
      return request(deps, {
        method: "GET",
        path: `/api/v1/tasks/${seg(args.taskId)}/comments`,
        query: { workspaceId: ws },
      });

    case "log_progress":
      return request(deps, {
        method: "POST",
        path: `/api/v1/tasks/${seg(args.taskId)}/progress`,
        body: pick(args, ["workspaceId", "note", "checks"]),
      });
    case "list_progress":
      return request(deps, {
        method: "GET",
        path: `/api/v1/tasks/${seg(args.taskId)}/progress`,
        query: { workspaceId: ws },
      });

    case "list_decisions":
      return request(deps, {
        method: "GET",
        path: "/api/v1/decisions",
        query: pick(args, ["workspaceId", "status", "epicId"]),
      });
    case "ask_decision":
      return request(deps, {
        method: "POST",
        path: "/api/v1/decisions",
        body: pick(args, [
          "workspaceId",
          "question",
          "default",
          "costly",
          "blocking",
          "epicId",
        ]),
      });
    case "answer_decision": {
      const hasAnswer = args.answer !== undefined;
      const hasKeep = args.keepDefault === true;
      if (hasAnswer === hasKeep) {
        return err("answer_decision requires exactly one of answer or keepDefault");
      }
      return request(deps, {
        method: "POST",
        path: `/api/v1/decisions/${seg(args.decisionId)}/answer`,
        body: hasAnswer
          ? { workspaceId: ws, answer: args.answer }
          : { workspaceId: ws, keepDefault: true },
      });
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
