# Chip Study rooms: design and contract

Studying together, live. A room opens on one of the host's assignments or topics. Everyone in it shares that workspace: its documents, notes and tasks, edited live with everyone's cursor shown, plus one Chip, audio, video, screen sharing and chat. Nothing is recorded.

Product rules (decided by the founder, 2026-11-07):
- **Personal rooms.** Anyone with the link joins, or the host lets each person in. Adults only.
  - Free hosts: up to 4 people for 60 minutes.
  - Pro hosts: up to 10, with no time limit.
- **Class rooms.** A teacher or admin of an institution opens one for the classes or students they invite.
  - Up to 50 people, with no time limit.
  - The institution's admins, and teachers of an invited class, join as co-hosts.
- **Editing.** The host and co-hosts can always edit.
  - Personal rooms default to "everyone can edit".
  - Class rooms default to "chosen people".
  - The host chooses, per person.
- **Chip in a room.** Everyone sees one shared Chip conversation.
  - Each question counts against the asker's own allowance.
  - It is logged on the host's assignment with the asker's name, so for a school assignment the teacher sees who used Chip.
  - The class's course-tutor rules apply.
- **Video.** Cloudflare Realtime SFU (raw, not RealtimeKit), plus Cloudflare TURN.
  - Video tiles are small and sent with simulcast, so most people receive the low layer.
  - The full layer goes only to whoever is on the stage, such as a screen share or a pinned speaker.

## Parts

| Part | Where | What it does |
|---|---|---|
| Room rules | `utopia` repo, `supabase/migrations/20261107230000_study_rooms.sql` | Who may open, join, edit or run a room. RPCs are listed below. |
| Room service function | `utopia` repo, `supabase/functions/study-rooms` | The room server's door into the database: `save`, `close`, `roster`. Authorised by a shared secret header, never by a user. |
| Room server | this repo, `worker/` | A Cloudflare Worker (routes `/api/rooms/*`, everything else served from `dist`) plus one Durable Object (`StudyRoom`) per room. |
| Room screens | this repo, `src/rooms/` | Lobby, room, controls, people, chat, Chip, and the shared editors. |

## Database RPCs (Supabase, signed in as the person)

- `study_room_open(p_assignment, p_institution?)` returns the room as `study_room_get` gives it. With `p_institution` it is a class room. It answers the room already open on that assignment, if there is one.
- `study_room_get(p_room)`, for hosts and co-hosts, returns:
  - `id, assignment_id, title, token, institution_id, edit_mode, admission, max_people, ends_at, live`
  - `members[{user_id, name, role, state, can_edit, joined_at}]`
  - `invited_classes[{id, name}]`, `invited_people[{user_id, name}]`
- `study_room_invite(p_room, p_classes uuid[], p_people uuid[])` and `study_room_uninvite(p_room, p_class?, p_person?)`: class rooms only.
- `study_room_peek(p_token)` returns `{found, title, host, institution, class_room, admission, ends_at, state, can_join, reason}`. `reason` is one of `ended | removed | not_invited | age_unknown | adults_only`.
- `study_room_join(p_token)` returns `{room_id, role, state ('in'|'waiting'), can_edit}`. It raises the same reasons as peek.
- `study_room_access(p_room)` returns `{room_id, user_id, name, role, state, can_edit, live, max_people, ends_at, assignment_id, host_id, title, class_room, edit_mode}`. The room server calls it with the person's own token.
- `study_room_workspace(p_room)` returns `{assignment{...}, documents[{id, kind, title, content, version, sort}], sources[...], notes[{id, body, pinned}], tasks[{id, title, due_on, done}]}`. Only for members whose state is `in`, while the room is live.
- `study_room_settings(p_room, p_edit_mode?, p_admission?)` and `study_room_member_set(p_room, p_user, p_state ('in'|'removed')?, p_can_edit?)`.
- `study_room_new_link(p_room)`, `study_room_end(p_room)`, `study_rooms_mine()`.
- Names come from the display name or username. They never come from an email.
- `study_room_log_use(p_room, p_action ('inserted'|'replaced'|'added_tasks'|'added_sources'), p_message?, p_words?, p_excerpt?)`: an editor recording that they put Chip's words into the shared work. `p_message` is a Chip message from the room's conversation.
- `study_room_tutor(p_room)`: the class's course-tutor rules for the room's assignment (or null). The Chip function applies them itself; screens may show "Chip follows <class>'s guidance".
- The room's Chip conversation is `study_rooms.chip_thread`, kept on the host's assignment as "Study room: <title>".

