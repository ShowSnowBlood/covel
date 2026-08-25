export interface RuntimeBindingTargetLike {
  qualifiedId: string;
  defaultSlot: string;
}

export interface RuntimeBindingSlotLike {
  slotId: string;
  tag?: string;
}

/**
 * Keep only bindings for runtimes that still exist in the current UI model.
 * Empty-string values are preserved so an explicitly unbound runtime can stay unbound.
 */
export function filterRuntimeBindingsForKnownRuntimes(
  bindings: Record<string, string>,
  knownRuntimeIds: Iterable<string>,
): Record<string, string> {
  const knownIds = new Set(knownRuntimeIds);
  return Object.fromEntries(
    Object.entries(bindings).filter(([qualifiedId]) =>
      knownIds.has(qualifiedId),
    ),
  );
}

/**
 * Fill every currently unbound agent runtime with the best text-model slot.
 * Existing non-empty bindings are preserved.
 *
 * Matching priority (per runtime):
 * 0. Direct name match: slot whose slotId === runtime.defaultSlot.
 * 1. `default` binds to the configured default/first text slot.
 * 2. A missing declared slot (commonly `plugin`) transparently falls back to
 *    the first configured text slot, matching the AI gateway's resolution.
 */
export function autoAssignRuntimeBindings(
  bindings: Record<string, string>,
  targets: readonly RuntimeBindingTargetLike[],
  slots: readonly RuntimeBindingSlotLike[],
): Record<string, string> {
  if (slots.length === 0) return { ...bindings };

  const next = { ...bindings };
  const firstTextSlot =
    slots.find((slot) => slot.tag === "text") ??
    slots.find((slot) => slot.tag === undefined);
  const defaultSlot =
    slots.find((slot) => slot.slotId === "default") ?? firstTextSlot;
  for (const target of targets) {
    if (next[target.qualifiedId]) continue;

    let chosen: RuntimeBindingSlotLike | undefined;

    // 0. Direct name match: `model: plugin` selects `[covel.plugin]`.
    chosen = slots.find((s) => s.slotId === target.defaultSlot);

    // 1. `default` is a virtual slot name used by some plugins to mean
    //    "the deployment's default text model". It does not require a literal
    //    [covel.default] block.
    if (!chosen && target.defaultSlot === "default") {
      chosen = defaultSlot;
    }

    // 2. Agent runtimes generate text. If their preferred role slot is not
    //    configured, use the deployment's first text slot rather than making
    //    every plugin require a duplicate [covel.plugin] declaration.
    if (!chosen) {
      chosen = firstTextSlot;
    }

    if (chosen) {
      next[target.qualifiedId] = chosen.slotId;
    }
  }

  return next;
}
