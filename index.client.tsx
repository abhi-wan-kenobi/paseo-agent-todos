import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/settings-screen";
import { TodoStatusRow } from "./client/timeline-row";
import { TodosSurface } from "./client/todos-surface";
import { agentTodoRpc, reviewAgentRpc, TIMELINE_KIND, timelineRowSchema, updateTodoRpc } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings("settings");
  const Surface = (props: PluginSurfaceProps) => <TodosSurface {...props} openSettings={openSettings} />;

  client.addSurface("todos", Surface);
  client.addSidebarItem({ id: "todos", title: "Agent Todos", icon: "ListTodo", surface: "todos" });
  client.addSettingsScreen({ id: "settings", title: "Agent Todos", icon: "ListTodo", Component: SettingsScreen });
  client.addTimelineRenderer({ kind: TIMELINE_KIND, version: 1, schema: timelineRowSchema, Component: TodoStatusRow });

  client.addCommandCenterItem({
    id: "open-todos",
    title: "Open Agent Todos",
    icon: "ListTodo",
    keywords: ["todo", "tasks", "deliveries", "google tasks"],
    context: "global",
    onSelect: ({ openSurface }) => openSurface("todos"),
  });

  client.addSlashCommand({
    name: "todo-done",
    description: "Mark this agent's todo delivered (and done in Google Tasks)",
    argumentHint: "",
    context: "agent",
    async onSubmit({ agent, rpc }) {
      const { todo } = await rpc(agentTodoRpc, { agentId: agent.id });
      if (!todo) throw new Error("This agent was not launched from Agent Todos.");
      await rpc(updateTodoRpc, { id: todo.id, status: "done" });
    },
  });

  client.addSlashCommand({
    name: "todo-review",
    description: "Ask this agent to review its delivery against the todo and Jira ticket",
    argumentHint: "[extra instructions]",
    context: "agent",
    async onSubmit({ agent, args, rpc }) {
      await rpc(reviewAgentRpc, { agentId: agent.id, extraInstructions: args });
    },
  });

  return () => {};
}
