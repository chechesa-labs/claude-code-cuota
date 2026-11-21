# Changelog

## Unreleased

- Every folder at once, for a while: `/cuotaweek 90-temp *` (`/cuotasemanal 90-temporal *` in Spanish, `/cuota` for the 5-hour window) raises the default cap of every folder until the window resets, then it goes back by itself. Folders with their own cap keep it. `/cuotaweek default-temp *` sets it back sooner. Shared by every session.
- **Changed:** "every folder" and "above 80%" are now symbols, `*` and `>80`: `/cuota default *`, `/cuota default >80`. Words after the number are always folder names, so a project named `all` or `todas` is no longer mistaken for every folder. `default all`, `default todas`, `default over-80` and `default sobre-80` now look for a folder with that name and change nothing if there is none. `/cuota all` no longer lists the folders: use `/cuota list`.
- A one-line band above the message box, near the cap, at the cap or when a message was held: `🟡` or `🔴`, the usage and cap of each window (`5 h 3%/80% · wk 89%/85%`), and buttons. It takes the place of the status line while it shows.
- `+5%` raises this folder's cap on the window that brakes by 5 points.
- `↩ Message` puts the held message back in the box (at the end, if you already typed something). Pasted images and files cannot be put back: the band says how many there were so you can paste them again. The text is kept in memory for that session only, never written to disk or sent.
- `Hide` hides the band until the state changes or another message is held; the status line comes back meanwhile.

## 0.2.2 (2026-10-29)

- The wind-down notice no longer lives in the system prompt, where every change of its text rewrote the prompt cache of the whole conversation. It now travels as context Claude reads next to the next tool result (so it arrives in the middle of a task) or next to the user's message, once per change of state, and once more after a compaction.
- New text: it says it comes from the mod and not from the user, gives the window and the percentages, keeps Claude on what the user asked, and no longer asks Claude to announce it. Near the cap it asks Claude not to cut the work short or summarize answers, only to keep its progress ready to resume. At the cap, Claude pauses at a safe point, saves the progress and tells the user how to go on (raise the cap now, or resume after the reset); agents hand back their full progress. When the cap is raised, Claude is told the notice no longer applies.
- Fix: at the cap, the report a background agent handed back when it paused was held like a new message, so the main conversation never read it. Only what the user sends to start new work is held now; agents, tasks and other sessions always get through.
- The status line says "near the cap" ("cerca del límite" in Spanish) instead of "wind down", since Claude no longer winds down there.
- Changing a cap also shows a toast, because the answer of a command run in the middle of a turn only shows at the end.

## 0.2.1 (2026-10-25)

- Fix: a braked session stayed braked after the window reset, because the usage reading only refreshes after a response and the brake held every message. The reading now expires at its reset time and is shared with the latest one from any session.

## 0.2.0 (2026-10-25)

- Several folders at once: `/cuota 85 lora-baker nova`, `/cuota default over-80`, `/cuota default all`. Folders are named by their short name, shown by `/cuota list` (parent/name when two folders share a name); if a name is unknown or ambiguous, nothing changes.
- `-temp` (`-temporal` in Spanish), attached to the cap, as in `/cuota 100-temp`: the raised cap lasts until the window resets, then goes back to the previous value.

## 0.1.1 (2026-10-25)

- Changing a cap now confirms it in the first line and shows the short status, without repeating the help.
- `/quota` works as an alias of `/cuota`.

## 0.1.0 (2026-10-25)

First public release.

- Status line with the 5-hour and weekly usage, the folder's cap and what is left.
- Per-folder caps, default 80% on each window. A folder is the root of its git repository.
- `/cuota` for the 5-hour window and `/cuotasemanal` or `/cuotaweek` for the weekly one: show, raise to any number from 1 to 100, `default`, `list`, `help`.
- Wind-down 10 points before the cap: Claude is asked to finish its step, write down the state and start nothing new.
- Brake at the cap: new messages and new agents in that folder wait; the turn in progress and messages sent during it go through.
- Closing message to agents already running.
- Last reading shared across sessions until its window resets.
- Interface in Spanish or English, following Claude Code's `language` setting.
- Optional webhook with each reading, brake and change of cap.
