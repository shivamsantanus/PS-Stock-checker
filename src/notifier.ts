import axios from "axios";
import { config } from "./config";
import { logger } from "./logger";
import { StockResult } from "./types";

export function hasAnyChannelConfigured(): boolean {
  return Boolean(config.discordWebhookUrl) || Boolean(config.telegramBotToken && config.telegramChatId);
}

/**
 * Fires a Discord webhook message. Kept deliberately dumb - one HTTP POST,
 * no retries/queueing - because a stock alert only matters if it's fast,
 * and Discord webhooks are reliable enough for this use case.
 */
async function postToDiscord(content: string, embed?: Record<string, unknown>): Promise<void> {
  if (!config.discordWebhookUrl) return;

  try {
    await axios.post(
      config.discordWebhookUrl,
      {
        content,
        embeds: embed ? [embed] : undefined,
      },
      { timeout: 10_000 }
    );
  } catch (err: any) {
    // Never let a failed notification crash the check loop.
    logger.error("Failed to send Discord notification", {
      error: err.message,
      status: err.response?.status,
    });
  }
}

/**
 * Fires a message via the Telegram Bot API. Same fire-and-forget philosophy
 * as the Discord path - a stock alert is only useful if it lands fast, and
 * we never want a notification failure to take down the check loop.
 */
async function postToTelegram(text: string): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  try {
    await axios.post(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        chat_id: config.telegramChatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
      },
      { timeout: 10_000 }
    );
  } catch (err: any) {
    logger.error("Failed to send Telegram notification", {
      error: err.message,
      status: err.response?.status,
      body: err.response?.data,
    });
  }
}

export async function notifyBackInStock(result: StockResult): Promise<void> {
  const { target } = result;

  const discordEmbed = {
    title: target.label,
    url: target.url,
    color: 0x2ecc71, // green
    fields: [
      { name: "Status", value: result.status, inline: true },
      { name: "Checked at", value: result.checkedAt, inline: true },
    ],
  };
  const telegramText = `🚨 *IN STOCK* — ${target.label}\n${target.url}\nChecked at: ${result.checkedAt}`;

  await Promise.all([
    postToDiscord(`🚨 **IN STOCK** — ${target.label}`, discordEmbed),
    postToTelegram(telegramText),
  ]);

  logger.info("Sent in-stock alert", { targetId: target.id });
}

export async function notifyError(message: string): Promise<void> {
  await Promise.all([
    postToDiscord(`⚠️ Stock checker error: ${message}`),
    postToTelegram(`⚠️ Stock checker error: ${message}`),
  ]);
}
