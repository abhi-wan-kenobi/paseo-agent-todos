import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import type { Styles } from "./styles";

export interface ProjectOption {
  name: string;
  path: string;
}

/** Paseo's registered projects, so a todo can launch where its code is committed. */
export function useProjects(): ProjectOption[] {
  const paseo = usePaseo();
  const projects = useQuery({
    queryKey: ["agent-todos", "projects"],
    queryFn: () => paseo.projects.list(),
    staleTime: 60_000,
  });
  return (projects.data?.projects ?? [])
    .map((project) => ({ name: project.projectCustomName || project.projectDisplayName, path: project.projectRootPath }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Short project label for a directory; unregistered directories show their last path segment. */
export function projectName(projects: ProjectOption[], path: string): string {
  return projects.find((project) => project.path === path)?.name ?? path.split("/").filter(Boolean).at(-1) ?? path;
}

export function ProjectPicker({
  theme,
  styles,
  value,
  fallbackLabel,
  onChange,
}: {
  theme: PluginTheme;
  styles: Styles;
  /** Selected directory; null means "use the preset's directory". */
  value: string | null;
  fallbackLabel: string;
  onChange(path: string | null): void;
}) {
  const projects = useProjects();
  const options: { key: string; label: string; path: string | null }[] = [
    { key: "preset", label: fallbackLabel, path: null },
    ...projects.map((project) => ({ key: project.path, label: project.name, path: project.path })),
  ];
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.path === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.path ? `Project ${option.label}, ${option.path}` : option.label}
            style={selected ? styles.tabActive : styles.tab}
            onPress={() => onChange(option.path)}
          >
            <View style={[styles.row, { gap: 4 }]}>
              {selected ? <Icon name="FolderGit2" size={12} color={theme.colors.accent} /> : null}
              <Text style={selected ? styles.text : styles.muted}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
