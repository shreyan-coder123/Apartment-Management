const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { z } = require("zod");

const { db, nowIso } = require("../db");
const { authenticate } = require("../middleware/auth");
const { createUniqueJoinCode } = require("../utils/joinCode");

const router = express.Router();

const createApartmentSchema = z.object({
  apartmentName: z.string().trim().min(2).max(100),
  apartmentAddress: z.string().trim().max(200).optional().default(""),
  adminName: z.string().trim().min(2).max(80),
});

const joinApartmentSchema = z.object({
  residentName: z.string().trim().min(2).max(80),
  joinCode: z.string().trim().min(6).max(12),
});

const shapeUser = (user) => ({
  userId: user.id,
  name: user.name,
  role: user.role,
  apartmentId: user.apartmentId,
});

const shapeApartment = (apartment) => ({
  apartmentId: apartment.id,
  name: apartment.name,
  address: apartment.address,
  joinCode: apartment.joinCode,
  adminId: apartment.adminId,
});

const normalizeJoinCode = (joinCode) =>
  joinCode.replace(/\s+/g, "").toUpperCase().slice(0, 6);

router.post("/create-apartment", async (req, res, next) => {
  try {
    const payload = createApartmentSchema.parse(req.body);
    const apartmentId = uuidv4();
    const adminId = uuidv4();
    const sessionToken = uuidv4();
    const createdAt = nowIso();

    const joinCode = createUniqueJoinCode((candidate) =>
      Boolean(db.prepare("SELECT 1 FROM apartments WHERE joinCode = ?").get(candidate))
    );

    const createApartmentAndAdmin = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO apartments (id, name, address, joinCode, adminId, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        apartmentId,
        payload.apartmentName,
        payload.apartmentAddress ?? "",
        joinCode,
        adminId,
        createdAt,
        createdAt
      );

      db.prepare(
        `
          INSERT INTO users (id, name, role, apartmentId, authToken, createdAt, updatedAt)
          VALUES (?, ?, 'admin', ?, ?, ?, ?)
        `
      ).run(adminId, payload.adminName, apartmentId, sessionToken, createdAt, createdAt);
    });

    createApartmentAndAdmin();

    const apartment = db.prepare("SELECT * FROM apartments WHERE id = ?").get(apartmentId);
    const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId);

    res.status(201).json({
      token: sessionToken,
      user: shapeUser(admin),
      apartment: shapeApartment(apartment),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/join-apartment", async (req, res, next) => {
  try {
    const payload = joinApartmentSchema.parse(req.body);
    const normalizedJoinCode = normalizeJoinCode(payload.joinCode);
    const apartment = db
      .prepare("SELECT * FROM apartments WHERE joinCode = ?")
      .get(normalizedJoinCode);

    if (!apartment) {
      return res.status(404).json({ error: "Apartment not found for join code" });
    }

    const residentId = uuidv4();
    const sessionToken = uuidv4();
    const createdAt = nowIso();

    db.prepare(
      `
        INSERT INTO users (id, name, role, apartmentId, authToken, createdAt, updatedAt)
        VALUES (?, ?, 'resident', ?, ?, ?, ?)
      `
    ).run(residentId, payload.residentName, apartment.id, sessionToken, createdAt, createdAt);

    const resident = db.prepare("SELECT * FROM users WHERE id = ?").get(residentId);

    const io = req.app.get("io");
    io.to(`apartment:${apartment.id}`).emit("resident:joined", {
      residentId: resident.id,
      residentName: resident.name,
      apartmentId: apartment.id,
      joinedAt: resident.createdAt,
    });

    return res.status(201).json({
      token: sessionToken,
      user: shapeUser(resident),
      apartment: shapeApartment(apartment),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const apartment = db
      .prepare("SELECT * FROM apartments WHERE id = ?")
      .get(req.user.apartmentId);

    if (!apartment) {
      return res.status(404).json({ error: "Apartment not found" });
    }

    return res.json({
      user: shapeUser(req.user),
      apartment: shapeApartment(apartment),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/logout", authenticate, async (req, res, next) => {
  try {
    db.prepare("UPDATE users SET authToken = NULL, updatedAt = ? WHERE id = ?").run(
      nowIso(),
      req.user.id
    );
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