After any change to settings or members, the host's screen sends `{t: "perm"}` on the room socket so the server re-reads the roster.

## Room server API (`/api/rooms/:roomId/...`)

Every HTTP call carries `Authorization: Bearer <Supabase access token>`. The Worker checks it by calling `study_room_access` with that token, and refuses unless `state = 'in'` and `live`. Room IDs are UUIDs. SFU session IDs and track names are locators, never credentials. The server checks that every session belongs to the caller, and that every requested publication is in this room.

| Route | Body | Answer |
|---|---|---|
| `POST /ticket` | none | `{ticket}`: single use, 60 s. Refused with 409 `room_full` when `max_people` distinct people are connected and the caller isn't one of them. |
| `GET /ws?ticket=` | WebSocket upgrade | the room socket (below) |
| `GET /turn` | none | `{iceServers}`: Cloudflare TURN credentials, TTL 24 h (`ROOM.turnTtlSeconds`), with port 53 URLs removed |
| `POST /rtc/session` | `{purpose: "publish" \| "receive"}` | `{sessionId}` |
| `POST /rtc/publish` | `{sessionId, offer, tracks: [{mid, trackName, kind: "audio" \| "video" \| "screen" \| "screen-audio", rids?: ("f" \| "h" \| "q")[]}]}` | `{answer, tracks}`. Successful tracks become publications in the room's discovery state and are announced on the socket. |
| `POST /rtc/receive` | `{sessionId, tracks: [{publisherSessionId, trackName, rid?}]}` | `{offer?, requiresImmediateRenegotiation, tracks}` |
| `POST /rtc/renegotiate` | `{sessionId, answer}` | `{}` |
| `POST /rtc/layer` | `{sessionId, tracks: [{mid, rid}]}` | `{tracks}`: changes a received simulcast layer |
| `POST /rtc/close` | `{sessionId, offer, tracks: [{mid}]}` | `{answer, tracks}`. Closing a publication removes it from discovery. |

Track names are `<userId>:<kind>`. Video publishes three simulcast layers, `f`, `h` and `q` (full, half and quarter size). Tiles receive `q` (or `h` on large screens), and the stage receives `f`, falling back alphabetically.

