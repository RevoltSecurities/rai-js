/**
 * Pattern 05 — Message Queue
 *
 * LangGraph equivalent:
 *   const { queue } = useStream(...)
 *   queue.size / queue.entries / queue.clear() / queue.cancel(id)
 *   Server-side queue — durable, survives page refresh, shared across tabs
 *
 * RAI approach:
 *   Client-side queue built on top of useRAIStream.
 *   useRAIQueue hook: auto-submits next message after run_end.
 *   Simpler, zero-infrastructure, sufficient for most chat UIs.
 *
 * When to use RAI client queue vs server queue:
 *   Client queue: rapid chat inputs, single user, ephemeral
 *   Server queue:  durable workflows, multi-tab, scheduled runs
 *                  → use RAIClient.createRun() directly with a task scheduler
 */

import { useCallback, useRef, useState } from "react";
import { useRAIStream } from "@revolt-rai/js";
import type { UseRAIStreamOptions, RunEndEvent } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

// ── useRAIQueue — client-side queue built on useRAIStream ────────────────────

export interface QueueEntry {
  id: string;
  text: string;
}

export function useRAIQueue(opts: UseRAIStreamOptions) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const submitRef = useRef<((text: string) => void) | null>(null);

  const stream = useRAIStream({
    ...opts,
    onFinish: (ev: RunEndEvent) => {
      opts.onFinish?.(ev);
      // Auto-submit next queued message after run completes
      setQueue((prev) => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        Promise.resolve().then(() => submitRef.current?.(next.text));
        return rest;
      });
    },
  });

  submitRef.current = stream.submit;

  const submit = useCallback(
    (text: string) => {
      if (stream.isLoading) {
        // Busy — enqueue instead of interrupting
        setQueue((prev) => [
          ...prev,
          { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text },
        ]);
      } else {
        stream.submit(text);
      }
    },
    [stream],
  );

  return {
    ...stream,
    submit,           // override — queues when busy
    queue,
    clearQueue: () => setQueue([]),
    cancelQueued: (id: string) => setQueue((p) => p.filter((e) => e.id !== id)),
  };
}

// ── QueueList component ───────────────────────────────────────────────────────

function QueueList({
  queue,
  onCancel,
}: {
  queue: QueueEntry[];
  onCancel: (id: string) => void;
}) {
  if (queue.length === 0) return null;
  return (
    <div className="queue-list">
      <div className="queue-header">{queue.length} queued</div>
      {queue.map((entry) => (
        <div key={entry.id} className="queue-entry">
          <span className="queue-dot" />
          <span className="queue-text">{entry.text}</span>
          <button
            className="queue-cancel"
            onClick={() => onCancel(entry.id)}
            title="Cancel this queued message"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PRESETS = ["What is React?", "What is Vue?", "What is Svelte?"];

export default function MessageQueueExample() {
  const { messages, submit, isLoading, queue, clearQueue, cancelQueued, switchThread } =
    useRAIQueue({
      baseUrl: "http://localhost:8000",
      agent: "rai",
    });

  const hasMessages = messages.length > 0;

  // Send all presets at once — first runs immediately, rest queue automatically
  const handleAllPresets = () => {
    for (const preset of PRESETS) submit(preset);
  };

  return (
    <div>
      <div className="chat-body">
        {!hasMessages && (
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => submit(p)}>{p}</button>
            ))}
            <button onClick={handleAllPresets}>Send all 3 at once →</button>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id ?? i}>
            {msg.role === "human" && (
              <div className="human-bubble">{msg.content}</div>
            )}
            {msg.role === "assistant" && msg.content && (
              <div className="ai-bubble">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}

        {isLoading && <div className="typing-indicator" />}

        {/* Queue display */}
        <QueueList queue={queue} onCancel={cancelQueued} />
      </div>

      <div className="chat-input-area">
        <input
          placeholder="Send a message (will queue if busy)…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              submit(e.currentTarget.value.trim()); // auto-queues when busy
              e.currentTarget.value = "";
            }
          }}
        />

        {queue.length > 0 && (
          <button className="clear-queue" onClick={clearQueue}>
            ✕ Clear queue ({queue.length})
          </button>
        )}

        {hasMessages && (
          <button onClick={() => switchThread(null)}>New thread</button>
        )}
      </div>
    </div>
  );
}
