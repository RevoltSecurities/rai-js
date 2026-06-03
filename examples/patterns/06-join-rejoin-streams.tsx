/**
 * Pattern 06 — Join & Rejoin Streams
 *
 * LangGraph equivalent:
 *   stream.stop()                                     ← closes SSE only (server continues)
 *   stream.joinStream(runId)                          ← reconnect
 *   stream.submit(values, { onDisconnect: "continue", streamResumable: true })
 *
 * RAI changes:
 *   stream.disconnect()   ← SSE only, server keeps running (HITL/plan/subagents active)
 *   stream.stop()         ← SSE + server cancel (DIFFERENT from LangGraph stop())
 *   stream.joinStream(runId, lastEventId?)  ← identical API
 *   No flags needed on submit — RAI server always continues on disconnect
 *
 * CRITICAL distinction:
 *   LangGraph stop() = SSE disconnect only (server continues by default)
 *   RAI      stop() = SSE + server cancel (kills the run)
 *   RAI   disconnect() = SSE only (server continues) ← use this for rejoin pattern
 */

import { useState, useCallback } from "react";
import { useRAIStream } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

const PRESETS = [
  "Do a thorough analysis of the differences between React, Vue, and Angular",
];

export default function JoinRejoinExample() {
  const [connected, setConnected] = useState(true);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);

  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
    onRunCreated: ({ run_id }) => {
      setSavedRunId(run_id);
    },
    // reconnectOnMount: true  ← auto-rejoin on page refresh via sessionStorage
  });

  // Disconnect SSE only — server keeps running
  // LangGraph: stream.stop() (server continues by default)
  // RAI:       stream.disconnect() ← must use disconnect(), NOT stop()
  const handleDisconnect = useCallback(() => {
    stream.disconnect();  // ✓ server keeps running, HITL/plan/subagents continue
    setConnected(false);
  }, [stream]);

  // Reconnect — replays missed events via Last-Event-ID
  // Identical API to LangGraph
  const handleRejoin = useCallback(() => {
    if (savedRunId) {
      stream.joinStream(savedRunId); // server sends all events since disconnect
      setConnected(true);
    }
  }, [stream, savedRunId]);

  const handleSubmit = (text: string) => {
    setConnected(true);
    stream.submit(text); // no special flags — RAI server always continues on disconnect
  };

  const hasMessages = stream.messages.length > 0;

  return (
    <div>
      {/* Connection status bar */}
      <div className="status-bar">
        <div className="connection-status">
          <span className={`status-dot ${connected ? "connected" : "disconnected"}`} />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>

        <div className="status-actions">
          {savedRunId && (
            <span className="run-id">Run: {savedRunId.slice(0, 8)}…</span>
          )}

          {/* Disconnect button — only shown while streaming */}
          {stream.isLoading && connected && (
            <button className="disconnect-btn" onClick={handleDisconnect}>
              Disconnect
            </button>
          )}

          {/* Rejoin button — shown after disconnect */}
          {!connected && savedRunId && (
            <button className="rejoin-btn" onClick={handleRejoin}>
              Rejoin
            </button>
          )}
        </div>
      </div>

      <div className="chat-body">
        {!hasMessages && (
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => handleSubmit(p)}>{p}</button>
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
            return (
              <div key={msg.id ?? i}>
                {msg.content && (
                  <div className="ai-bubble">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )}
                {/* Tool calls still visible */}
                {stream.getToolCalls(msg.id).map((tc) => (
                  <div key={tc.id} className="tool-card-mini">
                    {tc.status === "running" ? "⟳" : tc.status === "done" ? "✓" : "✗"}
                    {" "}<code>{tc.name}</code>
                  </div>
                ))}
              </div>
            );
          }

          return null;
        })}

        {stream.isLoading && connected && <div className="typing-indicator" />}

        {/* Disconnected but run still active */}
        {!connected && stream.isLoading && (
          <div className="disconnected-notice">
            ⚠ Stream disconnected — agent may still be running server-side.
            Click Rejoin to reconnect.
          </div>
        )}
      </div>

      <input
        placeholder="Send a message…"
        disabled={stream.isLoading}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSubmit(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
      />

      {hasMessages && (
        <button onClick={() => stream.switchThread(null)}>New thread</button>
      )}
    </div>
  );
}