Details the server enforces (types for all of this are in `shared/rooms.ts`):
- **Tickets** are opaque. The Worker signs them with `ROOM_SERVER_SECRET`, so a made-up ticket never reaches a room. The room lets each one be used once. Capacity is checked again when the socket opens, so two people racing for the last place can't both get in.
- **Sessions.** `publish` sessions take `/rtc/publish`; `receive` sessions take `/rtc/receive` and `/rtc/layer`. Someone else's session, and a session the room has never seen, both get 403 `not_your_session`. Media is for people in the room: `/rtc/session`, `/rtc/publish` and `/rtc/receive` need the caller's room socket to be open (409 `not_connected` otherwise). Renegotiating, layers and closing still work while a socket reconnects.
- **Publishing.** A track named anything but `<your userId>:<kind>` gets 403 `not_your_track`. Only `video` and `screen` may have `rids`. At most 4 tracks per call. One publication of each kind per person: publishing a new camera (after a reconnect, say) withdraws the old one.
- **Receiving.** If any requested publication isn't in the room's discovery state now, the whole call is refused with 404 `unknown_publication` and the SFU isn't asked; re-read `pubs` and try again. A layered publication asked for without a `rid` gets `q`. At most 64 tracks per call.
- **Results.** Each entry in `tracks` has `errorCode` (and `errorDescription`) when that track failed; the others worked. The SFU wants each session's changes one at a time: finish each call (and its renegotiation) before the next on the same session. The server also queues calls per session.
- **Errors** are `{error, detail?, state?, code?}` with the HTTP status: 400 `bad_request`, 401 `unauthorized`, 403 `not_in_room` (with `state: "waiting"` or `"removed"` when that's why), 403 `not_your_session` / `not_your_track`, 404 `not_found` (also a room id that isn't a UUID), 404 `unknown_publication` / `unknown_track`, 405 `method_not_allowed`, 409 `room_full`, 409 `not_connected`, 409 `sfu_rejected` (with the SFU's `code`), 410 `ended`, 413 `too_big` (bodies over 256 KB), 429 `rate_limited`, 500 `internal`, 502 `sfu_error` / `upstream`, 503 `not_configured` (the Worker's settings aren't filled in yet).
- **Rate limits** (per person): 20 tickets and 12 SFU sessions a minute.

## Room socket

Binary frames carry Yjs over y-protocols:
- The first varUint is `0` for sync or `1` for awareness.
- Sync messages follow y-protocols/sync (step 1, step 2, update).
- **The server drops sync step 2 and update messages from anyone who can't edit**, and tells them once with `{t: "readonly"}`. Step 1 (asking for the state) is allowed for everyone.
- Awareness is relayed for everyone. It carries cursors and selections, and the client sets `{user: {id, name, color}}`. Screens show names from the server's roster, never from awareness.

How a screen syncs:
- On open, send sync step 1. The server answers with step 2 (the whole room). Then send each local change as an update.
- The server sends its own step 1 to editors only, so an editor's copy can fill in anything the room missed (after the room restarted, say). Answer it with step 2.
- A viewer's step 2 that adds nothing is ignored quietly. `{t: "readonly"}` means a change was really dropped: make the editors read-only, and start a fresh `Y.Doc` before editing again, because the dropped change is still in the local copy and later changes would build on it. Do the same after `{t: "you", canEdit: false}`.
- Awareness: the server sets `user.id` and `user.name` to the verified person before passing a state on, so `user.id` can be trusted to find the person in `people`. Each socket may speak for at most 4 Yjs client ids, only ones it used first. States over 16 KB are dropped.
- Frames over 16 MiB (binary) or 256 KB (text) are refused, and the socket is closed. The first filling (seeding) is one frame, so it must fit.
- A room that is already filled never takes a second filling: an update that sets `room.seeded` again is dropped whole and answered with `{t: "error", code: "already_seeded"}`. Start a fresh `Y.Doc` then, since the local copy holds a filling the room doesn't. (This is how two people asked to seed, one after the other, can never both land and double the host's work.)
- Per socket, at most 6 sync step 1s in 10 seconds (each makes the server send the whole document) and 60 awareness frames in 5 seconds (extra ones are dropped).

Text frames carry JSON. Times (`at`, `endsAt`) are epoch milliseconds.

