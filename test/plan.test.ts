import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { callTool, RUN_ID } from "../src/plan.js";
import type { FetchFn, PlanDeps } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch: no live
 * network, no live Beck API call.
 */

const TOKEN = "tok_test_123";
const BASE = "https://beck.example";

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

type Reply = { status?: number; body?: unknown };

function makeFetch(
  reply: Reply | ((call: Captured) => Reply),
  captured: Captured[] = [],
): FetchFn {
  return async (url, init) => {
    const call: Captured = { url, method: init?.method, headers: init?.headers, body: init?.body };
    captured.push(call);
    const r = typeof reply === "function" ? reply(call) : reply;
    const status = r.status ?? 200;
    const body = r.body ?? { ok: true };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
}

function deps(fetchFn: FetchFn, extra: Partial<PlanDeps> = {}): PlanDeps {
  return {
    fetchFn,
    env: { BECK_API_TOKEN: TOKEN, BECK_API_URL: BASE },
    runId: "run-fixed",
    ...extra,
  };
}

function bodyOf(call: Captured): Record<string, unknown> {
  return JSON.parse(call.body ?? "{}") as Record<string, unknown>;
}

function queryOf(call: Captured): URLSearchParams {
  return new URL(call.url).searchParams;
}

describe("missing token", () => {
  it("whoami returns the exact missing-token text and never fetches", async () => {
    const captured: Captured[] = [];
    const out = await callTool("whoami", {}, { fetchFn: makeFetch({}, captured), env: {} });
    assert.equal(out.isError, true);
    assert.equal(out.text, "BECK_API_TOKEN is not set");
    assert.equal(captured.length, 0);
  });

  it("a workspace tool returns the same text when the token is unset", async () => {
    const out = await callTool(
      "list_tasks",
      { workspaceId: "w1" },
      { fetchFn: makeFetch({}), env: { BECK_API_URL: BASE } },
    );
    assert.equal(out.isError, true);
    assert.equal(out.text, "BECK_API_TOKEN is not set");
  });
});

describe("headers", () => {
  it("sends Authorization and a stable per-process X-Beck-Run, no repo/branch by default", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    const d: PlanDeps = { fetchFn, env: { BECK_API_TOKEN: TOKEN, BECK_API_URL: BASE } };
    await callTool("whoami", {}, d);
    await callTool("list_workspaces", {}, d);
    assert.equal(captured.length, 2);
    for (const call of captured) {
      assert.equal(call.headers?.Authorization, `Bearer ${TOKEN}`);
      assert.equal(call.headers?.["X-Beck-Run"], RUN_ID);
      assert.ok((call.headers?.["X-Beck-Run"] ?? "").length >= 32);
      assert.equal(call.headers?.["X-Beck-Repo"], undefined);
      assert.equal(call.headers?.["X-Beck-Branch"], undefined);
    }
    assert.equal(captured[0].headers?.["X-Beck-Run"], captured[1].headers?.["X-Beck-Run"]);
  });

  it("sends X-Beck-Repo and X-Beck-Branch only when the env vars are set", async () => {
    const captured: Captured[] = [];
    const d = deps(makeFetch({}, captured));
    d.env = {
      BECK_API_TOKEN: TOKEN,
      BECK_API_URL: BASE,
      BECK_REPO: "octo/repo",
      BECK_BRANCH: "feat/x",
    };
    await callTool("whoami", {}, d);
    assert.equal(captured[0].headers?.["X-Beck-Repo"], "octo/repo");
    assert.equal(captured[0].headers?.["X-Beck-Branch"], "feat/x");
  });

  it("honours an injected run id", async () => {
    const captured: Captured[] = [];
    await callTool("whoami", {}, deps(makeFetch({}, captured)));
    assert.equal(captured[0].headers?.["X-Beck-Run"], "run-fixed");
  });

  it("never leaks the token into success or error text", async () => {
    const good = await callTool("whoami", {}, deps(makeFetch({ body: { id: "u1" } })));
    assert.ok(!good.text.includes(TOKEN));
    const bad = await callTool(
      "whoami",
      {},
      deps(makeFetch({ status: 500, body: { message: "boom" } })),
    );
    assert.ok(!bad.text.includes(TOKEN));
  });
});

