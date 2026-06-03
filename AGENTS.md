# @revolt-rai/js — Developer & Agent Guide

> Canonical reference for all AI agents and developers working on the TypeScript SDK.
> Claude Code: `CLAUDE.md` routes here via `@AGENTS.md`.

---

## Package Overview

`@revolt-rai/js` is the TypeScript SDK for the RAI HTTP server. It provides:

- **`RAIClient`** — framework-agnostic REST + SSE client (browser, Node 18+, Deno, Bun)
- **`useRAIStream`** — React hook (mirrors `@langchain/react` `useStream` pattern)
- **`SubagentManager`** — lifecycle tracking for specialist subagents
- **40+ typed SSE events** — every event the server emits has a TypeScript interface
which 
**Version**: `1.0.0` (versioned independently from Python `revolt-rai`)  
**Publish**: `@revolt-rai/js` on npm

### Production fixes applied before v1.0.0 release

| # | Fix | File | Impact |
|---|-----|------|--------|
| 1 | `tsconfig.json` target `ES2020→ES2023` | `tsconfig.json` | `findLastIndex()` compile error fixed |
| 2 | `dist/` built for first time | — | Package was never compiled before |
| 3 | Duplicate `isThreadLoading` removed from `UseRAIStreamResult` | `useRAIStream.ts` | TS invalid interface |
| 4 | `fetch?` added to `UseRAIStreamOptions`, wired to `RAIClient` | `useRAIStream.ts` | Proxy/signing support |
| 5 | `step_start` stale plan state fixed | `useRAIStream.ts` | Plan steps not updating correctly |
| 6 | `reconnectOnMount` reads live `stateRef.current.threadId` not stale prop | `useRAIStream.ts` | Wrong thread on reconnect |
| 7 | `HeadersResolver` inline import → proper top-level import | `useRAIStream.ts` | TS import style |
| 8 | `HeadersResolver`, `ThreadMessage`, `ThreadHistoryResponse` exported | `index.ts` | Missing from public API |
| 9 | `useRAIQueue` hook implemented | `useRAIQueue.ts` | In README but was missing |
| 10 | `useReducer` rewrite — eliminated all stale closure / tearing bugs | `useRAIStream.ts` | Messages not appearing, required reload |

---

## Repository Layout

```
packages/rai-js/
├── src/
│   ├── client.ts         # RAIClient class — all REST + SSE
│   ├── events.ts         # RAIEvent union type + 40+ interfaces + SSE parser
│   ├── subagents.ts      # SubagentManager class
│   ├── useRAIStream.ts   # useRAIStream React hook (useReducer)
│   └── index.ts          # Public exports + subpath exports
├── examples/
│   ├── chatbox/          # Full React app: Vite + Tailwind, all panels
│   │   ├── src/
│   │   │   ├── App.tsx                    # Main app, useRAIStream wired
│   │   │   └── components/
│   │   │       ├── MessageList.tsx        # Messages + tool cards + subagent cards
│   │   │       ├── ChatInput.tsx          # Input bar
│   │   │       ├── HITLPanel.tsx          # All 5 HITL decision modes
│   │   │       ├── PlanOverlay.tsx        # Animated plan mode panel
│   │   │       ├── PlanPanel.tsx          # Compact completed/rejected plan
│   │   │       ├── SubagentPanel.tsx      # Background subagent tracker
│   │   │       ├── AskUserPanel.tsx       # ask_user Q&A panel
│   │   │       ├── StatusBar.tsx          # Agent/thread/run status
│   │   │       └── ThreadSidebar.tsx      # Thread list with infinite scroll
│   │   ├── vite.config.ts               # Proxy to :8000 (no CORS)
│   │   └── index.html
│   └── patterns/         # 10 pattern files (LangGraph comparison)
│       ├── README.md                    # API diff table
│       ├── 01-markdown-messages.tsx
│       ├── 02-tool-calls.tsx
│       ├── 03-hitl-approval.tsx
│       ├── 04-reasoning-tokens.tsx
│       ├── 05-message-queue.tsx
│       ├── 06-join-rejoin-streams.tsx
│       ├── 07-subagent-streaming.tsx
│       ├── 08-plan-mode.tsx
│       ├── 09-custom-auth.tsx
│       └── 10-per-run-config.tsx
├── package.json          # @revolt-rai/js, v1.0.0, subpath exports
├── tsconfig.json         # ES2020, NodeNext, strict
├── README.md             # 848-line production docs
├── AGENTS.md             # This file
└── CLAUDE.md             # Routes to @AGENTS.md
```

