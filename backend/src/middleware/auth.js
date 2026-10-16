import jwt from "jsonwebtoken";

function secret() {
  return process.env.ADMIN_SESSION_SECRET || "development-only-change-me";
}

export function createAdminToken() {
  return jwt.sign({ role: "admin" }, secret(), { expiresIn: "2h", issuer: "jobatlas" });
}

export function requireAdmin(request, response, next) {
  const [scheme, token] = (request.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({ error: "Admin authentication is required." });
  }
  try {
    request.admin = jwt.verify(token, secret(), { issuer: "jobatlas" });
    return next();
  } catch {
    return response.status(401).json({ error: "Your admin session has expired." });
  }
}
