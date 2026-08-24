import {
  REPUTATION_MIN,
  clampReputation,
  reputationTier,
} from "../tier-metadata.js";

const HISTORY_LIMIT = 10;
const MAX_CHANGES_PER_TURN = 5;
const MAX_DELTA = 20;

export default function makeUpdateFactionReputation({
  tool,
  z,
  shortIdBatch,
  withPendingProposals,
  store,
}) {
  const changeSchema = z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Canonical named faction as it appears in the narrative"),
    delta: z
      .number()
      .int()
      .min(-MAX_DELTA)
      .max(MAX_DELTA)
      .refine((value) => value !== 0, "delta must not be zero")
      .describe("Reputation change this turn: -20..-1 or 1..20"),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe("One concrete player-facing sentence in the session language"),
  });

  return tool({
    name: "update-faction-reputation",
    description:
      "Batch-apply this turn's player-to-faction reputation changes. Names are de-duplicated case-insensitively; scores accumulate and clamp to [-100, 100]; standing metadata is derived automatically.",
    parameters: z.object({
      changes: z
        .array(changeSchema)
        .min(1)
        .max(MAX_CHANGES_PER_TURN)
        .describe("Named faction reputation changes for this turn, maximum 5"),
    }),
    execute: async (params, context) => {
      const now = new Date().toISOString();
      const turn = context.turnNumber ?? -1;
      const committedRows =
        (await store.listPluginData(
          context.sessionId,
          context.pluginId,
          "reputation",
        )) ?? [];

      const recordByName = new Map();
      const indexRow = (row) => {
        const value = row.value ?? {};
        if (typeof value.name !== "string" || value.name.length === 0) return;
        recordByName.set(value.name.toLocaleLowerCase(), {
          key: row.key,
          value,
        });
      };
      for (const row of committedRows) indexRow(row);
      for (const row of collectPendingRows(context.pendingProposals, context)) {
        indexRow(row);
      }

      const newNames = [];
      const seenNewNames = new Set();
      for (const change of params.changes) {
        const lookup = change.name.toLocaleLowerCase();
        if (!recordByName.has(lookup) && !seenNewNames.has(lookup)) {
          seenNewNames.add(lookup);
          newNames.push(change.name);
        }
      }
      const assignedIds =
        newNames.length > 0
          ? shortIdBatch("faction", newNames, context.sessionId)
          : [];
      const newNameToId = new Map();
      for (let index = 0; index < newNames.length; index += 1) {
        newNameToId.set(
          newNames[index].toLocaleLowerCase(),
          assignedIds[index],
        );
      }

      const writes = new Map();
      const results = [];
      const messageChanges = [];

      for (const change of params.changes) {
        const lookup = change.name.toLocaleLowerCase();
        const existing = recordByName.get(lookup);
        const key = existing?.key ?? newNameToId.get(lookup);
        if (!key) continue;

        const prior = existing?.value ?? {
          id: key,
          name: change.name,
          score: 0,
        };
        const priorScore =
          typeof prior.score === "number" && Number.isFinite(prior.score)
            ? prior.score
            : 0;
        const score = clampReputation(priorScore + change.delta);
        const standing = reputationTier(score);
        const history = Array.isArray(prior.history) ? prior.history : [];
        const deltaText = formatDelta(change.delta);
        const deltaColor = change.delta < 0 ? "red" : "green";
        const value = {
          ...prior,
          id: prior.id ?? key,
          name: prior.name,
          score,
          scoreBar: score - REPUTATION_MIN,
          standing: standing.id,
          standingLabel: standing.label,
          standingColor: standing.color,
          lastDelta: deltaText,
          lastDeltaColor: deltaColor,
          lastReason: change.reason,
          history: [
            ...history,
            { turn, delta: change.delta, reason: change.reason },
          ].slice(-HISTORY_LIMIT),
          updatedAt: now,
        };

        writes.set(key, value);
        recordByName.set(lookup, { key, value });
        results.push({
          id: key,
          name: value.name,
          score,
          standing: standing.id,
          status: existing ? "updated" : "created",
        });
        messageChanges.push({
          id: key,
          name: value.name,
          deltaText,
          deltaColor,
          score,
          standingLabel: standing.label,
          standingColor: standing.color,
          reason: change.reason,
        });
      }

      const items = [...writes].map(([key, value]) => ({
        namespace: "reputation",
        key,
        value,
      }));
      items.push(
        {
          namespace: "message",
          key: "__turnId",
          value: context.turnId,
        },
        {
          namespace: "message",
          key: "changes",
          value: messageChanges,
        },
      );

      const proposal = {
        id: crypto.randomUUID(),
        type: "plugin.data.batch",
        source: {
          pluginId: context.pluginId,
          runtimeId: context.runtimeId,
        },
        turnId: context.turnId,
        sessionId: context.sessionId,
        payload: { items },
        timestamp: now,
      };

      return withPendingProposals({ applied: results.length, results }, [
        proposal,
      ]);
    },
  });
}

function collectPendingRows(pendingProposals, context) {
  if (!Array.isArray(pendingProposals)) return [];

  const rows = [];
  for (const proposal of pendingProposals) {
    if (!proposal || proposal.sessionId !== context.sessionId) continue;
    if (proposal.source?.pluginId !== context.pluginId) continue;

    if (
      proposal.type === "plugin.data" &&
      proposal.payload?.namespace === "reputation"
    ) {
      rows.push({
        key: proposal.payload.key,
        value: proposal.payload.value,
      });
      continue;
    }

    if (proposal.type === "plugin.data.batch") {
      for (const item of proposal.payload?.items ?? []) {
        if (item.namespace === "reputation") {
          rows.push({ key: item.key, value: item.value });
        }
      }
    }
  }
  return rows;
}

function formatDelta(delta) {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
