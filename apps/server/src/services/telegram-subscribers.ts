import { pool } from "../db/index.js";

export async function listTelegramReportChatIds(): Promise<string[]> {
  const result = await pool.query<{ chat_id: string }>(
    `SELECT chat_id FROM telegram_report_subscribers ORDER BY first_seen_at ASC`
  );
  return result.rows.map((row) => row.chat_id);
}

export async function upsertTelegramReportSubscriber(input: {
  chatId: string;
  telegramUserId: string | null;
  username: string | null;
  displayName: string | null;
}) {
  await pool.query(
    `
    INSERT INTO telegram_report_subscribers (chat_id, telegram_user_id, username, display_name, last_seen_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      telegram_user_id = COALESCE(EXCLUDED.telegram_user_id, telegram_report_subscribers.telegram_user_id),
      username = COALESCE(EXCLUDED.username, telegram_report_subscribers.username),
      display_name = COALESCE(EXCLUDED.display_name, telegram_report_subscribers.display_name),
      last_seen_at = NOW()
    `,
    [input.chatId, input.telegramUserId, input.username, input.displayName]
  );
}

export async function getTelegramPollLastUpdateId(): Promise<number> {
  const result = await pool.query<{ last_update_id: string }>(
    `SELECT last_update_id FROM telegram_bot_poll_state WHERE id = 1 LIMIT 1`
  );
  if (result.rowCount === 0) {
    return 0;
  }
  return Number(result.rows[0]?.last_update_id ?? 0);
}

export async function setTelegramPollLastUpdateId(lastUpdateId: number) {
  await pool.query(
    `
    INSERT INTO telegram_bot_poll_state (id, last_update_id, updated_at)
    VALUES (1, $1, NOW())
    ON CONFLICT (id) DO UPDATE SET
      last_update_id = EXCLUDED.last_update_id,
      updated_at = NOW()
    `,
    [lastUpdateId]
  );
}
