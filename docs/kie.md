# KIE.ai Media Generation

A small, dependency-free Node.js client + CLI for generating media (image,
video, music) through the [KIE.ai](https://kie.ai/) unified API.

## How it works

All KIE generation is **asynchronous**:

1. `POST /api/v1/jobs/createTask` with `{ model, input }` → returns a `taskId`.
2. `GET /api/v1/jobs/recordInfo?taskId=…` → poll until `state` is `success` or `fail`.
3. On success, result URLs live in `data.resultJson.resultUrls`.

`state` moves through `waiting → queuing → generating → success | fail`.

## Setup

Requires **Node.js 18+** (uses the built-in `fetch`). No `npm install` needed.

```bash
cp .env.example .env
# then edit .env and set KIE_API_KEY
```

Get your key from <https://kie.ai/> → **API Keys**.

> The `.env` file is gitignored — never commit your key.

## CLI usage

```bash
# Image (default model: google/nano-banana)
node generate.js --prompt "a serene mountain lake at golden hour" --aspect 16:9

# Video
node generate.js --model veo3_fast --prompt "drone shot over a misty forest" --aspect 16:9

# Image-to-image
node generate.js --model qwen/image-to-image \
  --image https://example.com/input.png \
  --prompt "make it a snowy winter scene"

# Advanced: merge arbitrary model params as raw JSON
node generate.js --model some/model --prompt "hi" --input '{"seeds":42,"watermark":false}'
```

Results are downloaded into `./output/` by default. Pass `--no-download` to
print URLs only.

| Flag | Description | Default |
|------|-------------|---------|
| `--model` | KIE model id | `google/nano-banana` |
| `--prompt` | Text prompt (required) | — |
| `--image` | Input image URL (repeatable) | — |
| `--aspect` | Aspect ratio, e.g. `16:9`, `1:1`, `9:16` | — |
| `--input` | Raw JSON merged into the model input | — |
| `--out` | Output directory | `output` |
| `--no-download` | Print URLs only | download |
| `--timeout` | Max seconds to wait | `600` |

## Programmatic usage

```js
import { loadEnv } from "./src/env.js";
import { KieClient } from "./src/kie.js";

loadEnv(); // populate process.env from .env

const client = new KieClient(); // reads KIE_API_KEY from env

// One-shot: create + poll to completion
const { resultUrls } = await client.generate("google/nano-banana", {
  prompt: "a neon city skyline at dusk",
  aspectRatio: "16:9",
});
console.log(resultUrls);

// Or drive the steps yourself
const taskId = await client.createTask("veo3_fast", { prompt: "ocean waves" });
const result = await client.waitForTask(taskId, {
  onProgress: (rec) => console.log(rec.state),
});
```

`input` fields are model-specific — see each model's page in the
[KIE docs](https://docs.kie.ai/) (e.g. `prompt`, `image_urls`, `aspectRatio`,
`seeds`, `watermark`).

## Note on networking

The API host is `https://api.kie.ai`. If you run this from a sandboxed
environment with an egress allowlist, make sure `api.kie.ai` is permitted —
otherwise the request is blocked before it reaches KIE.
