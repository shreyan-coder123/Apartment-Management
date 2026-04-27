const { db } = require("../db");

const extractBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token.trim();
};

const authenticate = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = db
      .prepare(
        "SELECT id, name, role, apartmentId, authToken, createdAt, updatedAt FROM users WHERE authToken = ?"
      )
      .get(token);

    if (!user) {
      return res.status(401).json({ error: "Invalid session" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return next();
};

module.exports = { authenticate, requireRole, extractBearerToken };
