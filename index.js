/**
 * SlideForge Deck — GitHub Action
 *
 * Renders an editable .pptx from a JSON file of slide intents.
 * Zero dependencies: Node 20+ built-in fetch, no bundling step.
 */

const fs = require("fs");
const path = require("path");

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const isTrue = (v) => ["true", "1", "yes"].includes(v.toLowerCase());

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  // Random-ish delimiter so multiline/odd values can't break the file format.
  const d = `ghadelim_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  fs.appendFileSync(file, `${name}<<${d}\n${value ?? ""}\n${d}\n`);
}

function summary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, md + "\n");
}

const fail = (msg) => {
  console.log(`::error::${msg}`);
  process.exit(1);
};

function readDeck(deckPath) {
  if (!fs.existsSync(deckPath)) {
    fail(
      `Deck file not found: ${deckPath}\n` +
        `Point the "deck" input at a JSON file — either {"name": "...", "slides": [...]} or a bare array of slide intents.`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(deckPath, "utf8"));
  } catch (e) {
    fail(`Deck file is not valid JSON (${deckPath}): ${e.message}`);
  }
  // Accept a bare array of intents or a {slides: [...]} envelope.
  const body = Array.isArray(parsed) ? { slides: parsed } : { ...parsed };
  if (!Array.isArray(body.slides) || body.slides.length === 0) {
    fail(`No slides found in ${deckPath}. Expected {"slides": [ ... ]} or a bare array of slide intents.`);
  }
  return body;
}

async function main() {
  const apiKey = input("api-key");
  if (!apiKey) {
    fail(
      "No api-key supplied. Store your SlideForge key as a repo secret and pass it as `api-key`.\n" +
        "Free key (60 free slides, no credit card): https://slideforge.dev/sign-up -> https://slideforge.dev/console/keys"
    );
  }

  const apiBase = (input("api-base") || "https://api.slideforge.dev").replace(/\/+$/, "");
  const deckPath = input("deck") || "deck.json";
  const outPath = input("output") || "deck.pptx";

  const body = readDeck(deckPath);
  if (input("theme-id")) body.theme_id = input("theme-id");
  if (input("name")) body.name = input("name");

  const n = body.slides.length;
  console.log(`Rendering ${n} slide${n === 1 ? "" : "s"} from ${deckPath} ...`);

  // Identify the integration so renders from CI can be told apart from raw API calls.
  // Attribution only — it grants nothing, and omitting it changes nothing.
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-SlideForge-Client": "slideforge-deck-action/1.0.0",
  };

  let res, result;
  try {
    res = await fetch(`${apiBase}/v1/render/intent/deck`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    fail(`Could not reach the SlideForge API at ${apiBase}: ${e.message}`);
  }

  const text = await res.text();
  try {
    result = JSON.parse(text);
  } catch {
    fail(`Unexpected non-JSON response (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }

  if (!res.ok) {
    // Problem+JSON: surface the server's own explanation rather than a bare status code.
    const detail = result.detail || result.title || text.slice(0, 400);
    if (res.status === 401) {
      fail(`Unauthorized (401). Check the api-key secret. ${detail}`);
    }
    if (res.status === 402) {
      // Heads-up: an INVALID key can also surface here as "insufficient balance" rather than 401,
      // so check the secret before assuming you're out of credit.
      fail(
        `Insufficient balance (402). ${detail}\n` +
          `  - If you just configured this: double-check the api-key secret — an invalid key can look like a balance error.\n` +
          `  - New accounts get 60 free slides: https://slideforge.dev/sign-up\n` +
          `  - Top up: https://slideforge.dev/console/billing`
      );
    }
    fail(`SlideForge API error ${res.status}: ${detail}`);
  }

  const {
    job_id: jobId,
    status,
    fidelity,
    cost,
    pptx_available: pptxAvailable,
    blocking_error_count: errors = 0,
    nonblocking_warning_count: warnings = 0,
    slides_ok: slidesOk,
  } = result;

  setOutput("job-id", jobId);
  setOutput("status", status);
  setOutput("fidelity", fidelity);
  setOutput("slides", String(slidesOk ?? n));
  setOutput("cost", String(cost ?? ""));

  console.log(`status=${status}  fidelity=${fidelity}  slides_ok=${slidesOk ?? n}/${n}  cost=$${cost ?? 0}`);

  // The honesty layer drives the exit code: nothing usable => fail loudly, and it wasn't billed.
  if (!pptxAvailable || errors > 0) {
    const firstErrors = JSON.stringify(result.errors ?? result.fidelity_manifest ?? {}).slice(0, 600);
    summary(`### SlideForge — render failed\n\n\`status=${status}\`, ${errors} blocking error(s). Nothing was billed.\n\n\`\`\`json\n${firstErrors}\n\`\`\`\n`);
    fail(`Render produced no usable deck (status=${status}, ${errors} blocking error(s)). Nothing was billed. ${firstErrors}`);
  }

  // Download the .pptx (header-auth; response bodies stay credential-free).
  const dl = await fetch(`${apiBase}/v1/jobs/${jobId}/pptx`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!dl.ok) fail(`Rendered ok but the download failed (HTTP ${dl.status}) for job ${jobId}.`);

  const dir = path.dirname(outPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));

  const kb = Math.round(fs.statSync(outPath).size / 1024);
  setOutput("pptx-path", outPath);
  console.log(`Wrote ${outPath} (${kb} KB)`);

  summary(
    `### SlideForge — ${slidesOk ?? n} slide${(slidesOk ?? n) === 1 ? "" : "s"} rendered\n\n` +
      `| | |\n|---|---|\n` +
      `| **File** | \`${outPath}\` (${kb} KB) |\n` +
      `| **Status** | \`${status}\` |\n` +
      `| **Fidelity** | \`${fidelity}\` |\n` +
      `| **Warnings** | ${warnings} |\n` +
      `| **Cost** | $${cost ?? 0} |\n` +
      `| **Job** | \`${jobId}\` |\n`
  );

  if (warnings > 0) {
    console.log(`::warning::Render returned ${warnings} non-blocking warning(s). See the job for details.`);
    if (isTrue(input("fail-on-warnings"))) {
      fail(`fail-on-warnings is set and the render returned ${warnings} warning(s).`);
    }
  }
}

main().catch((e) => fail(e?.stack || String(e)));
