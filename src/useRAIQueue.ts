/**
 * useRAIQueue — client-side message queue built on top of useRAIStream.
 *
 * When submit() is called while a run is in progress, the message is queued
 * locally and submitted automatically after the current run ends (run_end event).
 *
 * Use case: rapid user inputs — send multiple messages without waiting.
 * The queue drains in order: first message runs immediately, rest wait.
 *
 * LangGraph equivalent: server-side queue from useStream({ queue }).
 * RAI equivalent: ephemeral client-side queue (simpler, zero-infrastructure).
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { useRAIStream, type UseRAIStreamOptions } from "./useRAIStream.js";
import type { RunEndEvent } from "./events.js";

export interface QueueEntry {
  id: string;
  text: string;
}

export interface UseRAIQueueResult extends ReturnType<typeof useRAIStream> {
  /** Override — queues message when a run is in progress, submits otherwise */
  submit: (text: string) => void;
  /** Current queue entries */
  queue: QueueEntry[];
  /** Cancel all queued messages */
  clearQueue: () => void;
  /** Cancel a specific queued message by ID */
  cancelQueued: (id: string) => void;
}

export function useRAIQueue(opts: UseRAIStreamOptions): UseRAIQueueResult {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const submitRef = useRef<((text: string) => void) | null>(null);

  const stream = useRAIStream({
    ...opts,
    onFinish: (ev: RunEndEvent) => {
      opts.onFinish?.(ev);
      // Auto-submit next queued message after current run ends
      setQueue((prev) => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        // Use microtask so run_end state settles before next submit
        Promise.resolve().then(() => submitRef.current?.(next.text));
        return rest;
      });
    },
  });

  // Always up-to-date submit ref — avoids stale closure in onFinish callback
  submitRef.current = stream.submit;

  const submit = useCallback(
    (text: string) => {
      if (stream.isLoading) {
        // Busy — enqueue
        setQueue((prev) => [
          ...prev,
          { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text },
        ]);
      } else {
        // Idle — submit immediately
        stream.submit(text);
      }
    },
    [stream],
  );

  const clearQueue = useCallback(() => setQueue([]), []);

  const cancelQueued = useCallback(
    (id: string) => setQueue((prev) => prev.filter((e) => e.id !== id)),
    [],
  );

  return {
    ...stream,
    submit,
    queue,
    clearQueue,
    cancelQueued,
  };
}
