/**
 * planboard MCP server: 34 tools over the Beck REST API.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core builds every REST wire
 * itself.
 *
 * Tool results are a single text item: the upstream JSON
 * body pretty-printed on success, or a documented error
 * string in an isError result on failure.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, PLAN_TOOL_NAMES, VERSION } from "./plan.js";

const WS_PROP = {
  type: "string",
  description: "The workspace id.",
} as const;

const PATH_PROP = {
  type: "string",
  description: "The document path.",
} as const;

const CONTENT_PROP = {
  type: "string",
  description: "The document content.",
} as const;

const ETAG_PROP = {
  type: "string",
  description: "The document's current etag.",
} as const;

const EPIC_PROP = {
  type: "string",
  description: "The epic id.",
} as const;

const TASK_PROP = {
  type: "string",
  description: "The task id.",
} as const;

const NAME_PROP = {
  type: "string",
  description: "The workspace name.",
} as const;

const TOOLS = [
  {
    name: "whoami",
    description: "Who the API token belongs to.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_workspaces",
    description: "List the workspaces the token can access.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "create_workspace",
    description: "Create a new workspace in the Beck account for organizing epics and tasks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: NAME_PROP,
      },
      required: ["name"],
    },
  },
  {
    name: "list_api_tokens",
    description: "List the API tokens issued for the authenticated Beck account.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "create_api_token",
    description: "Create an API token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The token name.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "revoke_api_token",
    description: "Revoke an API token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tokenId: {
          type: "string",
          description: "The token id.",
        },
      },
      required: ["tokenId"],
    },
  },
  {
    name: "list_documents",
    description: "List documents in the workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: WS_PROP,
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "read_document",
    description: "Read one document's content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: PATH_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "path"],
    },
  },
  {
    name: "create_document",
    description: "Create a document (no etag).",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: CONTENT_PROP,
        path: PATH_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "path", "content"],
    },
  },
  {
    name: "write_document",
    description: "Write a document, guarded by its etag (sent as If-Match).",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: CONTENT_PROP,
        etag: ETAG_PROP,
        path: PATH_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "path", "content", "etag"],
    },
  },
  {
    name: "delete_document",
    description: "Delete a document, guarded by its etag (sent as If-Match).",
    inputSchema: {
      type: "object" as const,
      properties: {
        etag: ETAG_PROP,
        path: PATH_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "path", "etag"],
    },
  },
  {
    name: "list_document_versions",
    description: "List a document's versions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: PATH_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "path"],
    },
  },
  {
    name: "restore_document",
    description: "Restore a document to a previous version.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: PATH_PROP,
        version: {
          type: "string",
          description: "The version to restore.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "path", "version"],
    },
  },
  {
    name: "list_epics",
    description: "List epics in the workspace.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: WS_PROP,
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_epic",
    description: "Get one epic by its ID, with its tasks and current status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        epicId: EPIC_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "epicId"],
    },
  },
  {
    name: "plan_it",
    description: "Plan the workspace's next epic.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: WS_PROP,
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_epic_github",
    description: "Get an epic's linked GitHub issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        epicId: EPIC_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "epicId"],
    },
  },
  {
    name: "link_epic_github",
    description: "Link an epic to a GitHub issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        epicId: EPIC_PROP,
        issueNumber: {
          type: "number",
          description: "The GitHub issue number.",
        },
        repo: {
          type: "string",
          description: "The GitHub repository.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "epicId"],
    },
  },
  {
    name: "list_tasks",
    description: "List tasks, with optional status / epicId / assignee / icebox filters.",
    inputSchema: {
      type: "object" as const,
      properties: {
        assignee: {
          type: "string",
          description: "Filter by assignee.",
        },
        epicId: {
          type: "string",
          description: "Filter by epic.",
        },
        icebox: {
          type: "boolean",
          description: "Filter by icebox state.",
        },
        status: {
          type: "string",
          description: "Filter by status.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "get_task",
    description: "Get one task by its ID, with its details and current status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "get_task_context",
    description: "Get a task with its full context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "recommend_task",
    description: "Recommend the next task to work on.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workspaceId: WS_PROP,
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "start_task",
    description: "Start a task, moving it into the in-progress state.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "finish_task",
    description: "Finish a task, reporting what was attempted.",
    inputSchema: {
      type: "object" as const,
      properties: {
        progress: {
          type: "object",
          description: "The finish report.",
          properties: {
            questions: {
              type: "string",
              description: "Open questions.",
            },
            whatAttempted: {
              type: "string",
              description: "What was attempted.",
            },
            whatFailed: {
              type: "string",
              description: "What failed.",
            },
            whatSucceeded: {
              type: "string",
              description: "What succeeded.",
            },
          },
          required: ["whatAttempted"],
        },
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId", "progress"],
    },
  },
  {
    name: "accept_task",
    description: "Accept a finished task.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "reject_task",
    description: "Reject a task; a reason is required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why the task is rejected.",
        },
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId", "reason"],
    },
  },
  {
    name: "update_task",
    description: "Update a task's fields; only provided fields are sent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blocked: {
          type: "boolean",
          description: "Blocked state.",
        },
        criteria: {
          type: "array",
          items: { type: "string" },
          description: "Acceptance criteria.",
        },
        description: {
          type: "string",
          description: "The task description.",
        },
        epicId: {
          type: "string",
          description: "The epic the task belongs to.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Relevant files.",
        },
        points: {
          type: "number",
          description: "Story points.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags.",
        },
        taskId: TASK_PROP,
        title: {
          type: "string",
          description: "The task title.",
        },
        type: {
          type: "string",
          description: "The task type.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a task.",
    inputSchema: {
      type: "object" as const,
      properties: {
        body: {
          type: "string",
          description: "The comment text.",
        },
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId", "body"],
    },
  },
  {
    name: "list_comments",
    description: "List a task's comments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "log_progress",
    description: "Log progress checks against a task.",
    inputSchema: {
      type: "object" as const,
      properties: {
        checks: {
          type: "object",
          description: "The check results.",
          properties: {
            label: {
              type: "string",
              description: "What the checks cover.",
            },
            passed: {
              type: "number",
              description: "Checks passed.",
            },
            total: {
              type: "number",
              description: "Checks total.",
            },
          },
          required: ["passed", "total"],
        },
        note: {
          type: "string",
          description: "A progress note.",
        },
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId", "checks"],
    },
  },
  {
    name: "list_progress",
    description: "List a task's progress entries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: TASK_PROP,
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "taskId"],
    },
  },
  {
    name: "list_decisions",
    description: "List decisions, optionally filtered by status (open|answered) or epic.",
    inputSchema: {
      type: "object" as const,
      properties: {
        epicId: {
          type: "string",
          description: "Filter by epic.",
        },
        status: {
          type: "string",
          enum: ["open", "answered"],
          description: "Decision status.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId"],
    },
  },
  {
    name: "ask_decision",
    description: "Ask a decision, with a default answer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        blocking: {
          type: "boolean",
          description: "Whether the decision blocks work.",
        },
        costly: {
          type: "boolean",
          description: "Whether the decision is costly to reverse.",
        },
        default: {
          type: "string",
          description: "The default answer if nobody decides.",
        },
        epicId: {
          type: "string",
          description: "The related epic.",
        },
        question: {
          type: "string",
          description: "The question to decide.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "question", "default"],
    },
  },
  {
    name: "answer_decision",
    description: "Answer a decision, or keep its default (exactly one of answer / keepDefault).",
    inputSchema: {
      type: "object" as const,
      properties: {
        answer: {
          type: "string",
          description: "The answer. Mutually exclusive with keepDefault.",
        },
        decisionId: {
          type: "string",
          description: "The decision id.",
        },
        keepDefault: {
          type: "boolean",
          description: "Keep the decision's default answer. Mutually exclusive with answer.",
        },
        workspaceId: WS_PROP,
      },
      required: ["workspaceId", "decisionId"],
    },
  },
];

const server = new Server(
  { name: "planboard", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!PLAN_TOOL_NAMES.includes(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  const a = (args ?? {}) as Record<string, unknown>;
  const out = await callTool(name, a);
  return {
    content: [{ type: "text" as const, text: out.text }],
    ...(out.isError ? { isError: true } : {}),
  };
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
