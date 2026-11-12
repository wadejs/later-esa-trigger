// Pure signed HTTP trigger. No AI, integration logic or user-data persistence runs here.
const origin = process.env.LATER_URL,
  secret = process.env.SCHEDULER_SECRET;
if (!origin || !secret) throw new Error("Missing LATER_URL / SCHEDULER_SECRET");
const base = new URL(origin);
if (base.protocol !== "https:" && base.hostname !== "127.0.0.1")
  throw new Error("HTTPS required");
const encoder = new TextEncoder();
const key = await crypto.subtle.importKey(
  "raw",
  encoder.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
async function post(path: string) {
  const timestamp = String(Date.now()),
    nonce = crypto.randomUUID(),
    body = "{}";
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${nonce}\nPOST\n${path}\n${body}`),
  );
  const signature = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Later-Accept-Stream": "1",
      "x-later-timestamp": timestamp,
      "x-later-nonce": nonce,
      "x-later-signature": signature,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(110000),
  });
  let result = (await response.json()) as any;
  let status = response.status;
  if (response.headers.get("x-later-stream") === "1") {
    status = result.status;
    result = result.body;
  }
  return { status, result };
}
const progressing = new Set([
  "classified",
  "action",
  "scan",
  "digest_ready",
  "question_archive_root",
  "question_archive",
  "notify",
  "questions_notify",
]);
const deadline = Date.now() + 230000;
let steps = 0,
  step = "idle";
while (steps < 30 && deadline - Date.now() > 115000) {
  const r = await post("/api/internal/tick");
  if (
    [409, 503].includes(r.status) &&
    [
      "busy",
      "coordination_release_unknown",
      "coordination_unavailable",
    ].includes(r.result?.error?.code)
  ) {
    const recovered = await post("/api/internal/recover");
    if (recovered.status === 200 && recovered.result.recovered) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    step = "busy";
    break;
  }
  if (r.status < 200 || r.status >= 300)
    throw new Error(
      `tick HTTP ${r.status}: ${String(r.result?.error?.code || "unknown")}`,
    );
  step = r.result.step;
  steps++;
  if (!progressing.has(step)) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
console.log(JSON.stringify({ ok: true, step, steps }));
export {};
