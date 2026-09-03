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
          "npm run dev -- --host 127.0.0.1 --port 8788",
        ]
      : ["run", "dev", "--", "--host", "127.0.0.1", "--port", "8788"];

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
  assert.match(html, /Attack on Titan/);
  assert.match(html, /Ask Lumi/);
  assert.match(html, /http:\/\/localhost:8788\/og\.png/);
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

test("routes normal natural-language searches to the default AI model", async () => {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Recommend anime similar to Frieren" }),
  });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.ok(payload.intent.contentTypes.includes("anime"));
  assert.ok(
    ["openai-compatible", "deterministic-fallback"].includes(
      payload.meta.provider,
    ),
  );
  assert.equal(payload.meta.taskType, "default");
  assert.equal(payload.meta.model, "ag/gemini-3.7-flash-high");
});

test("routes complex preference analysis to the reasoning AI model", async () => {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Analyze my watching history and explain my anime preference",
    }),
  });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.meta.taskType, "reasoning");
  assert.equal(payload.meta.model, "cx/gpt-5.6-sol");
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