describe("wires: identity, workspaces, tokens", () => {
  it("whoami GETs /api/v1/me on the default base and pretty-prints the JSON", async () => {
    const captured: Captured[] = [];
    const out = await callTool(
      "whoami",
      {},
      deps(makeFetch({ body: { id: "u1", name: "Rex" } }, captured), {
        env: { BECK_API_TOKEN: TOKEN },
      }),
    );
    assert.equal(out.isError, false);
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].url, "https://beck.bot/api/v1/me");
    assert.equal(out.text, JSON.stringify({ id: "u1", name: "Rex" }, null, 2));
  });

  it("a custom BECK_API_URL is used with any trailing slash trimmed", async () => {
    const captured: Captured[] = [];
    await callTool(
      "list_workspaces",
      {},
      deps(makeFetch({}, captured), {
        env: { BECK_API_TOKEN: TOKEN, BECK_API_URL: "https://beck.example/" },
      }),
    );
    assert.equal(captured[0].url, "https://beck.example/api/v1/workspaces");
    assert.equal(captured[0].method, "GET");
  });

  it("create_workspace POSTs {name} in the body", async () => {
    const captured: Captured[] = [];
    await callTool("create_workspace", { name: "Alpha" }, deps(makeFetch({}, captured)));
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].url, `${BASE}/api/v1/workspaces`);
    assert.deepEqual(bodyOf(captured[0]), { name: "Alpha" });
    assert.equal(captured[0].headers?.["Content-Type"], "application/json");
  });

  it("create_api_token POSTs {name}; revoke_api_token DELETEs by id", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool("create_api_token", { name: "ci" }, deps(fetchFn));
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].url, `${BASE}/api/v1/api-tokens`);
    assert.deepEqual(bodyOf(captured[0]), { name: "ci" });
    await callTool("revoke_api_token", { tokenId: "tok_9" }, deps(fetchFn));
    assert.equal(captured[1].method, "DELETE");
    assert.equal(captured[1].url, `${BASE}/api/v1/api-tokens/tok_9`);
    assert.equal(captured[1].body, undefined);
  });
});

