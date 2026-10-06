import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Line the launched agent ends its final message with; the daemon watches for it. */
export const STATUS_MARKER = "TODO-STATUS";
/** Lines the agent writes to add a subtask or mark one done. */
export const SUBTASK_MARKER = "TODO-SUBTASK";
export const SUBTASK_DONE_MARKER = "TODO-SUBTASK-DONE";
export const TIMELINE_KIND = "todo-status";
export const AGENT_LABEL = "agent-todo";

/** `partial`: the agent reported DONE while subtasks were still open; the todo completes once they are. */
export const runStatusSchema = z.enum(["running", "waiting", "blocked", "partial", "done", "failed", "archived"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string().nullable(),
  presetLabel: z.string(),
  provider: z.string(),
  /** Directory the agent ran in. */
  cwd: z.string().default(""),
  /** Permission mode the agent was started with; omp cannot change it later. */
  modeId: z.string().default(""),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: runStatusSchema,
  /** Reason the agent gave with BLOCKED, or the failure message. */
  note: z.string().nullable(),
  /** Launched with the briefing prompt; the first turn is an acknowledgement, never a delivery. */
  awaitingContext: z.boolean().default(false),
});
export type Run = z.infer<typeof runSchema>;

export const todoStatusSchema = z.enum(["open", "in_progress", "done"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const googleLinkSchema = z.object({
  taskId: z.string(),
  taskListId: z.string(),
  /** Google's `updated` timestamp at the last successful sync. */
  remoteUpdated: z.string(),
  /** Local clock at the last successful sync. */
  syncedAt: z.string(),
});

export const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  /** Who added it: me, or an agent that found new scope while working. */
  source: z.enum(["user", "agent"]),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type Subtask = z.infer<typeof subtaskSchema>;

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  jiraKey: z.string().nullable(),
  due: z.string().nullable(),
  status: todoStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  syncToGoogle: z.boolean(),
  google: googleLinkSchema.nullable(),
  /** Project directory agents launch in; null uses the preset's directory. */
  cwd: z.string().nullable().default(null),
  /** The todo is complete only when every subtask is done. */
  subtasks: z.array(subtaskSchema).default([]),
  runs: z.array(runSchema),
});
export type Todo = z.infer<typeof todoSchema>;

export const syncStateSchema = z.object({
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  running: z.boolean(),
});
export type SyncState = z.infer<typeof syncStateSchema>;

export const presetSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  /** Default permission mode, overridable per launch. Required: omp without a mode falls back to full access. */
  modeId: z.string().min(1),
  thinkingOptionId: z.string().nullable(),
  cwd: z.string().min(1),
});
export type Preset = z.infer<typeof presetSchema>;

export const DEFAULT_PROMPT = `You are picking up a tracked delivery from my todo list.

Task: {{title}}
{{notes}}
{{jira}}
{{due}}

Do the work end to end in this workspace. Before you report back, run a short review: re-read the task{{jiraReview}}, check every requirement against what you produced, and fix any gap you find.

End your final message with exactly one of these lines:
${STATUS_MARKER}: DONE
${STATUS_MARKER}: BLOCKED: <what you need from me>`;

/** Default launch prompt: brief the agent, then let me add context before it starts. */
export const DEFAULT_BRIEFING_PROMPT = `You are picking up a tracked delivery from my todo list. I will add more context in my next message before you start.

Task: {{title}}
{{notes}}
{{jira}}
{{due}}

For now, do not start the work and do not change anything: no edits, writes, commits, ticket changes or messages. You may read. First look up what the task depends on: the project's README and docs, any tracker or process notes it points to, and the Jira ticket if there is one. Then reply in a few lines with your understanding of the task, naming what you read, and ask only what those sources leave open. Wait for my next message.

Once I give you the go-ahead, do the work end to end in this workspace. Before you report back, run a short review: re-read the task{{jiraReview}}, check every requirement against what you produced, and fix any gap you find.

End the final message of the delivery with exactly one of these lines:
${STATUS_MARKER}: DONE
${STATUS_MARKER}: BLOCKED: <what you need from me>`;

export const DEFAULT_REVIEW_PROMPT = `Review the delivery you just made for "{{title}}"{{jiraReview}}. Check each requirement against what you produced, fix any gap, then summarise what was delivered.

End your final message with exactly one of these lines:
${STATUS_MARKER}: DONE
${STATUS_MARKER}: BLOCKED: <what you need from me>`;

