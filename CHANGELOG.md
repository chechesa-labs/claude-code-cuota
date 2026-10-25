# Changelog

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
