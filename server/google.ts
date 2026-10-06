import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

const API = "https://tasks.googleapis.com/tasks/v1";
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const DEFAULT_CREDENTIALS_DIR = join(homedir(), ".google_workspace_mcp", "credentials");

/** The authorized-user file google_workspace_mcp writes after OAuth. */
const credentialsSchema = z.object({
  refresh_token: z.string(),
  client_id: z.string(),
  client_secret: z.string(),
  token_uri: z.string().default("https://oauth2.googleapis.com/token"),
  scopes: z.array(z.string()).default([]),
});

export const googleTaskSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  notes: z.string().optional(),
  status: z.enum(["needsAction", "completed"]),
  due: z.string().optional(),
  updated: z.string(),
  deleted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  parent: z.string().optional(),
});
export type GoogleTask = z.infer<typeof googleTaskSchema>;

export interface GoogleTaskWrite {
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  due?: string | null;
  completed?: null;
}

/**
 * Reuses the refresh token google_workspace_mcp already holds. The refreshed access
 * token stays in memory; the MCP's credential file is never written.
 */
export class GoogleTasksClient {
  readonly account: string;
  private readonly credentials: z.infer<typeof credentialsSchema>;
  private accessToken: { value: string; expiresAt: number } | null = null;

  private constructor(account: string, credentials: z.infer<typeof credentialsSchema>) {
    this.account = account;
    this.credentials = credentials;
  }

  static async open(credentialsPath: string): Promise<GoogleTasksClient> {
    const path = credentialsPath.trim() || (await findDefaultCredentials());
    const credentials = credentialsSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (credentials.scopes.length > 0 && !credentials.scopes.includes(TASKS_SCOPE)) {
      throw new Error(`${path} was authorized without the Google Tasks scope; re-run the workspace MCP's Google auth with Tasks enabled.`);
    }
    return new GoogleTasksClient(basename(path, ".json"), credentials);
  }

  async listTaskLists(signal?: AbortSignal): Promise<Array<{ id: string; title: string }>> {
    const body = z
      .object({ items: z.array(z.object({ id: z.string(), title: z.string() })).default([]) })
      .parse(await this.request("GET", "/users/@me/lists?maxResults=100", undefined, signal));
    return body.items;
  }

  async listTasks(taskListId: string, signal?: AbortSignal): Promise<GoogleTask[]> {
    const tasks: GoogleTask[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true", showDeleted: "true" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = z
        .object({ items: z.array(googleTaskSchema).default([]), nextPageToken: z.string().optional() })
        .parse(await this.request("GET", `/lists/${encodeURIComponent(taskListId)}/tasks?${query}`, undefined, signal));
      tasks.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return tasks;
  }

  async insertTask(taskListId: string, task: GoogleTaskWrite, signal?: AbortSignal): Promise<GoogleTask> {
    return googleTaskSchema.parse(await this.request("POST", `/lists/${encodeURIComponent(taskListId)}/tasks`, task, signal));
  }

  async patchTask(taskListId: string, taskId: string, task: GoogleTaskWrite, signal?: AbortSignal): Promise<GoogleTask> {
    return googleTaskSchema.parse(
      await this.request("PATCH", `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, task, signal),
    );
  }

  async deleteTask(taskListId: string, taskId: string, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, undefined, signal);
  }

  private async token(signal?: AbortSignal): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const response = await fetch(this.credentials.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refresh_token,
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Google token refresh failed (${response.status}): ${await response.text()}`);
    }
    const body = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async request(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.token(signal)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Google Tasks ${method} ${path.split("?")[0]} failed (${response.status}): ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  }
}

async function findDefaultCredentials(): Promise<string> {
  const accounts = (await readdir(DEFAULT_CREDENTIALS_DIR)).filter((name) => name.includes("@") && name.endsWith(".json"));
  if (accounts.length !== 1) {
    throw new Error(
      `Found ${accounts.length} Google account files in ${DEFAULT_CREDENTIALS_DIR}; set the credentials path in the plugin settings.`,
    );
  }
  return join(DEFAULT_CREDENTIALS_DIR, accounts[0]);
}
