/**
 * useRAIStream — React hook for the RAI SSE event stream.
 *
 * Architecture:
 * - All rendering state lives in a single useReducer (React-native, no tearing)
 * - Mutable refs track currentAIMsgId, pendingTools, abort, etc. (no re-render)
 * - processEventRef always points to the latest dispatch function (no stale closures)
 * - SubagentManager is a plain class instance in a ref; its changes bump a counter
 *   in React state to trigger re-renders
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { RAIClient, CreateRunOptions, InterruptDecision, InterruptState, ThreadMessage, HeadersResolver } from "./client.js";
import type { RAIEvent, RunEndEvent } from "./events.js";
import { SubagentManager, type SubagentStream } from "./subagents.js";

// ---------------------------------------------------------------------------
// Plan exec tools — suppressed from tool cards (they get step/plan rendering).
// ---------------------------------------------------------------------------
const PLAN_EXEC_TOOLS = new Set([
  "enter_plan_mode", "enter_step", "mark_step_done",
  "mark_step_blocked", "exit_plan_mode", "list_plan_steps",
]);
const SUPPRESS_TOOL_CARDS = new Set([
  ...PLAN_EXEC_TOOLS,
  "ask_user", "compact_conversation",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageRole = "human" | "assistant";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "running" | "done" | "error";
}

export interface StreamMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  _planModeEntered?: boolean;
  _historyDivider?: { loaded: number; total: number; threadId: string };
}

export type PlanStepStatus = "pending" | "running" | "complete" | "blocked";

export interface PlanStep {
  number: number;
  description: string;
  status: PlanStepStatus;
  notes?: string;
}

export interface PlanState {
  raw: string;
  steps: PlanStep[];
  currentStep?: number;
  totalSteps?: number;
  status: "pending" | "approved" | "rejected" | "running" | "completed";
  approveUrl?: string;
  rejectUrl?: string;
}

export interface SubmitOptions extends CreateRunOptions {
  agent?: string;
  optimisticMessages?: StreamMessage[];
  multitaskStrategy?: "interrupt" | "enqueue" | "reject";
}

export interface UseRAIStreamOptions {
  baseUrl?: string;
  /** X-API-Key header value */
  apiKey?: string;
  /**
   * Header resolver — called before EVERY request (REST + SSE streams).
   * Use for JWT, MFA tokens, rotating credentials, multi-tenant headers.
   *
   * Accepts a plain object, sync fn, or async fn:
   *   getHeaders: { Authorization: `Bearer ${token}` }          // static
   *   getHeaders: () => ({ Authorization: localStorage.getItem("jwt") })  // sync
   *   getHeaders: async () => ({ Authorization: await getToken() })       // async
   *
   * Applied to: submit, HITL approve/reject, plan approve/reject,
   *   answerAskUser, thread history, interrupt checks — every single call.
   */
  getHeaders?: HeadersResolver;
  /** @deprecated Use getHeaders instead */
  defaultHeaders?: Record<string, string>;
  /**
   * Custom fetch implementation — use for proxy, request signing, audit logging.
   * Applied to all requests including SSE streams, HITL, plan, and REST calls.
   */
  fetch?: typeof fetch;
  agent?: string;
  threadId?: string | null;
  onThreadId?: (threadId: string) => void;
  onRunCreated?: (meta: { run_id: string; thread_id: string }) => void;
  onFinish?: (event: RunEndEvent) => void;
  onError?: (error: Error, meta?: { run_id?: string; thread_id?: string }) => void;
  onEvent?: (event: RAIEvent) => void;
  reconnectOnMount?: boolean;
  filterSubagentMessages?: boolean;
}

