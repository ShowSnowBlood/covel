export const FROSTFOX_LEVEL_WORLD_IDS = [
  "mistport",
  "haruka-academy",
  "emberback",
] as const;

export const FROSTFOX_LEVEL_COUNT = FROSTFOX_LEVEL_WORLD_IDS.length;

export function frostFoxLevelForWorld(worldId: string): number | null {
  const index = FROSTFOX_LEVEL_WORLD_IDS.indexOf(
    worldId as (typeof FROSTFOX_LEVEL_WORLD_IDS)[number],
  );
  return index < 0 ? null : index + 1;
}
