import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import {
  AGENT_LABEL,
  STATUS_MARKER,
  SUBTASK_DONE_MARKER,
  SUBTASK_MARKER,
  TIMELINE_KIND,
  type Run,
  type Settings,
  type TimelineRow,
  type Todo,
} from "../shared/contracts";
import type { TodoStore } from "./store";

const MARKER = new RegExp(`^[\\s*_\`>]*${STATUS_MARKER}:\\s*(DONE|BLOCKED)\\b[*_\`]*[\\s:—-]*(.*)$`, "gim");
const SUBTASK_LINE = new RegExp(`^[\\s*_\`>-]*(${SUBTASK_DONE_MARKER}|${SUBTASK_MARKER}):[*_\`]*\\s*(.+?)[\\s*_\`]*$`, "gim");

function subtaskBlock(todo: Todo): string {
  const protocol = `Record new required work on its own line as ${SUBTASK_MARKER}: <short title>, and mark finished work as ${SUBTASK_DONE_MARKER}: <exact title>. The todo is complete only when every subtask is done, so report ${STATUS_MARKER}: DONE only after all of them are.`;
  if (todo.subtasks.length === 0) {
    return `Subtasks: none yet. If the work splits into distinct pieces or new requirements come up, track them as subtasks. ${protocol}`;
  }
  const lines = todo.subtasks.map((subtask) => `- [${subtask.done ? "x" : " "}] ${subtask.title}`).join("\n");
  return `Subtasks:\n${lines}\n\n${protocol}`;
}

export function renderPrompt(template: string, todo: Todo, settings: Settings, extraInstructions: string): string {
  const jira = todo.jiraKey;
  const values: Record<string, string> = {
    title: todo.title,
    notes: todo.notes.trim() ? `Notes:\n${todo.notes.trim()}` : "",
    jira: jira
      ? `Jira: ${jira}${settings.jiraBrowseUrl ? ` (${settings.jiraBrowseUrl}${jira})` : ""}. Read the ticket, its comments, and linked issues with your Jira tools before you start the work.`
      : "",
    due: todo.due ? `Due: ${todo.due}` : "",
    jiraReview: jira ? ` and Jira ticket ${jira}` : "",
  };
  let prompt = template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match);
  // Appended in code, not the template, so saved custom templates still teach the subtask protocol.
  prompt += `\n\n${subtaskBlock(todo)}`;
  if (extraInstructions.trim()) prompt += `\n\nAdditional instructions:\n${extraInstructions.trim()}`;
  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

/** Assistant text since the latest user message, i.e. what the turn just produced. */
function latestAssistantText(timeline: readonly AgentTimelineItem[]): string {
  let text = "";
  for (const item of timeline) {
    if (item.type === "user_message") text = "";
    else if (item.type === "assistant_message") text += item.text;
  }
  return text;
}

