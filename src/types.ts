/**
 * planboard types.
 *
 * Thirty-four tools over the Beck REST API: identity,
 * workspaces and API tokens; etag-guarded documents; epics;
 * tasks and their comments; progress checks; and decisions.
 * Every tool answers with a single text payload — the upstream
 * JSON body pretty-printed on success, or a documented error
 * string on failure.
 */

/** The outcome of one tool call: result text plus error flag. */
export interface ToolOutcome {
  text: string;
  isError: boolean;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface PlanDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /**
   * Environment (BECK_API_URL, BECK_API_TOKEN, BECK_REPO,
   * BECK_BRANCH). Defaults to process.env.
   */
  env?: Record<string, string | undefined>;
  /**
   * Value sent as X-Beck-Run. Defaults to the per-process run
   * id generated once when the core module loads.
   */
  runId?: string;
}
