# Offline staged product captures

Run `node scripts/product-capture/capture.cjs` from the repository root with installed workspace dependencies, Playwright Chromium and FFmpeg (libx264/libvpx-vp9).

This renders ProductCaptureLab at 1280×720 with device scale 3. The six scenes are staged product demonstrations, not authenticated screenshots or evidence of an agent run. The eight WEBP names preserve existing consumers; build-application and build-reasoning are explicit aliases of the Build scene. The hero-run filenames now hold a labeled scene reel, not the former recording. Every new image/frame displays the staged-demo label; manifest entries identify the source view and hashes.

The builder isolates navigation, authentication and runtime hooks. Browser requests outside the ephemeral loopback asset server are rejected. The only API-shaped response is local Studio readiness fixture data; no model, account or execution request is sent. Workspace uses its existing in-memory capture adapter, and the security scene contains no live chat component. Original reference imagery embedded in the scenes is served from public files.

Before screenshots, the script rejects browser errors, requires the canonical logo path, rejects prior two-bar paths and waits for image decoding. Outputs are WEBP, JPEG, H.264 MP4 and VP9 WebM at 3840×2160. The video holds five independently captured scenes for two seconds each. Existing reference images without old branding are retained in the manifest.