export const settingsDefinition = defineSettings({
  id: "agent-todos",
  scope: "host",
  version: 1,
  schema: z.object({
    google: z
      .object({
        enabled: z.boolean().default(false),
        /** Empty: use the single account file under ~/.google_workspace_mcp/credentials. */
        credentialsPath: z.string().default(""),
        taskListId: z.string().default(""),
        intervalMinutes: z.number().int().min(1).max(240).default(5),
      })
      .default({ enabled: false, credentialsPath: "", taskListId: "", intervalMinutes: 5 }),
    /** Prefix that turns a Jira key into a link, e.g. https://your-company.atlassian.net/browse/. Empty: no links. */
    jiraBrowseUrl: z.string().default(""),
    /** Sent when "wait for my context" is on (the default). */
    briefingTemplate: z.string().default(DEFAULT_BRIEFING_PROMPT),
    /** Sent when the agent should start immediately. */
    promptTemplate: z.string().default(DEFAULT_PROMPT),
    reviewPromptTemplate: z.string().default(DEFAULT_REVIEW_PROMPT),
    /** Empty until you add one in settings: a preset names the agent, model and default directory. */
    presets: z.array(presetSchema).default([]),
  }),
});
export type Settings = z.infer<(typeof settingsDefinition)["schema"]>;

const empty = z.object({});

export const listTodosRpc = defineRpc({
  name: "todos.list",
  input: empty,
  output: z.object({ todos: z.array(todoSchema), sync: syncStateSchema }),
});

export const todoDraftSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().default(""),
  jiraKey: z.string().trim().nullable().default(null),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  cwd: z.string().nullable().default(null),
});

export const createTodoRpc = defineRpc({
  name: "todos.create",
  input: todoDraftSchema,
  output: todoSchema,
});

export const updateTodoRpc = defineRpc({
  name: "todos.update",
  input: z.object({
    id: z.string(),
    title: z.string().trim().min(1).optional(),
    notes: z.string().optional(),
    jiraKey: z.string().trim().nullable().optional(),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    status: todoStatusSchema.optional(),
    cwd: z.string().nullable().optional(),
  }),
  output: todoSchema,
});

export const deleteTodoRpc = defineRpc({
  name: "todos.delete",
  input: z.object({ id: z.string() }),
  output: empty,
});

export const subtaskRpc = defineRpc({
  name: "todos.subtask",
  input: z.object({
    todoId: z.string(),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("add"), title: z.string().trim().min(1) }),
      z.object({ kind: z.literal("toggle"), subtaskId: z.string() }),
      z.object({ kind: z.literal("remove"), subtaskId: z.string() }),
    ]),
  }),
  output: todoSchema,
});

export const launchTodoRpc = defineRpc({
  name: "todos.launch",
  input: z.object({
    id: z.string(),
    presetId: z.string(),
    extraInstructions: z.string().default(""),
    waitForContext: z.boolean().default(true),
    /** Overrides the preset's mode for this launch; omp fixes its mode at start. */
    modeId: z.string().min(1).optional(),
    /** Overrides the todo's project directory for this launch and becomes its new default. */
    cwd: z.string().min(1).optional(),
  }),
  output: z.object({ agentId: z.string(), workspaceId: z.string().nullable() }),
});

export const DEFAULT_RESUME_MESSAGE =
  "I'm resuming this delivery. Recap in a few lines where you left off and what is left, then wait for my next message.";

/** Sending to an archived or closed agent revives the same provider session in place. */
export const resumeAgentRpc = defineRpc({
  name: "todos.resume",
  input: z.object({ todoId: z.string(), agentId: z.string(), message: z.string().default(DEFAULT_RESUME_MESSAGE) }),
  output: z.object({ agentId: z.string() }),
});

export const agentTodoRpc = defineRpc({
  name: "todos.for-agent",
  input: z.object({ agentId: z.string() }),
  output: z.object({ todo: todoSchema.nullable() }),
});

export const reviewAgentRpc = defineRpc({
  name: "todos.review",
  input: z.object({ agentId: z.string(), extraInstructions: z.string().default("") }),
  output: z.object({ title: z.string() }),
});

export const syncNowRpc = defineRpc({
  name: "todos.sync",
  input: empty,
  output: syncStateSchema,
});

export const googleListsRpc = defineRpc({
  name: "google.lists",
  input: z.object({ credentialsPath: z.string() }),
  output: z.object({
    account: z.string(),
    lists: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
});

export const timelineRowSchema = z.object({
  title: z.string(),
  status: z.enum(["done", "partial", "blocked", "waiting"]),
  /** Subtasks this turn added or completed. */
  subtaskChanges: z.array(z.string()).default([]),
  note: z.string().nullable(),
  google: z.boolean(),
});
export type TimelineRow = z.infer<typeof timelineRowSchema>;

const JIRA_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/;

export function findJiraKey(text: string): string | null {
  return JIRA_KEY.exec(text)?.[1] ?? null;
}
