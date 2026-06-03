/**
 * RAIClient — framework-agnostic HTTP + SSE client for the RAI server.
 *
 * Works in browsers (fetch + ReadableStream) and Node 18+ (fetch built-in).
 * No dependencies beyond the TypeScript standard lib.
 */

import { parseSSEChunk, coerceEvent, RAIEvent, RawSSEFrame } from "./events.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Header resolver — called fresh before EVERY request (REST + SSE).
 * Return a plain object or a Promise — async is fully supported.
 *
 * Use this for:
 *   - JWT tokens read from localStorage / cookies
 *   - MFA tokens / OTP headers
 *   - Rotating credentials (refresh before they expire)
 *   - Multi-tenant headers (org_id, workspace_id)
 *   - Per-request signatures / HMAC
 *
 * @example
 * getHeaders: () => ({
 *   Authorization: `Bearer ${localStorage.getItem("jwt")}`,
 *   "X-MFA-Token": sessionStorage.getItem("mfa_token") ?? "",
 *   "X-Org-Id": store.getState().org.id,
 * })
 *
 * @example — async token refresh
 * getHeaders: async () => {
 *   const token = await authClient.getValidToken(); // refreshes silently if expired
 *   return { Authorization: `Bearer ${token}` };
 * }
 */
export type HeadersResolver =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

export interface RAIClientConfig {
  /** Base URL of the RAI server, e.g. "http://localhost:8000". Empty = same-origin (Vite proxy). */
  baseUrl?: string;
  /**
   * Simple API key — sent as X-API-Key header.
   * For JWT / MFA / rotating tokens use getHeaders instead.
   */
  apiKey?: string;
  /** Default agent name (default: "rai") */
  agent?: string;
  /**
   * Header resolver — called before EVERY request including SSE streams,
   * HITL decisions, plan approvals, thread history fetches, and all REST calls.
   *
   * Accepts either:
   *   - A plain object (static — equivalent to old defaultHeaders)
   *   - A sync function () => Record<string, string>
   *   - An async function () => Promise<Record<string, string>>
   *
   * All three read from wherever the token lives (localStorage, cookies,
   * in-memory store, auth SDK) and the result is merged into every request.
   *
   * @example — multiple auth headers from different sources
   * getHeaders: () => ({
   *   Authorization: `Bearer ${localStorage.getItem("access_token")}`,
   *   "X-MFA-Token": sessionStorage.getItem("mfa_token") ?? "",
   *   "X-Org-Id": myStore.currentOrg.id,
   *   "X-Device-Id": getDeviceFingerprint(),
   * })
   *
   * @example — async token refresh (silent re-auth)
   * getHeaders: async () => {
   *   const { accessToken } = await authSDK.getTokenSilently();
   *   return {
   *     Authorization: `Bearer ${accessToken}`,
   *     "X-Tenant": currentTenant,
   *   };
   * }
   *
   * @example — cookie-based (SSR / httpOnly not accessible, but custom headers work)
   * getHeaders: () => ({
   *   "X-CSRF-Token": document.cookie.match(/csrf=([^;]+)/)?.[1] ?? "",
   * })
   */
  getHeaders?: HeadersResolver;
  /**
   * @deprecated Use getHeaders instead.
   * Static headers object — cannot read tokens dynamically.
   */
  defaultHeaders?: Record<string, string>;
  /** Max SSE reconnect attempts (default: 5) */
  maxReconnects?: number;
  /**
   * Full fetch override — use when you need to intercept at the transport level
   * (e.g. route through a proxy, add request signing, log all requests).
   * For auth headers prefer getHeaders — it's simpler and covers all cases.
   */
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// REST types
// ---------------------------------------------------------------------------

export interface CreateRunOptions {
  threadId?: string;
  /** Override model for this run only. Format: "provider:model" or "litellm:provider/model" */
  model?: string;
  planMode?: boolean;
  selfLearn?: boolean;
  /** Whitelist specific tools for this run. null = all tools allowed. */
  allowedTools?: string[];
  maxTurns?: number;
  /**
   * LangGraph config.configurable passthrough.
   * Use for per-run context: { user_id, org_id, target_scope, ... }
   * Available in agent nodes via config.configurable.
   */
  config?: Record<string, unknown>;
  /**
   * Run-level metadata — stored on the run record, visible in history/audit.
   * Use for: user_id, session_id, client_version, feature_flags, etc.
   */
  metadata?: Record<string, unknown>;
  recursionLimit?: number;
}

export interface RunResponse {
  run_id: string;
  thread_id: string;
  agent_name: string;
  status: string;
  stream_url: string;
  created_at: string;
}

export interface ThreadInfo {
  thread_id: string;
  agent_name?: string;
  updated_at?: string;
  created_at?: string;
  git_branch?: string;
  cwd?: string;
}

export interface ThreadMessage {
  type: "human" | "ai" | "tool" | "system";
  content: string;
  id?: string;
  /** For AI messages — tool calls made */
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** For tool messages — which tool call this is the result of */
  tool_call_id?: string;
  /** For tool messages — tool name */
  name?: string;
}

export interface ThreadHistoryResponse {
  thread_id: string;
  total: number;
  offset: number;
  limit: number;
  messages: ThreadMessage[];
}

export interface InterruptState {
  pending: boolean;
  interrupt_id?: string;
  action_requests?: Array<{ name: string; args: Record<string, unknown> }>;
  thread_id: string;
  session_approved_tools: string[];
}

export type InterruptDecision =
  | { decision: "approve" }
  | { decision: "reject"; message?: string }
  | { decision: "approve_for_session" }
  | { decision: "edit"; edited_action: { name: string; args: Record<string, unknown> } }
  | { decision: "respond"; message: string };

// ---------------------------------------------------------------------------
// RAIClient
// ---------------------------------------------------------------------------

export class RAIClient {
  readonly baseUrl: string;
  readonly agent: string;
  private readonly _apiKey: string;
  private readonly _maxReconnects: number;
  private readonly _fetch: typeof fetch;
  private readonly _getHeaders: () => Promise<Record<string, string>>;