export interface UseRAIStreamResult {
  messages: StreamMessage[];
  isLoading: boolean;
  isThreadLoading: boolean;
  error: Error | null;
  toolCalls: ToolCall[];
  getToolCalls: (messageId: string) => ToolCall[];
  interrupt: InterruptState | null;
  interrupts: InterruptState[];
  askUser: { questions: Array<{ question: string; options?: string[] }>; toolCallId: string } | null;
  subagents: Map<string, SubagentStream>;
  activeSubagents: SubagentStream[];
  getSubagent: (taskId: string) => SubagentStream | undefined;
  getSubagentsByMessage: (messageId: string) => SubagentStream[];
  getSubagentsByType: (agentName: string) => SubagentStream[];
  plan: PlanState | null;
  runId: string | null;
  threadId: string | null;
  threadTotalMessages: number;
  sessionApprovedTools: string[];
  submit: (input: string, opts?: SubmitOptions) => void;
  /** Abort SSE + cancel server-side execution. All subagents/HITL terminated. */
  stop: () => void;
  /** Abort SSE only — server keeps running. Rejoin later via joinStream(runId). */
  disconnect: () => void;
  switchThread: (threadId: string | null) => void;
  joinStream: (runId: string, lastEventId?: string) => void;
  approveInterrupt: (decision?: InterruptDecision) => Promise<void>;
  rejectInterrupt: (message?: string) => Promise<void>;
  editInterrupt: (editedAction: { name: string; args: Record<string, unknown> }) => Promise<void>;
  respondToInterrupt: (message: string) => Promise<void>;
  approveInterruptForSession: () => Promise<void>;
  answerAskUser: (answers: string[]) => Promise<void>;
  approvePlan: () => Promise<void>;
  rejectPlan: (feedback?: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Reducer state — everything React needs to re-render
// ---------------------------------------------------------------------------

interface State {
  messages: StreamMessage[];
  isLoading: boolean;
  isThreadLoading: boolean;
  error: Error | null;
  toolCalls: ToolCall[];
  interrupts: InterruptState[];
  askUser: UseRAIStreamResult["askUser"];
  plan: PlanState | null;
  runId: string | null;
  threadId: string | null;
  sessionApprovedTools: string[];
  threadTotalMessages: number;
  subagentTick: number; // bump to re-render when SubagentManager changes
}

type Action =
  | { type: "SET"; patch: Partial<State> }
  | { type: "RESET"; threadId: string | null }
  | { type: "APPEND_CONTENT"; msgId: string; content: string }
  | { type: "APPEND_THINKING"; msgId: string; content: string }
  | { type: "ADD_MESSAGE"; msg: StreamMessage }
  | { type: "UPDATE_TOOL"; tcId: string; result: unknown; status: "done" | "error" }
  | { type: "ATTACH_TOOL"; msgId: string; tc: ToolCall }
  | { type: "ADD_AI_WITH_TOOL"; msgId: string; tc: ToolCall }
  | { type: "UPSERT_PLAN_STEP"; step: PlanStep }
  | { type: "SUBAGENT_TICK" };

const INITIAL_STATE: State = {
  messages: [],
  isLoading: false,
  isThreadLoading: false,
  error: null,
  toolCalls: [],
  interrupts: [],
  askUser: null,
  plan: null,
  runId: null,
  threadId: null,
  sessionApprovedTools: [],
  threadTotalMessages: 0,
  subagentTick: 0,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET":
      return { ...state, ...action.patch };

    case "RESET":
      return { ...INITIAL_STATE, threadId: action.threadId };

    case "APPEND_CONTENT": {
      const msgs = state.messages;
      const idx = msgs.findLastIndex((m) => m.id === action.msgId);
      if (idx < 0) return state;
      const updated = [...msgs];
      updated[idx] = { ...updated[idx], content: updated[idx].content + action.content };
      return { ...state, messages: updated };
    }

    case "APPEND_THINKING": {
      const msgs = state.messages;
      const idx = msgs.findLastIndex((m) => m.id === action.msgId);
      if (idx < 0) return state;
      const updated = [...msgs];
      updated[idx] = { ...updated[idx], thinking: (updated[idx].thinking ?? "") + action.content };
      return { ...state, messages: updated };
    }

    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.msg] };

    case "ATTACH_TOOL": {
      const msgs = state.messages;
      const idx = msgs.findLastIndex((m) => m.id === action.msgId);
      if (idx < 0) return state;
      const updated = [...msgs];
      const msg = updated[idx];
      updated[idx] = { ...msg, toolCalls: [...(msg.toolCalls ?? []), action.tc] };
      return {
        ...state,
        messages: updated,
        toolCalls: [...state.toolCalls, action.tc],
      };
    }

