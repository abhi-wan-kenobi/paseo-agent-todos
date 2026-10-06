# Agent Todos for Paseo

A todo list inside [Paseo](https://paseo.sh) that hands each task to a coding agent, in the project you choose, and marks it done when the agent delivers.

- **Launch an agent per todo.** Pick a launch preset (provider, model, permission mode) and a Paseo project; the agent starts in that project's workspace, so its branch and commits show up there.
- **Brief first, then go.** By default the agent reads what the task depends on, replies with its understanding and open questions, and waits for your context before changing anything.
- **Nested subtasks.** Add subtasks yourself, or let the agent add them as requirements change. A todo completes only when every subtask is done.
- **Automatic status.** The agent ends its delivery with `TODO-STATUS: DONE` or `TODO-STATUS: BLOCKED: <reason>`; the todo, its run history, and a status card in the agent timeline update on their own.
- **Resume anything.** Reopen a closed or archived agent's session from the todo.
- **Jira-aware.** Jira keys in a todo are detected; the agent is told to read the ticket before working.
- **Optional Google Tasks sync**, both directions.

## Install

Requires Paseo 0.10.2 or later with plugins enabled (**Settings → Plugins → Enable plugins**).

```bash
paseo plugin install npm:paseo-agent-todos
```

Or from GitHub:

```bash
paseo plugin install github:abhi-wan-kenobi/paseo-agent-todos
```

## Getting started

1. Open **Agent Todos** from the sidebar, then its settings (gear icon).
2. Add a **launch preset**: provider, model, default permission mode, and a default directory (absolute path) used when a todo has no project.
3. Optional: set the **Jira browse URL** (for example `https://your-company.atlassian.net/browse/`) so Jira keys become links.
4. Add a todo, choose its project, and press **Launch agent**.

### How the agent reports back

The launch prompt teaches the agent these lines; the plugin reads them when each turn ends:

| Line | Effect |
|---|---|
| `TODO-STATUS: DONE` | Marks the todo done, or "delivered, subtasks open" while subtasks remain |
| `TODO-STATUS: BLOCKED: <what it needs>` | Shows the reason on the todo |
| `TODO-SUBTASK: <title>` | Adds a subtask (a new subtask reopens a finished todo) |
| `TODO-SUBTASK-DONE: <title>` | Completes a subtask |

Prompt templates are editable in settings. `{{title}}`, `{{notes}}`, `{{jira}}`, `{{due}}` and `{{jiraReview}}` are filled in; the subtask list and protocol are always appended.

### Google Tasks sync

Sync reuses an OAuth authorized-user file that contains `refresh_token`, `client_id` and `client_secret` with the `https://www.googleapis.com/auth/tasks` scope. By default it looks for the single file under `~/.google_workspace_mcp/credentials/` (written by [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp)); you can point it at another file in settings, then pick a task list.

## Data

Todos are stored on the daemon host in `~/.paseo/plugin-data/paseo-agent-todos/todos.json` (or under `$PASEO_HOME`). Nothing leaves the machine except Google Tasks calls when sync is on.

## Limitations

- Status detection depends on the agent writing the marker lines; an agent that ignores them leaves the run at "Waiting for you".
- Permission mode is fixed when an agent starts (some providers cannot change it later).
- Google Tasks sync covers title, notes, due date and completion; subtasks stay local.
- Timeline status cards live in the daemon's memory and disappear after a daemon restart; todo state does not.

## License

MIT
