/**
 * Typed SSE event union — mirrors src/rai/client/_events.py exactly.
 * Every event type the RAI server emits is represented here.
 */

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export interface RunStartEvent {
  type: "run_start";
  run_id: string;
  thread_id: string;
  agent_name: string;
  input: string;
  model: string;
}

export interface RunEndEvent {
  type: "run_end";
  run_id: string;
  thread_id: string;
  status: string;
  output: string;
  model: string;
  stop_reason?: string;
  result_subtype?: string;
  num_turns?: number;
  request_count?: number;
  duration_ms?: number;
  ttft_ms?: number;
  usage?: Record<string, number>;
  model_usage?: Record<string, unknown>;
  total_cost_usd?: number;
}

export interface RunKeepaliveEvent {
  type: "run_keepalive";
  run_id: string;
  elapsed_ms: number;
  status: string;
}

export interface RateLimitEvent {
  type: "rate_limit";
  run_id: string;
  thread_id: string;
  status: string;
  resets_at?: string;
  rate_limit_type?: string;
  utilization?: number;
}

export interface ErrorEvent {
  type: "error";
  run_id: string;
  thread_id: string;
  message: string;
  traceback?: string;
}

// ---------------------------------------------------------------------------
// Token / thinking
// ---------------------------------------------------------------------------

export interface TokenEvent {
  type: "token";
  run_id: string;
  thread_id: string;
  content: string;
}

export interface ThinkingEvent {
  type: "thinking";
  run_id: string;
  thread_id: string;
  content: string;
  redacted: boolean;
}

// ---------------------------------------------------------------------------
// Tool events
// ---------------------------------------------------------------------------

