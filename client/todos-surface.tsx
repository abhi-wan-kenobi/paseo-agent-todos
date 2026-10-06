import { openExternalUrl, usePaseo, useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  createTodoRpc,
  deleteTodoRpc,
  findJiraKey,
  launchTodoRpc,
  listTodosRpc,
  resumeAgentRpc,
  settingsDefinition,
  subtaskRpc,
  syncNowRpc,
  updateTodoRpc,
  type Todo,
} from "../shared/contracts";
import { ProjectPicker, projectName, useProjects, type ProjectOption } from "./project-picker";
import { RUN_STATUS_LABEL, relativeTime, runStatusColor, useStyles, type Styles } from "./styles";

type SubtaskAction = { kind: "add"; title: string } | { kind: "toggle"; subtaskId: string } | { kind: "remove"; subtaskId: string };

type Filter = "active" | "done" | "all";

const TODOS_KEY = ["agent-todos", "list"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface TodosSurfaceProps extends PluginSurfaceProps {
  openSettings(): void;
}

export function TodosSurface(props: TodosSurfaceProps) {
  const { theme, layout, navigation, openSettings } = props;
  const styles = useStyles(theme, layout.compact);
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useSettings(settingsDefinition);
  const listTodos = useRpc(listTodosRpc);
  const syncNow = useRpc(syncNowRpc);
  const updateTodo = useRpc(updateTodoRpc);
  const [filter, setFilter] = useState<Filter>("active");
  const [editing, setEditing] = useState<Todo | "new" | null>(null);
  const [launching, setLaunching] = useState<Todo | null>(null);

  const todos = useQuery({ queryKey: TODOS_KEY, queryFn: () => listTodos({}), refetchInterval: 4_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: TODOS_KEY });
  const sync = useMutation({
    mutationFn: () => syncNow({}),
    onSuccess: (state) => (state.lastError ? toast.error(state.lastError) : toast.show("Synced with Google Tasks", { variant: "success" })),
    onError: (error) => toast.error(String(error instanceof Error ? error.message : error)),
    onSettled: refresh,
  });
  const toggle = useMutation({
    mutationFn: (todo: Todo) => updateTodo({ id: todo.id, status: todo.status === "done" ? "open" : "done" }),
    onError: (error) => toast.error(String(error instanceof Error ? error.message : error)),
    onSettled: refresh,
  });
  const resumeAgent = useRpc(resumeAgentRpc);
  const resume = useMutation({
    mutationFn: (input: { todoId: string; agentId: string }) => resumeAgent(input),
    onSuccess: ({ agentId }) => {
      toast.show("Agent resumed", { variant: "success" });
      setEditing(null);
      navigation?.openAgent({ agentId });
    },
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  });
  const onResume = (todoId: string, agentId: string) => resume.mutate({ todoId, agentId });
  const changeSubtask = useRpc(subtaskRpc);
  const subtask = useMutation({
    mutationFn: (input: { todoId: string; action: SubtaskAction }) => changeSubtask(input),
    onSuccess: (todo) => (todo.status === "done" ? toast.show("All subtasks done · todo complete", { variant: "success" }) : undefined),
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  });
  const projects = useProjects();

  const googleEnabled = settings.status === "ready" && settings.values.google.enabled;
  const all = todos.data?.todos ?? [];
  const visible = all
    .filter((todo) => (filter === "all" ? true : filter === "done" ? todo.status === "done" : todo.status !== "done"))
    .sort((a, b) =>
      filter === "done"
        ? (b.completedAt ?? "").localeCompare(a.completedAt ?? "")
        : (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.createdAt.localeCompare(a.createdAt),
    );
  const syncState = todos.data?.sync;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <View style={{ gap: 2 }}>
            <Text style={styles.title}>Agent Todos</Text>
            <Text style={styles.muted}>
              {all.filter((todo) => todo.status !== "done").length} open ·{" "}
              {all.filter((todo) => todo.status === "done" && todo.runs.some((run) => run.status === "done")).length} delivered by agents
            </Text>
          </View>
          <View style={styles.row}>
            {googleEnabled ? (
              <Pressable accessibilityRole="button" style={styles.button} disabled={sync.isPending} onPress={() => sync.mutate()}>
                <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
                <Text style={styles.buttonText}>{sync.isPending ? "Syncing…" : "Sync"}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Agent Todos settings" style={styles.button} onPress={openSettings}>
              <Icon name="Settings" size={14} color={theme.colors.foreground} />
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.primary} onPress={() => setEditing("new")}>
              <Icon name="Plus" size={14} color={theme.colors.accentForeground} />
              <Text style={styles.primaryText}>New todo</Text>
            </Pressable>
          </View>
        </View>

        {googleEnabled && syncState ? (
          <Text style={syncState.lastError ? styles.danger : styles.muted}>
            {syncState.lastError
              ? `Google sync failed: ${syncState.lastError}`
              : syncState.lastSyncAt
                ? `Google Tasks synced ${relativeTime(syncState.lastSyncAt)}`
                : "Google Tasks sync pending"}
          </Text>
        ) : null}

        <View style={styles.row}>
          {(["active", "done", "all"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === value }}
              style={filter === value ? styles.tabActive : styles.tab}
              onPress={() => setFilter(value)}
            >
              <Text style={filter === value ? styles.text : styles.muted}>
                {value === "active" ? "Open" : value === "done" ? "Done" : "All"}
              </Text>
            </Pressable>
          ))}
        </View>

        {todos.isPending ? <Text style={styles.muted}>Loading…</Text> : null}
        {todos.error ? <Text style={styles.danger}>{String(todos.error.message)}</Text> : null}
        {todos.data && visible.length === 0 ? (
          <Text style={styles.muted}>{filter === "done" ? "Nothing delivered yet." : "No open todos. Add one or sync Google Tasks."}</Text>
        ) : null}

        {visible.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            props={props}
            styles={styles}
            jiraBrowseUrl={settings.status === "ready" ? settings.values.jiraBrowseUrl : ""}
            projects={projects}
            onSubtask={(action) => subtask.mutate({ todoId: todo.id, action })}
            onToggle={() => toggle.mutate(todo)}
            onEdit={() => setEditing(todo)}
            onLaunch={() => setLaunching(todo)}
            onOpenAgent={(agentId) => navigation?.openAgent({ agentId })}
            onResume={(agentId) => onResume(todo.id, agentId)}
            resuming={resume.isPending}
          />
        ))}
      </ScrollView>

      <EditTodoModal
        target={editing}
        styles={styles}
        theme={theme}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        onResume={onResume}
      />
      <LaunchModal
        todo={launching}
        styles={styles}
        props={props}
        onClose={() => setLaunching(null)}
        onLaunched={(agentId) => {
          void refresh();
          navigation?.openAgent({ agentId });
        }}
      />
    </View>
  );
}

