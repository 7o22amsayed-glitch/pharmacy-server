const jwt = require("jsonwebtoken");

function generateToken(id, role) {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES || "3d", // Changed from 5h to 3d for 3 days
  });
}

module.exports = generateToken;