export function parseStatusMarker(text: string): { status: "done" | "blocked"; note: string | null } | null {
  let last: RegExpExecArray | null = null;
  for (const match of text.matchAll(MARKER)) last = match;
  if (!last) return null;
  const note = last[2].replace(/[*_`]+$/, "").trim();
  return { status: last[1].toUpperCase() === "DONE" ? "done" : "blocked", note: note || null };
}

export function parseSubtaskMarkers(text: string): { title: string; done: boolean }[] {
  return [...text.matchAll(SUBTASK_LINE)]
    .map((match) => ({ title: match[2].trim(), done: match[1].toUpperCase() === SUBTASK_DONE_MARKER }))
    .filter((marker) => marker.title.length > 0);
}

/** Applies agent subtask markers; returns a description of each change. */
export function applySubtaskMarkers(todo: Todo, markers: { title: string; done: boolean }[], now: string): string[] {
  const changes: string[] = [];
  for (const marker of markers) {
    const key = marker.title.toLowerCase();
    const existing = todo.subtasks.find((subtask) => subtask.title.toLowerCase() === key);
    if (!existing) {
      todo.subtasks.push({
        id: randomUUID(),
        title: marker.title,
        done: marker.done,
        source: "agent",
        createdAt: now,
        completedAt: marker.done ? now : null,
      });
      changes.push(marker.done ? `Added and completed: ${marker.title}` : `Added: ${marker.title}`);
    } else if (marker.done && !existing.done) {
      Object.assign(existing, { done: true, completedAt: now });
      changes.push(`Completed: ${existing.title}`);
    }
  }
  return changes;
}

export function openSubtasks(todo: Todo): string[] {
  return todo.subtasks.filter((subtask) => !subtask.done).map((subtask) => subtask.title);
}

/** New open scope reopens a finished todo: done never coexists with open subtasks. */
export function reopenForOpenSubtasks(todo: Todo): void {
  if (todo.status === "done" && openSubtasks(todo).length > 0) {
    Object.assign(todo, { status: "in_progress", completedAt: null });
  }
}

/**
 * Completes the todo once an agent has reported DONE (run `partial`) and the last subtask closes.
 * Returns true when the todo became done.
 */
export function completeIfSubtasksDone(todo: Todo, now: string): boolean {
  const run = todo.runs.at(-1);
  if (todo.status === "done" || run?.status !== "partial" || openSubtasks(todo).length > 0) return false;
  Object.assign(run, { status: "done", note: null });
  Object.assign(todo, { status: "done", completedAt: now, updatedAt: now });
  return true;
}

function findRun(todos: Todo[], agentId: string): { todo: Todo; run: Run } | null {
  for (const todo of todos) {
    const run = todo.runs.find((candidate) => candidate.agentId === agentId);
    if (run) return { todo, run };
  }
  return null;
}

export class AgentTracker {
  constructor(
    private readonly store: TodoStore,
    /** Called after a change Google should see. */
    private readonly onSyncableChange: () => void,
    private readonly googleEnabled: () => Promise<boolean>,
  ) {}

  async todoForAgent(agentId: string): Promise<Todo | null> {
    return findRun(await this.store.list(), agentId)?.todo ?? null;
  }

  async launch(
    paseo: PaseoApi,
    settings: Settings,
    input: { id: string; presetId: string; extraInstructions: string; waitForContext: boolean; modeId?: string; cwd?: string },
  ) {
    const { id: todoId, presetId, extraInstructions, waitForContext } = input;
    const preset = settings.presets.find((candidate) => candidate.id === presetId);
    if (!preset) throw new Error(`Unknown launch preset "${presetId}".`);
    const modeId = input.modeId ?? preset.modeId;
    const todo = (await this.store.list()).find((candidate) => candidate.id === todoId);
    if (!todo) throw new Error("Todo not found.");

    // Precedence: this launch's choice, then the todo's project, then the preset's directory.
    const cwd = input.cwd ?? todo.cwd ?? preset.cwd;
    const workspace = await paseo.workspaces.open(cwd);
    // Create first, record the run, then prompt: a fast turn must find its todo.
    const agent = await workspace.agents.create({
      config: {
        provider: `${preset.provider}/${preset.model}`,
        modeId,
        ...(preset.thinkingOptionId ? { thinkingOptionId: preset.thinkingOptionId } : {}),
      },
      title: todo.title,
      labels: { [AGENT_LABEL]: todo.id },
    });
    await this.store.mutate((todos) => {
      const current = todos.find((candidate) => candidate.id === todoId);
      if (!current) throw new Error("Todo was deleted while the agent started.");
      current.runs.push({
        agentId: agent.id,
        workspaceId: agent.workspaceId ?? workspace.id,
        presetLabel: preset.label,
        provider: `${preset.provider}/${preset.model}`,
        cwd,
        modeId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: "running",
        note: null,
        awaitingContext: waitForContext,
      });
      if (current.status === "open") current.status = "in_progress";
      if (input.cwd) current.cwd = input.cwd;
    });
    const template = waitForContext ? settings.briefingTemplate : settings.promptTemplate;
    await agent.send(renderPrompt(template, todo, settings, extraInstructions));
    return { agentId: agent.id, workspaceId: agent.workspaceId ?? workspace.id };
  }

  async review(paseo: PaseoApi, settings: Settings, agentId: string, extraInstructions: string) {
    const todo = await this.store.mutate((todos) => {
      const found = findRun(todos, agentId);
      if (!found) throw new Error("This agent was not launched from Agent Todos.");
      Object.assign(found.run, { status: "running", endedAt: null, note: null, awaitingContext: false });
      return structuredClone(found.todo);
    });
    await paseo.agents.ref(agentId).send(renderPrompt(settings.reviewPromptTemplate, todo, settings, extraInstructions));
    return { title: todo.title };
  }

  /**
   * Revives a closed or archived agent: the daemon reopens the same provider session
   * (and unarchives it) when it receives a message, keeping the original mode.
   */
  async resume(paseo: PaseoApi, todoId: string, agentId: string, message: string) {
    const run = (await this.store.list()).find((todo) => todo.id === todoId)?.runs.find((candidate) => candidate.agentId === agentId);
    if (!run) throw new Error("That agent run does not belong to this todo.");
    const agent = paseo.agents.ref(agentId);
    if (!(await agent.refresh())) throw new Error("Paseo no longer has this agent; launch a new one instead.");
    await agent.send(message);
    await this.store.mutate((todos) => {
      const found = findRun(todos, agentId);
      if (found && found.run.status !== "done") Object.assign(found.run, { status: "running", endedAt: null, note: null });
    });
    return { agentId };
  }

  async onTurnStarted(agentId: string): Promise<void> {
    await this.store.mutate((todos) => {
      const found = findRun(todos, agentId);
      if (found && found.run.status !== "done") Object.assign(found.run, { status: "running", endedAt: null });
    });
  }

  async onTurnEnded(event: PluginLifecycleEvents["agent.turn_ended"], paseo: PaseoApi): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.store.mutate((todos) => {
      const found = findRun(todos, event.agent.id);
      if (!found) return null;
      const { todo, run } = found;
      run.endedAt = now;
      // The briefing turn only acknowledges the task; never read a status marker from it.
      const briefing = run.awaitingContext;
      run.awaitingContext = false;
      if (event.outcome.kind === "failed") {
        Object.assign(run, { status: "failed", note: event.outcome.error.message });
        return null;
      }
      const text = event.outcome.kind === "completed" ? latestAssistantText(event.timeline) : "";
      // Subtasks count from any turn: the briefing reply is where an agent first splits the work.
      const subtaskChanges = applySubtaskMarkers(todo, parseSubtaskMarkers(text), now);
      if (subtaskChanges.length > 0) {
        todo.updatedAt = now;
        reopenForOpenSubtasks(todo);
      }
      const marker = briefing ? null : parseStatusMarker(text);
      const open = openSubtasks(todo);
      let status: TimelineRow["status"];
      let note: string | null;
      if (!marker) {
        Object.assign(run, { status: "waiting", note: null });
        if (subtaskChanges.length === 0) return null;
        [status, note] = ["waiting", null];
      } else if (marker.status === "done" && open.length > 0) {
        [status, note] = ["partial", `Open subtasks: ${open.join("; ")}`];
        Object.assign(run, { status, note });
      } else {
        [status, note] = [marker.status, marker.note];
        Object.assign(run, { status, note });
        if (status === "done" && todo.status !== "done") {
          Object.assign(todo, { status: "done", completedAt: now, updatedAt: now });
        }
      }
      return { title: todo.title, status, note, subtaskChanges, synced: todo.syncToGoogle };
    });
    if (!result) return;
    if (result.status === "done") this.onSyncableChange();
    const row: TimelineRow = {
      title: result.title,
      status: result.status,
      subtaskChanges: result.subtaskChanges,
      note: result.note,
      google: result.status === "done" && result.synced && (await this.googleEnabled()),
    };
    await paseo.agents.ref(event.agent.id).timeline.append({
      type: "plugin",
      id: `agent-todo-${event.turnId ?? now}`,
      kind: TIMELINE_KIND,
      version: 1,
      data: row,
    });
  }

  async onArchived(agentId: string): Promise<void> {
    await this.store.mutate((todos) => {
      const found = findRun(todos, agentId);
      // A partial run keeps its DONE report so ticking the last subtask still completes the todo.
      if (found && found.run.status !== "done" && found.run.status !== "partial") {
        Object.assign(found.run, { status: "archived", endedAt: found.run.endedAt ?? new Date().toISOString() });
      }
    });
  }
}
