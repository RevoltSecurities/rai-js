/**
 * Pattern 10 — Per-run Config: Model, Tools, Metadata, Context
 *
 * submit() options that map to CreateRunRequest on the server.
 * All options can be mixed and matched per message.
 */

import { useRAIStream } from "@revolt-rai/js";

export default function PerRunConfigExample() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    agent: "rai",
  });

  return (
    <div>
      {/* Basic submit */}
      <button onClick={() => stream.submit("hello")}>
        Basic
      </button>

      {/* Switch agent per message */}
      <button onClick={() => stream.submit("scan ports on example.com", {
        agent: "recon",    // use recon specialist
      })}>
        Recon agent
      </button>

      {/* Override model for this run only */}
      <button onClick={() => stream.submit("audit this codebase", {
        model: "anthropic:claude-opus-4-8", // most capable model
      })}>
        Opus model
      </button>

      {/* Restrict tools — only allow safe read-only tools */}
      <button onClick={() => stream.submit("read the config file", {
        allowedTools: ["read_file", "bash", "web_search"],
        // tools NOT in this list will be blocked
      })}>
        Read-only tools
      </button>

      {/* Plan mode — agent must plan before acting */}
      <button onClick={() => stream.submit("find all SQL injections", {
        planMode: true,
      })}>
        Plan mode
      </button>

      {/* Cap LLM turns — prevent runaway long chains */}
      <button onClick={() => stream.submit("analyze this", {
        maxTurns: 10,
      })}>
        Max 10 turns
      </button>

      {/* Per-run metadata — stored on run, visible in audit log */}
      <button onClick={() => stream.submit("do something", {
        metadata: {
          user_id: "u_12345",
          org_id: "org_acme",
          session_id: "sess_abc",
          triggered_by: "button-click",
          client_version: "2.1.0",
        },
      })}>
        With metadata
      </button>

      {/* Config — passed to agent as LangGraph config.configurable */}
      <button onClick={() => stream.submit("scan the target", {
        config: {
          target_scope: "*.example.com",
          env: "staging",
          max_depth: 3,
          exclude_paths: ["/admin", "/internal"],
        },
      })}>
        With config
      </button>

      {/* Everything at once */}
      <button onClick={() => stream.submit("full SAST audit of /tmp/codebase", {
        agent: "sast-analyzer",
        model: "anthropic:claude-opus-4-8",
        planMode: true,
        allowedTools: ["bash", "read_file", "web_search"],
        maxTurns: 50,
        metadata: {
          user_id: "u_12345",
          org_id: "org_acme",
          audit_id: "aud_" + Date.now(),
        },
        config: {
          target_path: "/tmp/codebase",
          language: "java",
          severity_threshold: "high",
        },
      })}>
        Full config
      </button>

      {stream.messages.map((msg, i) => (
        <div key={msg.id ?? i}>
          {msg.role === "human" && <p className="human">{msg.content}</p>}
          {msg.role === "assistant" && <p className="ai">{msg.content}</p>}
        </div>
      ))}
    </div>
  );
}
