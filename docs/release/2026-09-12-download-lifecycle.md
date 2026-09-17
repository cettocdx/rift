# Downloads, URL cache ownership and image focus

Baseline: `4c69b8d`. This follow-up fixes races after the late-receipt work;
provider startup latency and native packaging are unchanged.

## Proven defects and changes

A file download did not become busy until after URL resolution, permitting
repeated clicks to launch duplicate resolutions/downloads. Each clicked receipt
now acquires a synchronous lock before any await. Its busy state is independent
of another receipt rendered by the same component. An explicitly requested,
authorized download can finish after navigating away; obsolete completion may
not overwrite the current renderer or its cache. A denied or failed durable
file lookup cannot fall back to a prior signed URL or open a browser window.

The shared per-hook image cache also accepted old batch results after a newer
explicit URL write. Each pending ID now has an ownership ticket. Explicit writes,
removal, action/client replacement and teardown retire that ownership. Only its
owner may write or release the reservation; unrelated text deltas retain healthy
requests. Action replacement also retires retained setters/getters. Chunk size
50, retries for omitted/failed IDs, TTL and independent hook instances remain.
Same-client authentication changes still require the caller's account-boundary
remount. This is not a new global or cross-account cache.

A real browser image download exposed lost focus after closing the viewer.
The fixture has intentionally stubbed service hooks, so a separate component test
with stable client/action objects confirmed the cause: a canonical URL resolving
while the viewer was open replaced the opener DOM node. The file renderer created
a new nested React component type on each render. Rendering that branch within
the stable parent preserves the opener, which the existing modal can then focus.
No focus-selector workaround or ImageViewer rewrite was introduced.

## Verification

- Deferred component tests reproduce duplicate clicks, denial fallback, obsolete
  URL/cache/toast writes, overlapping busy states and unmount completion.
- Hook tests exercise batches across 120 text deltas, supersession, removal and
  re-add, old clients, Strict Mode replay, expiration and separate instances.
- Stable-client focus test fails before the nested component fix and passes after.
- `pnpm exec playwright test --config e2e/mobile-fixture/playwright.media-download.config.ts`
  uses actual Messages/FilePartRenderer/ImageViewer and the production browser
  download utility. Eight Chromium/WebKit desktop and 360/390/430px scenarios
  download exact synthetic SVG bytes, reject an HTTP 403 body without saving it,
  retry successfully, restore focus and retain the draft. It is a loopback test;
  service authorization and native IPC are not exercised by this matrix.

## Remaining limits

The URL cache is still keyed by file ID; a same-ID corrected receipt cannot
invalidate a stale cache entry on remount without a richer freshness contract.
Persisted versus temporary receipt precedence is unchanged. ImageViewer's own
button still uses its selected URL directly, independently of the durable-ID
refresh path on document/video cards. Native download completion, large media,
physical mobile keyboards and account-boundary integration require separate live
verification. FilePreviewCard's older memo-created component identity remains.
The changes do not establish overall Cursor/Claude parity or production readiness.

Exact gate, build and runtime evidence live in the external RIFT-Reports folder.
