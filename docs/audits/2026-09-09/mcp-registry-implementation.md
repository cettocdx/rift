# MCP Registry implementation — 2026-09-09

## Delivered

The existing curated marketplace now includes an on-demand **Explore the MCP Registry** section. The server reads only `https://registry.modelcontextprotocol.io/v0.1/servers`, requests latest versions, and independently filters official metadata to active/latest records with concrete HTTPS Streamable HTTP or SSE endpoints. Local addresses, credential-bearing URLs, unresolved placeholders, unsupported packages/transports and required custom-header records are not presented as ready remote connections.

Listings preserve the published namespace and version. Registry descriptions render as text; package commands and remote icons are never executed. Generic package marks deliberately identify community servers without inventing a provider logo. Curated and installed endpoints take precedence, and discovery deduplicates repeated endpoints.

A hashed Registry identity binds namespace, version, endpoint and transport. Connect and OAuth start resolve that binding on the server before calling the existing verified connection / PKCE OAuth flows. A forged id or modified endpoint is rejected. Provider identity cannot be claimed from a client-supplied display name. Recheck keeps existing ownership and revision checks.

There is no speculative Connected state. Curated public/OAuth providers retain their direct connection actions. Community entries open the existing credential selection form, where users can choose no authentication, provider OAuth, bearer token or API-key header. Authentication metadata in the Registry is not reliable enough to promise OAuth for every server. Sign-in still requires actual provider support and consent.

## Cache and availability

A single in-process refresh coalesces requests. Successful snapshots persist atomically at `~/.cache/rift/mcp-registry-v1.json`; `RIFT_MCP_REGISTRY_CACHE_PATH` can point at a persistent server volume. The cache refreshes after one hour and backs off after failure. Cached discovery remains available during upstream outages; new identity binding requires a snapshot no older than 24 hours. Hosts with read-only or ephemeral filesystems keep the memory cache but need a persistent path for restart durability. Existing curated plugins do not depend on this cache.

Pagination is bounded (20 pages, 100 records per page, 15-second request deadline and an earlier completed-page cutoff). An incomplete snapshot is labeled explicitly and links to the official Registry. It is not represented as the entire marketplace. The Registry is loaded only when the user expands it, so initial Plugins rendering does not wait on upstream discovery.

## Validation

- 8 focused suites passed: **73 tests passed**, 1 opt-in network test skipped during normal deterministic run.
- Separate opt-in live test passed: production adapter discovered **725 supported remote servers** in approximately **9.5 seconds**, with `truncated: true`.
- Tests cover latest/active filtering, unsafe URLs, unsupported transports, version-bound identity, forged endpoint/transport rejection, fixed-origin cursor handling, repeated cursor and oversized response rejection, persisted snapshot reload, real connect-before-persist, retryable UI and duplicate suppression.
- Existing curated OAuth callback, start, recheck and marketplace UX tests pass.
- Typecheck reported no marketplace errors; unrelated concurrent bot-meeting/generated-API errors were reported to the integrating agent.
- No provider OAuth consent was granted and no external plugin was installed for testing. Live OAuth success for newly discovered community servers remains provider-dependent and is not claimed.

## Visual changes

| Before | After | Why |
| --- | --- | --- |
| Curated-only list | Curated list plus independently expandable Registry | Broad discovery without slowing the known-provider view |
| Inconsistent row logo envelope | 40px row plate with at most 24px optical mark | Consistent visual rhythm |
| Arbitrary public server could be confused with a known brand | Namespace/version-bearing community listing and neutral package mark | Clear provenance without false branding |
| Connecting unknown metadata could imply instant OAuth support | Explicit setup followed by actual handshake/sign-in | Honest connection state and usable credential selection |

Sources: [Official Registry API](https://registry.modelcontextprotocol.io/docs), [Registry aggregators](https://modelcontextprotocol.io/registry/registry-aggregators), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
