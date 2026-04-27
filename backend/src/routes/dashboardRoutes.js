const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const apartment = db
      .prepare("SELECT * FROM apartments WHERE id = ?")
      .get(req.user.apartmentId);

    if (!apartment) {
      return res.status(404).json({ error: "Apartment not found" });
    }

    if (req.user.role === "admin") {
      const totalResidents =
        db
          .prepare("SELECT COUNT(*) AS count FROM users WHERE apartmentId = ? AND role = 'resident'")
          .get(req.user.apartmentId).count || 0;
      const totalBills =
        db
          .prepare("SELECT COUNT(*) AS count FROM bills WHERE apartmentId = ?")
          .get(req.user.apartmentId).count || 0;
      const paidBills =
        db
          .prepare("SELECT COUNT(*) AS count FROM bills WHERE apartmentId = ? AND status = 'paid'")
          .get(req.user.apartmentId).count || 0;
      const unpaidBills =
        db
          .prepare("SELECT COUNT(*) AS count FROM bills WHERE apartmentId = ? AND status = 'unpaid'")
          .get(req.user.apartmentId).count || 0;

      return res.json({
        apartment: {
          apartmentId: apartment.id,
          name: apartment.name,
          address: apartment.address,
          joinCode: apartment.joinCode,
          adminId: apartment.adminId,
        },
        summary: {
          totalResidents,
          totalBills,
          paidBills,
          unpaidBills,
        },
      });
    }

    const pendingBills =
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM bills WHERE apartmentId = ? AND residentId = ? AND status = 'unpaid'"
        )
        .get(req.user.apartmentId, req.user.id).count || 0;
    const paidBills =
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM bills WHERE apartmentId = ? AND residentId = ? AND status = 'paid'"
        )
        .get(req.user.apartmentId, req.user.id).count || 0;
    const totalMessages =
      db
        .prepare("SELECT COUNT(*) AS count FROM messages WHERE apartmentId = ? AND recipientId = ?")
        .get(req.user.apartmentId, req.user.id).count || 0;

    return res.json({
      apartment: {
        apartmentId: apartment.id,
        name: apartment.name,
        address: apartment.address,
        joinCode: apartment.joinCode,
        adminId: apartment.adminId,
      },
      summary: {
        pendingBills,
        paidBills,
        totalMessages,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