**Server to client:**
- `{t: "hello", you: {userId, name, role, canEdit}, people: [...], publications: [...], chat: [...], chip: [...], hands: [userId...], endsAt, editMode, seeded}`
- `{t: "people", people: [{userId, name, role, canEdit, hand, connected}]}`
- `{t: "you", canEdit, role}`: after a permission change
- `{t: "pubs", publications: [{userId, sessionId, trackName, kind, rids}]}`
- `{t: "chat", id, from: {userId, name}, text, at}`
- `{t: "hand", userId, up}`
- `{t: "chip", id, from: {userId, name}, question, answer, done, stopped?, at}`: one entry of the Chip conversation, whole, each time it changes. Replace by `id`. `stopped` means the asker left before Chip finished.
- `{t: "mute-request", by}`: `by` is the host's or co-host's `userId`
- `{t: "readonly"}`
- `{t: "seed"}`: you are the one who fills the empty room (see Seeding)
- `{t: "ending", at}` five minutes before a free room's end (also on joining inside those five minutes)
- `{t: "ended", why: "host" | "time" | "removed"}`, then the socket closes
- `{t: "error", code}`, with `code` one of `bad_message`, `bad_frame`, `too_long`, `rate_limited`, `not_allowed`, `not_yours`, `not_seeded`, `already_seeded` (see How a screen syncs), `still_live` (`end` before `study_room_end`), `perm_failed` (the roster couldn't be read; send `perm` again), and, just before the socket closes, `bad_ticket`, `room_full`, `removed` or `ended`

Close codes: 4001 bad or used ticket (get a new one), 4003 removed, 4009 room full, 4010 ended, 4400 not the room protocol, 1009 frame too big.

**Client to server:**
- `{t: "chat", text}`: at most 2,000 characters (after trimming); 10 per 10 seconds
- `{t: "hand", up}`
- `{t: "perm"}`: hosts and co-hosts
- `{t: "mute-all"}`: hosts and co-hosts
- `{t: "end"}`: hosts and co-hosts, after `study_room_end`. The server reads the roster again and ends the room once the database says it has ended; before that it answers `{t: "error", code: "still_live"}`.
- `{t: "seeded"}`
- `{t: "chip-ask", id, text}`, `{t: "chip-chunk", id, text}` and `{t: "chip-done", id, text}`, from the asker only
- `"ping"`, answered with `"pong"` by the auto-response

## The shared document (Yjs layout)

| Yjs type | Name | Holds |
|---|---|---|
| `Y.Map` | `room` | `seeded: true` once filled |
| `Y.Map` | `documents` | id → `Y.Map{kind: "doc" \| "code" \| "sheet", title, sort, lang?, stdin?, header?}` |
| `Y.XmlFragment` | `doc/<id>` | a TipTap document (`@tiptap/extension-collaboration` with `fragment`) |
| `Y.Text` | `code/<id>` | a code document's text (y-codemirror.next) |
| `Y.Array<Y.Array<string>>` | `sheet/<id>` | a sheet's rows of cells |
| `Y.Array<Y.Map>` | `notes` | `{id, body, pinned}`, `body` a `Y.Text` (a plain string is read too) |
| `Y.Array<Y.Map>` | `tasks` | `{id, title, due_on, done}`, `title` a `Y.Text` (a plain string is read too) |

**Seeding.** The first editor to connect to an empty room gets `{t: "seed"}`. They load `study_room_workspace`, fill every type above in one Yjs transaction (setting `room.seeded = true` in the same transaction), then send `{t: "seeded"}`. Only one person is asked at a time. If they disconnect before seeding, the next editor is asked. So is the next editor if the one asked hasn't seeded within 60 seconds, so the seeder must check `room.seeded` just before filling (someone asked earlier may have finished meanwhile). The room counts as seeded when the document says so; `{t: "seeded"}` only confirms it (answered with `{t: "error", code: "not_seeded"}` if the document doesn't).

**Saving.**
- The server saves only after `room.seeded` is true. That way an empty room can never wipe the host's notes or tasks.
- It saves about every 20 seconds while there are changes, when the last person leaves, and when the room ends.
- It turns the Yjs state into the editors' own formats:
  - documents: ProseMirror JSON from the XmlFragment, plus plain text and a word count;
  - code: `{lang, code, stdin?}`;
  - sheets: `{rows, header}`, with CSV as the text.
