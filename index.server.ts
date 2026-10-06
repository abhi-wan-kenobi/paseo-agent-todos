import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  agentTodoRpc,
  createTodoRpc,
  deleteTodoRpc,
  googleListsRpc,
  launchTodoRpc,
  listTodosRpc,
  resumeAgentRpc,
  reviewAgentRpc,
  settingsDefinition,
  subtaskRpc,
  syncNowRpc,
  updateTodoRpc,
  type Settings,
} from "./shared/contracts";
import { AgentTracker, completeIfSubtasksDone, reopenForOpenSubtasks } from "./server/agents";
import { randomUUID } from "node:crypto";
import { GoogleTasksClient } from "./server/google";
import { newTodo, TodoStore } from "./server/store";
import { GoogleSyncer } from "./server/sync";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(settingsDefinition);
  const readSettings = async (): Promise<Settings | null> => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : null;
  };
  const requireSettings = async (): Promise<Settings> => {
    const values = await readSettings();
    if (!values) throw new Error("Agent Todos settings are invalid; fix them under Settings → Plugins.");
    return values;
  };

  const store = new TodoStore();
  const syncer = new GoogleSyncer(store, readSettings);
  const tracker = new AgentTracker(
    store,
    () => syncer.schedule(),
    async () => (await readSettings())?.google.enabled ?? false,
  );

  void readSettings().then((values) => syncer.configure(values));
  const stopSettings = settings.subscribe((state) => {
    if (state.status === "ready") syncer.configure(state.values);
  });

  server.handle(listTodosRpc, async () => ({ todos: await store.list(), sync: syncer.snapshot() }));

  server.handle(createTodoRpc, async (draft) => {
    const todo = await store.mutate((todos) => {
      const created = newTodo({ ...draft, jiraKey: draft.jiraKey?.toUpperCase() || null });
      todos.push(created);
      return structuredClone(created);
    });
    syncer.schedule();
    return todo;
  });

  server.handle(updateTodoRpc, async ({ id, ...patch }) => {
    const todo = await store.mutate((todos) => {
      const current = todos.find((candidate) => candidate.id === id);
      if (!current) throw new Error("Todo not found.");
      const now = new Date().toISOString();
      if (patch.title !== undefined) current.title = patch.title;
      if (patch.notes !== undefined) current.notes = patch.notes;
      if (patch.jiraKey !== undefined) current.jiraKey = patch.jiraKey?.toUpperCase() || null;
      if (patch.due !== undefined) current.due = patch.due;
      if (patch.cwd !== undefined) current.cwd = patch.cwd;
      if (patch.status !== undefined && patch.status !== current.status) {
        current.status = patch.status;
        current.completedAt = patch.status === "done" ? now : null;
      }
      current.updatedAt = now;
      return structuredClone(current);
    });
    syncer.schedule();
    return todo;
  });

  server.handle(subtaskRpc, async ({ todoId, action }) => {
    const { todo, statusChanged } = await store.mutate((todos) => {
      const current = todos.find((candidate) => candidate.id === todoId);
      if (!current) throw new Error("Todo not found.");
      const now = new Date().toISOString();
      const before = current.status;
      if (action.kind === "add") {
        current.subtasks.push({ id: randomUUID(), title: action.title, done: false, source: "user", createdAt: now, completedAt: null });
        reopenForOpenSubtasks(current);
      } else {
        const index = current.subtasks.findIndex((subtask) => subtask.id === action.subtaskId);
        if (index < 0) throw new Error("Subtask not found.");
        if (action.kind === "remove") current.subtasks.splice(index, 1);
        else {
          const subtask = current.subtasks[index];
          Object.assign(subtask, { done: !subtask.done, completedAt: subtask.done ? null : now });
          reopenForOpenSubtasks(current);
        }
        completeIfSubtasksDone(current, now);
      }
      current.updatedAt = now;
      return { todo: structuredClone(current), statusChanged: current.status !== before };
    });
    if (statusChanged) syncer.schedule();
    return todo;
  });

  server.handle(deleteTodoRpc, async ({ id }) => {
    const todo = (await store.list()).find((candidate) => candidate.id === id);
    if (!todo) return {};
    const values = await readSettings();
    if (todo.google && values?.google.enabled) {
      const google = await GoogleTasksClient.open(values.google.credentialsPath);
      await google.deleteTask(todo.google.taskListId, todo.google.taskId);
    }
    await store.mutate((todos) => {
      const index = todos.findIndex((candidate) => candidate.id === id);
      if (index >= 0) todos.splice(index, 1);
    });
    return {};
  });

  server.handle(launchTodoRpc, async (input, { paseo }) =>
    tracker.launch(paseo, await requireSettings(), input),
  );

  server.handle(resumeAgentRpc, ({ todoId, agentId, message }, { paseo }) => tracker.resume(paseo, todoId, agentId, message));

  server.handle(reviewAgentRpc, async ({ agentId, extraInstructions }, { paseo }) =>
    tracker.review(paseo, await requireSettings(), agentId, extraInstructions),
  );

  server.handle(agentTodoRpc, async ({ agentId }) => ({ todo: await tracker.todoForAgent(agentId) }));

  server.handle(syncNowRpc, async () => {
    const values = await requireSettings();
    if (!values.google.enabled) throw new Error("Google Tasks sync is off; turn it on in the plugin settings.");
    return syncer.syncNow();
  });

  server.handle(googleListsRpc, async ({ credentialsPath }) => {
    const google = await GoogleTasksClient.open(credentialsPath);
    return { account: google.account, lists: await google.listTaskLists() };
  });

  server.on("agent.turn_started", (event) => tracker.onTurnStarted(event.agent.id));
  server.on("agent.turn_ended", (event, { paseo }) => tracker.onTurnEnded(event, paseo));
  server.on("agent.archived", (event) => tracker.onArchived(event.agent.id));

  return () => {
    stopSettings();
    syncer.dispose();
  };
}
