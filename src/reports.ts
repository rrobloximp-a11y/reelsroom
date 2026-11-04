// Reasons a viewer can pick when reporting a video. Shared by the browser and the API.
export const REPORT_REASONS = [
  { id: "sexual", label: "Sexual or nude content" },
  { id: "violent", label: "Violent or graphic content" },
  { id: "hate", label: "Hateful or abusive content" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "dangerous", label: "Dangerous or harmful acts" },
  { id: "spam", label: "Spam, scam or misleading" },
  { id: "child", label: "Puts children at risk" },
  { id: "copyright", label: "Stolen or copyrighted content" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];
export const reportLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
