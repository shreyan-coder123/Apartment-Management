const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateJoinCode = (length = 6) => {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * JOIN_CODE_CHARS.length);
    code += JOIN_CODE_CHARS[randomIndex];
  }

  return code;
};

const createUniqueJoinCode = (isTakenFn) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = generateJoinCode();
    const exists = isTakenFn(candidate);

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate unique join code");
};

module.exports = { createUniqueJoinCode };
