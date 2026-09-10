import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const baseUrl = "http://localhost:8788";
let devServer;
let serverOutput = "";

before(async () => {
  const command =
    process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const args =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          "npm run dev -- --hostname 127.0.0.1 --port 8788",
        ]
      : ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "8788"];

  devServer = spawn(
    command,
    args,
    {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  devServer.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  devServer.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (devServer.exitCode !== null) {
      throw new Error(`Test server exited early.\n${serverOutput}`);
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The worker is still compiling.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for the test server.\n${serverOutput}`);
});

after(() => {
  if (!devServer || devServer.exitCode !== null) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(devServer.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    devServer.kill("SIGTERM");
  }
});

test("server-renders the EntertainmentAI dashboard", async () => {
  const response = await fetch(baseUrl, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>EntertainmentAI - Every story universe, intelligently curated<\/title>/i,
  );
  assert.match(html, /EntertainmentAI/);
  assert.match(html, /Your universe/);
  assert.match(html, /Ask Lumi/);
  assert.match(html, /https?:\/\/[^"]+\/og\.png/);
  assert.doesNotMatch(
    html,
    /Your site is taking shape|react-loading-skeleton|entertainmentai\.invalid/,
  );
});

test("filters the universal catalog by content type", async () => {
  const response = await fetch(`${baseUrl}/api/contents?type=anime`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.ok(payload.data.length >= 3);
  assert.ok(payload.data.every((item) => item.type === "anime"));
});

test("serves premium content detail from canonical Supabase ids", async (context) => {
  const contentsResponse = await fetch(`${baseUrl}/api/contents?limit=10`);
  assert.equal(contentsResponse.status, 200);
  const contentsPayload = await contentsResponse.json();
  const candidate = contentsPayload.data?.find((item) => item.id);
  if (!candidate) context.skip("No Supabase content rows available for detail validation.");

  const detailResponse = await fetch(`${baseUrl}/api/content/${candidate.id}`);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).data;
  assert.equal(String(detail.id), String(candidate.id));
  assert.ok(Array.isArray(detail.characters));
  assert.ok(Array.isArray(detail.castCredits));
});

test("renders the premium content detail shell", async () => {
  const response = await fetch(`${baseUrl}/content/movie-interstellar`, { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /content-experience|detail-loading/i);
});

test("returns unavailable information when vector and fallback context are absent", async () => {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Recommend anime similar to Frieren" }),
  });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.meta.retrievalFallbackUsed, true);
  assert.equal(payload.meta.retrievalEngine, "metadata-popularity-fallback-v1");
  assert.equal(typeof payload.meta.groundedSources, "number");
  assert.ok(payload.meta.groundedSources >= 0);
  assert.ok(typeof payload.meta.errorType === "string" || payload.meta.errorType === null);
  assert.equal(typeof payload.answer, "string");
  assert.ok(payload.answer.length > 0);
});

test("AI chat uses grounded records or a deterministic fallback safely", async () => {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Analyze my watching history and explain my anime preference",
    }),
  });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.meta.retrievalFallbackUsed, true);
  assert.ok(payload.meta.groundedSources > 0);
  assert.ok(["deterministic-fallback", "remote-ai"].includes(payload.meta.provider));
  assert.ok(payload.recommendations.length <= payload.meta.groundedSources);
});

test("renders every Batch 4 application page", async () => {
  const pages = new Map([
    ["/discover", "Discover every universe"],
    ["/search", "Search by title, meaning, or character"],
    ["/recommendations", "Recommended for you"],
    ["/ai-chat", "Ask Lumi"],
    ["/profile", "Your taste dashboard"],
    ["/watchlist", "Your watchlist"],
    ["/history", "History.*continue watching"],
    ["/profile/preferences", "Your preference profile"],
    ["/rating-history", "Your rating history"],
    ["/favorites", "Your favorites"],
    ["/onboarding", "Taste calibration"],
  ]);

  for (const [path, copy] of pages) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), new RegExp(copy, "i"), path);
  }
});

test("provides Supabase email, password, and magic-link authentication UI", async () => {
  const response = await fetch(`${baseUrl}/auth`, {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Sign in/i);
  assert.match(html, /Create account/i);
  assert.match(html, /Magic link/i);
});

test("protects onboarding, watchlist, and history APIs without a Supabase session", async () => {
  const calls = [
    fetch(`${baseUrl}/api/user/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favoriteGenres: ["Action"], onboardingCompleted: true }),
    }),
    fetch(`${baseUrl}/api/user/watchlist`),
    fetch(`${baseUrl}/api/user/history`),
    fetch(`${baseUrl}/api/user/onboarding`),
    fetch(`${baseUrl}/api/user/preferences`),
    fetch(`${baseUrl}/api/user/ratings`),
    fetch(`${baseUrl}/api/user/favorites`),
    fetch(`${baseUrl}/api/user/taste-profile`),
    fetch(`${baseUrl}/api/content/rating`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentId: 1, rating: 5 }) }),
    fetch(`${baseUrl}/api/content/favorite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentId: 1 }) }),
  ];
  const responses = await Promise.all(calls);
  assert.ok(responses.every((response) => response.status === 401));
});

test("returns a safe unauthenticated Supabase session state", async () => {
  const response = await fetch(`${baseUrl}/api/auth/session`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user, null);
  assert.equal(typeof payload.configured, "boolean");
});
