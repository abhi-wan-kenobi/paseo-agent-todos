import { findJiraKey, type Settings, type SyncState, type Todo } from "../shared/contracts";
import { GoogleTasksClient, type GoogleTask, type GoogleTaskWrite } from "./google";
import { newTodo, type TodoStore } from "./store";

interface Push {
  todoId: string;
  taskId: string | null;
  write: GoogleTaskWrite;
  /** `updatedAt` of the todo when the write was planned. */
  plannedAt: string;
}

/** A todo has unsynced local edits when it changed after its last sync. */
function isDirty(todo: Todo): boolean {
  return todo.google === null ? todo.syncToGoogle : todo.updatedAt > todo.google.syncedAt;
}

export function toGoogleWrite(todo: Todo, jiraBrowseUrl: string): GoogleTaskWrite {
  let notes = todo.notes;
  if (todo.jiraKey && !notes.includes(todo.jiraKey)) {
    notes = `${notes}${notes ? "\n\n" : ""}Jira: ${jiraBrowseUrl}${todo.jiraKey}`.trimEnd();
  }
  return {
    title: todo.title,
    notes,
    due: todo.due ? `${todo.due}T00:00:00.000Z` : null,
    ...(todo.status === "done" ? { status: "completed" } : { status: "needsAction", completed: null }),
  };
}

function applyRemote(todo: Todo, task: GoogleTask, now: string): void {
  todo.title = task.title;
  todo.notes = task.notes ?? "";
  todo.due = task.due ? task.due.slice(0, 10) : null;
  todo.jiraKey ??= findJiraKey(`${todo.title}\n${todo.notes}`);
  if (task.status === "completed" && todo.status !== "done") {
    todo.status = "done";
    todo.completedAt = now;
  } else if (task.status === "needsAction" && todo.status === "done") {
    todo.status = "open";
    todo.completedAt = null;
  }
}

/**
 * Two-way sync with one Google Tasks list. Remote edits win over an unchanged local
 * todo; local edits win when both sides changed since the last sync. Network writes
 * run outside the store lock so lifecycle hooks never wait on Google.
 */
export async function syncWithGoogle(store: TodoStore, settings: Settings, signal?: AbortSignal): Promise<void> {
  const listId = settings.google.taskListId;
  if (!listId) throw new Error("Choose a Google Tasks list in the plugin settings.");
  const google = await GoogleTasksClient.open(settings.google.credentialsPath);
  const remote = new Map((await google.listTasks(listId, signal)).map((task) => [task.id, task]));

  const pushes = await store.mutate((todos) => {
    const now = new Date().toISOString();
    const linked = new Set<string>();
    const planned: Push[] = [];
    for (let index = todos.length - 1; index >= 0; index--) {
      const todo = todos[index];
      if (todo.google && todo.google.taskListId !== listId) continue;
      if (todo.google) {
        linked.add(todo.google.taskId);
        const task = remote.get(todo.google.taskId);
        if (!task || task.deleted) {
          // Deleted in Google: drop untouched todos, keep ones that carry agent history.
          if (todo.runs.length === 0) todos.splice(index, 1);
          else Object.assign(todo, { google: null, syncToGoogle: false, updatedAt: now });
          continue;
        }
        if (!isDirty(todo)) {
          if (task.updated !== todo.google.remoteUpdated) {
            applyRemote(todo, task, now);
            todo.updatedAt = now;
            todo.google = { ...todo.google, remoteUpdated: task.updated, syncedAt: now };
          }
          continue;
        }
      }
      if (isDirty(todo)) {
        planned.push({
          todoId: todo.id,
          taskId: todo.google?.taskId ?? null,
          write: toGoogleWrite(todo, settings.jiraBrowseUrl),
          plannedAt: todo.updatedAt,
        });
      }
    }
    for (const task of remote.values()) {
      if (linked.has(task.id) || task.deleted || task.status === "completed" || !task.title.trim()) continue;
      const todo = newTodo({ title: task.title, notes: task.notes ?? "", jiraKey: null, due: null, cwd: null }, now);
      applyRemote(todo, task, now);
      todo.google = { taskId: task.id, taskListId: listId, remoteUpdated: task.updated, syncedAt: now };
      todos.push(todo);
    }
    return planned;
  });

  const written: Array<{ push: Push; task: GoogleTask }> = [];
  const failures: string[] = [];
  for (const push of pushes) {
    try {
      const task = push.taskId
        ? await google.patchTask(listId, push.taskId, push.write, signal)
        : await google.insertTask(listId, push.write, signal);
      written.push({ push, task });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (written.length > 0) {
    await store.mutate((todos) => {
      for (const { push, task } of written) {
        const todo = todos.find((candidate) => candidate.id === push.todoId);
        if (!todo) continue;
        // syncedAt = plannedAt keeps the todo dirty if it was edited during the write.
        todo.google = { taskId: task.id, taskListId: listId, remoteUpdated: task.updated, syncedAt: push.plannedAt };
      }
    });
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

export class GoogleSyncer {
  private state: SyncState = { lastSyncAt: null, lastError: null, running: false };
  private debounce: NodeJS.Timeout | undefined;
  private interval: NodeJS.Timeout | undefined;
  private inFlight: Promise<SyncState> | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly store: TodoStore,
    private readonly readSettings: () => Promise<Settings | null>,
  ) {}

  snapshot(): SyncState {
    return { ...this.state };
  }

  /** Restarts the periodic timer from current settings. */
  configure(settings: Settings | null): void {
    clearInterval(this.interval);
    if (!settings?.google.enabled) return;
    this.interval = setInterval(() => void this.syncNow(), settings.google.intervalMinutes * 60_000);
    this.schedule(0);
  }

  /** Coalesces bursts of local edits into one sync. */
  schedule(delayMs = 2_000): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), delayMs);
  }

  syncNow(): Promise<SyncState> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  dispose(): void {
    clearTimeout(this.debounce);
    clearInterval(this.interval);
    this.abort.abort();
  }

  private async run(): Promise<SyncState> {
    const settings = await this.readSettings();
    if (!settings?.google.enabled) return this.snapshot();
    this.state = { ...this.state, running: true };
    try {
      await syncWithGoogle(this.store, settings, this.abort.signal);
      this.state = { lastSyncAt: new Date().toISOString(), lastError: null, running: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[agent-todos] Google sync failed:", message);
      this.state = { ...this.state, lastError: message, running: false };
    }
    return this.snapshot();
  }
}
