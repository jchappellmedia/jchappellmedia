// Minimal, dependency-free client for the KIE.ai unified media-generation API.
//
// Flow (all generation is asynchronous):
//   1. POST /api/v1/jobs/createTask  -> { data: { taskId } }
//   2. GET  /api/v1/jobs/recordInfo?taskId=...  -> poll until state is "success" | "fail"
//   3. Read result URLs from data.resultJson.resultUrls
//
// Docs: https://docs.kie.ai/  (Market -> Get Task Details)

const DEFAULT_BASE_URL = "https://api.kie.ai";

// Terminal + in-flight task states returned by recordInfo.
const TERMINAL_STATES = new Set(["success", "fail"]);

class KieError extends Error {
  constructor(message, { code, taskId, failCode } = {}) {
    super(message);
    this.name = "KieError";
    this.code = code;
    this.taskId = taskId;
    this.failCode = failCode;
  }
}

class KieClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey   KIE API key (defaults to process.env.KIE_API_KEY)
   * @param {string} [opts.baseUrl]
   */
  constructor({ apiKey = process.env.KIE_API_KEY, baseUrl } = {}) {
    if (!apiKey) {
      throw new KieError(
        "Missing KIE API key. Set KIE_API_KEY in your environment or pass { apiKey }."
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || process.env.KIE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  get #headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async #request(path, { method = "GET", body } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.#headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new KieError(`KIE API returned non-JSON response (HTTP ${res.status})`);
    }

    // KIE nests its own status code inside the body; 200 == success.
    if (!res.ok || (payload.code && payload.code !== 200)) {
      throw new KieError(payload.msg || `KIE API error (HTTP ${res.status})`, {
        code: payload.code || res.status,
      });
    }
    return payload.data;
  }

  /**
   * Create a generation task.
   * @param {string} model   e.g. "google/nano-banana", "veo3_fast", "qwen/image-to-image"
   * @param {object} input   model-specific parameters (prompt, image_urls, aspectRatio, ...)
   * @param {object} [opts]
   * @param {string} [opts.callBackUrl]  webhook to receive the result (optional)
   * @returns {Promise<string>} taskId
   */
  async createTask(model, input, { callBackUrl } = {}) {
    if (!model) throw new KieError("createTask requires a model name.");
    const data = await this.#request("/api/v1/jobs/createTask", {
      method: "POST",
      body: { model, input, ...(callBackUrl ? { callBackUrl } : {}) },
    });
    if (!data?.taskId) throw new KieError("KIE API did not return a taskId.");
    return data.taskId;
  }

  /**
   * Fetch the raw status record for a task.
   * @returns {Promise<{taskId:string,state:string,resultJson?:string,failCode?:string,failMsg?:string,progress?:number}>}
   */
  async getTask(taskId) {
    if (!taskId) throw new KieError("getTask requires a taskId.");
    return this.#request(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  }

  /**
   * Poll a task until it reaches a terminal state, returning the parsed result URLs.
   * @param {string} taskId
   * @param {object} [opts]
   * @param {number} [opts.intervalMs=5000]   delay between polls
   * @param {number} [opts.timeoutMs=600000]  give up after this long (10 min default)
   * @param {(rec:object)=>void} [opts.onProgress]  called on every poll
   * @returns {Promise<{taskId:string,resultUrls:string[],record:object}>}
   */
  async waitForTask(taskId, { intervalMs = 5000, timeoutMs = 600_000, onProgress } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const record = await this.getTask(taskId);
      if (onProgress) onProgress(record);

      if (record.state === "fail") {
        throw new KieError(record.failMsg || "Generation failed.", {
          taskId,
          failCode: record.failCode,
        });
      }
      if (record.state === "success") {
        return { taskId, resultUrls: parseResultUrls(record), record };
      }
      if (Date.now() >= deadline) {
        throw new KieError(`Timed out waiting for task ${taskId} (state: ${record.state}).`, {
          taskId,
        });
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Convenience: create a task and wait for the finished result URLs.
   * @returns {Promise<{taskId:string,resultUrls:string[],record:object}>}
   */
  async generate(model, input, { callBackUrl, ...waitOpts } = {}) {
    const taskId = await this.createTask(model, input, { callBackUrl });
    return this.waitForTask(taskId, waitOpts);
  }
}

/** Extract resultUrls from a recordInfo response (resultJson is a JSON string). */
function parseResultUrls(record) {
  if (!record?.resultJson) return [];
  try {
    const parsed = JSON.parse(record.resultJson);
    return parsed.resultUrls || parsed.result_urls || [];
  } catch {
    return [];
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { KieClient, KieError, parseResultUrls, TERMINAL_STATES, DEFAULT_BASE_URL };
