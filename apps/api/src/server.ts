import {
  DEFAULT_CLASSIFY_MODEL,
  ELIGIBILITY_PROMPT_VERSION,
  POSTPROCESS_VERSION,
} from "@remotefit/core";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./db/env.js";

loadEnv();
const port = Number(process.env["PORT"] ?? 3001);
const { db } = createDb();
// The same combination `npm run classify` writes, so the API never mixes versions.
const classifier = {
  promptVersion: ELIGIBILITY_PROMPT_VERSION,
  postprocessVersion: POSTPROCESS_VERSION,
  model: process.env["RF_LLM_MODEL_CLASSIFY"] || DEFAULT_CLASSIFY_MODEL,
};
createApp({ jobs: { db, classifier } }).listen(port, () => {
  console.log(
    `API listening on http://localhost:${port} · ${classifier.promptVersion} + ${classifier.postprocessVersion} + ${classifier.model}`,
  );
});