---

## Architecture

### State management — `useReducer` (critical design decision)

**Never use `useSyncExternalStore` with a mutable external store.** React's concurrent renderer calls `getSnapshot()` multiple times mid-render; mutable stores cause tearing and dropped updates.

`useRAIStream` uses `useReducer` exclusively:
- All state changes go through `dispatch(action)` — React scheduler handles batching
- `stateRef.current` for synchronous reads inside the event processor
- `dispatchRef.current` for dispatching from async SSE callbacks
- `processEventRef.current` — updated every render, read by async loop to prevent stale closures

```ts
// CORRECT — dispatch goes through React
dispatchRef.current({ type: "ADD_MESSAGE", msg });

// WRONG — direct state mutation bypasses React
state.messages.push(msg); // never do this
```

### Stale closure prevention

The SSE loop is a long-lived async generator. React recreates functions between renders. The loop must never capture functions directly:

```ts
// CORRECT — always reads latest via ref
for await (const ev of client.streamRun(runId)) {
  processEventRef.current?.(ev);  // latest processEvent function
}

// WRONG — stale closure after first re-render
for await (const ev of client.streamRun(runId)) {
  processEvent(ev);  // captured at loop start, stale after re-render
}
```

### Reducer actions

```ts
type Action =
  | { type: "SET"; patch: Partial<State> }          // general field updates
  | { type: "RESET"; threadId: string | null }       // clear all state
  | { type: "APPEND_CONTENT"; msgId, content }       // token streaming
  | { type: "APPEND_THINKING"; msgId, content }      // thinking streaming
  | { type: "ADD_MESSAGE"; msg }                     // new message
  | { type: "ATTACH_TOOL"; msgId, tc }               // attach tool to existing msg
  | { type: "ADD_AI_WITH_TOOL"; msgId, tc }          // create AI msg + attach tool
  | { type: "UPDATE_TOOL"; tcId, result, status }    // tool_end completion
  | { type: "UPSERT_PLAN_STEP"; step }               // step_start/complete/blocked
  | { type: "SUBAGENT_TICK" };                       // subagent state changed
```

### Dynamic auth — `getHeaders` resolver

Called before **every** request: REST calls, SSE open, SSE reconnects, HITL, plan, thread history.

```ts
// Three supported forms:
getHeaders: { Authorization: `Bearer ${token}` }          // static object
getHeaders: () => ({ Authorization: localStorage.getItem("jwt") })  // sync fn
getHeaders: async () => ({ Authorization: await auth.getToken() })  // async fn
```

In `RAIClient._resolveHeaders()`:
```ts
private async _resolveHeaders(extra?): Promise<Record<string, string>> {
  const dynamic = await this._getHeaders();  // fresh on every call
  return { "Content-Type": "application/json", ...dynamic, ...extra };
}
```

---

## Key Interfaces

### `RAIClientConfig`

```ts
interface RAIClientConfig {
  baseUrl?: string;
  apiKey?: string;
  agent?: string;
  getHeaders?: HeadersResolver;   // fn | async fn | plain object
  defaultHeaders?: Record<string, string>; // deprecated, use getHeaders
  maxReconnects?: number;
  fetch?: typeof fetch;           // custom transport
}
```

### `CreateRunOptions`

