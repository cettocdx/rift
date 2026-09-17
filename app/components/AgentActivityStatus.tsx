export function AgentActivityStatus({ isLive }: { isLive: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={isLive ? "Agent run in progress" : "Agent ready"}
      className="sr-only"
    >
      {isLive ? "Agent run in progress" : "Agent ready"}
    </span>
  );
}
