// Minimal .env loader — no external dependency.
// Reads KEY=VALUE lines from a .env file and populates process.env
// (without overwriting variables already set in the real environment).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @param {string} [path]  path to the .env file (default: ./.env in cwd)
 */
export function loadEnv(path = resolve(process.cwd(), ".env")) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // no .env file — rely on the real environment
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}
