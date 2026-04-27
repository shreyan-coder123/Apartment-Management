require("dotenv").config();

const cors = require("cors");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { db } = require("./db");
const { authenticate, extractBearerToken } = require("./middleware/auth");
const { errorHandler } = require("./middleware/errorHandler");
const authRoutes = require("./routes/authRoutes");
const billRoutes = require("./routes/billRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const messageRoutes = require("./routes/messageRoutes");
const residentRoutes = require("./routes/residentRoutes");

const app = express();
const server = http.createServer(app);

const configuredOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowedOrigins = [...new Set([...defaultOrigins, ...configuredOrigins])];

const isPrivateNetworkHost = (hostname) =>
  /^192\.168\./.test(hostname) ||
  /^10\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

const isOriginAllowed = (origin) => {
  if (!origin || allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.port === "5173" && isPrivateNetworkHost(parsed.hostname);
  } catch {
    return false;
  }
};

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin blocked by CORS policy"));
    },
    methods: ["GET", "POST", "PATCH"],
  },
});

io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      extractBearerToken(socket.handshake.headers.authorization);

    if (!token) {
      return next(new Error("Unauthorized"));
    }

    const user = db
      .prepare(
        "SELECT id, name, role, apartmentId, authToken, createdAt, updatedAt FROM users WHERE authToken = ?"
      )
      .get(token);

    if (!user) {
      return next(new Error("Invalid session"));
    }

    socket.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
});

io.on("connection", (socket) => {
  socket.join(`apartment:${socket.user.apartmentId}`);
  socket.join(`user:${socket.user.id}`);

  socket.emit("connected", {
    userId: socket.user.id,
    apartmentId: socket.user.apartmentId,
    role: socket.user.role,
  });
});

app.set("io", io);
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin blocked by CORS policy"));
    },
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => {
  const apartmentCount = db.prepare("SELECT COUNT(*) AS count FROM apartments").get().count || 0;
  res.json({
    ok: true,
    engine: "sqlite",
    apartments: apartmentCount,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", authenticate, dashboardRoutes);
app.use("/api/residents", authenticate, residentRoutes);
app.use("/api/bills", authenticate, billRoutes);
app.use("/api/messages", authenticate, messageRoutes);
app.use(errorHandler);

const port = Number(process.env.PORT || 4000);

server.listen(port, "0.0.0.0", () => {
  console.log(`Backend running at http://localhost:${port}`);
});