describe("wires: documents", () => {
  it("list_documents GETs with workspaceId as a query parameter", async () => {
    const captured: Captured[] = [];
    await callTool("list_documents", { workspaceId: "w1" }, deps(makeFetch({}, captured)));
    assert.equal(captured[0].method, "GET");
    assert.equal(new URL(captured[0].url).pathname, "/api/v1/documents");
    assert.equal(queryOf(captured[0]).get("workspaceId"), "w1");
  });

  it("read_document GETs content with workspaceId and path query parameters", async () => {
    const captured: Captured[] = [];
    await callTool(
      "read_document",
      { workspaceId: "w1", path: "docs/a b.md" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(new URL(captured[0].url).pathname, "/api/v1/documents/content");
    assert.equal(queryOf(captured[0]).get("workspaceId"), "w1");
    assert.equal(queryOf(captured[0]).get("path"), "docs/a b.md");
  });

  it("create_document PUTs the body with no If-Match header", async () => {
    const captured: Captured[] = [];
    await callTool(
      "create_document",
      { workspaceId: "w1", path: "a.md", content: "hello" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].method, "PUT");
    assert.equal(captured[0].url, `${BASE}/api/v1/documents/content`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", path: "a.md", content: "hello" });
    assert.equal(captured[0].headers?.["If-Match"], undefined);
  });

  it("write_document PUTs with If-Match and keeps the etag out of the body", async () => {
    const captured: Captured[] = [];
    await callTool(
      "write_document",
      { workspaceId: "w1", path: "a.md", content: "v2", etag: "etag-7" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].method, "PUT");
    assert.equal(captured[0].headers?.["If-Match"], "etag-7");
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", path: "a.md", content: "v2" });
  });

  it("delete_document DELETEs with query parameters and If-Match, no body", async () => {
    const captured: Captured[] = [];
    await callTool(
      "delete_document",
      { workspaceId: "w1", path: "a.md", etag: "etag-7" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].method, "DELETE");
    assert.equal(new URL(captured[0].url).pathname, "/api/v1/documents/content");
    assert.equal(queryOf(captured[0]).get("workspaceId"), "w1");
    assert.equal(queryOf(captured[0]).get("path"), "a.md");
    assert.equal(captured[0].headers?.["If-Match"], "etag-7");
    assert.equal(captured[0].body, undefined);
  });

  it("list_document_versions GETs versions; restore_document POSTs the version", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool(
      "list_document_versions",
      { workspaceId: "w1", path: "a.md" },
      deps(fetchFn),
    );
    assert.equal(new URL(captured[0].url).pathname, "/api/v1/documents/versions");
    assert.equal(queryOf(captured[0]).get("path"), "a.md");
    await callTool(
      "restore_document",
      { workspaceId: "w1", path: "a.md", version: "v3" },
      deps(fetchFn),
    );
    assert.equal(captured[1].method, "POST");
    assert.equal(captured[1].url, `${BASE}/api/v1/documents/restore`);
    assert.deepEqual(bodyOf(captured[1]), { workspaceId: "w1", path: "a.md", version: "v3" });
  });
});

describe("wires: epics", () => {
  it("get_epic GETs by id with workspaceId query; plan_it POSTs the workspaceId", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool("get_epic", { workspaceId: "w1", epicId: "e5" }, deps(fetchFn));
    assert.equal(captured[0].url, `${BASE}/api/v1/epics/e5?workspaceId=w1`);
    await callTool("plan_it", { workspaceId: "w1" }, deps(fetchFn));
    assert.equal(captured[1].method, "POST");
    assert.equal(captured[1].url, `${BASE}/api/v1/epics/plan`);
    assert.deepEqual(bodyOf(captured[1]), { workspaceId: "w1" });
  });

  it("link_epic_github POSTs provided fields and omits unset ones", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool(
      "link_epic_github",
      { workspaceId: "w1", epicId: "e5", repo: "octo/repo", issueNumber: 42 },
      deps(fetchFn),
    );
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].url, `${BASE}/api/v1/epics/e5/github`);
    assert.deepEqual(bodyOf(captured[0]), {
      workspaceId: "w1",
      repo: "octo/repo",
      issueNumber: 42,
    });
    await callTool("link_epic_github", { workspaceId: "w1", epicId: "e5" }, deps(fetchFn));
    assert.deepEqual(bodyOf(captured[1]), { workspaceId: "w1" });
  });

  it("get_epic_github GETs the github subresource", async () => {
    const captured: Captured[] = [];
    await callTool(
      "get_epic_github",
      { workspaceId: "w1", epicId: "e5" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].url, `${BASE}/api/v1/epics/e5/github?workspaceId=w1`);
  });
});

