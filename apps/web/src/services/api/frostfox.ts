import { request } from "./request.js";
import type { ModelCapabilityInfo } from "./llm.js";
export const FROSTFOX_RECENT_UNLOCK_STORAGE_KEY =
  "covel:frostfox:recent-unlock";
const FROSTFOX_REQUEST_OPTIONS = {
  cache: "no-store",
  credentials: "same-origin",
} as const;

export interface FrostFoxAccountView {
  readonly id: string;
  readonly name: string;
  readonly balance: number;
  readonly isAdmin?: boolean;
  readonly credentialState: "active" | "recovery_required";
  readonly lastVerifiedAt: string;
}

export interface FrostFoxAccountStatus {
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly clientId?: string;
  readonly routerBaseUrl?: string;
  readonly account?: FrostFoxAccountView;
}

export interface FrostFoxManagedModel {
  readonly id: string;
  readonly name: string;
  readonly capability: ModelCapabilityInfo;
}

export interface FrostFoxManagedChannel {
  readonly channelKey: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly protocol: "openai-chat-v1";
  readonly baseUrl: string;
  readonly models: readonly FrostFoxManagedModel[];
  readonly error?: string;
}

export interface FrostFoxModelCatalog {
  readonly configurationVersion: string;
  readonly channels: readonly FrostFoxManagedChannel[];
}
export interface FrostFoxModelScheduleEntry {
  readonly channelKey: string;
  readonly modelId: string;
}

export interface FrostFoxModelSchedule {
  readonly story: readonly FrostFoxModelScheduleEntry[];
  readonly updatedAt: string | null;
  readonly canEdit?: boolean;
}

export interface FrostFoxProgressionStatus {
  readonly completedLevel: number;
  readonly unlockedLevel: number;
  readonly totalLevels: number;
  readonly updatedAt: string | null;
}
export async function fetchFrostFoxAccount(
  silentErrors = false,
): Promise<FrostFoxAccountStatus> {
  return request<FrostFoxAccountStatus>("/api/frostfox/account", {
    ...FROSTFOX_REQUEST_OPTIONS,
    silentErrors,
  });
}

export async function fetchFrostFoxModels(
  silentErrors = false,
): Promise<FrostFoxModelCatalog> {
  return request<FrostFoxModelCatalog>("/api/frostfox/models", {
    ...FROSTFOX_REQUEST_OPTIONS,
    silentErrors,
  });
}

export async function fetchFrostFoxModelSchedule(
  silentErrors = false,
): Promise<FrostFoxModelSchedule> {
  return request<FrostFoxModelSchedule>("/api/frostfox/model-schedule", {
    ...FROSTFOX_REQUEST_OPTIONS,
    silentErrors,
  });
}

export async function saveFrostFoxModelSchedule(
  story: readonly FrostFoxModelScheduleEntry[],
): Promise<FrostFoxModelSchedule> {
  return request<FrostFoxModelSchedule>("/api/frostfox/model-schedule", {
    ...FROSTFOX_REQUEST_OPTIONS,
    method: "PUT",
    body: JSON.stringify({ story }),
  });
}
export async function fetchFrostFoxProgression(
  silentErrors = false,
): Promise<FrostFoxProgressionStatus> {
  return request<FrostFoxProgressionStatus>("/api/frostfox/progression", {
    ...FROSTFOX_REQUEST_OPTIONS,
    silentErrors,
  });
}

export async function completeFrostFoxLevel(
  worldId: string,
): Promise<FrostFoxProgressionStatus> {
  return request<FrostFoxProgressionStatus>(
    "/api/frostfox/progression/complete",
    {
      ...FROSTFOX_REQUEST_OPTIONS,
      method: "POST",
      body: JSON.stringify({ worldId }),
    },
  );
}

export async function signOutFrostFox(): Promise<void> {
  await request<void>("/api/frostfox/logout", {
    ...FROSTFOX_REQUEST_OPTIONS,
    method: "POST",
  });
}

export async function disconnectFrostFox(): Promise<void> {
  await request<void>("/api/frostfox/account", {
    ...FROSTFOX_REQUEST_OPTIONS,
    method: "DELETE",
  });
}
