import { RUNTIME_CONTEXT_TTL_MS } from "./config.js";
import { queryAll, queryFirst } from "./lib/db.js";
import { createRuntimeContextResolver } from "./lib/runtime.js";

export const resolveRuntimeContext = createRuntimeContextResolver({
  queryAll,
  queryFirst,
  ttlMs: RUNTIME_CONTEXT_TTL_MS
});
