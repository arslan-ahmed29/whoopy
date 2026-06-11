import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import * as openwhoop from "./openwhoop-source.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  WHOOP_CLIENT_ID,
  WHOOP_CLIENT_SECRET,
  WHOOP_REDIRECT_URI = "http://localhost:3001/auth/callback",
  WHOOPY_SOURCE,
  PORT = 3001,
} = process.env;

// "openwhoop" reads the local SQLite database synced by the openwhoop CLI
// (no WHOOP membership needed); anything else uses the WHOOP cloud API.
// Defaults to openwhoop automatically when its database exists and no API
// credentials are configured.
const LOCAL_MODE =
  WHOOPY_SOURCE === "openwhoop" ||
  (!WHOOPY_SOURCE && !WHOOP_CLIENT_ID && openwhoop.isAvailable());

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE = "https://api.prod.whoop.com/developer/v2";
const SCOPES =
  "read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement offline";

// Single-user dashboard: tokens persist in a local gitignored file so a
// server restart doesn't force a re-login.
const TOKEN_FILE = path.join(__dirname, ".tokens.json");

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

let tokens = loadTokens();
let pendingOAuthState = null;

async function exchangeToken(params) {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens?.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function getAccessToken() {
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    scope: "offline",
  });
  return tokens.access_token;
}

async function whoopGet(endpoint, query = {}) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    const err = new Error("Not authenticated with WHOOP");
    err.status = 401;
    throw err;
  }
  const url = new URL(WHOOP_API_BASE + endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = new Error(`WHOOP API ${endpoint} failed (${res.status}): ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Paginated collection endpoints (cycle, recovery, sleep, workout) return
// { records, next_token }; walk pages until we have `limit` records.
async function whoopGetAll(endpoint, { start, end, limit = 50 } = {}) {
  const records = [];
  let nextToken;
  do {
    const page = await whoopGet(endpoint, {
      start,
      end,
      limit: Math.min(limit - records.length, 25),
      nextToken,
    });
    records.push(...(page.records ?? []));
    nextToken = page.next_token;
  } while (nextToken && records.length < limit);
  return records;
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/auth/login", (req, res) => {
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    return res
      .status(500)
      .send("Missing WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET. Copy .env.example to .env and fill them in.");
  }
  pendingOAuthState = crypto.randomBytes(16).toString("hex");
  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", WHOOP_CLIENT_ID);
  url.searchParams.set("redirect_uri", WHOOP_REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", pendingOAuthState);
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`WHOOP authorization failed: ${error}`);
  if (!code || state !== pendingOAuthState) {
    return res.status(400).send("Invalid OAuth state or missing code. Try logging in again.");
  }
  pendingOAuthState = null;
  try {
    await exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: WHOOP_REDIRECT_URI,
    });
    res.redirect("/");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/auth/logout", (req, res) => {
  tokens = null;
  fs.rmSync(TOKEN_FILE, { force: true });
  res.json({ ok: true });
});

app.get("/api/status", async (req, res) => {
  if (LOCAL_MODE) {
    return res.json({
      source: "openwhoop",
      configured: true,
      authenticated: openwhoop.isAvailable(),
      dbPath: openwhoop.dbPath,
    });
  }
  res.json({
    source: "whoop-api",
    configured: Boolean(WHOOP_CLIENT_ID && WHOOP_CLIENT_SECRET),
    authenticated: Boolean(await getAccessToken().catch(() => null)),
  });
});

function handleApiError(res, err) {
  res.status(err.status ?? 500).json({ error: err.message });
}

app.get("/api/profile", async (req, res) => {
  if (LOCAL_MODE) {
    return res.json({
      profile: { first_name: "Local", last_name: "(openwhoop)" },
      body: null,
    });
  }
  try {
    const [profile, body] = await Promise.all([
      whoopGet("/user/profile/basic"),
      whoopGet("/user/measurement/body").catch(() => null),
    ]);
    res.json({ profile, body });
  } catch (err) {
    handleApiError(res, err);
  }
});

// Each dashboard endpoint accepts ?days=N (default 30) and returns newest-first records.
function rangeQuery(req) {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 180);
  return {
    start: new Date(Date.now() - days * 86400_000).toISOString(),
    end: new Date().toISOString(),
    limit: 200,
  };
}

app.get("/api/recovery", async (req, res) => {
  try {
    const range = rangeQuery(req);
    res.json(LOCAL_MODE ? await openwhoop.getRecovery(range) : await whoopGetAll("/recovery", range));
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/sleep", async (req, res) => {
  try {
    const range = rangeQuery(req);
    res.json(LOCAL_MODE ? await openwhoop.getSleep(range) : await whoopGetAll("/activity/sleep", range));
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/cycles", async (req, res) => {
  try {
    const range = rangeQuery(req);
    res.json(LOCAL_MODE ? await openwhoop.getCycles(range) : await whoopGetAll("/cycle", range));
  } catch (err) {
    handleApiError(res, err);
  }
});

app.get("/api/workouts", async (req, res) => {
  try {
    const range = rangeQuery(req);
    res.json(
      LOCAL_MODE ? await openwhoop.getWorkouts(range) : await whoopGetAll("/activity/workout", range)
    );
  } catch (err) {
    handleApiError(res, err);
  }
});

// Daily stress / SpO2 / skin temperature averages; openwhoop local mode only.
app.get("/api/vitals", async (req, res) => {
  if (!LOCAL_MODE) return res.json([]);
  try {
    res.json(await openwhoop.getVitals(rangeQuery(req)));
  } catch (err) {
    handleApiError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`whoopy dashboard running at http://localhost:${PORT}`);
  if (LOCAL_MODE) {
    console.log(`Local mode: reading openwhoop database at ${openwhoop.dbPath}`);
    if (!openwhoop.isAvailable()) {
      console.log("⚠ Database not found. Run `openwhoop download-history` and `openwhoop detect-events` first.");
    }
  } else if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    console.log("⚠ No WHOOP credentials found. Copy .env.example to .env and add your Client ID/Secret.");
  }
});
