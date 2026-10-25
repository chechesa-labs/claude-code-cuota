# Cuota: usage budget per project for Claude Code

[Leer en español](README.es.md)

Your Claude plan has two usage windows, a 5-hour one and a weekly one, and they are shared by everything you do: client work, side projects, experiments. One busy afternoon on a hobby project can use up the whole week, and the work that matters stops.

Works in the **Claude Code extension for VS Code**.

**Cuota** puts a cap on each folder, the way a phone caps data per app. Every project gets a default cap (80% of each window). Ten points before the cap, Claude starts wrapping up. At the cap, that folder stops taking new messages, while whatever Claude is doing finishes without being cut off. One command raises the cap for the folders that need it.

![Cuota in action](docs/demo-en.gif)

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cuota --marketplace chechesa-labs/claude-code-cuota
```

Or from a shell:

```
claude plugin install cuota --marketplace chechesa-labs/claude-code-cuota
```

Answer `y` to add the marketplace, then choose the scope (user scope applies it to every project). New sessions load it from then on.

Requirements: a recent Claude Code with mod (plugin hooks module) support, tested on 2.1.310, and a Claude Pro or Max subscription. With an API key there are no 5-hour or weekly windows to read, so Cuota has nothing to cap.

## Compatibility

| Where | Status |
| --- | --- |
| Claude Code extension for VS Code | Tested in daily use (2.1.310): status line, commands, wind-down and brake |
| Claude Code in the terminal | Runs on the same mod system; not yet tested by us in a live session |

The VS Code extension uses the same Claude Code settings as the terminal, so installing once makes Cuota load in both. In VS Code the status line shows above the message box, prefixed with `cuota plugin`.

## What you see

A status line under the prompt, starting with the figures:

```
5 h 46% · week 33% · cap 80% · 34% left
wind down · 5 h 72% · week 34% · cap 80% · 8% left
braked · 5 h 80% · week 34% · cap 80% · /cuota 90 to go on
```

## Commands

`/cuota` is for the 5-hour window and `/cuotaweek` for the weekly one. With Claude Code set to Spanish, the weekly command is `/cuotasemanal`.

| Command | What it does |
| --- | --- |
| `/cuota` | Shows this folder's caps, usage and reset times |
| `/cuota 90` | Raises this folder's 5-hour cap to 90% (any number from 1 to 100) |
| `/cuotaweek 95` | Same for the weekly cap |
| `/cuota 100` | Removes this folder's 5-hour cap (also `/cuota free`) |
| `/cuota default` | Back to the default 5-hour cap |
| `/cuotaweek default` | Back to the default weekly cap |
| `/cuota list` | Every folder with its own caps |
| `/cuota help` | All options |

Commands are answered by the plugin itself: they never reach the model, use no tokens, and always work, even when the folder is braked.

## How it decides

- **A folder** is the root of the git repository you are in; outside git, the working directory.
- **Wind down:** within 10 points of a cap, Cuota adds a short instruction for Claude: finish the current step, write down the state, start nothing new, and do not launch new agents. Claude still answers you as usual.
- **Brake:** at the cap, new messages in that folder are held with a note on how to raise the cap, and new agents are not started. The turn in progress is never cut off. Messages you send while Claude is working still get through, so you can give wrap-up instructions.
- **Running agents** get a message asking them to finish their step and hand back what they have.
- **Readings are shared** across sessions: a new session starts from the last reading any session saw, until that window resets.

## Settings

Set them when installing, or later in `/config`:

| Setting | Default | Meaning |
| --- | --- | --- |
| Default cap, 5-hour window | 80 | Percent of the 5-hour window where folders without their own cap stop |
| Default cap, weekly window | 80 | Same for the weekly window |
| The 5-hour window brakes | on | Off: the 5-hour window only warns |
| Wind-down margin | 10 | Points before the cap where the wind-down starts |
| Language | auto | `auto` follows Claude Code's `language` setting (Spanish or English); `es` or `en` pin it |
| Webhook | empty | Optional URL that receives a JSON `POST` on each reading, each brake and each change of cap |

## Privacy

Cuota makes no model calls and sends nothing anywhere, except to the webhook if you set one. It reads the usage percentages Claude Code already reports, Claude Code's `language` setting, and whether the folders above your working directory contain `.git`. Caps and the last reading are kept in the plugin's own store on your machine. If you use the webhook, point it at an `https` address you control: the payload includes folder paths.

## Known limits

- Whether the closing message reaches an agent that is already running, and whether the wind-down instruction reaches agents as well as the main conversation, has not been verified in a live session yet.
- Where an organization manages Claude Code through managed settings, the wind-down instruction only runs if the organization lists the plugin there; the status line, the commands and the brake work either way.
- Caps work on the percentages Anthropic reports for your plan. The 100% limit itself is Anthropic's and applies to your whole account.

## Maintenance

Maintained by Chechesa Labs. We use it daily in our own work and in our clients' work. Issues are handled as time allows; installation, configuration and priority support are part of our services.

## License

[MIT](LICENSE)

Cuota is an independent project by Chechesa Labs. It is not affiliated with, endorsed by or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic.
