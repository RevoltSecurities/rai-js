# @revolt-rai/js

TypeScript SDK for the [RAI](https://github.com/RevoltSecurities/RAI) HTTP server — the open-source AI security operator.

- **Framework-agnostic core** — `RAIClient` works in any JS environment (browser, Node 18+, Deno, Bun)
- **React hook** — `useRAIStream` mirrors `@langchain/react`'s `useStream` API pattern
- **Fully typed** — every SSE event the server emits has a TypeScript interface
- **Dynamic auth** — `getHeaders` resolver called fresh on every request (JWT, MFA, rotating tokens)
- **Plan mode** — structured multi-step planning with approval gate
- **HITL** — 5 decision modes: approve, reject, edit, respond, approve-for-session
- **Subagent streaming** — live token + tool tracking per specialist agent

---

## Install

```bash
npm install @revolt-rai/js
# or
pnpm add @revolt-rai/js
# or
yarn add @revolt-rai/js
```

React is an optional peer dependency — only needed if you use `useRAIStream`.

---

## Start the RAI server

```bash
# Local install
pip install revolt-rai
rai http serve --hitl --cors http://localhost:3000

# Docker
docker run -p 8000:8000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/revoltsecurities/rai
```

---

## Quick start

### React

```tsx
import { useRAIStream } from "@revolt-rai/js";

export default function Chat() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
  });

  return (
    <div>
      {stream.messages.map((msg) => (
        <div key={msg.id}>
          {msg.role === "human" && <p className="human">{msg.content}</p>}
          {msg.role === "assistant" && <p className="ai">{msg.content}</p>}
        </div>
      ))}

      {stream.isLoading && <p>Thinking…</p>}

      <input
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            stream.submit(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
      />
    </div>
  );
}
```

### Vanilla JS / Node

```ts
import { RAIClient } from "@revolt-rai/js";

const client = new RAIClient({ baseUrl: "http://localhost:8000" });

for await (const event of client.run("scan example.com")) {
  if (event.type === "token")       process.stdout.write(event.content);
  if (event.type === "tool_start")  console.log("→", event.tool_name);
  if (event.type === "run_end")     console.log("done", event.duration_ms + "ms");
}
```

---

## Authentication

### 1. Static API key

```tsx
const stream = useRAIStream({
  baseUrl: "http://localhost:8000",
  apiKey: "my-server-key",  // sent as X-API-Key header
});
```

### 2. JWT from localStorage (sync)

```tsx
const stream = useRAIStream({
  baseUrl: "https://rai.company.com",
  getHeaders: () => ({
    Authorization: `Bearer ${localStorage.getItem("access_token")}`,
    "X-Org-Id": localStorage.getItem("org_id") ?? "",
  }),
});
```

### 3. Multiple auth headers — JWT + MFA + tenant

```tsx
const stream = useRAIStream({
  baseUrl: "https://rai.company.com",
  getHeaders: () => ({
    Authorization: `Bearer ${store.auth.jwt}`,
    "X-MFA-Token": sessionStorage.getItem("mfa_token") ?? "",
    "X-Org-Id": store.currentOrg.id,
    "X-Workspace-Id": store.workspace.id,
    "X-Device-Id": deviceFingerprint.get(),
  }),
});
```

### 4. Async token refresh (Auth0, Cognito, Firebase)

```tsx
const stream = useRAIStream({
  baseUrl: "https://rai.company.com",
  getHeaders: async () => {
    // Automatically refreshes the token when expired
    const { accessToken } = await auth0.getTokenSilently();
    return {
      Authorization: `Bearer ${accessToken}`,
      "X-Tenant": currentTenant,
    };
  },
});
```

### 5. Cookie-based CSRF

```tsx
const stream = useRAIStream({
  baseUrl: "https://rai.company.com",
  getHeaders: () => ({
    "X-CSRF-Token": document.cookie.match(/csrf=([^;]+)/)?.[1] ?? "",
  }),
});
```

### 6. Per-organization API keys (multi-tenant SaaS)

```tsx
const { org } = useCurrentOrg();
const stream = useRAIStream({
  baseUrl: "https://rai.company.com",
  getHeaders: () => ({
    "X-API-Key": org.raiApiKey,
    "X-Workspace": org.workspaceId,
  }),
});
```

### 7. Custom fetch — proxy, request signing, logging

```tsx
const client = new RAIClient({
  baseUrl: "https://rai.company.com",
  fetch: async (url, init) => {
    const token = await tokenStore.getValid();
    const signed = await hmacSign(url, init); // custom signing
    return fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        "X-Signature": signed,
      },
    });
  },
});
```

> **`getHeaders` is called before every single request** — REST calls, SSE stream opens, reconnects, HITL decisions, plan approvals, `answerAskUser`, thread history fetches — everything. Tokens are never stale.

---

## `useRAIStream` — full API

### Options

```ts
useRAIStream({
  baseUrl?: string;          // RAI server URL (empty = Vite proxy)
  agent?: string;            // Agent name, default "rai"
  apiKey?: string;           // X-API-Key header
  getHeaders?: HeadersResolver; // Dynamic auth (JWT, MFA, etc.)
  threadId?: string | null;  // Resume an existing thread on mount
  reconnectOnMount?: boolean;// Auto-rejoin active run on page refresh
  filterSubagentMessages?: boolean; // Keep subagent tokens out of messages[] (default: true)
  onRunCreated?: (meta: { run_id, thread_id }) => void;
  onFinish?: (event: RunEndEvent) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: RAIEvent) => void; // Every raw SSE event
  onThreadId?: (threadId: string) => void;
})
```

### Returns

```ts
// ── Data ─────────────────────────────────────────────────────────────
messages: StreamMessage[]        // Human + assistant messages
isLoading: boolean               // Run in progress
isThreadLoading: boolean         // Fetching thread history
error: Error | null

// ── Tool calls ───────────────────────────────────────────────────────
toolCalls: ToolCall[]            // All tool calls in current turn
getToolCalls(messageId): ToolCall[] // Tool calls for a specific message

// ── Interrupts (HITL) ────────────────────────────────────────────────
interrupt: InterruptState | null // First pending interrupt
interrupts: InterruptState[]     // All pending interrupts
askUser: AskUserState | null     // Pending ask_user request

// ── Subagents ────────────────────────────────────────────────────────
subagents: Map<string, SubagentStream>
activeSubagents: SubagentStream[]
getSubagent(taskId): SubagentStream | undefined
getSubagentsByMessage(messageId): SubagentStream[]
getSubagentsByType(agentName): SubagentStream[]

// ── Plan mode ────────────────────────────────────────────────────────
plan: PlanState | null

// ── Thread ───────────────────────────────────────────────────────────
runId: string | null
threadId: string | null
sessionApprovedTools: string[]

// ── Actions ──────────────────────────────────────────────────────────
submit(input, opts?)         // Start a run
stop()                       // Cancel run + abort SSE
disconnect()                 // Abort SSE only — server keeps running
switchThread(id | null)      // Switch thread (loads history)
joinStream(runId, lastEventId?) // Reconnect to existing run

// HITL
approveInterrupt(decision?)  // Approve (default) or custom decision
rejectInterrupt(message?)    // Reject with optional reason
editInterrupt(action)        // Edit tool args and approve
respondToInterrupt(message)  // Send message to agent
approveInterruptForSession() // Approve this tool for whole session
answerAskUser(answers)       // Answer ask_user questions

// Plan
approvePlan()
rejectPlan(feedback?)
```

---

## Submit options

```ts
stream.submit("scan example.com", {
  agent: "recon",                    // Different agent for this message
  model: "anthropic:claude-opus-4-8", // Override model for this run
  planMode: true,                    // Agent must plan before acting
  allowedTools: ["bash", "read_file"], // Restrict tools for this run
  maxTurns: 30,                      // Cap LLM turns
  metadata: {                        // Stored on run — visible in audit log
    user_id: user.id,
    org_id: org.id,
    session_id: sessionId,
  },
  config: {                          // Passed to agent as configurable
    target_scope: "example.com",
    env: "production",
  },
  multitaskStrategy: "interrupt",    // interrupt | reject (default: interrupt)
});
```

---

## Tool calls

```tsx
{stream.messages.map((msg) => (
  <div key={msg.id}>
    {msg.role === "human" && <HumanBubble>{msg.content}</HumanBubble>}

    {msg.role === "assistant" && (
      <>
        {msg.content && <AIBubble>{msg.content}</AIBubble>}

        {/* Tool calls for this turn */}
        {stream.getToolCalls(msg.id).map((tc) => (
          <ToolCard key={tc.id} tc={tc} />
        ))}
      </>
    )}
  </div>
))}
```

### `ToolCall` shape

```ts
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "running" | "done" | "error";
}
```

---

## HITL — Human-in-the-loop

```tsx
const { interrupt, approveInterrupt, rejectInterrupt, editInterrupt,
        respondToInterrupt, approveInterruptForSession } = stream;

{interrupt && (
  <div>
    <h3>Approval Required</h3>

    {interrupt.action_requests?.map((req, i) => (
      <div key={i}>
        <code>{req.name}</code>
        <pre>{JSON.stringify(req.args, null, 2)}</pre>
      </div>
    ))}

    {/* 5 decision modes */}
    <button onClick={() => approveInterrupt()}>Approve</button>
    <button onClick={() => approveInterruptForSession()}>Approve for Session</button>
    <button onClick={() => rejectInterrupt("Too risky")}>Reject</button>
    <button onClick={() => editInterrupt({ name: req.name, args: newArgs })}>Edit</button>
    <button onClick={() => respondToInterrupt("Use /tmp instead")}>Respond</button>
  </div>
)}
```

### Session approval — never prompt again

```tsx
// After approveInterruptForSession(), stream.sessionApprovedTools
// lists all tools approved for this session — show to users
{stream.sessionApprovedTools.length > 0 && (
  <p>Session-approved: {stream.sessionApprovedTools.join(", ")}</p>
)}
```

---

## Plan mode

```tsx
stream.submit("audit this codebase for vulnerabilities", {
  planMode: true,  // agent must write and get approval before executing
});

{stream.plan && (
  <div>
    {/* Waiting for plan to be written */}
    {stream.plan.status === "pending" && !stream.plan.raw && (
      <p>|| Writing plan…</p>
    )}

    {/* Plan ready — show markdown and approve/reject */}
    {stream.plan.status === "pending" && stream.plan.raw && (
      <>
        <Markdown>{stream.plan.raw}</Markdown>
        <button onClick={() => stream.approvePlan()}>Approve</button>
        <button onClick={() => stream.rejectPlan("Focus on auth only")}>Reject</button>
      </>
    )}

    {/* Executing — show step progress */}
    {(stream.plan.status === "approved" || stream.plan.status === "running") && (
      <ul>
        {stream.plan.steps.map((step) => (
          <li key={step.number}>
            {step.status === "complete" ? "✓" : step.status === "running" ? "◉" : "○"}
            {" "}{step.description}
          </li>
        ))}
      </ul>
    )}
  </div>
)}
```

---

## Subagent streaming

```tsx
const stream = useRAIStream({
  baseUrl: "http://localhost:8000",
  filterSubagentMessages: true, // keep subagent tokens out of messages[]
});

const subagentList = Array.from(stream.subagents.values());
const completed = subagentList.filter(s => s.status === "complete").length;
const total = subagentList.length;

{stream.messages.map((msg) => {
  const turnSubagents = msg.role === "assistant"
    ? stream.getSubagentsByMessage(msg.id)
    : [];

  return (
    <div key={msg.id}>
      {msg.role === "human" && <HumanBubble>{msg.content}</HumanBubble>}
      {msg.role === "assistant" && msg.content && (
        <AIBubble>{msg.content}</AIBubble>
      )}

      {turnSubagents.length > 0 && (
        <>
          <p>{completed}/{total} specialist agents completed</p>
          <div className="progress-bar">
            <div style={{ width: `${total ? (completed/total)*100 : 0}%` }} />
          </div>
          <div className="grid">
            {turnSubagents.map(sa => (
              <SubagentCard key={sa.id} subagent={sa} />
            ))}
          </div>
        </>
      )}
    </div>
  );
})}
```

### `SubagentStream` shape

```ts
interface SubagentStream {
  id: string;
  name: string;              // agent name e.g. "recon", "sast-analyzer"
  status: "pending" | "running" | "complete" | "error";
  content: string;           // accumulated token output
  thinking: string;          // extended thinking blocks
  outputPreview: string;     // summary from subagent_completed event
  toolCalls: SubagentToolCall[]; // tools the subagent used
  input: string;             // prompt passed to subagent
  model: string;             // which model the subagent used
  parentRunId: string;
  aiMessageId: string | null; // which AI message spawned this subagent
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}
```

---

## Reasoning / thinking blocks

```tsx
{stream.messages.map((msg, i) => (
  <div key={msg.id ?? i}>
    {msg.role === "human" && <HumanBubble>{msg.content}</HumanBubble>}

    {msg.role === "assistant" && (
      <>
        {/* Extended thinking — shown collapsed by default */}
        {msg.thinking && (
          <details>
            <summary>
              Thinking {stream.isLoading && i === stream.messages.length - 1
                ? "(streaming…)" : "(done)"}
            </summary>
            <pre>{msg.thinking}</pre>
          </details>
        )}

        {msg.content && <AIBubble>{msg.content}</AIBubble>}
      </>
    )}
  </div>
))}
```

---

## Thread management

```tsx
// Resume a specific thread on mount
const stream = useRAIStream({
  baseUrl: "http://localhost:8000",
  threadId: savedThreadId,     // loads last 50 messages automatically
  onThreadId: (id) => setStoredThreadId(id), // save new thread IDs
});

// Switch to a different thread
stream.switchThread(existingThreadId); // loads history

// Start fresh
stream.switchThread(null);

// Auto-reconnect after page refresh
const stream = useRAIStream({
  baseUrl: "http://localhost:8000",
  reconnectOnMount: true, // rejoins any active run via sessionStorage
});
```

### List threads via `RAIClient`

```ts
const client = new RAIClient({ baseUrl: "http://localhost:8000" });

const threads = await client.listThreads({ limit: 20, sort: "updated" });
// [{ thread_id, agent_name, updated_at, cwd, git_branch }]

await client.deleteThread(threadId);
await client.injectMessage(threadId, "continue from here");
```

---

## Join / Rejoin streams

```tsx
const stream = useRAIStream({ baseUrl: "http://localhost:8000" });
const [savedRunId, setSavedRunId] = useState<string | null>(null);

// Save run ID when created
useRAIStream({
  onRunCreated: ({ run_id }) => setSavedRunId(run_id),
});

// Disconnect SSE — server keeps running (HITL/plan still active)
const handleDisconnect = () => {
  stream.disconnect();  // NOT stop() — that would kill the server run
};

// Reconnect — replays missed events via Last-Event-ID
const handleRejoin = () => {
  if (savedRunId) stream.joinStream(savedRunId);
};
```

> **`stop()` vs `disconnect()`**:
> - `stop()` — aborts SSE + cancels server execution. Subagents terminated.
> - `disconnect()` — aborts SSE only. Server run, HITL, plan, subagents all continue.

---

## Message queue (rapid inputs)

```tsx
import { useRAIQueue } from "./useRAIQueue"; // build on top of useRAIStream

const { submit, queue, clearQueue, cancelQueued, messages, isLoading } =
  useRAIQueue({ baseUrl: "http://localhost:8000" });

// Submits queue automatically — if busy, enqueues; submits after run_end
submit("What is React?");
submit("What is Vue?");    // queued
submit("What is Svelte?"); // queued

{queue.length > 0 && (
  <div>
    {queue.length} queued
    <button onClick={clearQueue}>Clear all</button>
    {queue.map(entry => (
      <div key={entry.id}>
        {entry.text}
        <button onClick={() => cancelQueued(entry.id)}>✕</button>
      </div>
    ))}
  </div>
)}
```

<details>
<summary>useRAIQueue implementation</summary>

```ts
import { useCallback, useRef, useState } from "react";
import { useRAIStream, type UseRAIStreamOptions } from "@revolt-rai/js";

export function useRAIQueue(opts: UseRAIStreamOptions) {
  const [queue, setQueue] = useState<Array<{ id: string; text: string }>>([]);
  const submitRef = useRef<((text: string) => void) | null>(null);

  const stream = useRAIStream({
    ...opts,
    onFinish: (ev) => {
      opts.onFinish?.(ev);
      setQueue(prev => {
        if (!prev.length) return prev;
        const [next, ...rest] = prev;
        Promise.resolve().then(() => submitRef.current?.(next.text));
        return rest;
      });
    },
  });

  submitRef.current = stream.submit;

  const submit = useCallback((text: string) => {
    if (stream.isLoading) {
      setQueue(prev => [...prev, { id: `q-${Date.now()}`, text }]);
    } else {
      stream.submit(text);
    }
  }, [stream]);

  return {
    ...stream,
    submit,
    queue,
    clearQueue: () => setQueue([]),
    cancelQueued: (id: string) => setQueue(p => p.filter(e => e.id !== id)),
  };
}
```

</details>

---

## Core client reference

```ts
const client = new RAIClient({
  baseUrl: "http://localhost:8000",
  agent: "rai",            // default agent
  apiKey: "server-key",    // X-API-Key
  getHeaders: async () => ({ // dynamic auth
    Authorization: `Bearer ${await getToken()}`,
  }),
});

// Runs
const run = await client.createRun("scan example.com", "recon", {
  model: "anthropic:claude-opus-4-8",
  planMode: true,
  allowedTools: ["bash", "read_file"],
  metadata: { user_id: "u_123" },
});

for await (const ev of client.streamRun(run.run_id)) {
  if (ev.type === "token")      process.stdout.write(ev.content);
  if (ev.type === "tool_start") console.log("tool:", ev.tool_name);
  if (ev.type === "interrupt")  await client.submitDecision(ev.thread_id, { decision: "approve" });
  if (ev.type === "plan_ready") await client.approvePlan(run.run_id);
  if (ev.type === "run_end")    break;
}

await client.cancelRun(run.run_id);

// Threads
const threads = await client.listThreads({ limit: 20 });
const history = await client.getThreadHistory(threadId, { limit: 50 });
await client.deleteThread(threadId);
await client.injectMessage(threadId, "follow up message");

// HITL
const state = await client.getInterrupt(threadId);
await client.submitDecision(threadId, { decision: "approve" });
await client.submitDecision(threadId, { decision: "reject", message: "too risky" });
await client.submitDecision(threadId, { decision: "edit", edited_action: { name, args } });
await client.submitDecision(threadId, { decision: "respond", message: "use /tmp" });
await client.submitDecision(threadId, { decision: "approve_for_session" });
await client.submitAskUser(threadId, ["answer1", "answer2"]);

// Server health
const ok = await client.health(); // true | false
```

---

## Switching agents per request

```tsx
// Different agent per message — same thread
stream.submit("find SQL injections",   { agent: "sast-analyzer" });
stream.submit("scan ports",            { agent: "recon" });
stream.submit("summarize findings",    { agent: "rai" });
stream.submit("generate exploit PoC",  { agent: "rai", model: "anthropic:claude-opus-4-8" });
```

---

## VS Code extension

`RAIClient` works directly in the extension host (Node.js) — no browser APIs required:

```ts
import * as vscode from "vscode";
import { RAIClient } from "@revolt-rai/js";

export function activate(context: vscode.ExtensionContext) {
  const client = new RAIClient({ baseUrl: "http://localhost:8000" });
  const output = vscode.window.createOutputChannel("RAI");

  context.subscriptions.push(
    vscode.commands.registerCommand("rai.scan", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? ".";
      output.show();

      for await (const ev of client.run(`SAST scan: ${folder}`, "sast-analyzer")) {
        if (ev.type === "token")      output.append(ev.content);
        if (ev.type === "tool_start") output.appendLine(`\n→ ${ev.tool_name}`);
        if (ev.type === "interrupt") {
          const choice = await vscode.window.showQuickPick(
            ["Approve", "Reject"],
            { placeHolder: `Approve ${ev.action_requests?.[0]?.name}?` }
          );
          await client.submitDecision(ev.thread_id, {
            decision: choice === "Approve" ? "approve" : "reject",
          });
        }
      }
    })
  );
}
```

`useRAIStream` works inside Webview panels (Chromium context).

---

## Server setup for production

```python
# server.py — custom auth middleware
from rai.sdk import RAIHTTPServer, HTTPConfig, RAIAgent
import jwt

config = HTTPConfig(host="0.0.0.0", port=8000, cors_origins=["https://app.company.com"])
server = RAIHTTPServer(config)
server.register(RAIAgent.builder().agent_name("rai").model("litellm:openai/bedrock-claude-sonnet-4.6-(US)"))

app = server._build_app()

@app.middleware("http")
async def jwt_guard(request, call_next):
    if request.url.path in ("/ok", "/docs"):
        return await call_next(request)
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        request.state.user = payload
    except Exception:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Unauthorized"}, 401)
    return await call_next(request)

import uvicorn
uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## All event types

```ts
import type {
  // Run lifecycle
  RunStartEvent, RunEndEvent, RunKeepaliveEvent, RateLimitEvent, ErrorEvent,
  // Streaming
  TokenEvent, ThinkingEvent,
  // Tools
  ToolStartEvent, ToolEndEvent, PermissionDeniedEvent,
  // HITL
  InterruptEvent, InterruptResolvedEvent, InterruptAutoApprovedEvent,
  AskUserRequestEvent, SessionApprovedEvent,
  // Plan mode
  PlanModeEnteredEvent, PlanReadyEvent, PlanApprovedEvent, PlanRejectedEvent,
  StepStartEvent, StepCompleteEvent, StepBlockedEvent, PlanCompletedEvent,
  // Subagents
  SubagentStartedEvent, SubagentTokenEvent, SubagentThinkingEvent,
  SubagentToolStartEvent, SubagentToolEndEvent, SubagentInterruptEvent,
  SubagentCompletedEvent, SubagentErrorEvent,
  // Tasks / pipelines
  TaskCreatedEvent, TaskCompletedEvent, PipelineCreatedEvent, PipelineEndEvent,
} from "@revolt-rai/js";
```

Listen to every event:

```tsx
useRAIStream({
  baseUrl: "http://localhost:8000",
  onEvent: (ev) => {
    if (ev.type === "run_end") analytics.track("run_completed", { duration: ev.duration_ms });
    if (ev.type === "error")   Sentry.captureException(new Error(ev.message));
  },
});
```

---

## Exports

```ts
import { RAIClient } from "@revolt-rai/js";           // core client
import { useRAIStream } from "@revolt-rai/js";         // React hook
import { useRAIStream } from "@revolt-rai/js/react";   // explicit subpath
import { RAIClient } from "@revolt-rai/js/client";     // client only
import type { RAIEvent } from "@revolt-rai/js/events"; // event types only
```

---

## Requirements

| Environment | Min version |
|---|---|
| Node.js | 18+ (fetch built-in) |
| Deno | 1.28+ |
| Browser | Chrome 95+, Firefox 94+, Safari 15.4+ |
| React (optional) | 18+ |
| TypeScript (optional) | 5.0+ |

RAI server: `pip install revolt-rai` (Python 3.11+)

---

## License

MIT — [github.com/RevoltSecurities/RAI](https://github.com/RevoltSecurities/RAI)