  constructor(config?: RAIClientConfig) {
    this.baseUrl = (config?.baseUrl ?? "").replace(/\/$/, "");
    this.agent = config?.agent ?? "rai";
    this._apiKey = config?.apiKey ?? "";
    this._maxReconnects = config?.maxReconnects ?? 5;
    this._fetch = config?.fetch ?? globalThis.fetch.bind(globalThis);

    // Normalise getHeaders / defaultHeaders into a single async resolver.
    // Called fresh before EVERY request so tokens are never stale.
    const resolver = config?.getHeaders ?? config?.defaultHeaders ?? {};
    if (typeof resolver === "function") {
      this._getHeaders = async () => resolver();
    } else {
      // Plain object — wrap in async fn; still "fresh" closure each call
      // (if user mutates the object between requests, changes are picked up)
      this._getHeaders = async () => ({ ...resolver });
    }
  }

  // ---- helpers ----

  /** Resolve all request headers — called before every REST call and SSE open. */
  private async _resolveHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const dynamic = await this._getHeaders();   // JWT, MFA, tenant, etc.
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...dynamic,
    };
    if (this._apiKey) h["X-API-Key"] = this._apiKey;
    return { ...h, ...extra };
  }

  private async _json<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = await this._resolveHeaders();
    const resp = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`RAI ${method} ${path} → ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  // ---- runs ----

  async createRun(
    input: string,
    agent = this.agent,
    opts: CreateRunOptions = {},
  ): Promise<RunResponse> {
    return this._json<RunResponse>("POST", `/agents/${agent}/runs`, {
      input,
      thread_id: opts.threadId,
      model: opts.model,
      plan_mode: opts.planMode ?? false,
      self_learn: opts.selfLearn ?? false,
      allowed_tools: opts.allowedTools,
      max_turns: opts.maxTurns,
      config: opts.config,
      metadata: opts.metadata,
      recursion_limit: opts.recursionLimit,
    });
  }

  async cancelRun(runId: string, agent = this.agent): Promise<void> {
    await this._json("POST", `/agents/${agent}/runs/${runId}/cancel`);
  }

  async approvePlan(runId: string, agent = this.agent): Promise<void> {
    await this._json("POST", `/agents/${agent}/runs/${runId}/plan/approve`);
  }

  async rejectPlan(runId: string, feedback?: string, agent = this.agent): Promise<void> {
    await this._json("POST", `/agents/${agent}/runs/${runId}/plan/reject`, { feedback });
  }

  // ---- streaming ----

  async *streamRun(
    runId: string,
    agent = this.agent,
    lastEventId?: string,
  ): AsyncGenerator<RAIEvent | RawSSEFrame> {
    const path = `/agents/${agent}/runs/${runId}/stream`;
    yield* this._streamSSE(path, lastEventId);
  }

  async *run(
    input: string,
    agent = this.agent,
    opts: CreateRunOptions = {},
  ): AsyncGenerator<RAIEvent | RawSSEFrame, RunResponse> {
    const run = await this.createRun(input, agent, opts);
    yield* this.streamRun(run.run_id, agent);
    return run;
  }

  // ---- threads ----

  async listThreads(opts?: { agent?: string; limit?: number; offset?: number; sort?: string }): Promise<ThreadInfo[]> {
    const params = new URLSearchParams();
    if (opts?.agent) params.set("agent", opts.agent);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    if (opts?.sort) params.set("sort", opts.sort);
    const q = params.toString();
    return this._json<ThreadInfo[]>("GET", `/threads${q ? `?${q}` : ""}`);
  }

  async getThread(threadId: string): Promise<ThreadInfo> {
    return this._json<ThreadInfo>("GET", `/threads/${threadId}`);
  }

  /**
   * Fetch message history for a thread.
   * Returns messages in chronological order.
   * Use limit/offset for pagination — TUI uses limit=500, chatbox uses 50.
   */
  async getThreadHistory(
    threadId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ThreadHistoryResponse> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const q = params.toString();
    return this._json<ThreadHistoryResponse>("GET", `/threads/${threadId}/history${q ? `?${q}` : ""}`);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this._json("DELETE", `/threads/${threadId}`);
  }

  async injectMessage(threadId: string, content: string, agentName?: string): Promise<void> {
    await this._json("POST", `/threads/${threadId}/messages`, {
      content,
      agent_name: agentName,
    });
  }

  // ---- HITL ----

  async getInterrupt(threadId: string): Promise<InterruptState> {
    return this._json<InterruptState>("GET", `/threads/${threadId}/interrupt`);
  }

  async submitDecision(threadId: string, decision: InterruptDecision): Promise<void> {
    await this._json("POST", `/threads/${threadId}/interrupt`, decision);
  }

  async submitAskUser(threadId: string, answers: string[], status = "answered"): Promise<void> {
    await this._json("POST", `/threads/${threadId}/ask_user`, { status, answers });
  }

  // ---- agents ----

  async listAgents(): Promise<Array<{ name: string; model: string; description: string }>> {
    return this._json("GET", "/agents");
  }

  // ---- health ----

  async health(): Promise<boolean> {
    try {
      const resp = await this._fetch(`${this.baseUrl}/ok`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ---- internal SSE ----

  async *_streamSSE(
    path: string,
    lastEventId?: string,
  ): AsyncGenerator<RAIEvent | RawSSEFrame> {
    let reconnects = 0;
    let lastId = lastEventId;

    while (true) {
      // Resolve headers fresh on every connect/reconnect — captures latest
      // JWT, MFA token, rotated credentials from wherever they're stored
      const headers = await this._resolveHeaders(
        lastId ? { "Last-Event-ID": lastId } : undefined,
      );
      delete (headers as Record<string, string>)["Content-Type"];

      let resp: Response;
      try {
        resp = await this._fetch(`${this.baseUrl}${path}`, {
          method: "GET",
          headers,
        });
      } catch (err) {
        if (reconnects >= this._maxReconnects) throw err;
        reconnects++;
        await _sleep(300 * reconnects);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`SSE ${path} → ${resp.status}`);
      }

      reconnects = 0;

      const reader = resp.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let pending = "";
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) pending += decoder.decode(value, { stream: !done });

        const blocks = pending.split("\n\n");
        pending = blocks.pop() ?? "";

        for (const block of blocks) {
          for (const frame of parseSSEChunk(block + "\n\n")) {
            if (frame.id) lastId = frame.id;
            const ev = coerceEvent(frame);
            yield ev;
            if (frame.event === "run_end") return;
          }
        }
      }

      return;
    }
  }
}

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
