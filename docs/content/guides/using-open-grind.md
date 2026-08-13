# Using Open Grind

The main navigation keeps the same five destinations on every platform:
**Browse**, **Right Now**, **Interest**, **Inbox**, and **Settings**. Compact
windows use a mobile-style layout; wider windows can show the Inbox and an open
conversation together.

## Browse and choose a location

Open Grind requires a browsing location before it loads the grid. Search for a
place or choose a point on the map. Android and iOS builds also expose **Use my
location** when system permission is granted; desktop builds use place search
and the map picker.

The grid supports pull-to-refresh, adjustable column count, quick age and
position controls, and detailed filters including online status, photos,
favorites, tags, tribes, body type, relationship status, and health practices.
Open a profile to see its photos and details, favorite it, add a private note,
send a Tap, start a conversation, copy its profile ID, or block it.

> [!NOTE]
> Reporting profiles is not implemented yet. Use the official Grindr client for
> reporting and other safety workflows that Open Grind does not expose.

## Right Now and Interest

**Right Now** displays and filters the available feed by age, position, hosting,
and sort order. You can open a profile or start a conversation from a post.
Creating a Right Now post is not implemented.

**Interest** contains received Taps and Viewed Me. Account privacy settings can
hide your own views or the Viewed Me list.

## Inbox and conversations

The Inbox supports cached text search, unread state, pull-to-refresh, selecting
multiple conversations, and bulk deletion. Conversations update through the
real-time connection and support:

- text, replies, reactions, and message actions;
- photos and videos selected from device storage;
- albums, locations, and reusable saved phrases;
- received images, videos, audio, locations, Giphy media, albums, expiring
  media, and call-history messages; and
- shared-media and shared-album collections from conversation details.

Message reporting is not implemented. Failed sends remain visible so they can
be retried instead of disappearing silently.

### Capture and call availability

| Action                        | Android                     | iOS and iPadOS                                     | macOS, Windows, Linux                       |
| ----------------------------- | --------------------------- | -------------------------------------------------- | ------------------------------------------- |
| Pick existing media           | Android system picker       | Tauri/Apple file dialog                            | Desktop file dialog                         |
| Take a photo                  | Available                   | Implemented; device validation pending             | Not available                               |
| Record a short expiring video | Available, up to 15 seconds | Implemented; validation pending; up to 15 seconds  | Not available                               |
| Record a voice message        | Available                   | Implemented; validation pending                    | Record unavailable; received audio can play |
| Start or receive a video call | Available                   | Implemented; validation pending; requires Agora ID | Not available                               |

Android and iOS short videos can be sent view-once or with one replay. Availability of
received media still depends on the sender, expiry, server access, and whether a
local retained copy exists.

## Albums

Use **Settings → Manage albums** to create, rename, reorder, fill, and delete
albums. Albums can be shared from the conversation attachment drawer. Received
albums and shared media are available from conversation details.

Open Grind can keep encrypted local album and chat-media copies. If retention is
enabled, media may remain available on this device after the sender retracts a
message or revokes, removes, or expires album access. Review the storage options
before enabling retention on a shared device.

## Edit your profile

**Settings → Edit profile** covers profile photos, identity, stats, preferences,
health information, and social links. Server or account capabilities determine
which fields are returned and accepted.

## Power features

Open the command center with the keyboard shortcut shown in the app. It can
navigate quickly, change browsing location from a geohash, open a profile by ID,
and apply filters. **Developer Settings** exposes timeouts, cache sizes,
concurrency, media quality, retries, and diagnostics; keep the recommended
defaults unless troubleshooting a specific problem.
