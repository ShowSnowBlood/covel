import { request } from "./request.js";

export interface FrostFoxAccountView {
  readonly id: string;
  readonly name: string;
  readonly balance: number;
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
    silentErrors,
  });
}

export async function fetchFrostFoxModels(
  silentErrors = false,
): Promise<FrostFoxModelCatalog> {
  return request<FrostFoxModelCatalog>("/api/frostfox/models", {
    silentErrors,
  });
}
export async function fetchFrostFoxProgression(
  silentErrors = false,
): Promise<FrostFoxProgressionStatus> {
  return request<FrostFoxProgressionStatus>("/api/frostfox/progression", {
    silentErrors,
  });
}

export async function completeFrostFoxLevel(
  worldId: string,
): Promise<FrostFoxProgressionStatus> {
  return request<FrostFoxProgressionStatus>(
    "/api/frostfox/progression/complete",
    {
      method: "POST",
      body: JSON.stringify({ worldId }),
    },
  );
}

export async function signOutFrostFox(): Promise<void> {
  await request<void>("/api/frostfox/logout", { method: "POST" });
}

export async function disconnectFrostFox(): Promise<void> {
  await request<void>("/api/frostfox/account", { method: "DELETE" });
}
