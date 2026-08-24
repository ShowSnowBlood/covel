export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;

export const REPUTATION_TIERS = [
  {
    id: "hostile",
    max: -60,
    label: { zh: "敌对", en: "Hostile" },
    color: "red",
  },
  {
    id: "distrusted",
    max: -20,
    label: { zh: "戒备", en: "Distrusted" },
    color: "amber",
  },
  {
    id: "neutral",
    max: 19,
    label: { zh: "中立", en: "Neutral" },
    color: "blue",
  },
  {
    id: "respected",
    max: 59,
    label: { zh: "尊重", en: "Respected" },
    color: "green",
  },
  {
    id: "allied",
    max: 84,
    label: { zh: "盟友", en: "Allied" },
    color: "cyan",
  },
  {
    id: "revered",
    max: REPUTATION_MAX,
    label: { zh: "崇敬", en: "Revered" },
    color: "purple",
  },
];

export function clampReputation(score) {
  return Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, score));
}

export function reputationTier(score) {
  return (
    REPUTATION_TIERS.find((tier) => score <= tier.max) ??
    REPUTATION_TIERS.at(-1)
  );
}
