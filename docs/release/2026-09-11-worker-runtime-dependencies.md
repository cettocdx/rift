# Worker runtime dependencies — 2026-09-11

## Finding

The staging dry-run bundle built from `d3186a5` omitted `undici` from its
generated `package.json` and external dependency manifest. The bundled E2B SDK
still loaded it through `new Function("moduleName", "return import(moduleName)")`.
Listing a package as external does not make that opaque import discoverable.
The generated Containerfile installs the generated package manifest, not the
application's root lockfile, so a root dependency alone did not repair the image.

Without that import the SDK falls back to global fetch instead of constructing
its HTTP/2-capable Undici dispatcher. This identifies a transport packaging
defect; it does not quantify its contribution to first-response latency.

The same dry run resolved unversioned `sharp` to `latest`, making its image
dependency non-reproducible. The shared build factory now explicitly installs
`node-pty@1.2.0-beta.12`, `sharp@0.34.5`, and `undici@7.25.0` through
`additionalPackages`. Ordinary and isolated canary builds use the same factory.

## Verification

A regression test invoking the real installed build extension failed before
the fix and passed afterward. All six offline canary configuration checks pass.
The new real Trigger CLI dry run generated these exact dependencies:

| Package              | Version       |
| -------------------- | ------------- |
| import-in-the-middle | 3.0.1         |
| node-pty             | 1.2.0-beta.12 |
| playwright           | 1.55.0        |
| sharp                | 0.34.5        |
| undici               | 7.25.0        |

Artifact: `.trigger/tmp/build-azIVJO`, content hash
`0e6fe864224140670c34a80f40342c81`. Its generated package and build manifests were
independently reviewed. No hosted deployment or environment synchronization ran.

The CLI's best-effort skill indexing failed because the local dry-run bundle
had not installed its external dependencies (`import-in-the-middle` was the
first missing module), while the CLI still reported dry-run completion. Root
therefore invoked the installed SDK's `indexWorkerManifest` separately, after
rebasing only manifest output paths and linking already-installed exact external
versions into the dry-run directory. It successfully indexed exactly one task,
`agent-long`, with zero skills and zero prompts. No application credentials were
passed to this indexer. The task bundle bytes were unchanged.

Local dependency links and ancestor module resolution do not prove Linux image
installation, native module loading, a clean deployed runtime, or actual E2B
HTTP/2 negotiation. Those and hosted latency remain canary runtime gates. The
successful index also does not replace checking the remote staging schedule
inventory before enabling any task.

Evidence logs:
`/tmp/rift-worker-dependencies-red.log`,
`/tmp/rift-worker-dependencies-green.log`,
`/tmp/rift-trigger-staging-canary-dependencies-dry-run-20260911.log`, and
`/tmp/rift-canary-index-fixed-private-20260911/index-result.json`.
