# @revolt-rai/js — Pattern Examples

Each file demonstrates one integration pattern, with direct comparison to the LangGraph React SDK equivalent where applicable.

To use these files, copy them into your own React project that has `@revolt-rai/js` installed.

---

## Files

| File | Pattern | LangGraph equivalent |
|------|---------|---------------------|
| `01-markdown-messages.tsx` | Basic chat with Markdown rendering | `useStream` + `HumanMessage.isInstance` + `msg.text` |
| `02-tool-calls.tsx` | Tool call cards — bash (Kali style) + generic | `ToolCallFromTool` + `ToolCallState` + `ToolMessage` |
| `03-hitl-approval.tsx` | HITL approval panel — all 5 decision modes | `ApprovalCard` + `HITLRequest` + manual `HITLResponse` |
| `04-reasoning-tokens.tsx` | Extended thinking / reasoning blocks | `msg.contentBlocks` filtering |
| `05-message-queue.tsx` | Client-side message queue with cancel | `queue` from `useStream` (server-side) |
| `06-join-rejoin-streams.tsx` | Disconnect SSE, rejoin later | `stream.stop()` + `stream.joinStream()` |
| `07-subagent-streaming.tsx` | Subagent cards with live progress | `filterSubagentMessages` + `SubagentCard` |
| `08-plan-mode.tsx` | Plan mode — write → approve → execute | RAI-exclusive (no LangGraph equivalent) |
| `09-custom-auth.tsx` | JWT, MFA, async refresh, custom fetch | No LangGraph equivalent |
| `10-per-run-config.tsx` | Model, tools, metadata, config per submit | No LangGraph equivalent |

---

## Key API differences vs LangGraph

### Message fields
```ts
// LangGraph
HumanMessage.isInstance(msg)  → msg.text
AIMessage.isInstance(msg)     → msg.text
msg.contentBlocks.filter(b => b.type === "reasoning").map(b => b.reasoning).join("")

// RAI
msg.role === "human"      → msg.content
msg.role === "assistant"  → msg.content
msg.thinking              // direct field, no contentBlocks parsing
```

### Submit
```ts
// LangGraph
stream.submit({ messages: [{ type: "human", content: text }] })

// RAI — plain string
stream.submit(text)
stream.submit(text, { agent, model, planMode, allowedTools, metadata, config })
```

### Tool calls
```ts
// LangGraph — separate ToolMessage matched by tool_call_id
stream.toolCalls.filter(tc => msg.tool_calls?.find(t => t.id === tc.call.id))
tc.call.name / tc.call.args
result: ToolMessage (separate)
state: "pending" | "completed"

// RAI — result embedded, simple getToolCalls
stream.getToolCalls(msg.id)
tc.name / tc.args
tc.result   // embedded directly
tc.status: "running" | "done" | "error"
```

### HITL
```ts
// LangGraph — manual HITLResponse construction
stream.submit(null, { command: { resume: {
  decisions: actionRequests.map((_, i) =>
    i === idx ? { type: "approve" } : { type: "reject", message: "..." }
  )
}}})

// RAI — one method call
stream.approveInterrupt()
stream.rejectInterrupt(message)
stream.editInterrupt({ name, args })
stream.respondToInterrupt(message)    // RAI-only
stream.approveInterruptForSession()   // RAI-only
```

### stop() vs disconnect()
```ts
// LangGraph: stop() = SSE disconnect only (server continues)
stream.stop()

// RAI: stop() = SSE + server cancel (kills the run!)
stream.stop()        // ← kills server execution
stream.disconnect()  // ← SSE only, server keeps running (use for rejoin)
stream.joinStream(runId)  // reconnect
```

### Subagents
```ts
// LangGraph
stream.submit(values, { streamSubgraphs: true })  // flag required
subagent.messages[]    // full message list

// RAI — no flag needed
stream.submit(text)    // subagent events always streamed
subagent.content       // accumulated token string
subagent.thinking      // RAI-only: extended thinking
subagent.toolCalls[]   // RAI-only: tools the subagent used
subagent.model         // RAI-only: which model it used
```