describe("wires: tasks", () => {
  it("list_tasks with no filters sends only workspaceId", async () => {
    const captured: Captured[] = [];
    await callTool("list_tasks", { workspaceId: "w1" }, deps(makeFetch({}, captured)));
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks?workspaceId=w1`);
  });

  it("list_tasks sends every provided filter as a query parameter", async () => {
    const captured: Captured[] = [];
    await callTool(
      "list_tasks",
      { workspaceId: "w1", status: "open", epicId: "e5", assignee: "rex", icebox: true },
      deps(makeFetch({}, captured)),
    );
    const q = queryOf(captured[0]);
    assert.equal(q.get("workspaceId"), "w1");
    assert.equal(q.get("status"), "open");
    assert.equal(q.get("epicId"), "e5");
    assert.equal(q.get("assignee"), "rex");
    assert.equal(q.get("icebox"), "true");
  });

  it("get_task, get_task_context and recommend_task hit their GET wires", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool("get_task", { workspaceId: "w1", taskId: "t1" }, deps(fetchFn));
    await callTool("get_task_context", { workspaceId: "w1", taskId: "t1" }, deps(fetchFn));
    await callTool("recommend_task", { workspaceId: "w1" }, deps(fetchFn));
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1?workspaceId=w1`);
    assert.equal(captured[1].url, `${BASE}/api/v1/tasks/t1/context?workspaceId=w1`);
    assert.equal(captured[2].url, `${BASE}/api/v1/tasks/recommend?workspaceId=w1`);
  });

  it("start_task and accept_task POST only the workspaceId", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool("start_task", { workspaceId: "w1", taskId: "t1" }, deps(fetchFn));
    await callTool("accept_task", { workspaceId: "w1", taskId: "t1" }, deps(fetchFn));
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1/start`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1" });
    assert.equal(captured[1].url, `${BASE}/api/v1/tasks/t1/accept`);
    assert.deepEqual(bodyOf(captured[1]), { workspaceId: "w1" });
  });

  it("finish_task POSTs workspaceId and the progress report", async () => {
    const captured: Captured[] = [];
    const progress = { whatAttempted: "the thing", whatSucceeded: "most of it" };
    await callTool(
      "finish_task",
      { workspaceId: "w1", taskId: "t1", progress },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1/finish`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", progress });
  });

  it("reject_task POSTs workspaceId and the required reason", async () => {
    const captured: Captured[] = [];
    await callTool(
      "reject_task",
      { workspaceId: "w1", taskId: "t1", reason: "not ready" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1/reject`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", reason: "not ready" });
  });

  it("update_task PATCHes only the provided fields plus workspaceId", async () => {
    const captured: Captured[] = [];
    await callTool(
      "update_task",
      { workspaceId: "w1", taskId: "t1", title: "New title", points: 3 },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].method, "PATCH");
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", title: "New title", points: 3 });
  });

  it("update_task passes through every provided field", async () => {
    const captured: Captured[] = [];
    const args = {
      workspaceId: "w1",
      taskId: "t1",
      title: "T",
      type: "bug",
      points: 5,
      tags: ["a"],
      epicId: "e5",
      description: "D",
      blocked: true,
      criteria: ["c1"],
      files: ["f.ts"],
    };
    await callTool("update_task", args, deps(makeFetch({}, captured)));
    const { taskId: _taskId, ...expected } = args;
    assert.deepEqual(bodyOf(captured[0]), expected);
  });

  it("add_comment POSTs the comment body; list_comments GETs them", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool(
      "add_comment",
      { workspaceId: "w1", taskId: "t1", body: "looks good" },
      deps(fetchFn),
    );
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1/comments`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", body: "looks good" });
    await callTool("list_comments", { workspaceId: "w1", taskId: "t1" }, deps(fetchFn));
    assert.equal(captured[1].method, "GET");
    assert.equal(captured[1].url, `${BASE}/api/v1/tasks/t1/comments?workspaceId=w1`);
  });
});

