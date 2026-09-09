import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, stateless session cookie: base64url(payload).hex(hmac). No JWT
// library needed — this is one claim (the GitHub login) plus an expiry, so a
// raw HMAC is simpler to audit than pulling in a token format built for much
// richer claims.

const COOKIE_NAME = "tt_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface SessionPayload {
  login: string;
  exp: number;
}

function secret(): string {
  const value = process.env.AUTH_COOKIE_SECRET;
  if (!value) {
    throw new Error(
      "AUTH_COOKIE_SECRET is not set — generate one with `openssl rand -base64 32` and set it in the environment.",
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function createSessionCookieValue(login: string): string {
  const payload: SessionPayload = { login, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionCookieValue(value: string | undefined | null): { login: string } | null {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as SessionPayload;
    if (typeof payload.login !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { login: payload.login };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };
