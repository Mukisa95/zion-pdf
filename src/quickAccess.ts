export const QUICK_ACTIONS = [
  { id: "select", label: "Select" },
  { id: "ink", label: "Draw" },
  { id: "freetext", label: "Text" },
  { id: "sign", label: "Sign" },
  { id: "highlight", label: "Highlight" },
  { id: "edit-text", label: "Edit PDF" },
  { id: "ask-ai", label: "Ask AI" },
] as const;
export type QuickAction = typeof QUICK_ACTIONS[number]["id"];
export type QuickPreference = { id: QuickAction; visible: boolean }[];
export const defaultQuickAccess = (): QuickPreference => QUICK_ACTIONS.map(({ id }) => ({ id, visible: ["select", "ink", "freetext", "sign", "edit-text"].includes(id) }));
export function readQuickAccess(): QuickPreference {
  try {
    const data: unknown = JSON.parse(localStorage.getItem("zionpdf:quick-access:v1") || "null");
    if (!Array.isArray(data)) return defaultQuickAccess();
    const defaults = defaultQuickAccess();
    const result: QuickPreference = [];
    for (const item of data) {
      if (item && typeof item.visible === "boolean" && defaults.some(x => x.id === item.id) && !result.some(x => x.id === item.id))
        result.push({ id: item.id, visible: item.visible });
    }
    return [...result, ...defaults.filter(x => !result.some(y => x.id === y.id))];
  } catch { return defaultQuickAccess(); }
}
