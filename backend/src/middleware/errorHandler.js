const { ZodError } = require("zod");

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({ error: "Duplicate record conflict" });
  }

  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
};

module.exports = { errorHandler };

