# API behavior parity and recovery

Status: implemented local design record
Reference client: official Android app `26.12.0.169415`

## Objective

Open Grind should behave like an ordinary interactive Android client: requests are
bounded, foreground work takes priority, optional enrichment yields under upstream
protection, background work does not retry aggressively, and realtime transport
exists only while the app can use it. These controls reduce accidental request
bursts; they do not promise that an upstream service will accept any request.

The official-client observations below come from static analysis of the matching
decompiled APK. They are reference evidence, not an authorization to bypass access
controls or conceal errors.

## Request shaping

- Browse cascade requests are serialized. A superseded location or filter load is
  discarded instead of being rendered later.
- Visible lazy profiles are collected briefly, deduplicated, and resolved through
  `/v3/profiles` in batches of at most 30. The official client also chunks this
  request at 30 profile identifiers.
- Identical safe reads share one in-flight native request. Mutations are never
  replayed automatically.
- The native runtime has a fixed global ceiling of 20 requests and one permit each
  for Browse cascade, profile batches, and background notification polling.
- Background polling waits while foreground requests are active or queued.
- A rolling circuit opens after a configurable number and percentage of relevant
  failures. A Cloudflare-style `/v3/profiles` block uses an endpoint-scoped
  protection cooldown so the base Browse grid remains usable. A protection block
  from any other request class opens a global cooldown. Mutations remain blocked
  after that cooldown until one safe read proves that protection has recovered.
- Request cancellation crosses the WebView/Rust boundary. A timed-out or abandoned
  subscriber cannot leave its native request running indefinitely.

## Realtime lifecycle

Realtime delivery is enabled only when all native inputs are true:

1. the frontend requested realtime;
2. the process is foregrounded; and
3. Android reports an Internet-capable network.

The app reuses Tauri's process lifecycle events and one process-scoped Android
network callback. Disabling realtime preserves the authenticated session and
interrupts connection setup, an active socket, or retry sleep.

The locally patched `grindr` crate matches the observed official transport:

- ten-second WebSocket control-frame ping;
- linear five-second retry steps capped at a 180-second nominal delay;
- equal jitter from 50% to just below 100% of the nominal delay;
- connected state only after `ws.connection.established`;
- retry counter reset after establishment;
- graceful deliberate close with code `1000` and reason `Normal closure`; and
- no retry after a normal server close.

These transport constants and lifecycle gates are fixed. Making them faster or
optional would weaken parity and anti-burst guarantees.

## Targeted synchronization and caching

- Reconnect, foreground, dropped-event, and server refresh signals are coalesced
  into typed `inbox`, `conversation`, `taps`, and `views` scopes.
- Inbox automatic reconciliation fetches only the latest page. A manual refresh is
  the explicit full refresh path.
- Active conversations refresh only when a signal targets them or transport loss
  makes a broad catch-up necessary.
- Taps and views hydrate account-scoped disk snapshots before performing
  stale-while-revalidate network reads. WebSocket updates are persisted.
- Inbox message search reads downloaded memory/disk history only. Search never
  expands into background history downloads.
- Profile snapshots retain server freshness hints. A newer summary timestamp makes
  an otherwise recent profile cache entry stale.
- Full and Browse profile projections share one account-generation-scoped,
  one-minute TTL/LRU. Expired entries are deleted on access; account changes clear
  cached projections and prevent stale request completion from becoming current.
- Cached inbox search indexes compact normalized message corpora with bounded
  readers, then releases nonactive full transcripts. Cancelling or clearing the
  query drops the corpus and prevents late workers from repopulating results.
- Place search runs only after explicit submission, cancels stale requests, and
  keeps a bounded in-memory LRU.
- Album dimension inspection uses a bounded, cancellable worker pool and preserves
  server slide order.

## Navigation and bounded live state

Open Grind keeps canonical, deep-linkable routes while applying an app-owned
semantic navigation policy. Browse, Right Now, Interest, Inbox, and Settings are
peer roots: switching roots or sibling subsections replaces the current browser
entry. The first detail records one semantic parent, while selecting another chat
or profile replaces the existing detail. Back closes the highest-priority viewer,
dialog, drawer, or local mode before closing the current detail, returning to the
current root, and finally returning to Browse. At Browse root, Android Back
backgrounds the task.

Route provenance contains only opaque entry IDs and parent routes. Scroll memory
uses stable item anchors in an account-scoped, process-lifetime store. Conversation
drafts and reply targets are also process-only and use a 20-conversation LRU; they
are cleared after sending, explicit discard, account change, or sign-out. Neither
drafts nor content-bearing snapshots are written into browser history.

Large surfaces render bounded virtual windows rather than retaining prior screen
trees. Browse retains five fetched payload pages, chat retains eight message pages,
and album/shared-media drawers retain the focused page plus its immediate
neighbors and any explicitly opened item. Durable history remains paged on disk;
these renderer limits are not product history limits.

## Received-media retention and migration