```ts
interface CreateRunOptions {
  threadId?: string;
  model?: string;           // "provider:model" or "litellm:provider/model"
  planMode?: boolean;
  selfLearn?: boolean;
  allowedTools?: string[];
  maxTurns?: number;
  config?: Record<string, unknown>;    // → LangGraph config.configurable
  metadata?: Record<string, unknown>;  // stored on run, visible in audit
  recursionLimit?: number;
}
```

### `UseRAIStreamOptions`

```ts
interface UseRAIStreamOptions {
  baseUrl?: string;
  apiKey?: string;
  getHeaders?: HeadersResolver;
  agent?: string;
  threadId?: string | null;
  reconnectOnMount?: boolean;
  filterSubagentMessages?: boolean; // default: true
  onRunCreated?: (meta: { run_id, thread_id }) => void;
  onFinish?: (event: RunEndEvent) => void;
  onError?: (error: Error, meta?) => void;
  onEvent?: (event: RAIEvent) => void;
  onThreadId?: (threadId: string) => void;
}
```

---

## stop() vs disconnect()

This is a **critical distinction** — wrong choice causes user-facing bugs.

| Method | SSE | Server execution | When to use |
|--------|-----|-----------------|-------------|
| `stop()` | ✅ aborted | ✅ cancelled | User explicitly ends the run |
| `disconnect()` | ✅ aborted | ❌ keeps running | Temporary detach, rejoin later |
| `joinStream(runId)` | ✅ reconnects | ❌ unchanged | Reconnect after disconnect/refresh |

LangGraph's `stop()` = SSE only (server continues). RAI `stop()` = SSE + server cancel.
Use RAI `disconnect()` to match LangGraph `stop()` behavior.

---

## Plan Mode — Timing Rules

The `plan_ready` event fires AFTER `plan_mode_entered`. The server's `_PLAN_FUTURES[run_id]` is only set when `plan_ready` fires. Calling `approvePlan()` before `plan_ready` returns `409 "No pending plan to approve"`.

```ts
// CORRECT — gate on plan.raw being populated
const planReady = plan.status === "pending" && !!plan.raw;
{planReady && <button onClick={approvePlan}>Approve</button>}

// WRONG — shows button immediately on plan_mode_entered
{plan.status === "pending" && <button onClick={approvePlan}>Approve</button>}
```

Plan exec tools suppressed from tool cards (they get step/plan UI instead):
`enter_plan_mode`, `enter_step`, `mark_step_done`, `mark_step_blocked`, `exit_plan_mode`, `list_plan_steps`, `ask_user`, `compact_conversation`

---

## Tool Call Pairing

Tool calls are keyed `"toolName:id"` in `pendingToolsRef` to handle parallel same-tool calls:

```ts
// tool_start — register with composite key
pendingToolsRef.current.set(`${ev.tool_name}:${tcId}`, tcId);

// tool_end — find by name prefix, FIFO order
for (const [k, v] of pendingToolsRef.current.entries()) {
  if (k.startsWith(`${ev.tool_name}:`)) { foundKey = k; foundId = v; break; }
}
```

**Never** use just `toolName` as key — breaks when same tool runs twice concurrently.

---

## Thread History Loading

Uses two-step fetch to get the **last 50 messages** (not first 50):

```ts
// Step 1: probe for total count (cheap — 1 message)
const probe = await client.getThreadHistory(threadId, { limit: 1 });
// Step 2: fetch last PAGE from correct offset
const offset = Math.max(0, probe.total - PAGE_SIZE);
const history = await client.getThreadHistory(threadId, { limit: PAGE_SIZE, offset });
```

The server endpoint is `msgs[offset : offset + limit]` — without offset it always returns the oldest messages.

---

## Chatbox Example

Start the RAI server first:
```bash
cd /path/to/rai
rai http serve --hitl --cors http://localhost:3000
```

Then run the chatbox:
```bash
cd packages/rai-js/examples/chatbox
npm install
npm run dev   # http://localhost:3000
```

The Vite dev server proxies all `/agents`, `/threads`, `/runs`, `/ok` to `:8000` — no CORS issues.

