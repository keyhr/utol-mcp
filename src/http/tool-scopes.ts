export interface ToolGroup {
  id: string;
  label: string;
  description: string;
  tools: string[];
  defaultOn: boolean;
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "read",
    label: "読み取り",
    description: "講義一覧・課題・シラバス・お知らせ等の閲覧",
    tools: [
      "auth_status",
      "list_courses",
      "get_course",
      "list_assignments",
      "get_assignment",
      "get_syllabus",
      "search_courses",
      "list_announcements",
      "list_updates",
      "list_messages",
      "refresh_cache",
    ],
    defaultOn: true,
  },
  {
    id: "download",
    label: "ダウンロード",
    description: "教材ファイルのダウンロード",
    tools: ["download_material"],
    defaultOn: true,
  },
  {
    id: "write",
    label: "書き込み",
    description: "課題提出状況の変更・受講登録/解除（要注意）",
    tools: ["set_task_no_submission", "register_course", "unregister_course"],
    defaultOn: false,
  },
];

export function scopePrefix(toolName: string): string {
  return `tool:${toolName}`;
}

export function toolsFromScopes(scopes: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const s of scopes) {
    if (s.startsWith("tool:")) {
      allowed.add(s.slice(5));
    }
  }
  return allowed;
}

export function allToolNames(): string[] {
  return TOOL_GROUPS.flatMap((g) => g.tools);
}
