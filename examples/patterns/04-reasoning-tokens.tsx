/**
 * Pattern 04 — Reasoning / Thinking Tokens
 *
 * LangGraph equivalent:
 *   msg.contentBlocks.filter(b => b.type === "reasoning").map(b => b.reasoning).join("")
 *   msg.contentBlocks.filter(b => b.type === "text").map(b => b.text).join("")
 *   ThinkingBubble({ content, isStreaming })
 *
 * RAI changes:
 *   msg.thinking  ← direct field, no contentBlocks parsing
 *   msg.content   ← direct field
 *   Both stream live as separate SSE events (thinking / token)
 */

import { useRAIStream } from "@revolt-rai/js";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

const PRESETS = [
  "Explain why 0.1 + 0.2 !== 0.3 in JavaScript",
  "A farmer has 100 feet of fencing. What dimensions maximize the enclosed area?",
  "Is P=NP? Explain the current state of the problem.",
];

function ThinkingBubble({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="thinking-bubble"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="thinking-summary">
        {/* Brain icon */}
        <span>🧠</span>
        {isStreaming ? (
          <span className="thinking-streaming">Thinking…</span>
        ) : (
          <span className="thinking-done">Thought for a moment</span>
        )}
      </summary>
      <pre className="thinking-content">{content}</pre>
    </details>
  );
}

export default function ReasoningTokens() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
  });

  return (
    <div>
      {stream.messages.length === 0 && (
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => stream.submit(p)}>{p}</button>
          ))}
        </div>
      )}

      {stream.messages.map((msg, i) => {
        if (msg.role === "human") {
          return (
            <div key={msg.id ?? i} className="human-bubble">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          );
        }

        if (msg.role === "assistant") {
          const isLastStreaming = stream.isLoading && i === stream.messages.length - 1;

          return (
            <div key={msg.id ?? i} className="space-y-2">
              {/* Thinking block — msg.thinking (RAI) vs contentBlocks parsing (LangGraph) */}
              {msg.thinking && (
                <ThinkingBubble
                  content={msg.thinking}
                  isStreaming={isLastStreaming}
                />
              )}

              {/* Text content — msg.content (RAI) vs contentBlocks[].text (LangGraph) */}
              {msg.content && (
                <div className="ai-bubble">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
          );
        }

        return null;
      })}

      {stream.isLoading && <div className="typing-indicator" />}

      <input
        placeholder="Ask a reasoning-heavy question…"
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
