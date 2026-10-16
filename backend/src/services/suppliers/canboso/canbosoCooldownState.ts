import { settingsService } from "../../settings/SettingsService";

export const CANBOSO_COOLDOWN_UNTIL_MS_KEY = "CANBOSO_COOLDOWN_UNTIL_MS";
export const CANBOSO_AUTH_PAUSED_UNTIL_MS_KEY = "CANBOSO_AUTH_PAUSED_UNTIL_MS";

/** After 401/403 — pause background refreshes (invalid-auth limit is 5/min per key). */
export const CANBOSO_AUTH_PAUSE_MS = 10 * 60 * 1000;

let blockedUntilTimestamp = 0;
let authPausedUntilTimestamp = 0;
let currentPenaltyLevel = 0;

export function getCanbosoBlockedUntilMs(): number {
  return blockedUntilTimestamp;
}

export function getCanbosoAuthPausedUntilMs(): number {
  return authPausedUntilTimestamp;
}

export function getCanbosoPenaltyLevel(): number {
  return currentPenaltyLevel;
}

export function isCanbosoCooldownActive(now = Date.now()): boolean {
  return now < blockedUntilTimestamp || now < authPausedUntilTimestamp;
}

export function isCanbosoApiRefreshAllowed(now = Date.now()): boolean {
  return now >= blockedUntilTimestamp && now >= authPausedUntilTimestamp;
}

export async function hydrateCanbosoCooldownFromSettings(): Promise<void> {
  const now = Date.now();
  const [cooldownRaw, authRaw] = await Promise.all([
    settingsService.getSetting(CANBOSO_COOLDOWN_UNTIL_MS_KEY),
    settingsService.getSetting(CANBOSO_AUTH_PAUSED_UNTIL_MS_KEY),
  ]);
  const cooldown = cooldownRaw ? Number(cooldownRaw) : 0;
  const authPause = authRaw ? Number(authRaw) : 0;
  if (Number.isFinite(cooldown) && cooldown > now) {
    blockedUntilTimestamp = Math.max(blockedUntilTimestamp, cooldown);
  }
  if (Number.isFinite(authPause) && authPause > now) {
    authPausedUntilTimestamp = Math.max(authPausedUntilTimestamp, authPause);
  }
}

export async function applyCanbosoRateLimitCooldown(
  retryAfterSeconds: number,
  penaltyLevel?: number,
): Promise<void> {
  if (penaltyLevel != null && Number.isFinite(penaltyLevel)) {
    currentPenaltyLevel = penaltyLevel;
  }
  const until = Date.now() + retryAfterSeconds * 1000 + 2000;
  blockedUntilTimestamp = Math.max(blockedUntilTimestamp, until);
  try {
    await settingsService.setSetting(
      CANBOSO_COOLDOWN_UNTIL_MS_KEY,
      String(blockedUntilTimestamp),
    );
  } catch (err) {
    console.warn("[Canboso] Failed to persist cooldown to settings:", err);
  }
}

export async function applyCanbosoAuthFailurePause(reason: string): Promise<void> {
  const until = Date.now() + CANBOSO_AUTH_PAUSE_MS;
  authPausedUntilTimestamp = Math.max(authPausedUntilTimestamp, until);
  try {
    await settingsService.setSetting(
      CANBOSO_AUTH_PAUSED_UNTIL_MS_KEY,
      String(authPausedUntilTimestamp),
    );
  } catch (err) {
    console.warn("[Canboso] Failed to persist auth pause to settings:", err);
  }
  console.error(
    `[CanbosoAdapter] Auth rejected — pausing API refreshes for ${CANBOSO_AUTH_PAUSE_MS / 60000} min (${reason}).`,
  );
}

export function clearCanbosoCooldownForTests(): void {
  blockedUntilTimestamp = 0;
  authPausedUntilTimestamp = 0;
  currentPenaltyLevel = 0;
}
