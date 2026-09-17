# Terminal and code export fidelity

Two defects were reproduced before correction:

- CodeActionButtons called `content.trim()` before copying, changing leading indentation and trailing newlines. Copy now writes the exact original string. This matters for indentation-sensitive code and exact terminal evidence.
- The text-download fallback revoked its blob URL in the same event as the anchor click. Binary media already allowed WebKit time to consume the URL. Text downloads now use the same bounded 30-second lifetime and always remove the temporary anchor. The notification says “Download started”; an anchor click cannot prove a completed disk write.

The computer detail panel also no longer says “RIFT is using” for a completed historical operation. It shows the tool name alongside the existing action-specific status and independent run indicator.

Verification:

- Red tests reproduced altered copied text and prematurely revoked text-download URLs.
- Nine focused unit tests passed: exact copied text, text/binary URL lifetime, native binary bytes, failure/empty/abort handling, picker write/close ordering, and responsive sidebar shell.
- Six real browser download cases passed across Chromium and WebKit at 360, 390 and 430 pixels. They opened the production terminal detail component, clicked Download, saved the resulting `terminal-output.txt`, and compared the full command and output byte-for-byte as UTF-8. Draft text remained intact after closing the dialog.
- The browser suite explicitly exercises the no-picker fallback; picker behavior uses mocked browser API unit coverage. Native binary IPC is mocked in unit coverage. This is not a physical-device or native Downloads-folder acceptance claim.
- Scoped ESLint and whitespace checks passed.
- Production build including TypeScript passed (`/tmp/rift-download-build-0917.log`). Release `.next-ui-release-1789602136608-0dcc5e76` is running in the separate 3057 preview. Main 3020 and native user processes were not restarted.

Evidence: `/tmp/rift-download-copy-red-0917.log`, `/tmp/rift-download-final-tests-0917.log`, `/tmp/rift-terminal-download-browser-0917.log`; downloaded files under `e2e/mobile-fixture/results/mobile-tools/`.