- It then calls `study-rooms` with `action: "save"`. That writes them to the host's assignment through `study_room_save`.
- Rows created in the room keep their client-made UUIDs. Rows without a UUID `id` (and documents of another kind) can't be saved, so they're left out.
- It sends only what changed. What the room was seeded with counts as saved, so a document nobody touched is never rewritten (and its `version` isn't bumped). Notes and tasks are sent only when they changed, because sending them replaces the assignment's. Documents go in batches of at most 500 rows and about 4 MB. A list of more than 500 notes or tasks is held back, never cut short.
- A failed save is tried again, further apart each time (from 20 seconds up to 10 minutes). A room that has ended keeps its storage until its last save has gone through.
- While anyone is connected, the server sends an empty save (no rows) every hour. That only bumps `last_active_at`, so the database's 6-hour rule never ends a room people are in.

## Chip in a room

The asker's own screen calls the `chip-study` function with `action: "chat"` as usual, adding `room: <roomId>`. It drops `assignment` and `thread`, which come from the room.

The function then:
- checks `study_room_access` with the asker's token (in the room, room live);
- reads the host's assignment as the room's context;
- applies the class's course-tutor rules;
- charges the asker's allowance;
- logs `study_ai_log` on the host's assignment with the asker's `user_id` and `room_id`.

While it streams, the asker's screen relays the conversation on the room socket:
1. `chip-ask` (id, question);
2. `chip-chunk` (the growing answer, at most 4 per second);
3. `chip-done` (the final text).

The server keeps the room's Chip conversation, the last 50 messages, and shows it to everyone. Only editors can insert Chip's text into a document.

Server-side, for the relay:
- `id` is made by the asker's screen: 1 to 64 of `A-Z a-z 0-9 _ -`, new for each question.
- `chip-chunk` and `chip-done` carry the whole answer so far, not a piece. A chunk less than 250 ms after the last one is dropped (the next carries it).
- Only the asker (the same person, from any of their tabs) may send them. Anyone else gets `not_yours`.
- Limits: questions up to 4,000 characters, answers up to 40,000, 6 questions a minute per person.
- If the asker leaves before `chip-done`, the entry is finished with what it has and `stopped: true`.

## Lifetimes and limits

- **Free rooms** end at `ends_at`: the server warns five minutes before, then saves, closes the room, and tells everyone.
- **When everyone has left for 30 minutes**, the server saves and closes the room. So does a room nobody connects to within 30 minutes of a ticket. The database also treats a room unused for 6 hours as ended (see the hourly keep-alive under Saving).
- **Taking someone out.** After `perm`, anyone the roster marks `removed` gets `{t: "ended", why: "removed"}` and is disconnected. Their publications are dropped. Every track of theirs, sent or received, is force-closed at the SFU, and their unused tickets stop working.
- **Disconnects.** A person's publications are dropped 30 seconds after their last socket closes, unless they come back. Then every track of theirs (sent and received) is force-closed at the SFU and their sessions are forgotten, so a screen whose socket was away that long makes new sessions, publishes again and subscribes again. Their hand goes down when their last socket closes.
- **Capacity.** At most `max_people` distinct people connected at once.
- **Ending.** When a room ends (host, time, or empty), the server saves, closes the room through `study-rooms`, force-closes every track at the SFU, and then clears the room's storage. A save or close that fails is retried for several hours, and nothing is cleared until it has gone through.

## Secrets and settings (Worker)

| Name | Kind | What |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | var (public) | for `study_room_access` with the user's token |
| `ROOM_SERVICE_URL` | var | `.../functions/v1/study-rooms` |
| `ROOM_SERVER_SECRET` | secret | the shared secret for `study-rooms` (also set in Supabase; at least 32 characters). It also signs room tickets. |
| `REALTIME_APP_ID` | var | the Cloudflare Realtime SFU app |
| `REALTIME_APP_SECRET` | secret | the SFU app secret |
| `TURN_KEY_ID` | var | the Cloudflare TURN key |
| `TURN_KEY_API_TOKEN` | secret | the TURN key's API token |
| `REALTIME_API_BASE`, `TURN_API_BASE` | var, optional | for tests (point them at a local mock) |

The founder creates the SFU app and the TURN key in the Cloudflare dashboard, and sets the secrets himself with `wrangler secret put`. They must never be pasted into chat.

The vars in `wrangler.jsonc` start as `REPLACE_…` placeholders. Until `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `ROOM_SERVER_SECRET` are set, every `/api/rooms` call answers 503 `not_configured`. Until the Realtime and TURN values are set, `/rtc/*` and `/turn` do the same. The app itself is unaffected.

## For the room screens

- Import the message and request types, limits and Yjs names from `shared/rooms.ts`. Don't restate them.
- `public/_headers` sends `Permissions-Policy: camera=(), microphone=()`, which blocks the camera and microphone on every page. The room screens must change it to allow them for the site itself, for example `camera=(self), microphone=(self), display-capture=(self)`.
- Open the socket with a fresh ticket each time, including on reconnect. Send `"ping"` about every 20 seconds to keep proxies from closing an idle socket. It is answered without waking the room.
- TURN credentials last 24 hours (`ROOM.turnTtlSeconds`), so a call's relay doesn't lose its credentials mid-call (new ones only reach new ICE candidates). The screens still fetch `/turn` again halfway through and give the new servers to `pc.setConfiguration()`.
- Open the room socket before any media: making sessions, publishing and receiving need it. Use separate `publish` and `receive` sessions (one PeerConnection each). When a connection fails, or the socket was gone for more than 30 seconds, make new sessions, publish again and subscribe again.
- A publication is announced as soon as the SFU accepts it, which can be a moment before the publisher's connection carries media. A receive whose track comes back with an `errorCode` can be tried again shortly.
- Subscribe to new entries in `pubs`, and stop showing ones that leave it. Ask for `q` on tiles, `h` on large tiles, and `f` on the stage, with `/rtc/layer` when that changes.
- Local integration test of the server: `npm run test:rooms` (`wrangler dev` with mock upstreams; about two minutes). It also opens two browsers on the e2e build served by `wrangler dev` and checks that an edit in one reaches the other through the real room server, and that the room saves it.

### How the screens use it (src/rooms/)

These follow from the contract above; none of them changes its shape.

- **Mute and camera off are publications.** Muting withdraws your `audio` publication (`/rtc/close`) and unmuting publishes it again; turning the camera off withdraws `video` and stops the camera (its light goes off). So "muted" and "camera off" on everyone's tiles are simply "no `audio`/`video` publication in `pubs`". The microphone track stays open while muted, so unmuting is quick.
- **A viewer never sends sync updates or step 2.** A screen that can't edit keeps any change it makes (there shouldn't be one; the editors are read-only) to itself and marks its copy spoiled. It starts a fresh `Y.Doc` on `{t: "readonly"}`, on `already_seeded`, on losing edit rights, and on gaining edit rights with a spoiled copy. After three fresh documents on one socket it reconnects, so it stays within the server's four awareness ids per socket.
- **Shared editors add nothing by themselves.** In a room, TipTap runs without its own undo history (the collaboration binding keeps it) and without the trailing-paragraph extension, which would otherwise add one paragraph per person at the same moment. Only an editor's screen updates citation labels.
- **Sheets repair concurrent edits.** Two people changing the same cell at once would each insert a value and push the row's later cells a column right. Cells inserted at the same place at the same time share Yjs's left neighbour (`origin`), which never happens otherwise, so every editor's screen keeps the first and deletes the rest (deleting twice is harmless), and fills out short rows. See `src/rooms/ysheet.ts`.
- **Notes and task titles merge.** A note's `body` and a task's `title` are `Y.Text`, changed by the edit someone made (from the text they saw to their new text), so two people changing one note both keep their words; words someone else changed meanwhile are never deleted. The server already reads a `Y.Text` there as its text.
- **Edit rights are checked when writing.** A viewer let in to edit can edit sheets, code settings, notes and tasks at once, without the editors being made again.
- **New rows keep client-made UUIDs**, as the server expects: new notes, tasks and documents get `crypto.randomUUID()`. Rooms can add and rename documents, but not delete them, because a save never deletes a document.
- **Names.** Cursor labels and tiles use the roster (`hello`/`people`), looked up by the awareness `user.id` the server verified; a screen's own `user.name` and `user.color` in awareness are ignored. Colours come from the user ID.
- **Chip's message id.** `study_room_log_use`'s `p_message` must be the database id of Chip's message, which only the asker's screen knows (the function's `done` event). Other editors log with `p_message: null`.
- **Chunks** go at least 260 ms apart (a little over the server's 250 ms), and the latest text is always sent when the gap is over.
- **Video layers.** Every tile, the stage and anything else on screen showing a publication says which layer it wants; the best wanted is asked for (`f` beats `h` beats `q`), and a video no tile shows is let go after three seconds off screen (closed at the SFU, received again when it's back). What's wanted is kept by track name, so someone who publishes again (a new session, the same name) comes back on the same layer, or still paused.
- **Closing tracks** follows Cloudflare: keep the mid, `transceiver.stop()`, then offer. A received track that has ended, or whose transceiver is stopped, never counts as arrived. Receive results are matched by track name and publisher session.
- **Media starts again** (new sessions, publish, subscribe) after a connection fails, after a socket gap over 30 seconds, on a 403 `not_your_session`, when `hello` lists none of this screen's publications on its current publish session while it has some published (a gap measured wrong after a sleep), and when a publish, receive, layer or close call fails on the way (5xx, offline, or no answer in 20 seconds). Restarts for errors are at least 5 seconds apart. If starting fails (409 `not_connected`, say), it's tried again after 2, 5, 10, 20 and then every 30 seconds, and at once when the socket opens.
- **Sound.** Joining is the tap that unlocks audio (the shared AudioContext is woken then). If the browser still refuses to play the room's sound, the room shows "Tap to hear the room".
- **The lobby's connection check** times a small request to the site (the room server is the same Worker) and, unless `VITE_ROOMS_STUN` is empty, looks for a STUN answer from `stun:stun.cloudflare.com:3478`. TURN credentials need someone who's in the room, so they're checked only on entering.
- **Waiting room.** A screen whose join answers `waiting` calls `study_room_join` again every four seconds (it answers the same membership) until it's `in`. Hosts and co-hosts read `study_room_get` every six seconds while in the room, to see who's waiting.
