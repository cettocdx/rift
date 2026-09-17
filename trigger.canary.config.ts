import { createTriggerConfig } from "./trigger.shared";

// Use the launcher so CLI env-file loading and inherited application variables
// cannot silently restore the ordinary development/production bindings.
if (
  process.env.NODE_ENV !== "production" ||
  process.env.RIFT_TRIGGER_CANARY !== "staging"
) {
  throw new Error(
    "Use scripts/trigger-staging-canary.cjs for the staging-canary config.",
  );
}

export default createTriggerConfig({
  project: "proj_tzdasuzvmzpcjmlcafvs",
  dirs: ["./trigger-canary"],
  enableConsoleLogging: false,
});
