import type { CustomAgentProfileConfig } from "./pet-roster";

/**
 * Where an effective setting actually came from.
 *
 * Section 18.4 asks settings to show effective policy and its inheritance
 * (`Organization -> User -> Project -> Agent/Team -> Run override`). Only some
 * of those layers carry policy in this product today: an organization exists,
 * but it governs spend, not agent capability; a project exists, but it carries
 * no policy at all.
 *
 * Rendering all five layers regardless would show a hierarchy the runtime does
 * not have -- the same class of claim as a hardcoded AUTHORIZED badge. So a
 * layer that cannot contribute is reported as `not-configurable`, with the
 * reason, rather than drawn as an empty row that implies someone could fill it.
 */

export type PolicyLayerId =
  | "product"
  | "organization"
  | "user"
  | "project"
  | "agent"
  | "run";

export type PolicyLayerState =
  /** This layer set the effective value. */
  | "source"
  /** This layer exists and could set it, but did not. */
  | "inherits"
  /** This layer cannot carry this setting in this product. */
  | "not-configurable";

export type PolicyLayer = {
  id: PolicyLayerId;
  label: string;
  state: PolicyLayerState;
  /** What this layer contributed, when it contributed something. */
  value?: string;
  /** Why the layer is unavailable, shown instead of an empty row. */
  reason?: string;
};

export type EffectivePolicySetting = {
  key: string;
  label: string;
  /** The value that will actually apply. */
  effectiveValue: string;
  /** Which layer decided it. */
  decidedBy: PolicyLayerId;
  chain: PolicyLayer[];
};

const ORG_NOT_CONFIGURABLE: PolicyLayer = {
  id: "organization",
  label: "Organization",
  state: "not-configurable",
  // Stated rather than implied: an organization does exist here, so silence
  // would read as "nobody has set this yet".
  reason: "Organizations govern spend and membership, not agent capability.",
};

const PROJECT_NOT_CONFIGURABLE: PolicyLayer = {
  id: "project",
  label: "Project",
  state: "not-configurable",
  reason: "Projects scope files and history; they carry no policy.",
};

const RUN_NOT_CONFIGURABLE: PolicyLayer = {
  id: "run",
  label: "Run override",
  state: "not-configurable",
  reason: "A run inherits its agent's policy and cannot widen it.",
};

/**
 * Resolves how each policy setting got its effective value.
 *
 * `agent` is optional: the settings page shows the account-wide defaults with
 * no agent selected, and the same chain narrowed by an agent when one is.
 */
export function resolveEffectivePolicy({
  agent,
  userGuardrailOverrides,
  productGuardrailDefaults,
}: {
  agent?: Pick<
    CustomAgentProfileConfig,
    "name" | "permissionPreset" | "concurrencyLimit" | "approvalPolicy"
  >;
  /** Guardrail ids the user explicitly turned on or off. */
  userGuardrailOverrides: ReadonlyMap<string, boolean>;
  productGuardrailDefaults: ReadonlyArray<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
}): EffectivePolicySetting[] {
  const settings: EffectivePolicySetting[] = [];

  // --- Filesystem / permission ceiling -------------------------------------
  settings.push({
    key: "permission",
    label: "Permission ceiling",
    effectiveValue: agent
      ? agent.permissionPreset === "read-only"
        ? "Read only"
        : agent.permissionPreset === "trusted"
          ? "Trusted workspace"
          : "Workspace write"
      : "Workspace write",
    decidedBy: agent ? "agent" : "product",
    chain: [
      {
        id: "product",
        label: "Product default",
        state: agent ? "inherits" : "source",
        value: "Workspace write",
      },
      ORG_NOT_CONFIGURABLE,
      {
        id: "user",
        label: "User",
        state: "not-configurable",
        reason: "Set per agent rather than account-wide.",
      },
      PROJECT_NOT_CONFIGURABLE,
      agent
        ? {
            id: "agent",
            label: `Agent · ${agent.name}`,
            state: "source",
            value:
              agent.permissionPreset === "read-only"
                ? "Read only"
                : agent.permissionPreset === "trusted"
                  ? "Trusted workspace"
                  : "Workspace write",
          }
        : {
            id: "agent",
            label: "Agent",
            state: "inherits",
            reason: "Select an agent to see how it narrows this.",
          },
      RUN_NOT_CONFIGURABLE,
    ],
  });

  // --- Concurrency ---------------------------------------------------------
  if (agent) {
    settings.push({
      key: "concurrency",
      label: "Concurrency",
      effectiveValue:
        agent.concurrencyLimit > 0
          ? `${agent.concurrencyLimit} parallel ${agent.concurrencyLimit === 1 ? "task" : "tasks"}`
          : "Unlimited",
      decidedBy: "agent",
      chain: [
        {
          id: "product",
          label: "Product default",
          state: "inherits",
          value: "Unlimited",
        },
        ORG_NOT_CONFIGURABLE,
        {
          id: "user",
          label: "User",
          state: "not-configurable",
          reason: "Set per agent rather than account-wide.",
        },
        PROJECT_NOT_CONFIGURABLE,
        {
          id: "agent",
          label: `Agent · ${agent.name}`,
          state: "source",
          value: `${agent.concurrencyLimit}`,
        },
        RUN_NOT_CONFIGURABLE,
      ],
    });
  }

  // --- Command guardrails --------------------------------------------------
  for (const guardrail of productGuardrailDefaults) {
    const override = userGuardrailOverrides.get(guardrail.id);
    const userSet = override !== undefined;
    const effective = userSet ? override : guardrail.enabled;

    settings.push({
      key: `guardrail:${guardrail.id}`,
      label: guardrail.name,
      effectiveValue: effective ? "Blocked" : "Allowed",
      decidedBy: userSet ? "user" : "product",
      chain: [
        {
          id: "product",
          label: "Product default",
          state: userSet ? "inherits" : "source",
          value: guardrail.enabled ? "Blocked" : "Allowed",
        },
        ORG_NOT_CONFIGURABLE,
        {
          id: "user",
          label: "User",
          state: userSet ? "source" : "inherits",
          value: userSet ? (override ? "Blocked" : "Allowed") : undefined,
        },
        PROJECT_NOT_CONFIGURABLE,
        {
          id: "agent",
          label: "Agent",
          state: "not-configurable",
          reason: "Guardrails apply to every agent and cannot be relaxed per agent.",
        },
        RUN_NOT_CONFIGURABLE,
      ],
    });
  }

  return settings;
}

/** The layers that can actually carry policy, for a legend or summary. */
export function configurableLayers(
  settings: readonly EffectivePolicySetting[],
): PolicyLayerId[] {
  const ids = new Set<PolicyLayerId>();
  for (const setting of settings) {
    for (const layer of setting.chain) {
      if (layer.state !== "not-configurable") ids.add(layer.id);
    }
  }
  return [...ids];
}
