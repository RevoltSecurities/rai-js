/**
 * Pattern 08 — Plan Mode
 *
 * No LangGraph equivalent — this is RAI-exclusive.
 *
 * Plan mode flow:
 *   1. submit(text, { planMode: true })
 *   2. plan_mode_entered SSE → plan.status = "pending", plan.raw = ""
 *      UI shows: "|| Writing plan…" (green, like Claude Code)
 *   3. plan_ready SSE → plan.raw = <markdown>
 *      UI shows: full plan + Approve / Reject buttons
 *   4. user calls approvePlan() → plan.status = "approved"
 *   5. step_start / step_complete SSEs → plan.steps updates
 *   6. plan_completed → plan.status = "completed"
 *
 * Key rule: NEVER show the Approve button before plan.raw is populated.
 * The server's _PLAN_FUTURES isn't set until plan_ready fires.
 * Calling approvePlan() before that returns 409 "No pending plan to approve".
 */

import { useState } from "react";
import { useRAIStream } from "@revolt-rai/js";
import type { PlanState, PlanStep } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

const PRESETS = [
  "Audit this codebase for SQL injection vulnerabilities",
  "Perform a complete SAST analysis of the React application",
  "Map all authentication endpoints and test for broken access control",
];

// ── Plan panel ────────────────────────────────────────────────────────────────

function PlanPanel({
  plan,
  onApprove,
  onReject,
}: {
  plan: PlanState;
  onApprove: () => void;
  onReject: (feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [loading, setLoading] = useState(false);

  const isPending  = plan.status === "pending";
  const isRunning  = plan.status === "approved" || plan.status === "running";
  const isComplete = plan.status === "completed";

  // planReady: plan.raw populated = plan_ready event fired
  // NEVER show approve button before this — server isn't ready
  const planReady = isPending && !!plan.raw;

  return (
    <div className={`plan-panel ${isPending ? "panel-pending" : isRunning ? "panel-running" : ""}`}>

      {/* Header */}
      <div className="plan-header">
        <span className="plan-icon">◈</span>
        <span className="plan-title">RAI — Plan Mode</span>
        <span className={`plan-badge badge-${plan.status}`}>
          {!plan.raw && isPending
            ? "PLANNING"
            : isPending   ? "REVIEW PLAN"
            : isRunning   ? "EXECUTING"
            : isComplete  ? "DONE"
            : plan.status.toUpperCase()}
        </span>
        {plan.steps.length > 0 && (
          <span className="plan-progress">
            {plan.steps.filter(s => s.status === "complete").length}/{plan.steps.length} steps
          </span>
        )}
      </div>

      {/* Writing plan — spinner while waiting for plan_ready */}
      {isPending && !plan.raw && (
        <div className="plan-writing">
          <span className="plan-bars">||</span>
          <span>Preparing plan</span>
          <span className="dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      )}

      {/* Plan markdown — shown after plan_ready */}
      {plan.raw && (
        <details className="plan-content" open={isPending}>
          <summary>View plan{plan.steps.length > 0 ? ` (${plan.steps.length} steps)` : ""}</summary>
          <div className="plan-markdown">
            <ReactMarkdown>{plan.raw}</ReactMarkdown>
          </div>
        </details>
      )}

      {/* Step list */}
      {plan.steps.length > 0 && (
        <div className="plan-steps">
          {plan.steps.map((step: PlanStep) => (
            <div key={step.number} className={`plan-step step-${step.status}`}>
              <span className={`step-icon ${step.status === "running" ? "pulse" : ""}`}>
                {step.status === "complete" ? "●" :
                 step.status === "running"  ? "◉" :
                 step.status === "blocked"  ? "✗" : "○"}
              </span>
              <div className="step-content">
                <div className="step-meta">
                  <span className="step-num">Step {step.number}</span>
                  {step.status !== "pending" && (
                    <span className={`step-status status-${step.status}`}>{step.status}</span>
                  )}
                </div>
                <span className="step-desc">{step.description}</span>
                {step.notes && <span className="step-notes">{step.notes}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approval actions — only shown when plan_ready has fired */}
      {planReady && (
        <div className="plan-actions">
          {!showReject ? (
            <>
              <button
                className="approve-btn"
                onClick={async () => {
                  setLoading(true);
                  try { await Promise.resolve(onApprove()); }
                  finally { setLoading(false); }
                }}
                disabled={loading}
              >
                {loading ? "…" : "✓"} Approve Plan
              </button>
              <button
                className="reject-btn"
                onClick={() => setShowReject(true)}
                disabled={loading}
              >
                ✗ Reject
              </button>
            </>
          ) : (
            <div className="reject-form">
              <textarea
                placeholder="What should be changed? (optional)"
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                rows={3}
              />
              <div className="reject-actions">
                <button
                  onClick={async () => {
                    setLoading(true);
                    try { await Promise.resolve(onReject(feedback || undefined)); }
                    finally { setLoading(false); }
                  }}
                  disabled={loading}
                >
                  ✗ Reject Plan
                </button>
                <button onClick={() => { setShowReject(false); setFeedback(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Execution progress bar */}
      {isRunning && (
        <div className="plan-executing">
          <span className="exec-dot" />
          <span>Executing plan…</span>
          {plan.currentStep && <span>Step {plan.currentStep}</span>}
          <div className="exec-progress">
            <div
              className="exec-fill"
              style={{
                width: plan.steps.length
                  ? `${(plan.steps.filter(s => s.status === "complete").length / plan.steps.length) * 100}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PlanModeExample() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
  });

  return (
    <div>
      <div className="chat-body">
        {stream.messages.length === 0 && (
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => stream.submit(p, { planMode: true })}>
                {p}
              </button>
            ))}
          </div>
        )}

        {stream.messages.map((msg, i) => (
          <div key={msg.id ?? i}>
            {msg.role === "human" && (
              <div className="human-bubble">{msg.content}</div>
            )}
            {msg.role === "assistant" && (
              <div>
                {msg.thinking && (
                  <details className="thinking-block">
                    <summary>Thinking…</summary>
                    <pre>{msg.thinking}</pre>
                  </details>
                )}
                {msg.content && (
                  <div className="ai-bubble">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )}
                {stream.getToolCalls(msg.id).map((tc) => (
                  <div key={tc.id} className="tool-chip">
                    {tc.status === "done" ? "✓" : "⟳"} {tc.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {stream.isLoading && !stream.plan && <div className="typing-indicator" />}
      </div>

      {/* Plan panel — appears when plan mode entered */}
      {stream.plan &&
        (stream.plan.status === "pending" ||
         stream.plan.status === "approved" ||
         stream.plan.status === "running") && (
        <PlanPanel
          plan={stream.plan}
          onApprove={() => stream.approvePlan()}
          onReject={(fb) => stream.rejectPlan(fb)}
        />
      )}

      {/* Plan completed banner — auto-dismissed in UI */}
      {stream.plan?.status === "completed" && (
        <div className="plan-complete-banner">
          ✔ Plan complete ({stream.plan.totalSteps ?? stream.plan.steps.length} steps)
        </div>
      )}

      <input
        placeholder="Ask something complex (will plan first)…"
        disabled={
          stream.isLoading &&
          stream.plan?.status !== "pending" // allow input when awaiting approval
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            stream.submit(e.currentTarget.value, { planMode: true });
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
