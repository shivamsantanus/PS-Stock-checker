import axios from "axios";
import { config } from "./config";
import { logger } from "./logger";
import { StockResult } from "./types";

/**
 * Fires a Discord webhook message. Kept deliberately dumb - one HTTP POST,
 * no retries/queueing - because a stock alert only matters if it's fast,
 * and Discord webhooks are reliable enough for this use case.
 */
async function postToDiscord(content: string, embed?: Record<string, unknown>): Promise<void> {
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

export async function notifyBackInStock(result: StockResult): Promise<void> {
  const { target } = result;
  await postToDiscord(`🚨 **IN STOCK** — ${target.label}`, {
    title: target.label,
    url: target.url,
    color: 0x2ecc71, // green
    fields: [
      { name: "Status", value: result.status, inline: true },
      { name: "Checked at", value: result.checkedAt, inline: true },
    ],
  });
  logger.info("Sent in-stock alert", { targetId: target.id });
}

export async function notifyError(message: string): Promise<void> {
  await postToDiscord(`⚠️ Stock checker error: ${message}`);
}
