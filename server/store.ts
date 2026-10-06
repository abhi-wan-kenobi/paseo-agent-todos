import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { todoSchema, type Todo } from "../shared/contracts";

const fileSchema = z.object({ version: z.literal(1), todos: z.array(todoSchema) });

/**
 * Todos live in one JSON file on the daemon machine. Every mutation goes through
 * `mutate`, which serialises writers so lifecycle hooks, RPCs, and the sync loop
 * never interleave a read-modify-write.
 */
export class TodoStore {
  readonly path: string;
  private todos: Todo[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugin-data", "paseo-agent-todos", "todos.json")) {
    this.path = path;
  }

  async list(): Promise<Todo[]> {
    return (await this.load()).map((todo) => structuredClone(todo));
  }

  /** Runs `change` against the live list and persists the result atomically. */
  mutate<T>(change: (todos: Todo[]) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const todos = await this.load();
      const before = JSON.stringify(todos);
      const result = await change(todos);
      // Lifecycle hooks fire for every agent; skip the write when nothing changed.
      if (JSON.stringify(todos) === before) return result;
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, todos }, null, 2));
      await rename(tmp, this.path);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<Todo[]> {
    if (this.todos) return this.todos;
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.todos = [];
      return this.todos;
    }
    this.todos = fileSchema.parse(JSON.parse(raw)).todos;
    return this.todos;
  }
}

export function newTodo(fields: Pick<Todo, "title" | "notes" | "jiraKey" | "due" | "cwd">, now = new Date().toISOString()): Todo {
  return {
    id: randomUUID(),
    ...fields,
    status: "open",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    syncToGoogle: true,
    google: null,
    subtasks: [],
    runs: [],
  };
}
