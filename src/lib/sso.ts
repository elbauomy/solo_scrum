import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * "Sign in with Microsoft" (Microsoft Entra ID, OpenID Connect, authorization code flow with PKCE).
 * Switched on only when IT has registered the app and these settings exist:
 *   MS_ENTRA_TENANT_ID, MS_ENTRA_CLIENT_ID, MS_ENTRA_CLIENT_SECRET, APP_URL (the public address, for the redirect URI).
 * MS_ENTRA_AUTHORITY exists only for tests (defaults to https://login.microsoftonline.com).
 */
export type SsoConfig = { tenantId: string; clientId: string; clientSecret: string; appUrl: string; authority: string };

export function ssoConfig(env: Record<string, string | undefined> = process.env): SsoConfig | null {
  const tenantId = env.MS_ENTRA_TENANT_ID?.trim();
  const clientId = env.MS_ENTRA_CLIENT_ID?.trim();
  const clientSecret = env.MS_ENTRA_CLIENT_SECRET?.trim();
  const appUrl = env.APP_URL?.trim().replace(/\/+$/, "");
  if (!tenantId || !clientId || !clientSecret || !appUrl) return null;
  return { tenantId, clientId, clientSecret, appUrl, authority: (env.MS_ENTRA_AUTHORITY?.trim() || "https://login.microsoftonline.com").replace(/\/+$/, "") };
}

export const SSO_COOKIE = "act_sso";
export const redirectUri = (cfg: SsoConfig) => `${cfg.appUrl}/api/auth/microsoft/callback`;
const b64url = (buf: Buffer) => buf.toString("base64url");
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

/** The address to send the browser to, and a short-lived signed cookie that ties the answer to this browser. */
export async function startSignIn(cfg: SsoConfig): Promise<{ url: string; cookie: string }> {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri(cfg),
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  const cookie = await new SignJWT({ state, nonce, verifier }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(key());
  return { url: `${cfg.authority}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize?${params}`, cookie };
}

export class SsoError extends Error {
  constructor(public code: "cancelled" | "expired" | "failed" | "no-email") {
    super(code);
  }
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Checks the answer from Microsoft and returns the verified email of the person who signed in. */
export async function finishSignIn(cfg: SsoConfig, query: URLSearchParams, cookieValue: string | undefined): Promise<{ email: string; claims: JWTPayload }> {
  if (query.get("error")) throw new SsoError("cancelled");
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state || !cookieValue) throw new SsoError("expired");
  let saved: JWTPayload;
  try {
    saved = (await jwtVerify(cookieValue, key(), { algorithms: ["HS256"] })).payload;
  } catch {
    throw new SsoError("expired");
  }
  if (saved.state !== state || typeof saved.verifier !== "string" || typeof saved.nonce !== "string") throw new SsoError("expired");

  const res = await fetch(`${cfg.authority}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(cfg),
      code_verifier: saved.verifier,
      scope: "openid profile email",
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) throw new SsoError("failed");
  const body = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!body.id_token) throw new SsoError("failed");

  const jwksUrl = `${cfg.authority}/${encodeURIComponent(cfg.tenantId)}/discovery/v2.0/keys`;
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  let claims: JWTPayload;
  try {
    claims = (
      await jwtVerify(body.id_token, jwks, {
        issuer: `${cfg.authority}/${cfg.tenantId}/v2.0`,
        audience: cfg.clientId,
        algorithms: ["RS256"],
      })
    ).payload;
  } catch {
    throw new SsoError("failed");
  }
  if (claims.nonce !== saved.nonce) throw new SsoError("failed");
  if (typeof claims.tid === "string" && claims.tid !== cfg.tenantId) throw new SsoError("failed");
  const email = [claims.email, claims.preferred_username, claims.upn].find((v): v is string => typeof v === "string" && v.includes("@"));
  if (!email) throw new SsoError("no-email");
  return { email: email.trim().toLowerCase(), claims };
}
