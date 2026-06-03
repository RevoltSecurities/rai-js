# @revolt-rai/js v1.0.0 Release Notes

TypeScript SDK for the RAI HTTP server — framework-agnostic client + React hook + subagent streaming.

## What's Included

### `RAIClient` — framework-agnostic HTTP + SSE client

Zero dependencies. Works in browsers (fetch + ReadableStream) and Node 18+.

```ts
import { RAIClient } from "@revolt-rai/js";

const client = new RAIClient({
  baseUrl: "http://localhost:8000",
  getHeaders: async () => ({
    Authorization: `Bearer ${await authSDK.getToken()}`,
  }),
});

// One-shot run
for await (const event of client.run("Pentest example.com")) {
  if (event.type === "token") process.stdout.write(event.content);
  if (event.type === "run_end") console.log("done", event.usage);
}
```

### `useRAIStream` — React hook

Full streaming state in a single hook: messages, tool calls, plan mode, HITL interrupts, subagents.

```tsx
import { useRAIStream } from "@revolt-rai/js";

const { messages, submit, isLoading, interrupt, approvePlan } = useRAIStream({
  client,
  agent: "rai",
});
```

### `useRAIQueue` — client-side message queue

Submit messages while a run is in progress — they queue and drain in order automatically.

```tsx
import { useRAIQueue } from "@revolt-rai/js";

const { submit, queue, clearQueue } = useRAIQueue({ client });
// submit() mid-run → queued; fires automatically after run_end
```

### 40+ typed SSE events

Every event the RAI server emits is fully typed — tokens, tool calls, HITL interrupts, plan steps, subagent lifecycle, rate limits, errors.

```ts
import type { RAIEvent, InterruptEvent, PlanReadyEvent } from "@revolt-rai/js";
```

### `SubagentManager` — subagent lifecycle tracking

Track every subagent spawned by the main agent — status, tokens, tool calls, output.

```ts
const { subagentManager } = useRAIStream({ client });
const recon = subagentManager.getByType("recon");
```

---

## Auth patterns supported

| Pattern | How |
|---------|-----|
| API key | `apiKey: "sk-..."` |
| JWT / Bearer | `getHeaders: () => ({ Authorization: \`Bearer ${token}\` })` |
| Async token refresh | `getHeaders: async () => ({ Authorization: \`Bearer ${await getToken()}\` })` |
| Multi-tenant | `getHeaders: () => ({ "X-Org-Id": org.id, "X-MFA-Token": mfa })` |
| Rotating credentials | `getHeaders` called fresh before every request including SSE reconnects |

---

## Install

```bash
npm install @revolt-rai/js
# or
pnpm add @revolt-rai/js
# or
yarn add @revolt-rai/js
```

React hook requires React ≥ 18 (optional peer dep — not needed for Node/vanilla usage).

## Compatibility

- Node 18+ (built-in fetch)
- All modern browsers
- React 18+
- Next.js 13+ (App Router + Pages Router)
- Works with Vite, Webpack, ESBuild
