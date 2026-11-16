/**
 * The exact evidence_note the API stores on a CHAT-mode reply (services/api ai/chat_facts.py,
 * CHAT_REPLY_NOTE). Such a reply has no evidence_status: it is conversation grounded in the
 * server's fact sheet, never a cited result. A backend test asserts this text stays identical.
 */
export const CHAT_REPLY_NOTE =
  "AI reply, not project evidence. Counts and names come from this project's records.";

/** CHAT_GROUNDED_NOTE (0.0.20): the reply quotes the selected stored project records. */
export const CHAT_GROUNDED_NOTE =
  "AI reply. Values quoted from the selected stored project records are shown with their evidence class; the wording around them is not project evidence.";