**`baseUrl: ""`** in `App.tsx` — empty string = same-origin = goes through Vite proxy. Never set `baseUrl: "http://localhost:8000"` directly in the browser — that bypasses the proxy and triggers CORS preflight `OPTIONS 405`.

---

## Python-side Changes That Affect the JS SDK

When new Python middleware, tools, or SSE events are added to the RAI server,
these JS SDK files need updating too:

| Python change | JS SDK files to update |
|---|---|
| New middleware (e.g. `LoopDetectionMiddleware`) | `src/index.ts` — export the type name if exposing to users |
| New SSE event type | `src/events.ts` + `src/useRAIStream.ts` + `src/index.ts` |
| New `CreateRunRequest` field | `src/client.ts` `CreateRunOptions` interface + `createRun()` body |
| New `UseRAIStreamOptions` field | `src/useRAIStream.ts` interface + `useMemo` RAIClient constructor |
| New HITL decision type | `src/client.ts` `InterruptDecision` union + `src/useRAIStream.ts` new action method |

**Current Python middlewares exposed to JS SDK** (as type names for documentation):
- `LoopDetectionMiddleware` — `RAI_LOOP_WINDOW`, `RAI_LOOP_DISABLED` env vars
- `ToolResultCompressionMiddleware` — `RAI_COMPACT_RESULT_*` env vars
- `MessageCompressionMiddleware` — no env vars (uses 30k token budget)

These affect server behavior — JS SDK users should know about them for debugging.

---

## Adding New Features

### New event type

1. `src/events.ts` — add interface + add to `RAIEvent` union
2. `src/useRAIStream.ts` — handle in `processEventRef.current` switch statement
3. `src/index.ts` — export the type
4. Update `examples/patterns/` — add or update relevant example
5. `README.md` — add to "All event types" section

### New hook method

1. `src/useRAIStream.ts`:
   - Add to `UseRAIStreamResult` interface
   - Implement with `useCallback` using `stateRef.current` for reads, `dispatchRef.current` for writes
   - Add to `return {}` object
2. `src/index.ts` — export type if needed
3. `README.md` — document in API reference
4. `examples/patterns/` — add usage example

### New client method

1. `src/client.ts` — add `async` method using `this._json()` or `this._streamSSE()`
2. `src/index.ts` — export from `RAIClient` (it's a class, auto-exported)
3. `README.md` — document in "Core client reference"

---

## LangGraph API Comparison (quick reference)

| Concept | LangGraph | RAI |
|---------|-----------|-----|
| Message role | `HumanMessage.isInstance(msg)` | `msg.role === "human"` |
| Message text | `msg.text` | `msg.content` |
| Thinking | `msg.contentBlocks.filter(reasoning)` | `msg.thinking` |
| Submit | `stream.submit({ messages: [...] })` | `stream.submit(text)` |
| Tool state | `"pending" \| "completed"` | `"running" \| "done" \| "error"` |
| Tool result | separate `ToolMessage` | `tc.result` embedded |
| Tool lookup | `stream.toolCalls.filter(tc => msg.tool_calls.find(...))` | `stream.getToolCalls(msg.id)` |
| HITL resume | manual `HITLResponse` construction | `stream.approveInterrupt()` |
| Server-continue | `stream.stop()` (default) | `stream.disconnect()` |
| Server-cancel | requires `onDisconnect: "cancel"` | `stream.stop()` |
| Queue | server-side via `queue` from `useStream` | client-side `useRAIQueue` hook |

---

## Publishing

```bash
# Build
cd packages/rai-js
npm install
npm run build     # compiles to dist/

# Publish (CI does this automatically on v* tag)
npm publish --access public

# Verify wheel content before publish
python3 -c "import zipfile; z=zipfile.ZipFile('dist/revolt_rai-2.0.1-py3-none-any.whl'); print(sum(1 for n in z.namelist() if n.startswith('rai/')))"
# Should print ~201
```

**npm requires `NPM_TOKEN` secret** in GitHub repo settings.
**PyPI requires `PYPI_TOKEN` secret**.
