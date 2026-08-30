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

test("answers natural-language entertainment searches", async () => {
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "anime with a genius protagonist" }),
  });
  assert.equal(response.status, 200);

  const payload = await response.json();
  const titles = payload.recommendations.map((item) => item.title);
  assert.ok(titles.includes("Code Geass") || titles.includes("Death Note"));
  assert.ok(payload.intent.contentTypes.includes("anime"));
  assert.ok(
    ["ollama", "deterministic-fallback"].includes(payload.meta.provider),
  );
  if (payload.meta.provider === "ollama") {
    assert.equal(payload.meta.model, "qwen2.5:3b");
  }
});
