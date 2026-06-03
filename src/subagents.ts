/**
 * SubagentManager — tracks RAI subagent lifecycle from spawn to completion.
 *
 * RAI subagents are identified by task_id (emitted in subagent_started).
 * Unlike LangGraph's SubagentManager which matches via namespace + pregel task IDs,
 * RAI gives us explicit task_id in every subagent event — no namespace matching needed.
 */

export type SubagentStatus = "pending" | "running" | "complete" | "error";

export interface SubagentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface SubagentStream {
  /** Unique task_id from subagent_started event */
  id: string;
  /** Agent name (e.g. "recon", "researcher") */
  name: string;
  /** Current execution status */
  status: SubagentStatus;
  /** Accumulated token content */
  content: string;
  /** Thinking content (extended thinking) */
  thinking: string;
  /** Final output preview from subagent_completed */
  outputPreview: string;
  /** Output file path if written to disk */
  outputFile?: string;
  /** Tool calls this subagent made */
  toolCalls: SubagentToolCall[];
  /** Input prompt passed to this subagent */
  input: string;
  /** Agent model */
  model: string;
  /** Parent run id (the run that spawned this subagent) */
  parentRunId: string;
  /** ID of the AI message that triggered this subagent */
  aiMessageId: string | null;
  /** When the subagent started */
  startedAt: Date | null;
  /** When the subagent completed */
  completedAt: Date | null;
  /** Error message if status === "error" */
  error: string | null;
}

export interface SubagentManagerOptions {
  onSubagentChange?: () => void;
}

export class SubagentManager {
  private _subagents = new Map<string, SubagentStream>();
  private _onChange?: () => void;

  constructor(opts?: SubagentManagerOptions) {
    this._onChange = opts?.onSubagentChange;
  }

  // ── event handlers ────────────────────────────────────────────────────────

  onStarted(
    taskId: string,
    agentName: string,
    input: string,
    model: string,
    parentRunId: string,
    aiMessageId: string | null,
  ): void {
    this._subagents.set(taskId, {
      id: taskId,
      name: agentName,
      status: "running",
      content: "",
      thinking: "",
      outputPreview: "",
      toolCalls: [],
      input,
      model,
      parentRunId,
      aiMessageId,
      startedAt: new Date(),
      completedAt: null,
      error: null,
    });
    this._onChange?.();
  }

  onToken(taskId: string, content: string): void {
    const s = this._subagents.get(taskId);
    if (!s) return;
    this._subagents.set(taskId, { ...s, content: s.content + content });
    this._onChange?.();
  }

  onThinking(taskId: string, content: string): void {
    const s = this._subagents.get(taskId);
    if (!s) return;
    this._subagents.set(taskId, { ...s, thinking: s.thinking + content });
    this._onChange?.();
  }

  onToolStart(taskId: string, toolName: string, toolInput: Record<string, unknown>): void {
    const s = this._subagents.get(taskId);
    if (!s) return;
    const tc: SubagentToolCall = {
      id: `${taskId}-${toolName}-${s.toolCalls.length}`,
      name: toolName,
      args: toolInput,
    };
    this._subagents.set(taskId, { ...s, toolCalls: [...s.toolCalls, tc] });
    this._onChange?.();
  }

  onCompleted(taskId: string, status: string, outputPreview: string, outputFile?: string): void {
    const s = this._subagents.get(taskId);
    if (!s) return;
    const finalStatus: SubagentStatus =
      status === "completed" ? "complete" :
      status === "failed" || status === "error" ? "error" :
      status === "cancelled" ? "error" : "complete";
    this._subagents.set(taskId, {
      ...s,
      status: finalStatus,
      outputPreview,
      outputFile,
      completedAt: new Date(),
    });
    this._onChange?.();
  }

  onError(taskId: string, message: string): void {
    const s = this._subagents.get(taskId);
    if (!s) return;
    this._subagents.set(taskId, {
      ...s,
      status: "error",
      error: message,
      completedAt: new Date(),
    });
    this._onChange?.();
  }

  onInterrupt(taskId: string): void {
    const s = this._subagents.get(taskId);
    if (!s) return;
    // status stays "running" — interrupt means waiting for HITL
    this._subagents.set(taskId, { ...s });
    this._onChange?.();
  }

  // ── queries (mirror LangGraph SubagentManager API) ─────────────────────────

  get all(): Map<string, SubagentStream> {
    return new Map(this._subagents);
  }

  get active(): SubagentStream[] {
    return [...this._subagents.values()].filter((s) => s.status === "running");
  }

  getById(taskId: string): SubagentStream | undefined {
    return this._subagents.get(taskId);
  }

  /** Get all subagents spawned by a specific AI message (mirrors LangGraph's getSubagentsByMessage) */
  getByMessage(aiMessageId: string): SubagentStream[] {
    return [...this._subagents.values()].filter((s) => s.aiMessageId === aiMessageId);
  }

  /** Get all subagents of a specific agent type/name (mirrors LangGraph's getSubagentsByType) */
  getByType(agentName: string): SubagentStream[] {
    return [...this._subagents.values()].filter((s) => s.name === agentName);
  }

  clear(): void {
    this._subagents.clear();
    this._onChange?.();
  }
}
