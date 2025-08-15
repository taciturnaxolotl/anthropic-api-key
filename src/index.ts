#!/usr/bin/env node

import { createServer } from "node:http";
import express from "express";
import fetch from "node-fetch";
import open from "open";
import {
  bootstrapFromDisk,
  exchangeRefreshToken,
  loadFromDisk,
  saveToDisk,
} from "./lib/token";

const PORT = Number(process.env.PORT || 8787);

function json(res: express.Response, data: unknown, status = 200) {
  res.status(status).json(data);
}

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

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
  } as Record<string, string>;
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

// Try to bootstrap from disk and exit if successful
const didBootstrap = await bootstrapFromDisk();

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(`Usage: anthropic\n`);
  console.log(
    `  anthropic                Start UI and flow; prints token on success and exits.`,
  );
  console.log(`  PORT=xxxx anthropic      Override port (default 8787).`);
  console.log(
    `\nTokens are cached at ~/.config/crush/anthropic and reused on later runs.\n`,
  );
  process.exit(0);
}

const indexHtml = `
  <!doctype html>
  <html>
      <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Anthropic Auth</title>
          <style>
              body {
                  font-family:
                      system-ui,
                      -apple-system,
                      Segoe UI,
                      Roboto,
                      Ubuntu,
                      Cantarell,
                      Noto Sans,
                      sans-serif;
                  background: #0f0f10;
                  color: #fff;
                  margin: 0;
                  display: flex;
                  min-height: 100vh;
                  align-items: center;
                  justify-content: center;
              }
              .card {
                  background: #1a1a1b;
                  border: 1px solid #2b2b2c;
                  border-radius: 14px;
                  padding: 28px;
                  max-width: 560px;
                  width: 100%;
              }
              h1 {
                  margin: 0 0 8px;
              }
              p {
                  color: #9aa0a6;
              }
              button,
              a.button {
                  background: linear-gradient(135deg, #ff6b35, #ff8e53);
                  color: #fff;
                  border: none;
                  border-radius: 10px;
                  padding: 12px 16px;
                  font-weight: 600;
                  cursor: pointer;
                  text-decoration: none;
                  display: inline-block;
              }
              textarea {
                  width: 100%;
                  min-height: 120px;
                  background: #111;
                  border: 1px solid #2b2b2c;
                  border-radius: 10px;
                  color: #fff;
                  padding: 10px;
              }
              .row {
                  margin: 16px 0;
              }
              .muted {
                  color: #9aa0a6;
              }
              .status {
                  margin-top: 8px;
                  font-size: 14px;
              }
          </style>
      <script type="module" crossorigin src="../anthropic-api-key/index-9f070n0a.js"></script></head>
      <body>
          <div class="card">
              <h1>Anthropic Authentication</h1>
              <p class="muted">
                  Start the OAuth flow, authorize in the new tab, then paste the
                  returned token here.
              </p>

              <div class="row">
                  <a
                      id="authlink"
                      class="button"
                      href="#"
                      target="_blank"
                      style="display: none"
                      >Open Anthropic Authorization</a
                  >
              </div>

              <div class="row">
                  <label for="code">Authorization code</label>
                  <textarea
                      id="code"
                      placeholder="Paste the exact code shown by Anthropic (not a URL). If it includes a #, keep the part after it too."
                  ></textarea>
              </div>

              <div class="row">
                  <button id="complete">Complete Authentication</button>
              </div>

              <div id="status" class="status"></div>
          </div>

          <script>
              let verifier = "";
              const statusEl = document.getElementById("status");

              function setStatus(msg, ok) {
                  statusEl.textContent = msg;
                  statusEl.style.color = ok ? "#34a853" : "#ea4335";
              }

              (async () => {
                  setStatus("Preparing authorization...", true);
                  const res = await fetch("/api/auth/start", { method: "POST" });
                  if (!res.ok) {
                      setStatus("Failed to prepare auth", false);
                      return;
                  }
                  const data = await res.json();
                  verifier = data.verifier;
                  const a = document.getElementById("authlink");
                  a.href = data.authUrl;
                  a.style.display = "inline-block";
                  setStatus(
                      'Ready. Click "Open Authorization" to continue.',
                      true,
                  );
              })();

              const completeBtn = document.getElementById("complete");
              document
                  .getElementById("complete")
                  .addEventListener("click", async () => {
                      if (completeBtn.disabled) return;
                      completeBtn.disabled = true;
                      const code = document.getElementById("code").value.trim();
                      if (!code || !verifier) {
                          setStatus(
                              "Missing code or verifier. Click Start first.",
                              false,
                          );
                          completeBtn.disabled = false;
                          return;
                      }
                      const res = await fetch("/api/auth/complete", {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ code, verifier }),
                      });
                      if (!res.ok) {
                          setStatus("Code exchange failed", false);
                          completeBtn.disabled = false;
                          return;
                      }
                      setStatus("Authenticated! Fetching token...", true);
                      const t = await fetch("/api/token");
                      if (!t.ok) {
                          setStatus("Could not fetch token", false);
                          completeBtn.disabled = false;
                          return;
                      }
                      const tok = await t.json();
                      setStatus(
                          "Access token acquired (expires " +
                              new Date(tok.expiresAt * 1000).toLocaleString() +
                              ")",
                          true,
                      );
                      setTimeout(() => {
                          try {
                              window.close();
                          } catch {}
                      }, 500);
                  });
          </script>
      </body>
  </html>
`;

if (!didBootstrap) {
  // Only start the server and open the browser if we didn't bootstrap from disk
  const memory = new Map<
    string,
    { accessToken: string; refreshToken: string; expiresAt: number }
  >();
  const app = express();
  app.use(express.json());

  app.post("/api/auth/start", async (_req, res) => {
    const { verifier, challenge } = await pkcePair();
    const authUrl = authorizeUrl(verifier, challenge);
    json(res, { authUrl, verifier });
  });

  app.post("/api/auth/complete", async (req, res) => {
    const body = req.body as { code?: string; verifier?: string };
    const code = String(body.code ?? "");
    const verifier = String(body.verifier ?? "");
    if (!code || !verifier)
      return json(res, { error: "missing code or verifier" }, 400);
    const tokens = await exchangeAuthorizationCode(code, verifier);
    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 0);
    const entry = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    };
    memory.set("tokens", entry);
    await saveToDisk(entry);
    console.log(`${entry.accessToken}\n`);
    setTimeout(() => process.exit(0), 100);
    json(res, { ok: true });
  });

  app.get("/api/token", async (_req, res) => {
    let entry = memory.get("tokens");
    if (!entry) {
      const disk = await loadFromDisk();
      if (disk) {
        entry = disk;
        memory.set("tokens", entry);
      }
    }
    if (!entry) return json(res, { error: "not_authenticated" }, 401);
    const now = Math.floor(Date.now() / 1000);
    if (now >= entry.expiresAt - 60) {
      const refreshed = await exchangeRefreshToken(entry.refreshToken);
      entry.accessToken = refreshed.access_token;
      entry.expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
      if (refreshed.refresh_token) entry.refreshToken = refreshed.refresh_token;
      memory.set("tokens", entry);
      await saveToDisk(entry);
    }
    json(res, {
      accessToken: entry.accessToken,
      expiresAt: entry.expiresAt,
    });
  });

  app.get("/", (_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(indexHtml);
  });

  app.use((_req, res) => {
    res.status(404).send("something went wrong and your request fell through");
  });

  const server = createServer(app);
  server.listen(PORT, async () => {
    const url = `http://localhost:${PORT}`;
    await open(url);
  });
}
