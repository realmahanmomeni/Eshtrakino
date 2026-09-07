import { settingsService, FORCE_JOIN_ENABLED, FORCE_JOIN_CHANNEL_ID, FORCE_JOIN_INVITE_LINK, FORCE_JOIN_TEXT } from "../settings/SettingsService";
import type { Context, Api } from "grammy";
import { isAdminTelegramId } from "../../config/env";

export class ForceJoinService {
  async shouldBlockUser(ctx: Context): Promise<boolean> {
     if (!ctx.from) return false;
     if (isAdminTelegramId(ctx.from.id)) return false;

     const enabled = await settingsService.getBoolSetting(FORCE_JOIN_ENABLED, false);
     if (!enabled) return false;

     const channelId = await settingsService.getSetting(FORCE_JOIN_CHANNEL_ID);
     if (!channelId) return false;

     return !(await this.isMember(ctx.api, channelId, ctx.from.id));
  }

  async isMember(api: Api, channelId: string, userId: number): Promise<boolean> {
      try {
          const member = await api.getChatMember(channelId, userId);
          return ["creator", "administrator", "member", "restricted"].includes(member.status);
      } catch (err) {
          console.warn(`[ForceJoinService] Failed to check membership for ${userId} in ${channelId}:`, err);
          return true; // Bypass blocking if bot lacks rights or channel invalid
      }
  }

  async getForceJoinText(): Promise<string> {
    const text = await settingsService.getSetting(FORCE_JOIN_TEXT);
    return text || "⚠️ برای استفاده از ربات، ابتدا باید در کانال ما عضو شوید.";
  }

  async getInviteLink(): Promise<string | null> {
    return await settingsService.getSetting(FORCE_JOIN_INVITE_LINK);
  }
}

export const forceJoinService = new ForceJoinService();
