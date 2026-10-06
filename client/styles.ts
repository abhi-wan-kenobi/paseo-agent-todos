import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { RunStatus } from "../shared/contracts";

type ViewKey = "screen" | "content" | "row" | "card" | "button" | "primary" | "chip" | "tab" | "tabActive" | "option" | "optionActive";
type TextKey = "title" | "heading" | "text" | "muted" | "danger" | "input" | "multiline" | "buttonText" | "primaryText";

export type Styles = Record<ViewKey, ViewStyle> & Record<TextKey, TextStyle>;

export function useStyles(theme: PluginTheme, compact: boolean): Styles {
  return useMemo((): Styles => {
    const { colors } = theme;
    const text: TextStyle = { color: colors.foreground, fontSize: 14 };
    const muted: TextStyle = { color: colors.foregroundMuted, fontSize: 12 };
    const button: ViewStyle = {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.surface2,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    };
    const input: TextStyle = {
      color: colors.foreground,
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
    };
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 } satisfies ViewStyle,
      content: { padding: compact ? 16 : 24, gap: compact ? 12 : 16, maxWidth: 960, width: "100%", alignSelf: "center" } satisfies ViewStyle,
      row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies ViewStyle,
      title: { color: colors.foreground, fontSize: compact ? 20 : 24, fontWeight: "600" } satisfies TextStyle,
      heading: { color: colors.foreground, fontSize: 16, fontWeight: "600" } satisfies TextStyle,
      text,
      muted,
      danger: { ...muted, color: colors.statusDanger } satisfies TextStyle,
      card: {
        backgroundColor: colors.surface1,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: compact ? 12 : 14,
        gap: 8,
      } satisfies ViewStyle,
      input,
      multiline: { ...input, minHeight: 72, textAlignVertical: "top" } satisfies TextStyle,
      button,
      buttonText: { color: colors.foreground, fontSize: 13 } satisfies TextStyle,
      primary: { ...button, backgroundColor: colors.accent, borderColor: colors.accent } satisfies ViewStyle,
      primaryText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" } satisfies TextStyle,
      chip: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      } satisfies ViewStyle,
      tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 } satisfies ViewStyle,
      tabActive: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface2 } satisfies ViewStyle,
      option: { ...button, justifyContent: "space-between" } satisfies ViewStyle,
      optionActive: { ...button, justifyContent: "space-between", borderColor: colors.accent } satisfies ViewStyle,
    };
  }, [theme, compact]);
}

export function runStatusColor(theme: PluginTheme, status: RunStatus): string {
  switch (status) {
    case "done":
      return theme.colors.statusSuccess;
    case "blocked":
    case "waiting":
    case "partial":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Agent working",
  waiting: "Waiting for you",
  blocked: "Blocked",
  partial: "Delivered, subtasks open",
  done: "Delivered",
  failed: "Failed",
  archived: "Agent archived",
};

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
