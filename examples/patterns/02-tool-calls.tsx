/**
 * Pattern 02 — Tool Calls
 *
 * LangGraph equivalent:
 *   ToolCallState = "pending" | "completed"
 *   call: ToolCallFromTool<typeof myTool>
 *   result: ToolMessage (separate object, matched by tool_call_id)
 *   stream.toolCalls.filter(tc => msg.tool_calls?.find(t => t.id === tc.call.id))
 *
 * RAI changes:
 *   tc.status = "running" | "done" | "error"   ← 3 states (LangGraph has 2)
 *   tc.result                                   ← embedded, no separate ToolMessage
 *   stream.getToolCalls(msg.id)                 ← replaces filter+find pattern
 *   tc.id / tc.name / tc.args                   ← same fields
 */

import { useState } from "react";
import { useRAIStream } from "@revolt-rai/js";
import type { ToolCall } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

// ── Generic tool card — works for any tool ───────────────────────────────────

function ToolCard({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const isPending = tc.status === "running";   // LangGraph: state === "pending"
  const isDone    = tc.status === "done";      // LangGraph: state === "completed"
  const isError   = tc.status === "error";     // RAI-only third state

  const isBash = ["bash", "shell", "Bash", "run_bash"].includes(tc.name);
  const cmd = isBash ? String(tc.args.command ?? "") : "";

  return (
    <div className={`tool-card ${isError ? "error" : ""}`}>
      <div className="tool-header" onClick={() => setOpen(o => !o)}>
        {/* Status indicator */}
        {isPending && <span className="spinner" />}
        {isDone    && <span className="check">✓</span>}
        {isError   && <span className="cross">✗</span>}

        {/* Bash: Kali terminal style */}
        {isBash ? (
          <span className="bash-header">
            <span className="bash-icon">⬢</span>
            <code>{tc.name}</code>
            {!isPending && (
              <span className="bash-prompt">
                <span className="bash-path">┌──(rai㉿rai)-[~]</span>
                <span className="bash-cmd">└─$ {cmd.slice(0, 60)}{cmd.length > 60 ? "…" : ""}</span>
              </span>
            )}
            {isPending && <span className="bash-running">{cmd.slice(0, 60)}</span>}
          </span>
        ) : (
          <span className="tool-name-inline">
            <span className="tool-icon">{toolIcon(tc.name)}</span>
            <code>{tc.name}</code>
            <span className="tool-args">({argsInline(tc.name, tc.args)})</span>
          </span>
        )}
      </div>

      {open && (
        <div className="tool-body">
          {/* Args */}
          <div className="tool-section">
            <label>Input</label>
            <pre>{JSON.stringify(tc.args, null, 2)}</pre>
          </div>

          {/* Result — tc.result is already embedded, no ToolMessage matching needed */}
          {tc.result !== undefined && (
            <div className="tool-section">
              <label>Output</label>
              <pre className={isError ? "error-output" : ""}>
                {typeof tc.result === "string"
                  ? tc.result.slice(0, 2000)
                  : JSON.stringify(tc.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main chat component ───────────────────────────────────────────────────────

export default function ToolCallsExample() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
  });

  return (
    <div>
      {stream.messages.map((msg, i) => (
        <div key={msg.id ?? i}>
          {msg.role === "human" && (
            <div className="human-bubble">{msg.content}</div>
          )}

          {msg.role === "assistant" && (
            <div>
              {msg.content && (
                <div className="ai-bubble">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}

              {/* RAI: stream.getToolCalls(msg.id) replaces filter+find pattern */}
              {stream.getToolCalls(msg.id).map((tc) => (
                <ToolCard key={tc.id} tc={tc} />
              ))}
            </div>
          )}
        </div>
      ))}

      {stream.isLoading && <div className="typing-indicator" />}

      <input
        placeholder="Ask something that requires tools…"
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolIcon(name: string): string {
  const n = name.toLowerCase();
  if (["bash","shell","run_bash","execute","cmd"].includes(n)) return "⬢";
  if (n.includes("memory")) return "🧠";
  if (n.includes("write")) return "✍";
  if (n.includes("edit"))  return "📝";
  if (n.includes("read"))  return "📖";
  if (n.includes("search") || n.includes("grep")) return "🔍";
  if (n.includes("web") || n.includes("http") || n.includes("fetch")) return "🌐";
  if (n.includes("docker")) return "🐳";
  if (n.includes("scan") || n.includes("nmap") || n.includes("exploit")) return "🎯";
  if (n.includes("key") || n.includes("token") || n.includes("jwt")) return "🔑";
  if (n.startsWith("mcp__")) return "🔌";
  return "⚙";
}

function argsInline(name: string, args: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (["bash","shell","run_bash"].includes(n)) {
    const cmd = String(args.command ?? "").split("\n")[0];
    return cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd;
  }
  if (args.file_path) return String(args.file_path);
  const pairs = Object.entries(args).slice(0, 2)
    .map(([k, v]) => `${k}=${String(v).slice(0, 25)}`);
  return pairs.join(", ");
}