Album history is partitioned by local account and original owner. Direct-message
media history is partitioned by local account and conversation. Record encryption
binds the complete identity tuple as authenticated data, while indexes expose only
hashed identities, ordering data, counts, and encrypted scope-bound cursors. Signed
remote URLs are never persisted.

Ordinary received media may be retained when its visible gallery tile is eligible
for caching. View-once media is never fetched speculatively: retention begins only
after explicit authorization and viewing. When retention is enabled, an encrypted
cached copy can remain after its view limit is exhausted or the sender retracts
the message. Media bytes remain subject to the configured LRU and explicit cache
clearing; lightweight history metadata can outlive byte eviction so the gallery
can show an unavailable placeholder. Disabling retention clears direct-media
bytes and entries whose only remaining value was a retained retracted or
view-once copy.

Beta-4 and earlier beta-5 cache records migrate in bounded batches. A source is
retired only after the partitioned beta-5 destination is durably written,
decrypted, parsed, and identity-verified. Corrupt destinations fail closed and
leave the legacy source readable. Account-session generations and cache epochs
prevent late downloads, reads, or migrations from repopulating state after
clear/sign-out. Migration diagnostics are restricted to schema versions, counts,
duration, and generic outcomes; IDs, URLs, content, and key material are excluded.

## Background notifications

Android uses one unique periodic WorkManager job with a connected-network
constraint. The worker exits successfully without a rapid retry when notifications
are disabled, no categories are selected, the app is foregrounded, or a check
fails. Only enabled categories are fetched. The native API runtime prevents the
background poll from overlapping foreground work.

WorkManager's minimum interval is 15 minutes. The configured interval is a request;
Android may run the job later because of battery, network, or system scheduling.

## Developer Settings

Defaults are recommended. Settings can make the app slower or more conservative,
but server-facing parity caps prevent more aggressive values.

| Setting                           |   Default |             Range | Effect                                                                                    |
| --------------------------------- | --------: | ----------------: | ----------------------------------------------------------------------------------------- |
| Profile resolution batch size     |        30 |              1-30 | Maximum IDs in one profile-resolution request                                             |
| Profile batch collection window   |     16 ms |        0-1,000 ms | Local coalescing delay before profile resolution                                          |
| Profile cache size                |       500 |         100-2,000 | Fresh profile records retained for the active account                                     |
| Conversation search concurrency   |         3 |               1-6 | Cached conversations read and indexed together                                            |
| Album-share discovery concurrency |         3 |               1-8 | Per-album recipient-share lookups run together                                            |
| API request timeout               | 35,000 ms |  5,000-120,000 ms | Subscriber wait before native cancellation                                                |
| Realtime sync throttle            |  2,000 ms |   2,000-30,000 ms | Minimum spacing between coalesced reconciliation passes                                   |
| Place search cache size           |        20 |             1-100 | Recent explicit searches retained in memory                                               |
| Album preload concurrency         |         3 |               1-8 | Detached media inspections run concurrently                                               |
| Notification polling interval     |    15 min |      15-1,440 min | Requested Android periodic check interval                                                 |
| Circuit history window            |        50 |            20-100 | Recent outcomes retained by native recovery                                               |
| Circuit minimum samples           |        20 |              5-20 | Samples required before opening the circuit                                               |
| Circuit failure threshold         |       50% |            25-50% | Failure ratio that opens the circuit                                                      |
| Circuit pause duration            | 30,000 ms | 30,000-300,000 ms | Pause after circuit opening                                                               |
| Protection cooldown               | 30,000 ms | 30,000-300,000 ms | Endpoint pause for blocked profile enrichment or global pause for other protection blocks |

Global concurrency, per-class serialization, foreground priority, cancellation
bounds, explicit place-search submission, WebSocket cadence, and notification
retry behavior remain fixed safety contracts.

## User and logcat reporting

- Cloudflare/protection recovery states appear in the top-of-screen mitigation
  banner with cooldown and recovery transitions. The banner distinguishes
  profile-only enrichment pauses from global API pauses.
- Unsafe mutations blocked by recovery report that the action was not sent and was
  not retried.
- Other errors continue through surface-specific error UI and copyable diagnostics.
- Native request, mitigation, notification, identity, realtime lifecycle, and
  privacy-safe frontend diagnostic events are emitted to logcat.
- Diagnostics contain bounded category/component/code labels, HTTP method and
  sanitized route structure, state, counts, and timing. They must not contain
  credentials, session tokens, message text, display names, private media URLs,
  query values, network identifiers, or account identifiers.
- Authentication refresh failures log only an allowlisted failure kind and, when
  available, HTTP status or API code. Server-controlled response text remains
  confined to explicit user-facing error handling.

Useful logcat markers include `[api-request]`, `[api-mitigation]`,
`[notification-poll]`, `[ws-lifecycle]`, `[client-error]`, and `[media-origin]`.

## Validation boundary

Static and automated checks can prove scheduling, bounds, cancellation, cache
validation, and error contracts. A signed APK on a physical Android device is still
required to validate process suspend/resume, network handoff, actual request cadence,
WorkManager timing, banner rendering, media loading, and upstream responses.
