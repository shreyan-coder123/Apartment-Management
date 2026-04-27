const express = require("express");
const { db } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireRole("admin"), async (req, res, next) => {
  try {
    const residents = db
      .prepare(
        `
          SELECT id, name, role, apartmentId, createdAt
          FROM users
          WHERE apartmentId = ? AND role = 'resident'
          ORDER BY createdAt DESC
        `
      )
      .all(req.user.apartmentId);

    return res.json({
      residents: residents.map((resident) => ({
        userId: resident.id,
        name: resident.name,
        role: resident.role,
        apartmentId: resident.apartmentId,
        joinedAt: resident.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

