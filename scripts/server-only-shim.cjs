// Dev-only: lets Node scripts (tsx) import app modules that carry the Next.js
// `server-only` marker. Usage: NODE_OPTIONS="--require ./scripts/server-only-shim.cjs"
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./server-only-empty.cjs");
  return orig.call(this, request, ...rest);
};
