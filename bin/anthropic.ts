#!/usr/bin/env bun

import { serve } from "bun";

const PORT = Number(Bun.env.PORT || 8787);
const ROOT = new URL("../", import.meta.url).pathname;
const PUBLIC_DIR = `${ROOT}public`;

function notFound() {
  return new Response("Not found", { status: 404 });
}

async function serveStatic(pathname: string) {
  const filePath = PUBLIC_DIR + (pathname === "/" ? "/index.html" : pathname);
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return new Response(file);
  } catch {
    return null;
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    ...init,
  });
}

function authorizeUrl(verifier: string, challenge: string) {
  const u = new URL("https://claude.ai/oauth/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set(
    "redirect_uri",
    "https://console.anthropic.com/oauth/code/callback",
  );
  u.searchParams.set("scope", "org:create_api_key user:profile user:inference");
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", verifier);
  return u.toString();
}

function base64url(input: ArrayBuffer | Uint8Array) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function pkcePair() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = base64url(digest as ArrayBuffer);
  return { verifier, challenge };
}

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

async function exchangeRefreshToken(refreshToken: string) {
  const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "CRUSH/1.0",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

function cleanPastedCode(input: string) {
  let v = input.trim();
  v = v.replace(/^code\s*[:=]\s*/i, "");
  v = v.replace(/^["'`]/, "").replace(/["'`]$/, "");
  const m = v.match(/[A-Za-z0-9._~-]+(?:#[A-Za-z0-9._~-]+)?/);
  if (m) return m[0];
  return v;
}

async function exchangeAuthorizationCode(code: string, verifier: string) {
  const cleaned = cleanPastedCode(code);
  const [pure, state = ""] = cleaned.split("#");
  const body = {
    code: pure ?? "",
    state: state ?? "",
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    redirect_uri: "https://console.anthropic.com/oauth/code/callback",
    code_verifier: verifier,
  } satisfies Record<string, string>;
  const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "CRUSH/1.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

const memory = new Map<
  string,
  { accessToken: string; refreshToken: string; expiresAt: number }
>();

const HOME = Bun.env.HOME || Bun.env.USERPROFILE || ".";
const CACHE_DIR = `${HOME}/.config/crush/anthropic`;
const BEARER_FILE = `${CACHE_DIR}/bearer_token`;
const REFRESH_FILE = `${CACHE_DIR}/refresh_token`;
const EXPIRES_FILE = `${CACHE_DIR}/bearer_token.expires`;

async function ensureDir() {
  await Bun.$`mkdir -p ${CACHE_DIR}`;
}

async function writeSecret(path: string, data: string) {
  await Bun.write(path, data);
  await Bun.$`chmod 600 ${path}`;
}

async function readText(path: string) {
  const f = Bun.file(path);
  if (!(await f.exists())) return undefined;
  return await f.text();
}

async function loadFromDisk() {
  const [bearer, refresh, expires] = await Promise.all([
    readText(BEARER_FILE),
    readText(REFRESH_FILE),
    readText(EXPIRES_FILE),
  ]);
  if (!bearer || !refresh || !expires) return undefined;
  const exp = Number.parseInt(expires, 10) || 0;
  return {
    accessToken: bearer.trim(),
    refreshToken: refresh.trim(),
    expiresAt: exp,
  };
}

async function saveToDisk(entry: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}) {
  await ensureDir();
  await writeSecret(BEARER_FILE, `${entry.accessToken}\n`);
  await writeSecret(REFRESH_FILE, `${entry.refreshToken}\n`);
  await writeSecret(EXPIRES_FILE, `${String(entry.expiresAt)}\n`);
}

let serverStarted = false;

async function bootstrapFromDisk() {
  const entry = await loadFromDisk();
  if (!entry) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now < entry.expiresAt - 60) {
    Bun.write(Bun.stdout, `${entry.accessToken}\n`);
    setTimeout(() => process.exit(0), 50);
    memory.set("tokens", entry);
    return true;
  }
  try {
    const refreshed = await exchangeRefreshToken(entry.refreshToken);
    entry.accessToken = refreshed.access_token;
    entry.expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
    if (refreshed.refresh_token) entry.refreshToken = refreshed.refresh_token;
    await saveToDisk(entry);
    memory.set("tokens", entry);
    Bun.write(Bun.stdout, `${entry.accessToken}\n`);
    setTimeout(() => process.exit(0), 50);
    return true;
  } catch {
    return false;
  }
}

const didBootstrap = await bootstrapFromDisk();

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  Bun.write(Bun.stdout, `Usage: anthropic\n\n`);
  Bun.write(
    Bun.stdout,
    `  anthropic                Start UI and flow; prints token on success and exits.\n`,
  );
  Bun.write(
    Bun.stdout,
    `  PORT=xxxx anthropic      Override port (default 8787).\n`,
  );
  Bun.write(
    Bun.stdout,
    `\nTokens are cached at ~/.config/crush/anthropic and reused on later runs.\n`,
  );
  process.exit(0);
}

if (!didBootstrap) {
  serve({
    port: PORT,
    development: { console: false },
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/ping")
          return json({ ok: true, ts: Date.now() });

        if (url.pathname === "/api/auth/start" && req.method === "POST") {
          const { verifier, challenge } = await pkcePair();
          const authUrl = authorizeUrl(verifier, challenge);
          return json({ authUrl, verifier });
        }

        if (url.pathname === "/api/auth/complete" && req.method === "POST") {
          const body = (await req.json().catch(() => ({}))) as {
            code?: string;
            verifier?: string;
          };
          const code = String(body.code ?? "");
          const verifier = String(body.verifier ?? "");
          if (!code || !verifier)
            return json({ error: "missing code or verifier" }, { status: 400 });
          const tokens = await exchangeAuthorizationCode(code, verifier);
          const expiresAt =
            Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 0);
          const entry = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt,
          };
          memory.set("tokens", entry);
          await saveToDisk(entry);
          Bun.write(Bun.stdout, `${entry.accessToken}\n`);
          setTimeout(() => process.exit(0), 100);
          return json({ ok: true });
        }

        if (url.pathname === "/api/token" && req.method === "GET") {
          let entry = memory.get("tokens");
          if (!entry) {
            const disk = await loadFromDisk();
            if (disk) {
              entry = disk;
              memory.set("tokens", entry);
            }
          }
          if (!entry)
            return json({ error: "not_authenticated" }, { status: 401 });
          const now = Math.floor(Date.now() / 1000);
          if (now >= entry.expiresAt - 60) {
            const refreshed = await exchangeRefreshToken(entry.refreshToken);
            entry.accessToken = refreshed.access_token;
            entry.expiresAt =
              Math.floor(Date.now() / 1000) + refreshed.expires_in;
            if (refreshed.refresh_token)
              entry.refreshToken = refreshed.refresh_token;
            memory.set("tokens", entry);
            await saveToDisk(entry);
          }
          return json({
            accessToken: entry.accessToken,
            expiresAt: entry.expiresAt,
          });
        }

        return notFound();
      }

      const staticResp = await serveStatic(url.pathname);
      if (staticResp) return staticResp;

      return notFound();
    },
    error() {},
  });

  if (!serverStarted) {
    serverStarted = true;
    const url = `http://localhost:${PORT}`;
    const tryRun = async (cmd: string, ...args: string[]) => {
      try {
        await Bun.$`${[cmd, ...args]}`.quiet();
        return true;
      } catch {
        return false;
      }
    };
    (async () => {
      if (process.platform === "darwin") {
        if (await tryRun("open", url)) return;
      } else if (process.platform === "win32") {
        if (await tryRun("cmd", "/c", "start", "", url)) return;
      } else {
        if (await tryRun("xdg-open", url)) return;
      }
    })();
  }
}
