#!/usr/bin/env node
/**
 * planboard CLI.
 *
 *   planboard whoami '{}'                 (and the other 33
 *   planboard list_tasks '<json>'          tool names likewise)
 *   planboard mcp
 *   planboard --version
 *
 * Each tool subcommand takes one JSON argument string with the
 * tool's arguments and prints the same text the MCP tool
 * returns. Exit codes: 0 success, 1 when the tool result is
 * an error, 2 usage error.
 */
import { callTool, PLAN_TOOL_NAMES, VERSION } from "./plan.js";

function usage(): never {
  console.error(`Usage:
  planboard <tool> '<json-args>'     one of: ${PLAN_TOOL_NAMES.join(", ")}
  planboard mcp
  planboard --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!PLAN_TOOL_NAMES.includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  const out = await callTool(cmd, args);
  console.log(out.text);
  if (out.isError) process.exit(1);
}

void main();
