/**
 * @revolt-rai/js — TypeScript SDK for the RAI HTTP server.
 *
 * Core (framework-agnostic):
 *   import { RAIClient } from "@revolt-rai/js";
 *
 * React:
 *   import { useRAIStream } from "@revolt-rai/js";
 *   import { useRAIStream } from "@revolt-rai/js/react";  // explicit subpath
 *
 * Subagents:
 *   import type { SubagentStream } from "@revolt-rai/js";
 */

// Core client
export { RAIClient } from "./client.js";
export type {
  RAIClientConfig,
  HeadersResolver,
  CreateRunOptions,
  RunResponse,
  ThreadInfo,
  ThreadMessage,
  ThreadHistoryResponse,
  InterruptState,
  InterruptDecision,
} from "./client.js";

// All SSE event types (40+)
export type {
  RAIEvent,
  RawSSEFrame,
  RunStartEvent,
  RunEndEvent,
  RunKeepaliveEvent,
  RateLimitEvent,
  ErrorEvent,
  TokenEvent,
  ThinkingEvent,
  ToolStartEvent,
  ToolEndEvent,
  PermissionDeniedEvent,
  InterruptEvent,
  InterruptResolvedEvent,
  InterruptAutoApprovedEvent,
  AskUserRequestEvent,
  SessionApprovedEvent,
  PlanModeEnteredEvent,
  PlanReadyEvent,
  PlanApprovedEvent,
  PlanRejectedEvent,
  StepStartEvent,
  StepCompleteEvent,
  StepBlockedEvent,
  PlanCompletedEvent,
  SubagentStartedEvent,
  SubagentTokenEvent,
  SubagentThinkingEvent,
  SubagentToolStartEvent,
  SubagentToolEndEvent,
  SubagentInterruptEvent,
  SubagentCompletedEvent,
  SubagentErrorEvent,
  TaskCreatedEvent,
  TaskCompletedEvent,
  PipelineCreatedEvent,
  PipelineEndEvent,
  ActionRequest,
  PlanStep,
  PlanStepStatus,
  SubagentStatus as EventSubagentStatus,
} from "./events.js";
export { parseSSEChunk, coerceEvent } from "./events.js";

// Subagent types
export { SubagentManager } from "./subagents.js";
export type { SubagentStream, SubagentStatus, SubagentToolCall } from "./subagents.js";

// React hook
export { useRAIStream } from "./useRAIStream.js";
export { useRAIQueue } from "./useRAIQueue.js";
export type { QueueEntry, UseRAIQueueResult } from "./useRAIQueue.js";
export type {
  UseRAIStreamOptions,
  UseRAIStreamResult,
  StreamMessage,
  SubmitOptions,
  ToolCall,
  PlanState,
  PlanStepStatus as HookPlanStepStatus,
  MessageRole,
} from "./useRAIStream.js";
