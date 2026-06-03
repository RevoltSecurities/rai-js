/**
 * Pattern 07 — Subagent Streaming
 *
 * LangGraph equivalent:
 *   useStream({ filterSubagentMessages: true })
 *   stream.submit(values, { streamSubgraphs: true })
 *   stream.getSubagentsByMessage(msg.id)
 *   subagent.status === "complete" | "error" | "running" | "pending"
 *   SubagentCard({ subagent })
 *
 * RAI changes:
 *   filterSubagentMessages: true  ← identical option
 *   No streamSubgraphs flag needed — RAI always streams subagent events
 *   stream.getSubagentsByMessage(msg.id)  ← identical API
 *   subagent.status: "pending"|"running"|"complete"|"error"  ← identical
 *   subagent.content   ← accumulated tokens (LangGraph: subagent.messages[])
 *   subagent.thinking  ← RAI-only: extended thinking from subagent
 *   subagent.toolCalls ← RAI-only: tools the subagent used
 *   subagent.model     ← RAI-only: which model the subagent used
 */

import { useRAIStream } from "@revolt-rai/js";
import type { SubagentStream } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

const PRESETS = [
  "Research and summarize the latest developments in quantum computing",
  "Analyze the pros and cons of microservices vs monolith architecture",
  "Find vulnerabilities in a typical Node.js Express application",
];

// ── SubagentCard component ────────────────────────────────────────────────────

function SubagentCard({ sa }: { sa: SubagentStream }) {
  const isRunning  = sa.status === "running";
  const isDone     = sa.status === "complete";
  const isError    = sa.status === "error";

  const statusColor = isRunning ? "#58a6ff" : isDone ? "#3fb950" : isError ? "#f85149" : "#6e7681";
  const statusIcon  = isRunning ? "◉" : isDone ? "●" : isError ? "✗" : "○";

  return (
    <div className="subagent-card">
      <div className="subagent-header">
        {/* Pulsing dot for running */}
        <span className={`subagent-dot ${isRunning ? "pulsing" : ""}`}
          style={{ color: statusColor }}>
          {statusIcon}
        </span>
        <strong className="subagent-name">{sa.name}</strong>

        {/* RAI-only: which model the subagent used */}
        {sa.model && <span className="subagent-model">{sa.model.split("/").pop()}</span>}
      </div>

      {/* Live token preview while running */}
      {isRunning && sa.content && (
        <p className="subagent-preview">{sa.content.slice(-120)}</p>
      )}

      {/* Output when done */}
      {isDone && sa.outputPreview && (
        <p className="subagent-output">{sa.outputPreview}</p>
      )}

      {/* RAI-only: extended thinking from subagent */}
      {sa.thinking && (
        <details className="subagent-thinking">
          <summary>Thinking</summary>
          <pre>{sa.thinking}</pre>
        </details>
      )}

      {/* RAI-only: tools the subagent used */}
      {sa.toolCalls.length > 0 && (
        <div className="subagent-tools">
          {sa.toolCalls.map((tc, i) => (
            <code key={i} className="tool-chip">{tc.name}</code>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SubagentStreamingExample() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
    filterSubagentMessages: true, // ← identical to LangGraph option
    onRunCreated: ({ run_id }) => console.log("run", run_id),
  });

  // Compute subagent stats — identical to LangGraph pattern
  const subagentList = Array.from(stream.subagents.values());
  const hasSubagents   = subagentList.length > 0;
  const completedCount = subagentList.filter((s) => s.status === "complete").length;
  const totalCount     = subagentList.length;
  const allDone        = hasSubagents &&
    subagentList.every((s) => s.status === "complete" || s.status === "error");

  // Filter messages — same logic as LangGraph snippet
  const messages = stream.messages.filter((msg) => {
    if (msg.role === "human") return true;
    if (msg.role === "assistant") {
      return msg.content.trim().length > 0 ||
        stream.getSubagentsByMessage(msg.id).length > 0;
    }
    return false;
  });

  return (
    <div>
      {messages.length === 0 && !hasSubagents && (
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => stream.submit(p)}>{p}</button>
          ))}
        </div>
      )}

      {messages.map((msg, i) => {
        const key = msg.id ?? `msg-${i}`;
        // Subagents spawned in this AI message's turn
        const turnSubagents = msg.role === "assistant"
          ? stream.getSubagentsByMessage(msg.id)  // ← identical to LangGraph
          : [];

        return (
          <div key={key}>
            {msg.role === "human" && (
              <div className="human-bubble">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            )}

            {msg.role === "assistant" && msg.content && (
              <div className="ai-bubble">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            )}

            {/* Subagent grid — identical structure to LangGraph SubagentCard pattern */}
            {turnSubagents.length > 0 && (
              <div className="subagent-section">
                <div className="subagent-meta">
                  <span>Specialist agents · {completedCount}/{totalCount} completed</span>
                </div>

                {/* Progress bar */}
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${totalCount ? (completedCount / totalCount) * 100 : 0}%` }}
                  />
                </div>

                <div className="subagent-grid">
                  {turnSubagents.map((sa) => (
                    <SubagentCard key={sa.id} sa={sa} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Typing indicator — only before any subagents appear */}
      {stream.isLoading && !hasSubagents && <div className="typing-indicator" />}

      {/* Synthesizing indicator — all subagents done but run still active */}
      {stream.isLoading && allDone && (
        <div className="synthesizing">
          <span className="pulse-icon">✦</span>
          Synthesizing results…
        </div>
      )}

      <input
        placeholder="Ask something that requires specialist agents…"
        disabled={stream.isLoading}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            stream.submit(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
      />

      {stream.messages.length > 0 && (
        <button onClick={() => stream.switchThread(null)}>New thread</button>
      )}
    </div>
  );
}
