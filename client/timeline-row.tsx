import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { TimelineRow } from "../shared/contracts";

const HEADLINE: Record<TimelineRow["status"], string> = {
  done: "Todo delivered",
  partial: "Delivered, but subtasks are still open",
  blocked: "Todo blocked",
  waiting: "Subtasks updated",
};

export function TodoStatusRow({ theme, item }: PluginTimelineItemProps<TimelineRow>) {
  const { title, status, note, google, subtaskChanges = [] } = item.data;
  const color =
    status === "done" ? theme.colors.statusSuccess : status === "waiting" ? theme.colors.foregroundMuted : theme.colors.statusWarning;
  const headline = `${HEADLINE[status]}: ${title}${status === "done" && google ? " · marked done in Google Tasks" : ""}`;
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-start",
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Icon name={status === "done" ? "CircleCheck" : status === "waiting" ? "ListTree" : "CircleAlert"} size={16} color={color} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{headline}</Text>
        {subtaskChanges.map((change) => (
          <Text key={change} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {change}
          </Text>
        ))}
        {note ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{note}</Text> : null}
      </View>
    </View>
  );
}
