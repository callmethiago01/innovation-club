import { Router } from "express";
import {
  createConversation,
  createCall,
  createCallSignal,
  createChatMedia,
  deleteMessage,
  deleteConversation,
  editMessage,
  getChatMedia,
  listCallSignals,
  listCalls,
  listChatMedia,
  listMyCalls,
  listContacts,
  listConversations,
  listMessages,
  sendMessage,
  updateCall,
} from "../controllers/messages.controller.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.use(authenticateToken);
router.get("/", listConversations);
router.get("/contacts", listContacts);
router.post("/", createConversation);
router.get("/media", listChatMedia);
router.post("/media", createChatMedia);
router.get("/media/:mediaId", getChatMedia);
router.get("/calls", listMyCalls);
router.get("/calls/:callId/signals", listCallSignals);
router.post("/calls/:callId/signals", createCallSignal);
router.patch("/calls/:callId", updateCall);
router.get("/:conversationId/calls", listCalls);
router.post("/:conversationId/calls", createCall);
router.delete("/:conversationId", deleteConversation);
router.patch("/:conversationId/:messageId", editMessage);
router.delete("/:conversationId/:messageId", deleteMessage);
router.get("/:conversationId", listMessages);
router.post("/:conversationId", sendMessage);

export default router;
