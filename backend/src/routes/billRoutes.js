const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");

const { db, nowIso } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

const createBillSchema = z.object({
  residentId: z.string().uuid(),
  type: z.string().trim().min(2).max(40),
  amount: z.coerce.number().positive(),
  dueDate: z.coerce.date(),
  notes: z.string().trim().max(300).optional().default(""),
  paymentPhone: z.string().trim().max(30).optional().default(""),
  qrCode: z.string().trim().max(2000).optional().default(""),
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const payload = createBillSchema.parse(req.body);

    const resident = db
      .prepare(
        `
          SELECT id, role
          FROM users
          WHERE id = ? AND apartmentId = ? AND role = 'resident'
        `
      )
      .get(payload.residentId, req.user.apartmentId);

    if (!resident) {
      return res.status(404).json({ error: "Resident not found in apartment" });
    }

    const billId = uuidv4();
    const createdAt = nowIso();

    db.prepare(
      `
        INSERT INTO bills (
          id, apartmentId, residentId, type, amount, dueDate, notes, paymentPhone, qrCode, status, createdAt, updatedAt, paidAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, NULL)
      `
    ).run(
      billId,
      req.user.apartmentId,
      payload.residentId,
      payload.type,
      payload.amount,
      payload.dueDate.toISOString(),
      payload.notes,
      payload.paymentPhone,
      payload.qrCode,
      createdAt,
      createdAt
    );

    const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId);

    const io = req.app.get("io");
    io.to(`user:${payload.residentId}`).emit("bill:new", bill);
    io.to(`apartment:${req.user.apartmentId}`).emit("bill:created", {
      billId: bill.id,
      residentId: payload.residentId,
      status: bill.status,
      createdAt: bill.createdAt,
    });

    return res.status(201).json({ bill });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const query =
      req.user.role === "admin"
        ? {
            sql: "SELECT * FROM bills WHERE apartmentId = ? ORDER BY dueDate ASC, createdAt DESC",
            params: [req.user.apartmentId],
          }
        : {
            sql: `
              SELECT * FROM bills
              WHERE apartmentId = ? AND residentId = ?
              ORDER BY dueDate ASC, createdAt DESC
            `,
            params: [req.user.apartmentId, req.user.id],
          };

    const bills = db.prepare(query.sql).all(...query.params);
    return res.json({ bills });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:billId/mark-paid", requireRole("resident"), async (req, res, next) => {
  try {
    const paidAt = nowIso();
    const result = db.prepare(
      `
        UPDATE bills
        SET status = 'paid', paidAt = ?, updatedAt = ?
        WHERE id = ? AND apartmentId = ? AND residentId = ? AND status = 'unpaid'
      `
    ).run(paidAt, paidAt, req.params.billId, req.user.apartmentId, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Unpaid bill not found" });
    }

    const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(req.params.billId);

    const io = req.app.get("io");
    io.to(`user:${req.user.id}`).emit("bill:updated", bill);
    io.to(`apartment:${req.user.apartmentId}`).emit("bill:status-updated", {
      billId: bill.id,
      residentId: req.user.id,
      status: bill.status,
      paidAt: bill.paidAt,
    });

    return res.json({ bill });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

