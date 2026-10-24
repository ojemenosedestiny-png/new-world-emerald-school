import type { AttendanceStatus } from "@workspace/api-client-react";

/** Shared by the staff register and the student view. */
export const STATUS_LABELS: Record<AttendanceStatus, { label: string; short: string; hue: string }> = {
  present: { label: "Present", short: "P", hue: "152 55% 36%" },
  late: { label: "Late", short: "L", hue: "41 80% 42%" },
  absent: { label: "Absent", short: "A", hue: "4 66% 46%" },
  excused: { label: "Excused", short: "E", hue: "212 75% 48%" },
};
