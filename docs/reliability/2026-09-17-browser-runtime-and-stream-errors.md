# Browser runtime and late stream error verification

## Findings

A live authenticated Hack browser request on the 3054 production preview returned `navigation-failed`: Playwright 1.55.0 expected Chromium headless shell revision 1187 under the normal macOS cache. Earlier tests had installed browsers under `/tmp/rift-playwright-browsers`; that environment override was not present in the ordinary web process. Mocked browser tests did not detect this deployment gap.

Playwright was also a development-only dependency even though `browse_url` dynamically imports it in the server runtime. It is now a production dependency, with the existing version unchanged.

## Fix

`scripts/browser-runtime.cjs` launches and closes the actual browser before declaring readiness. A missing executable triggers one installation using the locally resolved, lockfile-pinned Playwright CLI, followed by another real launch. Other launch failures propagate; they do not cause download loops. Normal `pnpm start`, release-preview startup and `pnpm setup` invoke this check. `pnpm prepare:browser` is available for image preparation.

Install and runtime must use the same `PLAYWRIGHT_BROWSERS_PATH` and service account. For Linux deployment images, install OS dependencies at image-build time using the pinned Playwright CLI (`pnpm exec playwright install --with-deps chromium --only-shell`), then run `pnpm prepare:browser` in the service environment. Do not expect a cache on the developer's Mac to exist in a cloud runtime. The Trigger deployment already has its own pinned Playwright image extension in `trigger.shared.ts`; that deployment was not changed here.

## Live evidence

- Before: chat `fcb54b63-f683-47f9-b1a7-6045ffe5110b`, browser missing, tool `ok: false`.
- After installation into the ordinary service cache: chat `c4ad0fd8-4a12-4c24-a5c4-ae567428fe1b`, `browse_url` returned `ok: true`, HTTP 200, title `Example Domain`, 559 bytes; 162 stream events, one finish and zero errors. The final response reported the actual title and success.
- A subsequent readiness check launched successfully without downloading again.
- No existing web/desktop process was restarted for this runtime repair.

## Late error visibility

The earlier chat `8e3faf42-d8e4-4155-b4ec-2b4ca321d0f0` had a successful browser result, one generic error event and a finish event, while its log reported success. Its exact underlying exception was not captured. Do not classify it as fixed based on the later passing request.

The outer UI stream error handler now reports original exceptions through the existing structured chat logger. Errors from asynchronously merged streams bypass the HTTP handler's outer catch; the new regression exercises that actual SDK path. User-facing text still uses the existing friendly formatter. This supplies missing evidence for recurrence rather than hiding the error or automatically repeating tool side effects.

## Checks

- 5 Node readiness/release-config tests passed.
- 29 stream-error, logger and HTTP-admission tests passed.
- 31 browsing and tool-boundary tests passed.
- TypeScript and scoped ESLint passed.
- Frozen offline lockfile validation passed after moving the existing pinned package to production dependencies.
- Initial production build failed while Turbopack wrote a temporary build-manifest file (ENOENT). The isolated retry completed successfully: `.next-ui-release-1789598788822-f1429c5a`. It is running separately on port 3055; the main 3020 application was not restarted.
- Live check on that new release: chat `219ec6c2-27ac-4bc8-ad9f-9c977a77477c`, browser `ok: true`, HTTP 200, title `Example Domain`; 140 events, one stop finish, zero error events. Both the browser capability and final response succeeded. The historical intermittent stream exception did not recur in these two successful requests; its root cause remains unproven.

This evidence covers browser readiness and error observability. Long-task recovery, all mobile flows, OS computer-control permissions and overall production readiness remain separate acceptance requirements.
