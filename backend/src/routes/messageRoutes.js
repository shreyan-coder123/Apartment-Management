const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");

const { db, nowIso } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

const sendMessageSchema = z.object({
  recipientId: z.string().uuid(),
  content: z.string().trim().min(1).max(500),
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const payload = sendMessageSchema.parse(req.body);
    const recipient = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE id = ? AND apartmentId = ? AND role = 'resident'
        `
      )
      .get(payload.recipientId, req.user.apartmentId);

    if (!recipient) {
      return res.status(404).json({ error: "Resident not found in apartment" });
    }

    const messageId = uuidv4();
    const createdAt = nowIso();

    db.prepare(
      `
        INSERT INTO messages (id, apartmentId, senderId, recipientId, content, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      messageId,
      req.user.apartmentId,
      req.user.id,
      payload.recipientId,
      payload.content,
      createdAt,
      createdAt
    );

    const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
    const io = req.app.get("io");
    io.to(`user:${payload.recipientId}`).emit("message:new", message);

    return res.status(201).json({ message });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const query =
      req.user.role === "admin"
        ? {
            sql: `
              SELECT * FROM messages
              WHERE apartmentId = ? AND senderId = ?
              ORDER BY createdAt DESC
            `,
            params: [req.user.apartmentId, req.user.id],
          }
        : {
            sql: `
              SELECT * FROM messages
              WHERE apartmentId = ? AND recipientId = ?
              ORDER BY createdAt DESC
            `,
            params: [req.user.apartmentId, req.user.id],
          };

    const messages = db.prepare(query.sql).all(...query.params);
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

