import { pool, query } from "../db.js";

function isValidId(value) {
  return /^\d+$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

export async function listConversations(request, response, next) {
  try {
    await query(
      `UPDATE message_receipts
       SET delivered_at = NOW()
       FROM messages
       WHERE message_receipts.message_id = messages.id
         AND message_receipts.user_id = $1
         AND message_receipts.delivered_at IS NULL`,
      [request.user.id],
    );
    const result = await query(
      `SELECT conversation.id, conversation.name,
              COALESCE((
                SELECT STRING_AGG(DISTINCT participant.full_name, ', ' ORDER BY participant.full_name)
                FROM conversation_members AS other_members
                JOIN users AS participant ON participant.id = other_members.user_id
                WHERE other_members.conversation_id = conversation.id
                  AND participant.id <> $1
              ), conversation.name, 'Conversation') AS title,
              latest.body AS last_message,
              latest.sent_at AS last_message_at
       FROM conversation_members AS membership
       JOIN conversations AS conversation ON conversation.id = membership.conversation_id
       LEFT JOIN LATERAL (
         SELECT body, sent_at
         FROM messages
         WHERE conversation_id = conversation.id
         ORDER BY sent_at DESC, id DESC
         LIMIT 1
       ) AS latest ON TRUE
       WHERE membership.user_id = $1
       ORDER BY latest.sent_at DESC NULLS LAST, conversation.created_at DESC
       LIMIT 100`,
      [request.user.id],
    );
    response.json({ conversations: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function listContacts(request, response, next) {
  try {
    const result = await query(
      `SELECT id, full_name, role
       FROM users
       WHERE id <> $1 AND is_active = TRUE
       ORDER BY full_name, id
       LIMIT 100`,
      [request.user.id],
    );
    response.json({ contacts: result.rows.map((contact) => ({ ...contact, id: String(contact.id) })) });
  } catch (error) {
    next(error);
  }
}

export async function createConversation(request, response, next) {
  const recipientId = request.body?.recipientId;
  const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";

  if (
    typeof recipientId !== "string" ||
    !isValidId(recipientId) ||
    recipientId === request.user.id ||
    name.length > 100
  ) {
    response.status(400).json({ error: "Choose a valid contact for this conversation." });
    return;
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const recipient = await client.query(
      "SELECT id, full_name FROM users WHERE id = $1 AND is_active = TRUE",
      [recipientId],
    );
    if (!recipient.rowCount) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      response.status(404).json({ error: "That contact is unavailable." });
      return;
    }

    const conversation = await client.query(
      `INSERT INTO conversations (name, created_by)
       VALUES ($1, $2)
       RETURNING id, name`,
      [name, request.user.id],
    );
    const conversationId = conversation.rows[0].id;
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [conversationId, request.user.id, recipientId],
    );
    await client.query("COMMIT");
    transactionStarted = false;

    response.status(201).json({
      conversation: {
        id: String(conversationId),
        name: conversation.rows[0].name,
        title: recipient.rows[0].full_name ?? name,
      },
    });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
}

export async function deleteConversation(request, response, next) {
  const { conversationId } = request.params;
  if (!isValidId(conversationId)) {
    response.status(400).json({ error: "Invalid conversation." });
    return;
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const membership = await client.query(
      `DELETE FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING conversation_id`,
      [conversationId, request.user.id],
    );
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      response.status(404).json({ error: "Conversation not found." });
      return;
    }

    await client.query(
      `DELETE FROM message_receipts
       USING messages
       WHERE message_receipts.message_id = messages.id
         AND messages.conversation_id = $1
         AND message_receipts.user_id = $2`,
      [conversationId, request.user.id],
    );
    await client.query(
      `DELETE FROM conversations
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM conversation_members WHERE conversation_id = $1
         )`,
      [conversationId],
    );
    await client.query("COMMIT");
    transactionStarted = false;
    response.status(204).end();
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
}

export async function listMessages(request, response, next) {
  const { conversationId } = request.params;
  if (!isValidId(conversationId)) {
    response.status(400).json({ error: "Invalid conversation." });
    return;
  }

  try {
    const membership = await query(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, request.user.id],
    );
    if (!membership.rowCount) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }

    await query(
      `INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
       SELECT id, $2, NOW(), NOW()
       FROM messages
       WHERE conversation_id = $1 AND sender_id <> $2
       ON CONFLICT (message_id, user_id)
       DO UPDATE SET delivered_at = COALESCE(message_receipts.delivered_at, NOW()),
                     read_at = NOW()`,
      [conversationId, request.user.id],
    );

    const result = await query(
      `SELECT message.id, message.body, message.message_type, message.media_mime, message.media_data,
              message.media_duration, message.edited_at, message.deleted_at,
              message.sent_at, message.sender_id,
              sender.full_name AS sender_name,
              COUNT(message_receipts.user_id)::int AS recipient_count,
              COUNT(message_receipts.delivered_at)::int AS delivered_count,
              COUNT(message_receipts.read_at)::int AS read_count
       FROM messages AS message
       JOIN users AS sender ON sender.id = message.sender_id
       LEFT JOIN message_receipts ON message_receipts.message_id = message.id
       WHERE message.conversation_id = $1
       GROUP BY message.id, sender.full_name
       ORDER BY message.sent_at ASC, message.id ASC
       LIMIT 500`,
      [conversationId],
    );
    response.json({ messages: result.rows.map((message) => ({ ...message, id: String(message.id), sender_id: String(message.sender_id) })) });
  } catch (error) {
    next(error);
  }
}

export async function editMessage(request, response, next) {
  const { conversationId, messageId } = request.params;
  const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
  if (!isValidId(conversationId) || !isValidId(messageId) || !body || body.length > 4000) {
    response.status(400).json({ error: "Messages must contain between 1 and 4,000 characters." });
    return;
  }

  try {
    const result = await query(
      `UPDATE messages
       SET body = $3, edited_at = NOW()
       WHERE id = $1 AND conversation_id = $2 AND sender_id = $4
         AND message_type = 'text' AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM conversation_members
           WHERE conversation_id = $2 AND user_id = $4
         )
       RETURNING id, body, edited_at`,
      [messageId, conversationId, body, request.user.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Message not found or it can no longer be edited." });
      return;
    }
    response.json({ message: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}

export async function deleteMessage(request, response, next) {
  const { conversationId, messageId } = request.params;
  if (!isValidId(conversationId) || !isValidId(messageId)) {
    response.status(400).json({ error: "Invalid message." });
    return;
  }

  try {
    const result = await query(
      `UPDATE messages
       SET body = 'This message was deleted.',
           message_type = 'text',
           media_mime = NULL,
           media_data = NULL,
           media_duration = NULL,
           deleted_at = NOW()
       WHERE id = $1 AND conversation_id = $2 AND sender_id = $3
         AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM conversation_members
           WHERE conversation_id = $2 AND user_id = $3
         )
       RETURNING id, body, deleted_at`,
      [messageId, conversationId, request.user.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Message not found or it has already been deleted." });
      return;
    }
    response.json({ message: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(request, response, next) {
  const { conversationId } = request.params;
  const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
  const voiceNote = request.body?.voiceNote;
  const isVoiceNote = voiceNote !== undefined;
  const allowedVoiceMimeTypes = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"]);
  const voiceMatch = isVoiceNote && typeof voiceNote?.fileData === "string"
    ? /^data:(audio\/(?:webm|ogg|mp4|mpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(voiceNote.fileData)
    : null;
  const voiceBytes = voiceMatch ? Buffer.from(voiceMatch[2], "base64") : null;
  const validVoiceNote = !isVoiceNote || (
    typeof voiceNote?.mimeType === "string" &&
    allowedVoiceMimeTypes.has(voiceNote.mimeType) &&
    voiceMatch?.[1] === voiceNote.mimeType &&
    voiceBytes?.length > 0 &&
    voiceBytes.length <= 5 * 1024 * 1024 &&
    voiceBytes.toString("base64") === voiceMatch[2] &&
    Number.isInteger(voiceNote.duration) &&
    voiceNote.duration > 0 &&
    voiceNote.duration <= 120
  );
  if (
    !isValidId(conversationId) ||
    (isVoiceNote ? !validVoiceNote : !body || body.length > 4000)
  ) {
    response.status(400).json({
      error: isVoiceNote
        ? "Voice notes must use a supported audio format, be up to 5 MB, and be no longer than 2 minutes."
        : "Messages must contain between 1 and 4,000 characters.",
    });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO messages
         (conversation_id, sender_id, body, message_type, media_mime, media_data, media_duration)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE EXISTS (
         SELECT 1 FROM conversation_members
         WHERE conversation_id = $1 AND user_id = $2
       )
       RETURNING id, body, message_type, media_mime, media_duration,
                 edited_at, deleted_at, sent_at, sender_id`,
      [
        conversationId,
        request.user.id,
        isVoiceNote ? "[Voice note]" : body,
        isVoiceNote ? "voice_note" : "text",
        isVoiceNote ? voiceNote.mimeType : null,
        isVoiceNote ? voiceNote.fileData : null,
        isVoiceNote ? voiceNote.duration : null,
      ],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }
    await query(
      `INSERT INTO message_receipts (message_id, user_id)
       SELECT $1, user_id
       FROM conversation_members
       WHERE conversation_id = $2 AND user_id <> $3
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [result.rows[0].id, conversationId, request.user.id],
    );
    const receiptSummary = await query(
      "SELECT COUNT(*)::int AS recipient_count FROM message_receipts WHERE message_id = $1",
      [result.rows[0].id],
    );
    response.status(201).json({
      message: {
        ...result.rows[0],
        id: String(result.rows[0].id),
        sender_id: String(result.rows[0].sender_id),
        sender_name: request.user.fullName,
        recipient_count: receiptSummary.rows[0].recipient_count,
        delivered_count: 0,
        read_count: 0,
      },
    });
  } catch (error) {
    next(error);
  }
}

function isValidMediaData(mediaData, mimeType) {
  if (typeof mediaData !== "string" || mediaData.length > 11_200_000) return false;
  const match = /^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(mediaData);
  if (!match || match[1] !== mimeType) return false;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== match[2]) return false;
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (mimeType === "video/webm") return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return bytes.length > 12 && bytes.subarray(4, 8).toString() === "ftyp";
}

export async function listChatMedia(request, response, next) {
  try {
    await query("DELETE FROM chat_media WHERE media_type = 'story' AND expires_at <= NOW()");
    const result = await query(
      `SELECT chat_media.id, chat_media.media_type, chat_media.mime_type,
              chat_media.title, chat_media.created_at,
              chat_media.expires_at, users.id AS user_id, users.full_name AS user_name
       FROM chat_media
       JOIN users ON users.id = chat_media.user_id
       WHERE chat_media.media_type = 'reel'
          OR chat_media.expires_at > NOW()
       ORDER BY chat_media.created_at DESC
       LIMIT 100`,
    );
    response.json({
      items: result.rows.map((item) => ({
        id: String(item.id),
        type: item.media_type,
        mimeType: item.mime_type,
        title: item.title,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        userId: String(item.user_id),
        userName: item.user_name,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function getChatMedia(request, response, next) {
  const { mediaId } = request.params;
  if (!isValidId(mediaId)) {
    response.status(400).json({ error: "Invalid media item." });
    return;
  }
  try {
    const result = await query(
      `SELECT chat_media.id, chat_media.media_type, chat_media.mime_type,
              chat_media.title, chat_media.media_data, chat_media.created_at,
              chat_media.expires_at, users.id AS user_id, users.full_name AS user_name
       FROM chat_media
       JOIN users ON users.id = chat_media.user_id
       WHERE chat_media.id = $1
         AND (chat_media.media_type = 'reel' OR chat_media.expires_at > NOW())`,
      [mediaId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "This story or reel is no longer available." });
      return;
    }
    const item = result.rows[0];
    response.json({
      item: {
        id: String(item.id),
        type: item.media_type,
        mimeType: item.mime_type,
        title: item.title,
        mediaData: item.media_data,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        userId: String(item.user_id),
        userName: item.user_name,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createChatMedia(request, response, next) {
  const { type, mimeType, title = "", mediaData } = request.body ?? {};
  const isVideo = typeof mimeType === "string" && mimeType.startsWith("video/");
  if (
    !["story", "reel"].includes(type) ||
    (type === "reel" && !isVideo) ||
    typeof title !== "string" || title.length > 160 ||
    !isValidMediaData(mediaData, mimeType)
  ) {
    response.status(400).json({ error: "Upload a supported image or video file up to 8 MB; reels must be videos." });
    return;
  }
  try {
    const result = await query(
      `INSERT INTO chat_media (user_id, media_type, mime_type, title, media_data, expires_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $2 = 'story' THEN NOW() + INTERVAL '24 hours' ELSE NULL END)
       RETURNING id, media_type, mime_type, title, created_at, expires_at`,
      [request.user.id, type, mimeType, title.trim(), mediaData],
    );
    const item = result.rows[0];
    response.status(201).json({
      item: {
        id: String(item.id),
        type: item.media_type,
        mimeType: item.mime_type,
        title: item.title,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        userId: request.user.id,
        userName: request.user.fullName,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createCall(request, response, next) {
  const { conversationId } = request.params;
  const { type } = request.body ?? {};
  if (!isValidId(conversationId) || !["audio", "video"].includes(type)) {
    response.status(400).json({ error: "Choose a valid conversation and call type." });
    return;
  }
  try {
    const members = await query(
      `SELECT user_id FROM conversation_members
       WHERE conversation_id = $1
         AND user_id <> $2
         AND EXISTS (
           SELECT 1 FROM conversation_members AS caller_membership
           WHERE caller_membership.conversation_id = $1
             AND caller_membership.user_id = $2
         )`,
      [conversationId, request.user.id],
    );
    if (!members.rowCount) {
      response.status(404).json({ error: "Conversation not found." });
      return;
    }
    if (members.rowCount !== 1) {
      response.status(400).json({ error: "Calls are currently available in one-to-one conversations only." });
      return;
    }
    const result = await query(
      `INSERT INTO calls (conversation_id, caller_id, recipient_id, call_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id, caller_id, recipient_id, call_type, status`,
      [conversationId, request.user.id, members.rows[0].user_id, type],
    );
    response.status(201).json({ call: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}

export async function listCalls(request, response, next) {
  if (!isValidId(request.params.conversationId)) {
    response.status(400).json({ error: "Invalid conversation." });
    return;
  }
  try {
    const result = await query(
      `SELECT calls.id, calls.conversation_id, calls.caller_id, calls.recipient_id,
              calls.call_type, calls.status, caller.full_name AS caller_name
       FROM calls
       JOIN users AS caller ON caller.id = calls.caller_id
       WHERE calls.conversation_id = $1
         AND (calls.caller_id = $2 OR calls.recipient_id = $2)
         AND calls.status IN ('ringing', 'active')
         AND calls.created_at > NOW() - INTERVAL '1 hour'
       ORDER BY calls.created_at DESC
       LIMIT 10`,
      [request.params.conversationId, request.user.id],
    );
    response.json({ calls: result.rows.map((call) => ({ ...call, id: String(call.id) })) });
  } catch (error) {
    next(error);
  }
}

export async function listMyCalls(request, response, next) {
  try {
    const result = await query(
      `SELECT calls.id, calls.conversation_id, calls.caller_id, calls.recipient_id,
              calls.call_type, calls.status, caller.full_name AS caller_name,
              conversation.name AS conversation_name,
              other_member.full_name AS recipient_name
       FROM calls
       JOIN conversations AS conversation ON conversation.id = calls.conversation_id
       JOIN users AS caller ON caller.id = calls.caller_id
       LEFT JOIN conversation_members AS other_members
         ON other_members.conversation_id = calls.conversation_id
        AND other_members.user_id <> $1
       LEFT JOIN users AS other_member ON other_member.id = other_members.user_id
       WHERE (calls.caller_id = $1 OR calls.recipient_id = $1)
         AND calls.status IN ('ringing', 'active')
         AND calls.created_at > NOW() - INTERVAL '1 hour'
       ORDER BY calls.created_at DESC
       LIMIT 10`,
      [request.user.id],
    );
    response.json({
      calls: result.rows.map((call) => ({
        ...call,
        id: String(call.id),
        conversation_id: String(call.conversation_id),
        caller_id: String(call.caller_id),
        recipient_id: String(call.recipient_id),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateCall(request, response, next) {
  const { callId } = request.params;
  const { status } = request.body ?? {};
  if (!isValidId(callId) || !["active", "declined", "ended"].includes(status)) {
    response.status(400).json({ error: "Provide a valid call and call status." });
    return;
  }
  try {
    const result = await query(
      `UPDATE calls SET status = $1, updated_at = NOW()
       WHERE id = $2
         AND (
           ($1 IN ('active', 'declined') AND recipient_id = $3)
           OR ($1 = 'ended' AND (caller_id = $3 OR recipient_id = $3))
         )
         AND status IN ('ringing', 'active')
       RETURNING id, status`,
      [status, callId, request.user.id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Call not found or no longer active." });
      return;
    }
    if (status !== "active") {
      await query("DELETE FROM call_signals WHERE call_id = $1", [callId]);
    }
    response.json({ call: { id: String(result.rows[0].id), status: result.rows[0].status } });
  } catch (error) {
    next(error);
  }
}

export async function listCallSignals(request, response, next) {
  const { callId } = request.params;
  const after = request.query.after || "0";
  if (!isValidId(callId) || !isValidId(after)) {
    response.status(400).json({ error: "Invalid call signal cursor." });
    return;
  }
  try {
    const result = await query(
      `SELECT call_signals.id, call_signals.signal_type, call_signals.payload,
              call_signals.sender_id
       FROM call_signals
       JOIN calls ON calls.id = call_signals.call_id
       WHERE call_signals.call_id = $1
         AND call_signals.recipient_id = $2
         AND call_signals.id > $3
       ORDER BY call_signals.id
       LIMIT 100`,
      [callId, request.user.id, after],
    );
    response.json({
      signals: result.rows.map((signal) => ({
        ...signal,
        id: String(signal.id),
        sender_id: String(signal.sender_id),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createCallSignal(request, response, next) {
  const { callId } = request.params;
  const { type, payload } = request.body ?? {};
  if (
    !isValidId(callId) ||
    !["offer", "answer", "ice-candidate"].includes(type) ||
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    Buffer.byteLength(JSON.stringify(payload)) > 100_000
  ) {
    response.status(400).json({ error: "Provide a valid call signal." });
    return;
  }
  try {
    const result = await query(
      `INSERT INTO call_signals (call_id, sender_id, recipient_id, signal_type, payload)
       SELECT calls.id, $2,
              CASE WHEN calls.caller_id = $2 THEN calls.recipient_id ELSE calls.caller_id END,
              $3, $4::jsonb
       FROM calls
       WHERE calls.id = $1
         AND (calls.caller_id = $2 OR calls.recipient_id = $2)
         AND calls.status IN ('ringing', 'active')
         AND (
           ($3 = 'offer' AND calls.caller_id = $2)
           OR ($3 = 'answer' AND calls.recipient_id = $2)
           OR $3 = 'ice-candidate'
         )
       RETURNING id`,
      [callId, request.user.id, type, JSON.stringify(payload)],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Call not found or no longer active." });
      return;
    }
    response.status(201).json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}
