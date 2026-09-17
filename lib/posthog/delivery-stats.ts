/** Aggregate loss counters only; never include destination, credential or user data. */
const counters = {
  droppedLogRecords: 0,
  rejectedLogRecords: 0,
  retiredAnalyticsClients: 0,
  rejectedAnalyticsEvents: 0,
};
export function recordTelemetryLoss(
  kind: keyof typeof counters,
  count = 1,
): void {
  counters[kind] = Math.min(Number.MAX_SAFE_INTEGER, counters[kind] + count);
}
export function getTelemetryDeliveryStats(): Readonly<typeof counters> {
  return { ...counters };
}
