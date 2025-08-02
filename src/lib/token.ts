const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

const HOME = Bun.env.HOME || Bun.env.USERPROFILE || ".";
const CACHE_DIR = `${HOME}/.config/crush/anthropic`;
const BEARER_FILE = `${CACHE_DIR}/bearer_token`;
const REFRESH_FILE = `${CACHE_DIR}/refresh_token`;
const EXPIRES_FILE = `${CACHE_DIR}/bearer_token.expires`;

export type TokenEntry = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export async function ensureDir() {
  await Bun.$`mkdir -p ${CACHE_DIR}`;
}

export async function writeSecret(path: string, data: string) {
  await Bun.write(path, data);
  await Bun.$`chmod 600 ${path}`;
}

export async function readText(path: string) {
  const f = Bun.file(path);
  if (!(await f.exists())) return undefined;
  return await f.text();
}

export async function loadFromDisk(): Promise<TokenEntry | undefined> {
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

export async function saveToDisk(entry: TokenEntry) {
  await ensureDir();
  await writeSecret(BEARER_FILE, `${entry.accessToken}\n`);
  await writeSecret(REFRESH_FILE, `${entry.refreshToken}\n`);
  await writeSecret(EXPIRES_FILE, `${String(entry.expiresAt)}\n`);
}

export async function exchangeRefreshToken(refreshToken: string) {
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

/**
 * Attempts to load a valid token from disk, refresh if needed, and print it to stdout.
 * Returns true if a valid token was found and printed, false otherwise.
 */
export async function bootstrapFromDisk(): Promise<boolean> {
  const entry = await loadFromDisk();
  if (!entry) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now < entry.expiresAt - 60) {
    Bun.write(Bun.stdout, `${entry.accessToken}\n`);
    setTimeout(() => process.exit(0), 50);
    return true;
  }
  try {
    const refreshed = await exchangeRefreshToken(entry.refreshToken);
    entry.accessToken = refreshed.access_token;
    entry.expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
    if (refreshed.refresh_token) entry.refreshToken = refreshed.refresh_token;
    await saveToDisk(entry);
    Bun.write(Bun.stdout, `${entry.accessToken}\n`);
    setTimeout(() => process.exit(0), 50);
    return true;
  } catch {
    return false;
  }
}
