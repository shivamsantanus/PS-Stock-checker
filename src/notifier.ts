import axios from "axios";
import { config } from "./config";
import { logger } from "./logger";
import { StockResult } from "./types";

export function hasAnyChannelConfigured(): boolean {
  return Boolean(config.discordWebhookUrl) || Boolean(config.telegramBotToken && config.telegramChatIds.length > 0);
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

async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  await axios.post(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    },
    { timeout: 10_000 }
  );
}

/**
 * Telegram retires a group's chat id and issues a brand-new one the moment
 * the group is upgraded to a supergroup - which happens automatically as a
 * side effect of enabling an admin-only feature like "only admins can send
 * messages", with no warning to the bot. Every send to the retired id then
 * fails with a 400 whose body carries the replacement id here.
 *
 * This bit us live (2026-08-07): a group was renamed and locked to
 * admin-only posting, silently migrated, and alerts stopped reaching it
 * while the private chat in the same TELEGRAM_CHAT_ID list kept working -
 * looking exactly like a bot permissions problem, which it wasn't.
 */
function migratedChatId(err: any): number | undefined {
  return err?.response?.data?.parameters?.migrate_to_chat_id;
}

/**
 * Fires a message via the Telegram Bot API. Same fire-and-forget philosophy
 * as the Discord path - a stock alert is only useful if it lands fast, and
 * we never want a notification failure to take down the check loop.
 */
async function postToTelegram(text: string): Promise<void> {
  if (!config.telegramBotToken || config.telegramChatIds.length === 0) return;

  // Fan the same message out to every configured chat (e.g. a private chat
  // and a group). One failing chat must not stop delivery to the others, so
  // each send is isolated and its own error is logged independently.
  await Promise.all(
    config.telegramChatIds.map(async (chatId) => {
      try {
        await sendTelegramMessage(chatId, text);
      } catch (err: any) {
        const newChatId = migratedChatId(err);
        if (newChatId !== undefined) {
          // Follow the migration for THIS send so a restock alert still
          // lands rather than being lost to a config change nobody made.
          // The fix is not persisted - a process rewriting its own .env is
          // worse than a loud log - so this warns on every alert until
          // TELEGRAM_CHAT_ID is updated by hand.
          logger.warn(
            `Telegram chat ${chatId} was upgraded to a supergroup - update TELEGRAM_CHAT_ID to ${newChatId} and restart`,
            { oldChatId: chatId, newChatId }
          );
          try {
            await sendTelegramMessage(newChatId, text);
          } catch (retryErr: any) {
            logger.error("Failed to send Telegram notification to migrated chat", {
              chatId: newChatId,
              error: retryErr.message,
              status: retryErr.response?.status,
              body: retryErr.response?.data,
            });
          }
          return;
        }

        logger.error("Failed to send Telegram notification", {
          chatId,
          error: err.message,
          status: err.response?.status,
          body: err.response?.data,
        });
      }
    })
  );
}

export async function notifyBackInStock(result: StockResult): Promise<void> {
  const { target } = result;
  // Prefer the human-facing product page over a raw API endpoint - an alert
  // is for racing to buy, so the link must open something purchasable.
  const linkUrl = target.displayUrl ?? target.url;
  // Opt-in extra context (see Target.detailJsonPath) - e.g. which store an
  // offer is fulfilled from, so the reader can judge how real the stock is.
  // The label defaults to "Source" but a target can override it when the
  // detail is something else entirely (see Target.detailLabel).
  const detailLabel = target.detailLabel ?? "Source";
  const detailLine = target.detailJsonPath && result.detail ? `\n${detailLabel}: ${result.detail}` : "";

  // The dark store this read actually applies to (see Target.detailSelector).
  // A pincode alone cannot be acted on: one pincode can span several stores
  // that disagree about stock, so without this the reader cannot tell whether
  // an alert covers THEIR address or one across the city.
  const storeLine = result.resolvedLocation ? `\n📍 Store: ${result.resolvedLocation}` : "";

  // Downgraded framing when detectPhantomStock (see phantomDetection.ts)
  // flagged this read as a likely Reliance Digital phantom-store offer - the
  // status is still IN_STOCK for state-tracking purposes, but the alert
  // itself must not read as a confident "go buy it now".
  const isSuspectedPhantom = Boolean(result.phantomWarning);
  const emoji = isSuspectedPhantom ? "⚠️" : "🚨";
  const headline = isSuspectedPhantom ? "SUSPECTED STOCK (unconfirmed)" : "IN STOCK";
  const color = isSuspectedPhantom ? 0xe67e22 : 0x2ecc71; // orange vs green
  const phantomLine = result.phantomWarning ? `\n⚠️ ${result.phantomWarning}` : "";

  const discordEmbed = {
    title: target.label,
    url: linkUrl,
    color,
    fields: [
      { name: "Status", value: result.status, inline: true },
      { name: "Checked at", value: result.checkedAt, inline: true },
      ...(target.detailJsonPath && result.detail ? [{ name: detailLabel, value: result.detail, inline: false }] : []),
      ...(result.resolvedLocation ? [{ name: "📍 Store", value: result.resolvedLocation, inline: false }] : []),
      ...(result.phantomWarning ? [{ name: "⚠️ Confidence warning", value: result.phantomWarning, inline: false }] : []),
    ],
  };
  const telegramText = `${emoji} *${headline}* — ${target.label}\n${linkUrl}${detailLine}${storeLine}${phantomLine}\nChecked at: ${result.checkedAt}`;

  await Promise.all([
    postToDiscord(`${emoji} **${headline}** — ${target.label}`, discordEmbed),
    postToTelegram(telegramText),
  ]);

  logger.info(isSuspectedPhantom ? "Sent suspected-phantom-stock alert" : "Sent in-stock alert", {
    targetId: target.id,
  });
}

export async function notifyComingSoon(result: StockResult): Promise<void> {
  const { target } = result;
  const linkUrl = target.displayUrl ?? target.url;

  const discordEmbed = {
    title: target.label,
    url: linkUrl,
    color: 0xf1c40f, // yellow
    fields: [
      { name: "Status", value: result.status, inline: true },
      { name: "Checked at", value: result.checkedAt, inline: true },
    ],
  };
  const telegramText = `👀 *COMING SOON* — ${target.label}\nOpen the app and check manually.\n${linkUrl}\nChecked at: ${result.checkedAt}`;

  await Promise.all([
    postToDiscord(`👀 **COMING SOON** — ${target.label} — open the app and check manually`, discordEmbed),
    postToTelegram(telegramText),
  ]);

  logger.info("Sent coming-soon alert", { targetId: target.id });
}

export async function notifyError(message: string): Promise<void> {
  await Promise.all([
    postToDiscord(`⚠️ Stock checker error: ${message}`),
    postToTelegram(`⚠️ Stock checker error: ${message}`),
  ]);
}