function TodoRow({
  todo,
  props,
  styles,
  jiraBrowseUrl,
  projects,
  onSubtask,
  onToggle,
  onEdit,
  onLaunch,
  onOpenAgent,
  onResume,
  resuming,
}: {
  todo: Todo;
  props: TodosSurfaceProps;
  styles: Styles;
  jiraBrowseUrl: string;
  projects: ProjectOption[];
  onSubtask(action: SubtaskAction): void;
  onToggle(): void;
  onEdit(): void;
  onLaunch(): void;
  onOpenAgent(agentId: string): void;
  onResume(agentId: string): void;
  resuming: boolean;
}) {
  const { theme, navigation } = props;
  const run = todo.runs.at(-1);
  const done = todo.status === "done";
  const overdue = !done && todo.due !== null && todo.due < new Date().toISOString().slice(0, 10);
  const [newSubtask, setNewSubtask] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const subtasksDone = todo.subtasks.filter((subtask) => subtask.done).length;
  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    onSubtask({ kind: "add", title: newSubtask.trim() });
    setNewSubtask("");
  };
  return (
    <View style={styles.card}>
      <View style={[styles.row, { flexWrap: "nowrap", alignItems: "flex-start" }]}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? `Reopen ${todo.title}` : `Mark ${todo.title} done`}
          hitSlop={8}
          onPress={onToggle}
          style={{ paddingTop: 1 }}
        >
          <Icon name={done ? "SquareCheck" : "Square"} size={18} color={done ? theme.colors.statusSuccess : theme.colors.foregroundMuted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${todo.title}`} style={{ flex: 1, gap: 4 }} onPress={onEdit}>
          <Text style={[styles.text, done ? { textDecorationLine: "line-through", color: theme.colors.foregroundMuted } : null]}>
            {todo.title}
          </Text>
          {todo.notes ? (
            <Text style={styles.muted} numberOfLines={2}>
              {todo.notes}
            </Text>
          ) : null}
        </Pressable>
      </View>

      {todo.subtasks.length > 0 || addingSubtask ? (
        <View style={{ gap: 6, paddingLeft: 26 }}>
          {todo.subtasks.map((subtask) => (
            <View key={subtask.id} style={[styles.row, { flexWrap: "nowrap", alignItems: "flex-start" }]}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: subtask.done }}
                accessibilityLabel={subtask.done ? `Reopen subtask ${subtask.title}` : `Mark subtask ${subtask.title} done`}
                hitSlop={8}
                onPress={() => onSubtask({ kind: "toggle", subtaskId: subtask.id })}
              >
                <Icon
                  name={subtask.done ? "SquareCheck" : "Square"}
                  size={15}
                  color={subtask.done ? theme.colors.statusSuccess : theme.colors.foregroundMuted}
                />
              </Pressable>
              <Text
                style={[
                  styles.muted,
                  { flex: 1, color: subtask.done ? theme.colors.foregroundMuted : theme.colors.foreground },
                  subtask.done ? { textDecorationLine: "line-through" } : null,
                ]}
              >
                {subtask.title}
              </Text>
              {subtask.source === "agent" ? <Icon name="Bot" size={12} color={theme.colors.foregroundMuted} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove subtask ${subtask.title}`}
                hitSlop={8}
                onPress={() => onSubtask({ kind: "remove", subtaskId: subtask.id })}
              >
                <Icon name="X" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          ))}
          {addingSubtask ? (
            <TextInput
              style={styles.input}
              value={newSubtask}
              onChangeText={setNewSubtask}
              onSubmitEditing={addSubtask}
              onBlur={() => (newSubtask.trim() ? undefined : setAddingSubtask(false))}
              placeholder="New subtask or requirement, Enter to add"
              autoFocus
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.row}>
        {todo.jiraKey ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open Jira ticket ${todo.jiraKey}`}
            style={styles.chip}
            disabled={!jiraBrowseUrl}
            onPress={() => void openExternalUrl(`${jiraBrowseUrl}${todo.jiraKey}`)}
          >
            <Icon name="Ticket" size={12} color={theme.colors.accent} />
            <Text style={[styles.muted, { color: theme.colors.accent }]}>{todo.jiraKey}</Text>
          </Pressable>
        ) : null}
        {todo.cwd ? (
          <View style={styles.chip}>
            <Icon name="FolderGit2" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.muted}>{projectName(projects, todo.cwd)}</Text>
          </View>
        ) : null}
        {todo.subtasks.length > 0 ? (
          <View style={styles.chip}>
            <Icon name="ListTree" size={12} color={subtasksDone === todo.subtasks.length ? theme.colors.statusSuccess : theme.colors.foregroundMuted} />
            <Text style={styles.muted}>
              {subtasksDone}/{todo.subtasks.length} subtasks
            </Text>
          </View>
        ) : null}
        {todo.due ? (
          <View style={styles.chip}>
            <Icon name="Calendar" size={12} color={overdue ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
            <Text style={overdue ? styles.danger : styles.muted}>{todo.due}</Text>
          </View>
        ) : null}
        {todo.google ? (
          <View style={styles.chip}>
            <Icon name="ListChecks" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.muted}>Google Tasks</Text>
          </View>
        ) : null}
        {run ? (
          <View style={[styles.chip, { borderColor: runStatusColor(theme, run.status) }]}>
            <Icon name="Bot" size={12} color={runStatusColor(theme, run.status)} />
            <Text style={[styles.muted, { color: runStatusColor(theme, run.status) }]}>
              {RUN_STATUS_LABEL[run.status]} · {run.presetLabel}
            </Text>
          </View>
        ) : null}
      </View>
      {run?.note && (run.status === "blocked" || run.status === "failed" || run.status === "partial") ? (
        <Text style={run.status === "failed" ? styles.danger : styles.muted}>{run.note}</Text>
      ) : null}

      <View style={styles.row}>
        {!done ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={onLaunch}>
            <Icon name="Rocket" size={14} color={theme.colors.foreground} />
            <Text style={styles.buttonText}>{run ? "Launch another agent" : "Launch agent"}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => setAddingSubtask(true)}>
          <Icon name="ListPlus" size={14} color={theme.colors.foreground} />
          <Text style={styles.buttonText}>Add subtask</Text>
        </Pressable>
        {run && navigation && run.status !== "archived" ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => onOpenAgent(run.agentId)}>
            <Icon name="MessageSquare" size={14} color={theme.colors.foreground} />
            <Text style={styles.buttonText}>Open agent</Text>
          </Pressable>
        ) : null}
        {run ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Resume this agent's session, even if it was closed or archived"
            style={run.status === "archived" ? styles.primary : styles.button}
            disabled={resuming}
            onPress={() => onResume(run.agentId)}
          >
            <Icon name="RotateCcw" size={14} color={run.status === "archived" ? theme.colors.accentForeground : theme.colors.foreground} />
            <Text style={run.status === "archived" ? styles.primaryText : styles.buttonText}>{resuming ? "Resuming…" : "Resume session"}</Text>
          </Pressable>
        ) : null}
        {todo.runs.length > 1 ? <Text style={styles.muted}>{todo.runs.length} agent runs</Text> : null}
      </View>
    </View>
  );
}

function EditTodoModal({
  target,
  styles,
  theme,
  onClose,
  onSaved,
  onResume,
}: {
  target: Todo | "new" | null;
  styles: Styles;
  theme: TodosSurfaceProps["theme"];
  onClose(): void;
  onSaved(): void;
  onResume(todoId: string, agentId: string): void;
}) {
  const existing = target !== "new" && target !== null ? target : null;
  return (
    <Modal title={existing ? "Edit todo" : "New todo"} open={target !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <Modal.Content>
        {target !== null ? (
          <TodoForm
            key={existing?.id ?? "new"}
            existing={existing}
            styles={styles}
            theme={theme}
            onDone={onClose}
            onSaved={onSaved}
            onResume={onResume}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}

function TodoForm({
  existing,
  styles,
  theme,
  onDone,
  onSaved,
  onResume,
}: {
  existing: Todo | null;
  styles: Styles;
  theme: TodosSurfaceProps["theme"];
  onDone(): void;
  onSaved(): void;
  onResume(todoId: string, agentId: string): void;
}) {
  const toast = useToast();
  const createTodo = useRpc(createTodoRpc);
  const updateTodo = useRpc(updateTodoRpc);
  const deleteTodo = useRpc(deleteTodoRpc);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [jiraKey, setJiraKey] = useState(existing?.jiraKey ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [due, setDue] = useState(existing?.due ?? "");
  const [cwd, setCwd] = useState<string | null>(existing?.cwd ?? null);
  const detectedJira = jiraKey.trim() || findJiraKey(`${title}\n${notes}`) || "";
  const dueValid = due.trim() === "" || DATE.test(due.trim());

  const save = useMutation({
    mutationFn: async () => {
      const fields = { title: title.trim(), notes, jiraKey: detectedJira || null, due: due.trim() || null, cwd };
      return existing ? updateTodo({ id: existing.id, ...fields }) : createTodo(fields);
    },
    onSuccess: () => {
      onSaved();
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteTodo({ id: existing!.id }),
    onSuccess: () => {
      onSaved();
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Title</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What needs delivering?" autoFocus />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Jira ticket</Text>
        <TextInput
          style={styles.input}
          value={jiraKey}
          onChangeText={setJiraKey}
          autoCapitalize="characters"
          placeholder={detectedJira ? `Detected ${detectedJira}` : "PROJ-1234 (optional)"}
        />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Notes and context for the agent</Text>
        <TextInput style={styles.multiline} value={notes} onChangeText={setNotes} multiline placeholder="Links, acceptance criteria, where to write output…" />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Due date</Text>
        <TextInput style={styles.input} value={due} onChangeText={setDue} placeholder="YYYY-MM-DD (optional)" />
        {!dueValid ? <Text style={styles.danger}>Use YYYY-MM-DD.</Text> : null}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Project agents launch in</Text>
        <ProjectPicker theme={theme} styles={styles} value={cwd} fallbackLabel="Preset default" onChange={setCwd} />
      </View>
      {existing?.runs.length ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.muted}>Agent runs</Text>
          {existing.runs.map((run) => (
            <View key={run.agentId} style={[styles.row, { justifyContent: "space-between", flexWrap: "nowrap" }]}>
              <Text style={[styles.muted, { flex: 1 }]}>
                {run.startedAt.slice(0, 16).replace("T", " ")} · {run.presetLabel}
                {run.modeId ? ` · ${run.modeId}` : ""} · {RUN_STATUS_LABEL[run.status]}
              </Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => onResume(existing.id, run.agentId)}>
                <Text style={styles.buttonText}>Resume</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={[styles.row, { justifyContent: "space-between" }]}>
        {existing ? (
          <Pressable accessibilityRole="button" style={styles.button} disabled={remove.isPending} onPress={() => remove.mutate()}>
            <Text style={[styles.buttonText, styles.danger]}>
              {existing.google ? "Delete here and in Google" : "Delete"}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable
          accessibilityRole="button"
          style={styles.primary}
          disabled={!title.trim() || !dueValid || save.isPending}
          onPress={() => save.mutate()}
        >
          <Text style={styles.primaryText}>{save.isPending ? "Saving…" : existing ? "Save" : "Add todo"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LaunchModal({
  todo,
  styles,
  props,
  onClose,
  onLaunched,
}: {
  todo: Todo | null;
  styles: Styles;
  props: TodosSurfaceProps;
  onClose(): void;
  onLaunched(agentId: string): void;
}) {
  return (
    <Modal title="Launch agent" open={todo !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <Modal.Content>
        {todo ? <LaunchForm key={todo.id} todo={todo} styles={styles} props={props} onClose={onClose} onLaunched={onLaunched} /> : null}
      </Modal.Content>
    </Modal>
  );
}

function LaunchForm({
  todo,
  styles,
  props,
  onClose,
  onLaunched,
}: {
  todo: Todo;
  styles: Styles;
  props: TodosSurfaceProps;
  onClose(): void;
  onLaunched(agentId: string): void;
}) {
  const { theme, openSettings } = props;
  const toast = useToast();
  const settings = useSettings(settingsDefinition);
  const launchTodo = useRpc(launchTodoRpc);
  const paseo = usePaseo();
  const presets = settings.status === "ready" ? settings.values.presets : [];
  const [presetId, setPresetId] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [waitForContext, setWaitForContext] = useState(true);
  // Mode is chosen per launch: omp fixes its permission mode when the session starts.
  const [modeChoice, setModeChoice] = useState<{ presetId: string; modeId: string } | null>(null);
  const selected = presetId ?? presets[0]?.id ?? null;
  const preset = presets.find((candidate) => candidate.id === selected) ?? null;
  const modeId = modeChoice && modeChoice.presetId === selected ? modeChoice.modeId : (preset?.modeId ?? null);
  // null = the preset's directory; whatever is chosen becomes the todo's default project.
  const [projectCwd, setProjectCwd] = useState<string | null>(todo.cwd);
  const cwd = projectCwd ?? preset?.cwd ?? null;
  const modes = useQuery({
    queryKey: ["agent-todos", "modes", preset?.provider, cwd],
    queryFn: () => paseo.providers.listModes(preset!.provider, { cwd: cwd! }),
    enabled: preset !== null && cwd !== null,
  });
  const modeList = modes.data?.modes ?? [];
  const selectedMode = modeList.find((mode) => mode.id === modeId);

  const launch = useMutation({
    mutationFn: () =>
      launchTodo({ id: todo.id, presetId: selected!, extraInstructions: extra, waitForContext, cwd: cwd!, ...(modeId ? { modeId } : {}) }),
    onSuccess: ({ agentId }) => {
      toast.show("Agent launched", { variant: "success" });
      onClose();
      onLaunched(agentId);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.text}>{todo.title}</Text>
      {todo.jiraKey ? <Text style={styles.muted}>The agent is told to read {todo.jiraKey} with its Jira tools before it starts the work.</Text> : null}
      <Text style={styles.muted}>Agent</Text>
      {settings.status === "loading" ? <Text style={styles.muted}>Loading presets…</Text> : null}
      {presets.map((preset) => (
        <Pressable
          key={preset.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === preset.id }}
          style={selected === preset.id ? styles.optionActive : styles.option}
          onPress={() => setPresetId(preset.id)}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.text}>{preset.label}</Text>
            <Text style={styles.muted}>
              {preset.provider}/{preset.model}
            </Text>
          </View>
          {selected === preset.id ? <Icon name="Check" size={16} color={theme.colors.accent} /> : null}
        </Pressable>
      ))}
      {settings.status === "ready" && presets.length === 0 ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={openSettings}>
          <Text style={styles.buttonText}>Add a launch preset in settings</Text>
        </Pressable>
      ) : null}
      <View style={{ gap: 6 }}>
        <Text style={styles.muted}>Project (the agent's working directory; commits show in that workspace)</Text>
        <ProjectPicker
          theme={theme}
          styles={styles}
          value={projectCwd}
          fallbackLabel={preset ? `Preset: ${preset.cwd.split("/").at(-1)}` : "Preset default"}
          onChange={setProjectCwd}
        />
      </View>
      {preset ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>Permission mode (fixed once the agent starts)</Text>
          {modes.isPending ? <Text style={styles.muted}>Loading modes…</Text> : null}
          {modes.error ? <Text style={styles.danger}>{modes.error.message}</Text> : null}
          <View style={styles.row}>
            {modeList.map((mode) => (
              <Pressable
                key={mode.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode.id === modeId }}
                style={mode.id === modeId ? styles.tabActive : styles.tab}
                onPress={() => setModeChoice({ presetId: preset.id, modeId: mode.id })}
              >
                <Text style={mode.id === modeId ? styles.text : styles.muted}>{mode.label}</Text>
              </Pressable>
            ))}
          </View>
          {selectedMode?.description ? <Text style={styles.muted}>{selectedMode.description}</Text> : null}
          {modes.data && modeId && !selectedMode ? (
            <Text style={styles.danger}>
              {preset.provider} has no “{modeId}” mode; pick one above or fix the preset.
            </Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: waitForContext }}
        style={[styles.row, { flexWrap: "nowrap", alignItems: "flex-start" }]}
        onPress={() => setWaitForContext((value) => !value)}
      >
        <Icon name={waitForContext ? "SquareCheck" : "Square"} size={18} color={waitForContext ? theme.colors.accent : theme.colors.foregroundMuted} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.text}>Wait for my context before starting</Text>
          <Text style={styles.muted}>
            {waitForContext
              ? "The agent acknowledges the task and asks questions without calling tools, then waits for your next message."
              : "The agent starts the work immediately."}
          </Text>
        </View>
      </Pressable>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Extra instructions (optional)</Text>
        <TextInput style={styles.multiline} value={extra} onChangeText={setExtra} multiline placeholder="Anything this run should do differently" />
      </View>
      <Text style={styles.muted}>
        When the delivery is finished, the agent reviews it and ends with “TODO-STATUS: DONE”; that marks this todo done
        {todo.google ? " here and in Google Tasks" : ""} once every subtask is done. The agent can add subtasks as requirements change.
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.primary}
        disabled={!selected || launch.isPending || (modes.data !== undefined && !selectedMode)}
        onPress={() => launch.mutate()}
      >
        <Icon name="Rocket" size={14} color={theme.colors.accentForeground} />
        <Text style={styles.primaryText}>{launch.isPending ? "Launching…" : "Launch"}</Text>
      </Pressable>
    </View>
  );
}