describe("wires: progress and decisions", () => {
  it("log_progress POSTs checks, omitting the note when absent", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool(
      "log_progress",
      { workspaceId: "w1", taskId: "t1", checks: { passed: 4, total: 5 } },
      deps(fetchFn),
    );
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1/progress`);
    assert.deepEqual(bodyOf(captured[0]), {
      workspaceId: "w1",
      checks: { passed: 4, total: 5 },
    });
    await callTool(
      "log_progress",
      { workspaceId: "w1", taskId: "t1", note: "halfway", checks: { passed: 1, total: 2, label: "unit" } },
      deps(fetchFn),
    );
    assert.deepEqual(bodyOf(captured[1]), {
      workspaceId: "w1",
      note: "halfway",
      checks: { passed: 1, total: 2, label: "unit" },
    });
  });

  it("list_progress GETs the progress subresource", async () => {
    const captured: Captured[] = [];
    await callTool(
      "list_progress",
      { workspaceId: "w1", taskId: "t1" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].url, `${BASE}/api/v1/tasks/t1/progress?workspaceId=w1`);
  });

  it("list_decisions sends status and epicId filters only when present", async () => {
    const captured: Captured[] = [];
    const fetchFn = makeFetch({}, captured);
    await callTool("list_decisions", { workspaceId: "w1" }, deps(fetchFn));
    assert.equal(captured[0].url, `${BASE}/api/v1/decisions?workspaceId=w1`);
    await callTool(
      "list_decisions",
      { workspaceId: "w1", status: "open", epicId: "e5" },
      deps(fetchFn),
    );
    const q = queryOf(captured[1]);
    assert.equal(q.get("status"), "open");
    assert.equal(q.get("epicId"), "e5");
  });

  it("ask_decision POSTs question and default, omitting unset optionals", async () => {
    const captured: Captured[] = [];
    await callTool(
      "ask_decision",
      { workspaceId: "w1", question: "Ship it?", default: "yes" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].url, `${BASE}/api/v1/decisions`);
    assert.deepEqual(bodyOf(captured[0]), {
      workspaceId: "w1",
      question: "Ship it?",
      default: "yes",
    });
  });
});

describe("answer_decision XOR validation", () => {
  const TEXT = "answer_decision requires exactly one of answer or keepDefault";

  it("rejects neither answer nor keepDefault, without fetching", async () => {
    const captured: Captured[] = [];
    const out = await callTool(
      "answer_decision",
      { workspaceId: "w1", decisionId: "d1" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(out.isError, true);
    assert.equal(out.text, TEXT);
    assert.equal(captured.length, 0);
  });

  it("rejects both answer and keepDefault, without fetching", async () => {
    const captured: Captured[] = [];
    const out = await callTool(
      "answer_decision",
      { workspaceId: "w1", decisionId: "d1", answer: "go", keepDefault: true },
      deps(makeFetch({}, captured)),
    );
    assert.equal(out.isError, true);
    assert.equal(out.text, TEXT);
    assert.equal(captured.length, 0);
  });

  it("rejects keepDefault: false on its own", async () => {
    const out = await callTool(
      "answer_decision",
      { workspaceId: "w1", decisionId: "d1", keepDefault: false },
      deps(makeFetch({})),
    );
    assert.equal(out.isError, true);
    assert.equal(out.text, TEXT);
  });

  it("posts the answer when only answer is given", async () => {
    const captured: Captured[] = [];
    const out = await callTool(
      "answer_decision",
      { workspaceId: "w1", decisionId: "d1", answer: "go" },
      deps(makeFetch({}, captured)),
    );
    assert.equal(out.isError, false);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].url, `${BASE}/api/v1/decisions/d1/answer`);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", answer: "go" });
  });

  it("posts keepDefault when only keepDefault is given", async () => {
    const captured: Captured[] = [];
    const out = await callTool(
      "answer_decision",
      { workspaceId: "w1", decisionId: "d1", keepDefault: true },
      deps(makeFetch({}, captured)),
    );
    assert.equal(out.isError, false);
    assert.deepEqual(bodyOf(captured[0]), { workspaceId: "w1", keepDefault: true });
  });
});

describe("upstream error mapping", () => {
  it("appends the body's message string", async () => {
    const out = await callTool(
      "whoami",
      {},
      deps(makeFetch({ status: 404, body: { message: "no such user" } })),
    );
    assert.equal(out.isError, true);
    assert.equal(out.text, "upstream error: HTTP 404 from beck-api: no such user");
  });

  it("appends the body's error string when there is no message", async () => {
    const out = await callTool(
      "whoami",
      {},
      deps(makeFetch({ status: 403, body: { error: "forbidden" } })),
    );
    assert.equal(out.text, "upstream error: HTTP 403 from beck-api: forbidden");
  });

  it("omits the suffix when the body carries no message", async () => {
    const out = await callTool(
      "whoami",
      {},
      deps(makeFetch({ status: 500, body: { detail: "opaque" } })),
    );
    assert.equal(out.text, "upstream error: HTTP 500 from beck-api");
  });

  it("omits the suffix for a non-JSON error body", async () => {
    const out = await callTool(
      "whoami",
      {},
      deps(makeFetch({ status: 502, body: "bad gateway" })),
    );
    assert.equal(out.text, "upstream error: HTTP 502 from beck-api");
  });

  it("maps a thrown fetch to upstream unreachable", async () => {
    const throwing: FetchFn = async () => {
      throw new Error("socket hangup");
    };
    const out = await callTool("whoami", {}, deps(throwing));
    assert.equal(out.isError, true);
    assert.equal(out.text, "upstream unreachable: beck-api");
  });
});