    case "ADD_AI_WITH_TOOL": {
      const aiMsg: StreamMessage = {
        id: action.msgId,
        role: "assistant" as const,
        content: "",
        toolCalls: [action.tc],
      };
      return {
        ...state,
        messages: [...state.messages, aiMsg],
        toolCalls: [...state.toolCalls, action.tc],
      };
    }

    case "UPDATE_TOOL": {
      const updater = (tc: ToolCall) =>
        tc.id === action.tcId
          ? { ...tc, result: action.result, status: action.status }
          : tc;
      return {
        ...state,
        toolCalls: state.toolCalls.map(updater),
        messages: state.messages.map((m) =>
          m.role === "assistant" && m.toolCalls
            ? { ...m, toolCalls: m.toolCalls.map(updater) }
            : m,
        ),
      };
    }

    case "UPSERT_PLAN_STEP": {
      if (!state.plan) return state;
      const steps = state.plan.steps;
      const idx = steps.findIndex((s) => s.number === action.step.number);
      const newSteps = idx >= 0
        ? steps.map((s, i) => (i === idx ? { ...s, ...action.step } : s))
        : [...steps, action.step];
      return { ...state, plan: { ...state.plan, steps: newSteps } };
    }

    case "SUBAGENT_TICK":
      return { ...state, subagentTick: state.subagentTick + 1 };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRAIStream(opts: UseRAIStreamOptions): UseRAIStreamResult {
  // Stable ref for getHeaders — function identity changes every render if defined
  // inline; using a ref means the resolver always calls the latest closure
  // without requiring it in useMemo deps (which would recreate client every render)
  const getHeadersRef = useRef(opts.getHeaders ?? opts.defaultHeaders);
  getHeadersRef.current = opts.getHeaders ?? opts.defaultHeaders;

  const client = useMemo(
    () => new RAIClient({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      agent: opts.agent,
      fetch: opts.fetch,
      // Stable wrapper: always calls the latest resolver via ref,
      // so the client instance is stable while tokens update dynamically
      getHeaders: getHeadersRef.current
        ? async () => {
            const resolver = getHeadersRef.current!;
            return typeof resolver === "function" ? resolver() : { ...resolver };
          }
        : undefined,
    }),
    [opts.baseUrl, opts.apiKey, opts.agent, opts.fetch], // client recreates on connection change
  );

  const cbRefs = useRef({
    onRunCreated: opts.onRunCreated,
    onFinish: opts.onFinish,
    onError: opts.onError,
    onEvent: opts.onEvent,
    onThreadId: opts.onThreadId,
    filterSubagentMessages: opts.filterSubagentMessages ?? true,
  });
  cbRefs.current.onRunCreated = opts.onRunCreated;
  cbRefs.current.onFinish = opts.onFinish;
  cbRefs.current.onError = opts.onError;
  cbRefs.current.onEvent = opts.onEvent;
  cbRefs.current.onThreadId = opts.onThreadId;
  cbRefs.current.filterSubagentMessages = opts.filterSubagentMessages ?? true;

  const [state, dispatch] = useReducer(reducer, {
    ...INITIAL_STATE,
    threadId: opts.threadId ?? null,
  });

  // Mutable refs — don't need React re-renders
  const abortRef = useRef<AbortController | null>(null);
  const currentAIMsgIdRef = useRef<string | null>(null);
  const toolCallSeqRef = useRef(0);
  const pendingToolsRef = useRef<Map<string, string>>(new Map()); // "name:id" → id

  // SubagentManager — stable instance, signals React via dispatch
  const subagentMgrRef = useRef<SubagentManager | null>(null);
  if (!subagentMgrRef.current) {
    subagentMgrRef.current = new SubagentManager({
      onSubagentChange: () => dispatch({ type: "SUBAGENT_TICK" }),
    });
  }
  const subagentMgr = subagentMgrRef.current;

  // Latest dispatch ref — async loop calls this, always up-to-date
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // State ref for synchronous reads inside the event processor
  // (avoids depending on React render cycle for internal logic)
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------------------------------------------------------------------------
  // Event processor — reads stateRef for current values, writes via dispatch
  // ---------------------------------------------------------------------------

  const processEventRef = useRef<((ev: RAIEvent) => void) | null>(null);
  processEventRef.current = useCallback((ev: RAIEvent) => {
    cbRefs.current.onEvent?.(ev);
    const s = stateRef.current;

    switch (ev.type) {

      case "run_start":
        dispatchRef.current({ type: "SET", patch: { runId: ev.run_id } });
        break;

      // ── Tokens ──────────────────────────────────────────────────────────────

      case "token": {
        const id = currentAIMsgIdRef.current;
        if (id && s.messages.some((m) => m.id === id)) {
          dispatchRef.current({ type: "APPEND_CONTENT", msgId: id, content: ev.content });
        } else {
          const newId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          currentAIMsgIdRef.current = newId;
          dispatchRef.current({
            type: "ADD_MESSAGE",
            msg: { id: newId, role: "assistant", content: ev.content, toolCalls: [] },
          });
        }
        break;
      }

      case "thinking": {
        const id = currentAIMsgIdRef.current;
        if (id && s.messages.some((m) => m.id === id)) {
          dispatchRef.current({ type: "APPEND_THINKING", msgId: id, content: ev.content });
        } else {
          const newId = `ai-think-${Date.now()}`;
          currentAIMsgIdRef.current = newId;
          dispatchRef.current({
            type: "ADD_MESSAGE",
            msg: { id: newId, role: "assistant", content: "", thinking: ev.content, toolCalls: [] },
          });
        }
        break;
      }

      // ── Tool calls ───────────────────────────────────────────────────────────

      case "tool_start": {
        if (SUPPRESS_TOOL_CARDS.has(ev.tool_name)) break;
        const tcId = `tc-${toolCallSeqRef.current++}`;
        pendingToolsRef.current.set(`${ev.tool_name}:${tcId}`, tcId);
        const tc: ToolCall = { id: tcId, name: ev.tool_name, args: ev.tool_input, status: "running" };

        const currentId = currentAIMsgIdRef.current;
        if (currentId && s.messages.some((m) => m.id === currentId && m.role === "assistant")) {
          dispatchRef.current({ type: "ATTACH_TOOL", msgId: currentId, tc });
        } else {
          const msgId = `ai-tool-${tcId}`;
          currentAIMsgIdRef.current = msgId;
          dispatchRef.current({ type: "ADD_AI_WITH_TOOL", msgId, tc });
        }
        break;
      }

      case "tool_end": {
        if (SUPPRESS_TOOL_CARDS.has(ev.tool_name)) break;
        let foundKey: string | null = null;
        let foundId: string | null = null;
        for (const [k, v] of pendingToolsRef.current.entries()) {
          if (k.startsWith(`${ev.tool_name}:`)) { foundKey = k; foundId = v; break; }
        }
        if (!foundKey || !foundId) break;
        pendingToolsRef.current.delete(foundKey);
        const out = ev.tool_output;
        const isErr = typeof out === "string" && out.toLowerCase().startsWith("error");
        dispatchRef.current({ type: "UPDATE_TOOL", tcId: foundId, result: out, status: isErr ? "error" : "done" });
        break;
      }

      // ── HITL ─────────────────────────────────────────────────────────────────

      case "interrupt":
        dispatchRef.current({
          type: "SET",
          patch: {
            interrupts: [
              ...s.interrupts,
              {
                pending: true,
                interrupt_id: ev.interrupt_id,
                action_requests: ev.action_requests,
                thread_id: ev.thread_id,
                session_approved_tools: s.sessionApprovedTools,
              },
            ],
          },
        });
        break;

      case "interrupt_resolved":
        dispatchRef.current({
          type: "SET",
          patch: { interrupts: s.interrupts.filter((i) => i.interrupt_id !== ev.interrupt_id) },
        });
        break;

      case "interrupt_auto_approved":
        dispatchRef.current({ type: "SET", patch: { interrupts: [] } });
        break;

      case "session_approved":
        dispatchRef.current({
          type: "SET",
          patch: { interrupts: [], sessionApprovedTools: ev.session_approved_tools },
        });
        break;

      case "ask_user_request":
        dispatchRef.current({
          type: "SET",
          patch: { askUser: { questions: ev.questions, toolCallId: ev.tool_call_id } },
        });
        break;

      // ── Plan ─────────────────────────────────────────────────────────────────

      case "plan_mode_entered":
        dispatchRef.current({ type: "SET", patch: { plan: { raw: "", steps: [], status: "pending" } } });
        break;

      case "plan_ready":
        dispatchRef.current({
          type: "SET",
          patch: { plan: { raw: ev.plan, steps: s.plan?.steps ?? [], status: "pending", approveUrl: ev.approve_url, rejectUrl: ev.reject_url } },
        });
        break;

      case "plan_approved":
        if (s.plan) dispatchRef.current({ type: "SET", patch: { plan: { ...s.plan, status: "approved" } } });
        break;

      case "plan_rejected":
        if (s.plan) dispatchRef.current({ type: "SET", patch: { plan: { ...s.plan, status: "rejected" } } });
        break;

      case "step_start":
        dispatchRef.current({
          type: "UPSERT_PLAN_STEP",
          step: { number: ev.step_number, description: ev.description, status: "running" },
        });
        {
          // Read fresh after UPSERT_PLAN_STEP — s.plan is stale at this point
          const freshPlan = stateRef.current.plan;
          if (freshPlan) {
            dispatchRef.current({ type: "SET", patch: { plan: { ...freshPlan, status: "running", currentStep: ev.step_number } } });
          }
        }
        break;

      case "step_complete":
        dispatchRef.current({
          type: "UPSERT_PLAN_STEP",
          step: { number: ev.step_number, description: ev.description, status: "complete", notes: ev.notes },
        });
        break;

      case "step_blocked":
        dispatchRef.current({
          type: "UPSERT_PLAN_STEP",
          step: { number: ev.step_number, description: ev.description, status: "blocked", notes: ev.reason },
        });
        break;

      case "plan_completed":
        if (s.plan) {
          dispatchRef.current({ type: "SET", patch: { plan: { ...s.plan, status: "completed", totalSteps: ev.total_steps } } });
        }
        break;

      // ── Subagents ────────────────────────────────────────────────────────────

      case "subagent_started":
        subagentMgr.onStarted(ev.task_id, ev.agent_name, ev.input, ev.model, ev.parent_run_id, currentAIMsgIdRef.current);
        break;

      case "subagent_token":
        subagentMgr.onToken(ev.task_id, ev.content);
        break;

      case "subagent_thinking":
        subagentMgr.onThinking(ev.task_id, ev.content);
        break;

      case "subagent_tool_start":
        subagentMgr.onToolStart(ev.task_id, ev.tool_name, ev.tool_input);
        break;

      case "subagent_completed":
        subagentMgr.onCompleted(ev.task_id, ev.status, ev.output_preview, ev.output_file);
        break;

      case "subagent_error":
        subagentMgr.onError(ev.task_id, ev.message);
        break;

      case "subagent_interrupt":
        subagentMgr.onInterrupt(ev.task_id);
        break;

      // ── Run lifecycle ────────────────────────────────────────────────────────

      case "run_end":
        currentAIMsgIdRef.current = null;
        toolCallSeqRef.current = 0;
        pendingToolsRef.current.clear();
        dispatchRef.current({ type: "SET", patch: { isLoading: false } });
        cbRefs.current.onFinish?.(ev);
        break;

      case "error":
        dispatchRef.current({ type: "SET", patch: { isLoading: false, error: new Error(ev.message) } });
        cbRefs.current.onError?.(new Error(ev.message), { run_id: ev.run_id, thread_id: ev.thread_id });
        break;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Stream runner
  // ---------------------------------------------------------------------------

  const _streamRun = useCallback(async (
    runId: string,
    agent: string,
    abort: AbortController,
    lastEventId?: string,
  ) => {
    try {
      for await (const ev of client.streamRun(runId, agent, lastEventId)) {
        if (abort.signal.aborted) break;
        processEventRef.current?.(ev as RAIEvent);
      }
    } catch (err: unknown) {
      if (!abort.signal.aborted) {
        const error = err instanceof Error ? err : new Error(String(err));
        dispatchRef.current({ type: "SET", patch: { isLoading: false, error } });
        cbRefs.current.onError?.(error);
      }
    }
  }, [client]);

  // ---------------------------------------------------------------------------
  // Thread history loading
  // ---------------------------------------------------------------------------

  const _loadThreadHistory = useCallback(async (threadId: string) => {
    dispatchRef.current({ type: "SET", patch: { isThreadLoading: true, error: null } });
    try {
      const probe = await client.getThreadHistory(threadId, { limit: 1, offset: 0 });
      const total = probe.total;
      const PAGE = 50;
      const offset = Math.max(0, total - PAGE);
      const history = total <= 1
        ? probe
        : await client.getThreadHistory(threadId, { limit: PAGE, offset });

      const messages: StreamMessage[] = [];
      const pendingToolCalls = new Map<string, { msgIdx: number; tcIdx: number }>();

      for (const msg of history.messages) {
        if (msg.type === "system") continue;

        if (msg.type === "human") {
          const c = msg.content ?? "";
          if (!c || c.startsWith("[Background agent") || c.trim() === "/compact" || c.includes("<system-reminder>")) continue;
          messages.push({ id: msg.id ?? `h-${messages.length}`, role: "human", content: c });
        }

        else if (msg.type === "ai") {
          const toolCalls: ToolCall[] = [];
          let showPlanModeEntered = false;
          for (const tc of msg.tool_calls ?? []) {
            if (tc.name === "enter_plan_mode") { showPlanModeEntered = true; continue; }
            if (SUPPRESS_TOOL_CARDS.has(tc.name)) continue;
            const toolCall: ToolCall = {
              id: tc.id ?? `tc-h-${messages.length}-${toolCalls.length}`,
              name: tc.name,
              args: tc.args ?? {},
              status: "done",
            };
            toolCalls.push(toolCall);
            if (tc.id) pendingToolCalls.set(tc.id, { msgIdx: messages.length, tcIdx: toolCalls.length - 1 });
          }
          if ((msg.content && msg.content.trim()) || toolCalls.length > 0) {
            if (showPlanModeEntered) {
              messages.push({ id: `plan-entered-${messages.length}`, role: "assistant", content: "", _planModeEntered: true });
            }
            messages.push({
              id: msg.id ?? `ai-${messages.length}`,
              role: "assistant",
              content: msg.content ?? "",
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }

        else if (msg.type === "tool") {
          const toolCallId = msg.tool_call_id ?? "";
          const toolName = msg.name ?? "tool";
          if (SUPPRESS_TOOL_CARDS.has(toolName)) continue;
          const output = msg.content ?? "";
          const isError = typeof output === "string" && output.toLowerCase().startsWith("error");
          if (toolCallId && pendingToolCalls.has(toolCallId)) {
            const { msgIdx, tcIdx } = pendingToolCalls.get(toolCallId)!;
            const aiMsg = messages[msgIdx];
            if (aiMsg?.toolCalls?.[tcIdx]) {
              aiMsg.toolCalls[tcIdx] = { ...aiMsg.toolCalls[tcIdx], result: output, status: isError ? "error" : "done" };
            }
            pendingToolCalls.delete(toolCallId);
          }
        }
      }

      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          _historyDivider: { loaded: messages.length, total: history.total, threadId },
        };
      }

      dispatchRef.current({
        type: "SET",
        patch: { messages, threadId, isThreadLoading: false, threadTotalMessages: history.total },
      });
      cbRefs.current.onThreadId?.(threadId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatchRef.current({ type: "SET", patch: { isThreadLoading: false, error } });
    }
  }, [client]);

  // ---------------------------------------------------------------------------
  // submit
  // ---------------------------------------------------------------------------

  const submit = useCallback((input: string, submitOpts: SubmitOptions = {}) => {
    const agent = submitOpts.agent ?? client.agent;
    const s = stateRef.current;

    if (s.isLoading) {
      if (submitOpts.multitaskStrategy === "reject") throw new Error("A run is already in progress");
      abortRef.current?.abort();
      if (s.runId) client.cancelRun(s.runId, agent).catch(() => {});
    }

    const abort = new AbortController();
    abortRef.current = abort;
    currentAIMsgIdRef.current = null;
    toolCallSeqRef.current = 0;
    pendingToolsRef.current.clear();

    const humanMsg: StreamMessage = { id: `human-${Date.now()}`, role: "human", content: input };
    const optimistic = submitOpts.optimisticMessages ?? [];

    dispatchRef.current({
      type: "SET",
      patch: {
        isLoading: true,
        error: null,
        interrupts: [],
        askUser: null,
        toolCalls: [],
        // Keep existing plan state — don't reset it on new message
        messages: [...s.messages, humanMsg, ...optimistic],
      },
    });

    (async () => {
      try {
        const run = await client.createRun(input, agent, {
          threadId: s.threadId ?? undefined,
          ...submitOpts,
        });
        dispatchRef.current({
          type: "SET",
          patch: {
            runId: run.run_id,
            threadId: run.thread_id,
          },
        });
        if (!s.threadId || s.threadId !== run.thread_id) {
          cbRefs.current.onThreadId?.(run.thread_id);
        }
        cbRefs.current.onRunCreated?.({ run_id: run.run_id, thread_id: run.thread_id });
        if (opts.reconnectOnMount && typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(`rai:stream:${run.thread_id}`, run.run_id);
        }
        await _streamRun(run.run_id, agent, abort);
        if (opts.reconnectOnMount && typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem(`rai:stream:${run.thread_id}`);
        }
      } catch (err: unknown) {
        if (!abort.signal.aborted) {
          const error = err instanceof Error ? err : new Error(String(err));
          dispatchRef.current({ type: "SET", patch: { isLoading: false, error } });
          cbRefs.current.onError?.(error);
        }
      }
    })();
  }, [client, _streamRun, opts.reconnectOnMount]);

  // ---------------------------------------------------------------------------
  // joinStream
  // ---------------------------------------------------------------------------

  const joinStream = useCallback((runId: string, lastEventId?: string) => {
    const agent = opts.agent ?? client.agent;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    dispatchRef.current({ type: "SET", patch: { isLoading: true, error: null, runId } });
    void _streamRun(runId, agent, abort, lastEventId);
  }, [client, _streamRun, opts.agent]);

  // ---------------------------------------------------------------------------
  // reconnectOnMount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!opts.reconnectOnMount) return;
    const tid = stateRef.current.threadId; // use live state, not stale prop
    if (!tid) return;
    if (typeof sessionStorage === "undefined") return;
    const runId = sessionStorage.getItem(`rai:stream:${tid}`);
    if (runId) joinStream(runId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // stop
  // ---------------------------------------------------------------------------

  // stop() — aborts SSE AND cancels server-side execution + subagents
  const stop = useCallback(() => {
    abortRef.current?.abort();
    dispatchRef.current({ type: "SET", patch: { isLoading: false } });
    const s = stateRef.current;
    if (s.runId) client.cancelRun(s.runId, opts.agent ?? client.agent).catch(() => {});
  }, [client, opts.agent]);

  // disconnect() — closes SSE only, server keeps running.
  // Use this for the join/rejoin pattern: disconnect → rejoin later via joinStream(runId).
  // HITL, plan mode, subagents all continue server-side.
  // contrast: stop() kills server execution too.
  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    dispatchRef.current({ type: "SET", patch: { isLoading: false } });
    // intentionally no cancelRun() call
  }, []);

  // ---------------------------------------------------------------------------
  // switchThread
  // ---------------------------------------------------------------------------

  const switchThread = useCallback((newThreadId: string | null) => {
    abortRef.current?.abort();
    currentAIMsgIdRef.current = null;
    toolCallSeqRef.current = 0;
    pendingToolsRef.current.clear();
    subagentMgr.clear();
    dispatchRef.current({ type: "RESET", threadId: newThreadId });
    if (newThreadId) _loadThreadHistory(newThreadId);
  }, [subagentMgr, _loadThreadHistory]);

  // ---------------------------------------------------------------------------
  // HITL
  // ---------------------------------------------------------------------------

  const approveInterrupt = useCallback(async (decision: InterruptDecision = { decision: "approve" }) => {
    const tid = stateRef.current.threadId;
    if (!tid) return;
    await client.submitDecision(tid, decision);
    dispatchRef.current({ type: "SET", patch: { interrupts: [] } });
  }, [client]);

  const rejectInterrupt = useCallback(async (message?: string) => {
    const tid = stateRef.current.threadId;
    if (!tid) return;
    await client.submitDecision(tid, { decision: "reject", message });
    dispatchRef.current({ type: "SET", patch: { interrupts: [] } });
  }, [client]);

  const editInterrupt = useCallback(async (editedAction: { name: string; args: Record<string, unknown> }) => {
    const tid = stateRef.current.threadId;
    if (!tid) return;
    await client.submitDecision(tid, { decision: "edit", edited_action: editedAction });
    dispatchRef.current({ type: "SET", patch: { interrupts: [] } });
  }, [client]);

  const respondToInterrupt = useCallback(async (message: string) => {
    const tid = stateRef.current.threadId;
    if (!tid) return;
    await client.submitDecision(tid, { decision: "respond", message });
    dispatchRef.current({ type: "SET", patch: { interrupts: [] } });
  }, [client]);

  const approveInterruptForSession = useCallback(async () => {
    const tid = stateRef.current.threadId;
    if (!tid) return;
    await client.submitDecision(tid, { decision: "approve_for_session" });
    dispatchRef.current({ type: "SET", patch: { interrupts: [] } });
  }, [client]);

  const answerAskUser = useCallback(async (answers: string[]) => {
    const tid = stateRef.current.threadId;
    if (!tid) return;
    await client.submitAskUser(tid, answers);
    dispatchRef.current({ type: "SET", patch: { askUser: null } });
  }, [client]);

  // ---------------------------------------------------------------------------
  // Plan
  // ---------------------------------------------------------------------------

  const approvePlan = useCallback(async () => {
    const s = stateRef.current;
    if (!s.runId) return;
    await client.approvePlan(s.runId, opts.agent ?? client.agent);
    if (s.plan) dispatchRef.current({ type: "SET", patch: { plan: { ...s.plan, status: "approved" } } });
  }, [client, opts.agent]);

  const rejectPlan = useCallback(async (feedback?: string) => {
    const s = stateRef.current;
    if (!s.runId) return;
    await client.rejectPlan(s.runId, feedback, opts.agent ?? client.agent);
    if (s.plan) dispatchRef.current({ type: "SET", patch: { plan: { ...s.plan, status: "rejected" } } });
  }, [client, opts.agent]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const getToolCalls = useCallback((messageId: string) => {
    const msg = state.messages.find((m) => m.id === messageId);
    return msg?.toolCalls ?? [];
  }, [state.messages]);

  const getSubagentsByMessage = useCallback((msgId: string) => subagentMgr.getByMessage(msgId), [subagentMgr]);
  const getSubagentsByType = useCallback((name: string) => subagentMgr.getByType(name), [subagentMgr]);
  const getSubagent = useCallback((id: string) => subagentMgr.getById(id), [subagentMgr]);

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    isThreadLoading: state.isThreadLoading,
    error: state.error,
    toolCalls: state.toolCalls,
    getToolCalls,
    interrupt: state.interrupts[0] ?? null,
    interrupts: state.interrupts,
    askUser: state.askUser,
    subagents: subagentMgr.all,
    activeSubagents: subagentMgr.active,
    getSubagent,
    getSubagentsByMessage,
    getSubagentsByType,
    plan: state.plan,
    runId: state.runId,
    threadId: state.threadId,
    threadTotalMessages: state.threadTotalMessages,
    sessionApprovedTools: state.sessionApprovedTools,
    submit,
    stop,
    disconnect,
    switchThread,
    joinStream,
    approveInterrupt,
    rejectInterrupt,
    editInterrupt,
    respondToInterrupt,
    approveInterruptForSession,
    answerAskUser,
    approvePlan,
    rejectPlan,
  };
}

