/**
 * Pattern 01 — Markdown Messages
 *
 * LangGraph equivalent:
 *   import { useStream } from "@langchain/react";
 *   stream.submit({ messages: [{ type: "human", content: text }] })
 *   HumanMessage.isInstance(msg) / AIMessage.isInstance(msg)
 *   msg.text
 *
 * RAI changes:
 *   stream.submit(text)              ← plain string, no message wrapping
 *   msg.role === "human" / "assistant"  ← role discriminant, no class instances
 *   msg.content                      ← content field (not .text)
 */

import { useRAIStream } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

const PRESETS = [
  "Write a quick-start guide for building a REST API with Express.js",
  "Compare Python and Rust in a table with pros and cons",
  "Explain the merge sort algorithm with code examples",
];

export default function MarkdownMessages() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
    onRunCreated: ({ run_id, thread_id }) =>
      console.log("run started", run_id, thread_id),
  });

  const handleSubmit = (text: string) => {
    stream.submit(text); // ← no { messages: [...] } wrapping needed
  };

  return (
    <div className="chat-container">
      {stream.messages.length === 0 && (
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => handleSubmit(p)}>{p}</button>
          ))}
        </div>
      )}

      {stream.messages.map((msg, i) => {
        // LangGraph: HumanMessage.isInstance(msg) → msg.text
        // RAI:       msg.role === "human"         → msg.content
        if (msg.role === "human") {
          return (
            <div key={msg.id ?? i} className="human-bubble">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          );
        }

        // LangGraph: AIMessage.isInstance(msg) → msg.text
        // RAI:       msg.role === "assistant"   → msg.content
        if (msg.role === "assistant") {
          return (
            <div key={msg.id ?? i} className="ai-bubble">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          );
        }

        return null;
      })}

      {stream.isLoading && <div className="typing-indicator">Thinking…</div>}

      <input
        placeholder="Send a message…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.value.trim()) {
            handleSubmit(e.currentTarget.value.trim());
            e.currentTarget.value = "";
          }
        }}
      />

      {/* New thread — identical API to LangGraph */}
      {stream.messages.length > 0 && (
        <button onClick={() => stream.switchThread(null)}>New thread</button>
      )}
    </div>
  );
}
