#!/usr/bin/env node
// CLI wrapper around the KIE client.
//
//   node generate.js --model <model> --prompt "<text>" [options]
//
// Options:
//   --model      <name>    KIE model id            (default: google/nano-banana)
//   --prompt     <text>    text prompt             (required)
//   --image      <url>     input image url; repeat for multiple (image-to-image)
//   --aspect     <ratio>   e.g. 16:9, 1:1, 9:16
//   --input      <json>    raw JSON merged into the model input (advanced)
//   --out        <dir>     download results into this directory (default: ./output)
//   --no-download          print URLs only, don't download
//   --timeout    <sec>     max seconds to wait     (default: 600)
//
// Examples:
//   node generate.js --prompt "a neon city skyline at dusk"
//   node generate.js --model veo3_fast --prompt "drone shot over a forest" --aspect 16:9
//   node generate.js --model qwen/image-to-image --image https://x/y.png --prompt "make it snowy"

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "./src/env.js";
import { KieClient, KieError } from "./src/kie.js";

function parseArgs(argv) {
  const args = { images: [], download: true, out: "output", timeout: 600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--model": args.model = next(); break;
      case "--prompt": args.prompt = next(); break;
      case "--image": args.images.push(next()); break;
      case "--aspect": args.aspect = next(); break;
      case "--input": args.rawInput = next(); break;
      case "--out": args.out = next(); break;
      case "--no-download": args.download = false; break;
      case "--timeout": args.timeout = Number(next()); break;
      case "-h": case "--help": args.help = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        args.help = true;
    }
  }
  return args;
}

const HELP = `Generate media via the KIE.ai API.

Usage:
  node generate.js --prompt "<text>" [--model <id>] [--image <url>]... [options]

Options:
  --model <id>       KIE model id (default: google/nano-banana)
  --prompt <text>    Text prompt (required)
  --image <url>      Input image URL (repeatable, for image-to-image)
  --aspect <ratio>   Aspect ratio, e.g. 16:9, 1:1, 9:16
  --input <json>     Raw JSON merged into the model input (advanced)
  --out <dir>        Output directory for downloads (default: ./output)
  --no-download      Print result URLs only, skip downloading
  --timeout <sec>    Max seconds to wait (default: 600)
  -h, --help         Show this help
`;

async function download(url, dir, index) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (new URL(url).pathname.match(/\.[a-z0-9]+$/i) || [".bin"])[0];
  const file = join(dir, `result-${index + 1}${ext}`);
  await writeFile(file, buf);
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  if (!args.prompt) {
    console.error("Error: --prompt is required.\n");
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  loadEnv();

  const model = args.model || "google/nano-banana";
  const input = { prompt: args.prompt };
  if (args.images.length) input.image_urls = args.images;
  if (args.aspect) input.aspectRatio = args.aspect;
  if (args.rawInput) {
    try {
      Object.assign(input, JSON.parse(args.rawInput));
    } catch {
      console.error("Error: --input must be valid JSON.");
      process.exitCode = 1;
      return;
    }
  }

  const client = new KieClient();

  console.log(`▸ Model:  ${model}`);
  console.log(`▸ Prompt: ${args.prompt}`);
  console.log("▸ Submitting task...");

  try {
    const taskId = await client.createTask(model, input);
    console.log(`▸ Task created: ${taskId}`);
    console.log("▸ Waiting for generation to finish...");

    let lastState = "";
    const { resultUrls } = await client.waitForTask(taskId, {
      timeoutMs: args.timeout * 1000,
      onProgress: (rec) => {
        if (rec.state !== lastState) {
          lastState = rec.state;
          const pct = rec.progress != null ? ` (${Math.round(rec.progress * 100)}%)` : "";
          console.log(`  · ${rec.state}${pct}`);
        }
      },
    });

    if (!resultUrls.length) {
      console.log("✓ Task succeeded but returned no result URLs.");
      return;
    }

    console.log(`\n✓ Done — ${resultUrls.length} result(s):`);
    resultUrls.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));

    if (args.download) {
      await mkdir(args.out, { recursive: true });
      for (let i = 0; i < resultUrls.length; i++) {
        const file = await download(resultUrls[i], args.out, i);
        console.log(`  ↓ saved ${file}`);
      }
    }
  } catch (err) {
    if (err instanceof KieError) {
      console.error(`\n✗ KIE error: ${err.message}` + (err.failCode ? ` (code ${err.failCode})` : ""));
    } else {
      console.error(`\n✗ ${err.message}`);
    }
    process.exitCode = 1;
  }
}

main();
