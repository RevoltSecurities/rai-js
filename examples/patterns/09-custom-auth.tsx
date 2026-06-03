/**
 * Pattern 09 — Custom Auth & Headers
 *
 * No LangGraph equivalent for this level of auth flexibility.
 *
 * Covers:
 *   1. Static API key
 *   2. JWT from localStorage
 *   3. Multiple headers: JWT + MFA + tenant + device
 *   4. Async token refresh (Auth0, Cognito, Firebase)
 *   5. Cookie-based CSRF
 *   6. Per-organization keys (multi-tenant)
 *   7. Custom fetch: proxy, request signing, audit logging
 *
 * getHeaders() is called before EVERY request:
 *   - POST /agents/{name}/runs          (submit)
 *   - GET  /agents/{name}/runs/{id}/stream (SSE open)
 *   - SSE reconnects (on network drop)
 *   - POST /threads/{id}/interrupt      (approveInterrupt/rejectInterrupt)
 *   - POST /agents/{name}/runs/{id}/plan/approve (approvePlan)
 *   - GET  /threads/{id}/history        (switchThread → load history)
 *   - POST /threads/{id}/ask_user       (answerAskUser)
 *   - DELETE /threads/{id}              (deleteThread)
 *   - ALL other REST calls
 */

import { useRAIStream, RAIClient } from "@revolt-rai/js";

// ── 1. Static API key ─────────────────────────────────────────────────────────

export function StaticKeyExample() {
  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    apiKey: "my-server-key", // sent as X-API-Key header
  });

  return <ChatUI stream={stream} />;
}

// ── 2. JWT from localStorage (sync) ──────────────────────────────────────────

export function JwtLocalStorageExample() {
  const stream = useRAIStream({
    baseUrl: "https://rai.company.com",
    getHeaders: () => ({
      Authorization: `Bearer ${localStorage.getItem("access_token")}`,
      "X-Org-Id": localStorage.getItem("org_id") ?? "",
    }),
    // getHeaders is called before every request — always reads the latest token
  });

  return <ChatUI stream={stream} />;
}

// ── 3. Multiple auth sources: JWT + MFA + tenant + device ────────────────────

export function MultiAuthExample() {
  // In a real app, read these from your state management (Redux, Zustand, etc.)
  const getJwt = () => sessionStorage.getItem("jwt") ?? "";
  const getMfaToken = () => sessionStorage.getItem("mfa_token") ?? "";
  const getOrgId = () => localStorage.getItem("current_org") ?? "";
  const getDeviceId = () => localStorage.getItem("device_id") ?? "";

  const stream = useRAIStream({
    baseUrl: "https://rai.company.com",
    getHeaders: () => ({
      "Authorization":   `Bearer ${getJwt()}`,
      "X-MFA-Token":     getMfaToken(),         // MFA step-up token
      "X-Org-Id":        getOrgId(),             // tenant isolation
      "X-Device-Id":     getDeviceId(),          // device fingerprint
      "X-Client-Version": "2.1.0",               // for server-side version checks
    }),
  });

  return <ChatUI stream={stream} />;
}

// ── 4. Async token refresh (Auth0 / Cognito / Firebase) ──────────────────────

export function AsyncTokenRefreshExample() {
  // Simulated auth SDK — replace with your actual auth provider
  const authSDK = {
    getTokenSilently: async (): Promise<{ accessToken: string }> => {
      // In real code: checks expiry, refreshes silently if needed
      return { accessToken: "refreshed-token-from-server" };
    },
  };

  const stream = useRAIStream({
    baseUrl: "https://rai.company.com",
    getHeaders: async () => {
      // Called before every request — if token is expired, this refreshes it
      const { accessToken } = await authSDK.getTokenSilently();
      return {
        Authorization: `Bearer ${accessToken}`,
        "X-Tenant": "acme-corp",
      };
    },
  });

  return <ChatUI stream={stream} />;
}

// ── 5. Cookie-based CSRF ─────────────────────────────────────────────────────

export function CsrfExample() {
  const stream = useRAIStream({
    baseUrl: "https://rai.company.com",
    getHeaders: () => ({
      // Read CSRF token from cookie — fresh on every request
      "X-CSRF-Token": document.cookie.match(/csrf=([^;]+)/)?.[1] ?? "",
      // Credentials: "include" is handled by custom fetch below if needed
    }),
  });

  return <ChatUI stream={stream} />;
}

// ── 6. Per-organization API keys (multi-tenant SaaS) ─────────────────────────

export function MultiTenantExample({ orgApiKey, workspaceId }: {
  orgApiKey: string;
  workspaceId: string;
}) {
  const stream = useRAIStream({
    baseUrl: "https://rai.company.com",
    getHeaders: () => ({
      "X-API-Key":       orgApiKey,      // different key per org
      "X-Workspace-Id":  workspaceId,
    }),
  });

  return <ChatUI stream={stream} />;
}

// ── 7. Custom fetch: proxy, signing, audit logging ───────────────────────────

export function CustomFetchExample() {
  // Custom fetch intercepts all RAI requests at transport level
  const auditedFetch: typeof fetch = async (url, init) => {
    const start = Date.now();

    // Add auth + proxy headers
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${localStorage.getItem("jwt")}`,
        "X-Via-Proxy": "true",
      },
      // Route through a proxy if needed
      // (for environments where direct server access is restricted)
    });

    // Audit log: request + response metadata
    console.log("[RAI audit]", {
      url,
      method: (init as RequestInit)?.method ?? "GET",
      status: response.status,
      durationMs: Date.now() - start,
    });

    return response;
  };

  const stream = useRAIStream({
    baseUrl: "http://localhost:8000",
    fetch: auditedFetch,
  });

  return <ChatUI stream={stream} />;
}

// ── 8. Core client: same getHeaders API ──────────────────────────────────────

export async function nodeScriptExample() {
  const client = new RAIClient({
    baseUrl: "https://rai.company.com",
    getHeaders: async () => {
      // Works identically in Node.js — read from env, secrets manager, etc.
      const token = process.env.RAI_JWT_TOKEN ?? "";
      return {
        Authorization: `Bearer ${token}`,
        "X-Service": "my-automation",
      };
    },
  });

  // getHeaders called before every request — createRun, streamRun, submitDecision, etc.
  const run = await client.createRun("scan example.com", "recon");
  for await (const ev of client.streamRun(run.run_id)) {
    if (ev.type === "token") process.stdout.write(ev.content);
  }
}

// ── Placeholder UI component used in examples above ──────────────────────────

function ChatUI({ stream }: { stream: ReturnType<typeof useRAIStream> }) {
  return (
    <div>
      {stream.messages.map((msg, i) => (
        <div key={msg.id ?? i}>
          {msg.role === "human" && <p className="human">{msg.content}</p>}
          {msg.role === "assistant" && <p className="ai">{msg.content}</p>}
        </div>
      ))}
      {stream.isLoading && <p>Thinking…</p>}
      <input
        placeholder="Send a message…"
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
