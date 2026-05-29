import { logger } from "./logger";

const UMID_URL = "https://sg-wum.alibaba.com/w/wu.json";
const TOKEN_TTL = 3600_000; // 1 hour
const POOL_SIZE = 8;

// Different browser User-Agents to get distinct bx-umidtoken values per identity
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

interface PoolEntry {
  token: string;
  ts: number;
  ua: string;
}

const _pool: PoolEntry[] = [];
let _rrIndex = 0;
let _initializing = false;
let _initPromise: Promise<void> | null = null;

async function fetchToken(userAgent: string): Promise<string> {
  try {
    const res = await fetch(UMID_URL, {
      headers: { "User-Agent": userAgent },
    });
    const text = await res.text();
    const m = text.match(/(?:umx\.wu|__fycb)\('([^']+)'\)/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function initPool(): Promise<void> {
  if (_initializing) return _initPromise!;
  _initializing = true;
  _initPromise = (async () => {
    logger.info({ size: POOL_SIZE }, "Initializing bx-umidtoken pool");
    const results = await Promise.allSettled(
      USER_AGENTS.slice(0, POOL_SIZE).map((ua) => fetchToken(ua))
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const token = r.status === "fulfilled" ? r.value : "";
      if (token) {
        _pool.push({ token, ts: Date.now(), ua: USER_AGENTS[i] });
      }
    }
    logger.info({ fetched: _pool.length }, "bx-umidtoken pool ready");
  })();
  return _initPromise;
}

async function refreshExpired(): Promise<void> {
  const now = Date.now();
  const stale = _pool.filter((e) => now - e.ts >= TOKEN_TTL);
  if (stale.length === 0) return;

  await Promise.allSettled(
    stale.map(async (entry) => {
      const token = await fetchToken(entry.ua);
      if (token) {
        entry.token = token;
        entry.ts = Date.now();
        logger.debug("bx-umidtoken refreshed in pool");
      }
    })
  );
}

/**
 * Get the next available bx-umidtoken from the pool (round-robin).
 * Automatically initializes the pool on first call and refreshes expired tokens.
 */
export async function getPooledMidtoken(): Promise<string> {
  if (_pool.length === 0) await initPool();

  // Refresh stale tokens in background — don't block current request
  void refreshExpired();

  if (_pool.length === 0) return "";

  const entry = _pool[_rrIndex % _pool.length];
  _rrIndex = (_rrIndex + 1) % _pool.length;
  return entry.token;
}

/**
 * Return current pool status — useful for a health/debug endpoint.
 */
export function getPoolStatus(): { size: number; entries: { ua: string; ageMs: number; hasToken: boolean }[] } {
  const now = Date.now();
  return {
    size: _pool.length,
    entries: _pool.map((e) => ({
      ua: e.ua.slice(0, 40) + "…",
      ageMs: now - e.ts,
      hasToken: !!e.token,
    })),
  };
}
