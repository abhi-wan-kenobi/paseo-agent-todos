import { usePaseo, useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  DEFAULT_BRIEFING_PROMPT,
  DEFAULT_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  googleListsRpc,
  presetSchema,
  settingsDefinition,
  type Preset,
  type Settings,
} from "../shared/contracts";
import { useStyles, type Styles } from "./styles";

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const settings = useSettings(settingsDefinition);
  const toast = useToast();
  const [draft, setDraft] = useState<{ values: Settings; revision: string } | null>(null);
  // SettingsInput only reads initialValue on mount; bump to remount after save/discard.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (settings.status === "ready" && draft === null) setDraft({ values: settings.values, revision: settings.revision });
  }, [settings, draft]);

  if (settings.status === "loading") return <Text style={styles.muted}>Loading…</Text>;
  if (settings.status === "error") return <Text style={styles.danger}>{settings.error}</Text>;
  if (settings.status === "invalid") {
    return (
      <SettingsSection title="Stored settings are invalid">
        <SettingsCard>
          <SettingsRow label="Error" hint={settings.error} />
          <SettingsAction label="Reset to defaults" actionLabel="Reset" onPress={() => void settings.reset()} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (!draft) return null;

  const values = draft.values;
  const update = (next: Partial<Settings>) => setDraft({ ...draft, values: { ...values, ...next } });
  const dirty = JSON.stringify(values) !== JSON.stringify(settings.values);
  const invalidPreset = values.presets.find((preset) => !presetSchema.safeParse(preset).success);
  const duplicateId = values.presets.find((preset, index) => values.presets.findIndex((other) => other.id === preset.id) !== index);

  async function save() {
    if (!draft) return;
    if (await settings.save(draft.values, draft.revision)) {
      toast.show("Settings saved", { variant: "success" });
      setDraft(null);
      setGeneration((value) => value + 1);
    }
  }

  return (
    <View key={generation} style={{ gap: 24 }}>
      <GoogleSection styles={styles} values={values} update={update} />

      <SettingsSection title="Jira">
        <SettingsCard>
          <SettingsInput
            label="Ticket URL prefix"
            hint="Jira keys link to this prefix + key."
            initialValue={values.jiraBrowseUrl}
            onChangeText={(jiraBrowseUrl) => update({ jiraBrowseUrl })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Launch presets">
        {values.presets.map((preset, index) => (
          <PresetCard
            key={index}
            preset={preset}
            styles={styles}
            onChange={(next) => update({ presets: values.presets.map((current, at) => (at === index ? next : current)) })}
            onRemove={() => {
              update({ presets: values.presets.filter((_, at) => at !== index) });
              setGeneration((value) => value + 1);
            }}
          />
        ))}
        <SettingsCard>
          <SettingsAction
            label="Add preset"
            actionLabel="Add"
            onPress={() =>
              update({
                presets: [
                  ...values.presets,
                  {
                    id: `preset-${values.presets.length + 1}`,
                    label: "New preset",
                    provider: "omp",
                    model: "anthropic/claude-opus-5-5",
                    modeId: "full",
                    thinkingOptionId: null,
                    cwd: "/absolute/path/to/project",
                  },
                ],
              })
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Prompts">
        <SettingsCard>
          <PromptEditor
            styles={styles}
            label="Launch prompt (wait for my context)"
            hint="Default. Placeholders: {{title}} {{notes}} {{jira}} {{due}} {{jiraReview}}. Keep the TODO-STATUS lines: they drive auto-completion. The first reply is never read as a delivery."
            value={values.briefingTemplate}
            fallback={DEFAULT_BRIEFING_PROMPT}
            onChange={(briefingTemplate) => update({ briefingTemplate })}
          />
          <PromptEditor
            styles={styles}
            label="Launch prompt (start immediately)"
            hint="Used when “Wait for my context” is unticked. Same placeholders."
            value={values.promptTemplate}
            fallback={DEFAULT_PROMPT}
            onChange={(promptTemplate) => update({ promptTemplate })}
          />
          <PromptEditor
            styles={styles}
            label="Review prompt (/todo-review)"
            hint="Sent to a linked agent by the /todo-review command."
            value={values.reviewPromptTemplate}
            fallback={DEFAULT_REVIEW_PROMPT}
            onChange={(reviewPromptTemplate) => update({ reviewPromptTemplate })}
          />
        </SettingsCard>
      </SettingsSection>

      <View style={{ gap: 8 }}>
        {invalidPreset ? <Text style={styles.danger}>Preset “{invalidPreset.label}” needs an id (lowercase-hyphen), provider, model, mode, and directory.</Text> : null}
        {duplicateId ? <Text style={styles.danger}>Two presets share the id “{duplicateId.id}”.</Text> : null}
        {settings.saveError ? <Text style={styles.danger}>{settings.saveError}</Text> : null}
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            style={styles.primary}
            disabled={!dirty || settings.saving || Boolean(invalidPreset) || Boolean(duplicateId)}
            onPress={() => void save()}
          >
            <Text style={styles.primaryText}>{settings.saving ? "Saving…" : "Save settings"}</Text>
          </Pressable>
          {dirty ? (
            <Pressable
              accessibilityRole="button"
              style={styles.button}
              onPress={() => {
                setDraft(null);
                setGeneration((value) => value + 1);
              }}
            >
              <Text style={styles.buttonText}>Discard changes</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function GoogleSection({ styles, values, update }: { styles: Styles; values: Settings; update(next: Partial<Settings>): void }) {
  const listGoogle = useRpc(googleListsRpc);
  const google = values.google;
  const setGoogle = (next: Partial<Settings["google"]>) => update({ google: { ...google, ...next } });
  const lists = useMutation({ mutationFn: () => listGoogle({ credentialsPath: google.credentialsPath }) });
  const options = lists.data?.lists.map((list) => ({ label: list.title, value: list.id })) ?? [];
  if (google.taskListId && !options.some((option) => option.value === google.taskListId)) {
    options.unshift({ label: `Current list (${google.taskListId.slice(0, 8)}…)`, value: google.taskListId });
  }

  return (
    <SettingsSection title="Google Tasks">
      <SettingsCard>
        <SettingsSwitch label="Two-way sync" hint="Pull open tasks in, push todos and completion back." value={google.enabled} onValueChange={(enabled) => setGoogle({ enabled })} />
        <SettingsInput
          label="Credentials file"
          hint="Leave empty to reuse the Google Workspace MCP account under ~/.google_workspace_mcp/credentials."
          placeholder="Auto-detect"
          initialValue={google.credentialsPath}
          onChangeText={(credentialsPath) => setGoogle({ credentialsPath })}
        />
        <SettingsAction
          label={lists.data ? `Signed in as ${lists.data.account}` : "Task lists"}
          hint={lists.error ? lists.error.message : undefined}
          actionLabel={lists.isPending ? "Loading…" : "Load lists"}
          disabled={lists.isPending}
          onPress={() => lists.mutate()}
        />
        {options.length > 0 ? (
          <SettingsSelect label="Task list" value={google.taskListId} options={options} onValueChange={(taskListId) => setGoogle({ taskListId })} />
        ) : null}
        <SettingsInput
          label="Sync every (minutes)"
          initialValue={String(google.intervalMinutes)}
          onChangeText={(text) => {
            const minutes = Number.parseInt(text, 10);
            if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 240) setGoogle({ intervalMinutes: minutes });
          }}
        />
      </SettingsCard>
      {google.enabled && !google.taskListId ? <Text style={styles.danger}>Load and pick a task list before saving.</Text> : null}
    </SettingsSection>
  );
}

function PresetCard({
  preset,
  styles,
  onChange,
  onRemove,
}: {
  preset: Preset;
  styles: Styles;
  onChange(next: Preset): void;
  onRemove(): void;
}) {
  const paseo = usePaseo();
  const set = (next: Partial<Preset>) => onChange({ ...preset, ...next });
  const providers = useQuery({ queryKey: ["agent-todos", "providers"], queryFn: () => paseo.providers.listAvailable() });
  const models = useQuery({
    queryKey: ["agent-todos", "models", preset.provider, preset.cwd],
    queryFn: () => paseo.providers.listModels(preset.provider, { cwd: preset.cwd }),
  });
  const modes = useQuery({
    queryKey: ["agent-todos", "modes", preset.provider, preset.cwd],
    queryFn: () => paseo.providers.listModes(preset.provider, { cwd: preset.cwd }),
  });

  const providerOptions = (providers.data?.providers ?? [])
    .filter((provider) => provider.available)
    .map((provider) => ({ label: provider.provider, value: provider.provider }));
  const modelList = models.data?.models ?? [];
  const model = modelList.find((candidate) => candidate.id === preset.model);
  const thinking = model?.thinkingOptions ?? [];

  return (
    <SettingsCard>
      <SettingsInput label="Label" initialValue={preset.label} onChangeText={(label) => set({ label })} />
      <SettingsInput label="Id" hint="Lowercase letters, digits, hyphens." initialValue={preset.id} onChangeText={(id) => set({ id })} />
      <SettingsSelect
        label="Provider"
        value={preset.provider}
        options={providerOptions.length ? providerOptions : [{ label: preset.provider, value: preset.provider }]}
        onValueChange={(provider) => set({ provider, model: "", modeId: "", thinkingOptionId: null })}
      />
      <SettingsSelect
        label="Model"
        hint={models.error ? models.error.message : undefined}
        value={preset.model}
        options={
          modelList.length
            ? modelList.map((candidate) => ({ label: candidate.label, value: candidate.id }))
            : [{ label: preset.model || "Loading…", value: preset.model }]
        }
        onValueChange={(next) => set({ model: next, thinkingOptionId: null })}
      />
      <SettingsSelect
        label="Permission mode"
        hint="Required. An omp agent without a mode runs with full access."
        value={preset.modeId}
        options={(modes.data?.modes ?? [{ id: preset.modeId, label: preset.modeId || "Loading…" }]).map((mode) => ({ label: mode.label, value: mode.id }))}
        onValueChange={(modeId) => set({ modeId })}
      />
      {thinking.length ? (
        <SettingsSelect
          label="Thinking"
          value={preset.thinkingOptionId ?? ""}
          options={[{ label: "Model default", value: "" }, ...thinking.map((option) => ({ label: option.label, value: option.id }))]}
          onValueChange={(value) => set({ thinkingOptionId: value || null })}
        />
      ) : null}
      <SettingsInput label="Working directory" hint="Absolute path; the agent opens a workspace here." initialValue={preset.cwd} onChangeText={(cwd) => set({ cwd })} />
      <SettingsAction label="Remove this preset" actionLabel="Remove" onPress={onRemove} />
      {models.isPending || modes.isPending ? <Text style={styles.muted}>Loading provider catalog…</Text> : null}
    </SettingsCard>
  );
}

function PromptEditor({
  styles,
  label,
  hint,
  value,
  fallback,
  onChange,
}: {
  styles: Styles;
  label: string;
  hint: string;
  value: string;
  fallback: string;
  onChange(value: string): void;
}) {
  return (
    <SettingsRow label={label} hint={hint}>
      <View style={{ gap: 6, width: "100%" }}>
        <TextInput style={[styles.multiline, { minHeight: 180 }]} value={value} onChangeText={onChange} multiline />
        {value !== fallback ? (
          <Pressable accessibilityRole="button" style={[styles.button, { alignSelf: "flex-start" }]} onPress={() => onChange(fallback)}>
            <Text style={styles.buttonText}>Restore default</Text>
          </Pressable>
        ) : null}
      </View>
    </SettingsRow>
  );
}