export interface ToolStartEvent {
  type: "tool_start";
  run_id: string;
  thread_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolEndEvent {
  type: "tool_end";
  run_id: string;
  thread_id: string;
  tool_name: string;
  tool_output: unknown;
}

export interface PermissionDeniedEvent {
  type: "permission_denied";
  run_id: string;
  thread_id: string;
  tool_name: string;
  reason: string;
  allowed_tools?: string[];
}

// ---------------------------------------------------------------------------
// HITL / interrupt
// ---------------------------------------------------------------------------

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface InterruptEvent {
  type: "interrupt";
  run_id: string;
  thread_id: string;
  interrupt_id: string;
  action_requests: ActionRequest[];
}

export interface InterruptResolvedEvent {
  type: "interrupt_resolved";
  run_id: string;
  thread_id: string;
  interrupt_id: string;
  decision: Record<string, unknown>;
}

export interface InterruptAutoApprovedEvent {
  type: "interrupt_auto_approved";
  run_id: string;
  thread_id: string;
  tool_names: string[];
}

export interface AskUserRequestEvent {
  type: "ask_user_request";
  run_id: string;
  thread_id: string;
  questions: Array<{ question: string; options?: string[] }>;
  tool_call_id: string;
}

export interface SessionApprovedEvent {
  type: "session_approved";
  run_id: string;
  thread_id: string;
  approved_tools: string[];
  session_approved_tools: string[];
}

// ---------------------------------------------------------------------------
// Plan mode
// ---------------------------------------------------------------------------

export type PlanStepStatus = "pending" | "running" | "complete" | "blocked";

export interface PlanStep {
  number: number;
  description: string;
  status: PlanStepStatus;
  notes?: string;
}

export interface PlanModeEnteredEvent {
  type: "plan_mode_entered";
  run_id: string;
}

export interface PlanReadyEvent {
  type: "plan_ready";
  run_id: string;
  plan: string;
  plan_file: string;
  approve_url: string;
  reject_url: string;
}

export interface PlanApprovedEvent {
  type: "plan_approved";
  run_id: string;
}

export interface PlanRejectedEvent {
  type: "plan_rejected";
  run_id: string;
  feedback: string;
}

export interface StepStartEvent {
  type: "step_start";
  run_id: string;
  step_number: number;
  description: string;
}

export interface StepCompleteEvent {
  type: "step_complete";
  run_id: string;
  step_number: number;
  description: string;
  notes: string;
}

export interface StepBlockedEvent {
  type: "step_blocked";
  run_id: string;
  step_number: number;
  description: string;
  reason: string;
}

export interface PlanCompletedEvent {
  type: "plan_completed";
  run_id: string;
  plan_file: string;
  total_steps: number;
}

// ---------------------------------------------------------------------------
// Subagent events
// ---------------------------------------------------------------------------

/**
 * Execution status of a subagent — mirrors LangGraph's SubagentStatus.
 * "pending" → spawned, not yet streaming
 * "running" → actively streaming
 * "complete" → finished successfully
 * "error"    → failed
 */
export type SubagentStatus = "pending" | "running" | "complete" | "error";

export interface SubagentStartedEvent {
  type: "subagent_started";
  run_id: string;
  task_id: string;
  agent_name: string;
  input: string;
  parent_run_id: string;
  model: string;
}

export interface SubagentTokenEvent {
  type: "subagent_token";
  run_id: string;
  task_id: string;
  content: string;
}

export interface SubagentThinkingEvent {
  type: "subagent_thinking";
  run_id: string;
  task_id: string;
  content: string;
}

export interface SubagentToolStartEvent {
  type: "subagent_tool_start";
  run_id: string;
  task_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface SubagentToolEndEvent {
  type: "subagent_tool_end";
  run_id: string;
  task_id: string;
  tool_name: string;
  tool_output: unknown;
}

export interface SubagentInterruptEvent {
  type: "subagent_interrupt";
  run_id: string;
  task_id: string;
  agent_name: string;
  interrupt_id: string;
  action_requests: ActionRequest[];
}

export interface SubagentCompletedEvent {
  type: "subagent_completed";
  run_id: string;
  task_id: string;
  agent_name: string;
  status: string;
  output_preview: string;
  output_file?: string;
}

export interface SubagentErrorEvent {
  type: "subagent_error";
  run_id: string;
  task_id: string;
  agent_name: string;
  message: string;
}

export interface SubagentResumedEvent {
  type: "subagent_resumed";
  run_id: string;
  task_id: string;
  agent_name: string;
  message: string;
}

export interface SubagentTurnCompleteEvent {
  type: "subagent_turn_complete";
  run_id: string;
  task_id: string;
  agent_name: string;
  status: string;
  output_preview: string;
}

// ---------------------------------------------------------------------------
// Task / pipeline
// ---------------------------------------------------------------------------

export interface TaskCreatedEvent {
  type: "task_created";
  run_id: string;
  thread_id: string;
  task_id: string;
  agent_name: string;
}

export interface TaskCompletedEvent {
  type: "task_completed";
  run_id: string;
  thread_id: string;
  task_id: string;
  status: string;
  agent_name: string;
  output?: string;
  output_file?: string;
}

export interface PipelineCreatedEvent {
  type: "pipeline_created";
  run_id: string;
  pipeline_id: string;
  tasks: unknown[];
}

export interface PipelineEndEvent {
  type: "pipeline_end";
  run_id: string;
  pipeline_id: string;
  status: string;
  total: number;
  succeeded: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type RAIEvent =
  | RunStartEvent
  | RunEndEvent
  | RunKeepaliveEvent
  | RateLimitEvent
  | ErrorEvent
  | TokenEvent
  | ThinkingEvent
  | ToolStartEvent
  | ToolEndEvent
  | PermissionDeniedEvent
  | InterruptEvent
  | InterruptResolvedEvent
  | InterruptAutoApprovedEvent
  | AskUserRequestEvent
  | SessionApprovedEvent
  | PlanModeEnteredEvent
  | PlanReadyEvent
  | PlanApprovedEvent
  | PlanRejectedEvent
  | StepStartEvent
  | StepCompleteEvent
  | StepBlockedEvent
  | PlanCompletedEvent
  | SubagentStartedEvent
  | SubagentTokenEvent
  | SubagentThinkingEvent
  | SubagentToolStartEvent
  | SubagentToolEndEvent
  | SubagentInterruptEvent
  | SubagentCompletedEvent
  | SubagentErrorEvent
  | SubagentResumedEvent
  | SubagentTurnCompleteEvent
  | TaskCreatedEvent
  | TaskCompletedEvent
  | PipelineCreatedEvent
  | PipelineEndEvent;

// ---------------------------------------------------------------------------
// SSE frame parser
// ---------------------------------------------------------------------------

export interface RawSSEFrame {
  event: string;
  data: Record<string, unknown>;
  id?: string;
}

export function parseSSEChunk(chunk: string): RawSSEFrame[] {
  const frames: RawSSEFrame[] = [];
  const blocks = chunk.split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "";
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      else if (line.startsWith("id:")) id = line.slice(3).trim();
    }
    if (!event && !dataLines.length) continue;
    let data: Record<string, unknown> = {};
    const raw = dataLines.join("\n");
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = { raw }; }
    }
    frames.push({ event, data, id });
  }
  return frames;
}

export function coerceEvent(frame: RawSSEFrame): RAIEvent | RawSSEFrame {
  return { type: frame.event, ...frame.data } as RAIEvent;
}
