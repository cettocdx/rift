import { createTriggerConfig } from "./trigger.shared";

if (
  process.env.NODE_ENV !== "production" ||
  process.env.RIFT_TRIGGER_CANARY !== "staging"
) {
  throw new Error(
    "Use scripts/trigger-staging-canary.cjs --hack for the staging-canary config.",
  );
}

export default createTriggerConfig({
  project: "proj_tzdasuzvmzpcjmlcafvs",
  dirs: ["./trigger-hack-canary"],
  enableConsoleLogging: false,
});
