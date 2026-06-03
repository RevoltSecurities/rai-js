/**
 * Pattern 03 — Human-in-the-loop (HITL) Approval
 *
 * LangGraph equivalent:
 *   interrupt.value as HITLRequest
 *   hitlRequest.actionRequests[]
 *   stream.submit(null, { command: { resume: { decisions: [{ type: "approve" }] } } })
 *
 * RAI changes:
 *   stream.interrupt.action_requests[]  ← already structured, no .value cast
 *   stream.approveInterrupt()           ← no manual HITLResponse construction
 *   stream.rejectInterrupt(message)
 *   stream.editInterrupt({ name, args })
 *   stream.respondToInterrupt(message)  ← RAI-only
 *   stream.approveInterruptForSession() ← RAI-only
 */

import { useState } from "react";
import { useRAIStream } from "@revolt-rai/js";
import ReactMarkdown from "react-markdown";

type Mode = "default" | "reject" | "edit" | "respond";

function ApprovalCard({
  req,
  onApprove,
  onApproveSession,
  onReject,
  onEdit,
  onRespond,
  isProcessing,
}: {
  req: { name: string; args: Record<string, unknown> };
  onApprove: () => void;
  onApproveSession: () => void;
  onReject: (reason: string) => void;
  onEdit: (args: Record<string, unknown>) => void;
  onRespond: (msg: string) => void;
  isProcessing: boolean;
}) {
  const [mode, setMode] = useState<Mode>("default");
  const [rejectReason, setRejectReason] = useState("");
  const [respondMsg, setRespondMsg] = useState("");
  const [editedArgs, setEditedArgs] = useState(JSON.stringify(req.args, null, 2));
  const [editError, setEditError] = useState("");

  const isBash = ["bash", "shell", "Bash"].includes(req.name);
  const cmd = isBash ? String(req.args.command ?? "") : null;

  return (
    <div className="approval-card">
      <div className="approval-header">
        <span className="shield-icon">⚠</span>
        <strong>Review Required</strong>
        <span className="badge">Awaiting Approval</span>
      </div>

      {/* Tool display */}
      <div className="approval-tool">
        <code>{req.name}</code>
        {isBash && cmd && (
          <div className="bash-block">
            <span className="bash-path">┌──(rai㉿rai)-[~]</span>
            <pre className="bash-cmd">└─$ {cmd}</pre>
          </div>
        )}
        {!isBash && (
          <div className="args-list">
            {Object.entries(req.args).map(([k, v]) => (
              <div key={k}>
                <span className="arg-key">{k}</span>
                <pre className="arg-val">
                  {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sub-forms */}
      {mode === "reject" && (
        <div className="sub-form">
          <input
            placeholder="Reason (optional)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
          />
          <div className="sub-actions">
            <button onClick={() => onReject(rejectReason || "User rejected")}>
              ✗ Confirm Reject
            </button>
            <button onClick={() => setMode("default")}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "respond" && (
        <div className="sub-form">
          <textarea
            placeholder="Your message to the agent…"
            value={respondMsg}
            onChange={e => setRespondMsg(e.target.value)}
            rows={3}
          />
          <div className="sub-actions">
            <button onClick={() => onRespond(respondMsg)} disabled={!respondMsg.trim()}>
              → Send
            </button>
            <button onClick={() => setMode("default")}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="sub-form">
          <textarea
            className="mono"
            value={editedArgs}
            onChange={e => { setEditedArgs(e.target.value); setEditError(""); }}
            rows={8}
          />
          {editError && <span className="error">{editError}</span>}
          <div className="sub-actions">
            <button onClick={() => {
              try {
                const parsed = JSON.parse(editedArgs);
                onEdit(parsed);
              } catch (e) {
                setEditError("Invalid JSON");
              }
            }}>
              ✓ Apply Edit
            </button>
            <button onClick={() => setMode("default")}>Cancel</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {mode === "default" && (
        <div className="approval-actions">
          <button className="approve" onClick={onApprove} disabled={isProcessing}>
            ✓ Approve
          </button>
          {/* RAI-only: approve for entire session */}
          <button className="approve-session" onClick={onApproveSession} disabled={isProcessing}>
            ✓✓ Approve for Session
          </button>
          {/* RAI-only: respond with message */}
          <button className="secondary" onClick={() => setMode("respond")} disabled={isProcessing}>
            💬 Respond
          </button>
          <button className="secondary" onClick={() => {
            setEditedArgs(JSON.stringify(req.args, null, 2));
            setMode("edit");
          }} disabled={isProcessing}>
            ✏ Edit
          </button>
          <button className="danger" onClick={() => setMode("reject")} disabled={isProcessing}>
            ✗ Reject
          </button>
        </div>
      )}
    </div>
  );
}

export default function HITLExample() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
  });

  const [isProcessing, setIsProcessing] = useState(false);

  // LangGraph: interrupt.value as HITLRequest → hitlRequest.actionRequests
  // RAI:       stream.interrupt.action_requests (already typed, no cast)
  const actionRequests = stream.interrupt?.action_requests ?? [];

  const wrap = (fn: () => Promise<void>) => async () => {
    setIsProcessing(true);
    try { await fn(); } finally { setIsProcessing(false); }
  };

  return (
    <div>
      {stream.messages.map((msg, i) => (
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

      {stream.isLoading && !stream.interrupt && (
        <div className="typing-indicator" />
      )}

      {/* Session-approved tools indicator */}
      {stream.sessionApprovedTools.length > 0 && (
        <div className="session-approved">
          ✓ Session-approved: {stream.sessionApprovedTools.join(", ")}
        </div>
      )}

      {/* HITL panel — one ApprovalCard per action_request */}
      {stream.interrupt && actionRequests.length > 0 && (
        <div className="hitl-section">
          {actionRequests.map((req, idx) => (
            <ApprovalCard
              key={idx}
              req={req}
              isProcessing={isProcessing}
              // RAI: one method call instead of constructing HITLResponse
              onApprove={wrap(() => stream.approveInterrupt())}
              onApproveSession={wrap(() => stream.approveInterruptForSession())}
              onReject={wrap((reason) => stream.rejectInterrupt(reason))}
              onEdit={wrap((args) => stream.editInterrupt({ name: req.name, args }))}
              onRespond={wrap((msg) => stream.respondToInterrupt(msg))}
            />
          ))}
        </div>
      )}

      {/* ask_user panel */}
      {stream.askUser && (
        <div className="ask-user-panel">
          {stream.askUser.questions.map((q, i) => (
            <div key={i}>
              <label>{q.question}</label>
              {q.options ? (
                q.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => stream.answerAskUser([opt])}
                  >
                    {opt}
                  </button>
                ))
              ) : (
                <input
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      stream.answerAskUser([e.currentTarget.value]);
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <input
        placeholder={
          stream.interrupt
            ? "Approve or reject the pending action…"
            : "Send a message…"
        }
        disabled={stream.isLoading || isProcessing || !!stream.interrupt}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            stream.submit(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
      />
    </div>
  );
}
