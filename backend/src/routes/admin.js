import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { createAdminToken, requireAdmin } from "../middleware/auth.js";
import { Source } from "../models/Source.js";
import { crawlManager } from "../services/crawl-manager.js";
import { appendSourceToFile } from "../services/source-sync.js";

const router = Router();

function passwordsMatch(candidate, expected) {
  const first = Buffer.from(String(candidate || ""));
  const second = Buffer.from(String(expected || ""));
  return first.length === second.length && timingSafeEqual(first, second);
}

function validateSource(company, rawUrl) {
  const name = String(company || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new Error("Company name must be 2 to 80 characters.");
  const url = new URL(String(rawUrl || "").trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter a complete public HTTP or HTTPS career URL.");
  }
  return { company: name, url: url.toString() };
}

router.post("/login", (request, response) => {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return response.status(503).json({ error: "ADMIN_PASSWORD is not configured." });
  if (!passwordsMatch(request.body?.password, configured)) {
    return response.status(401).json({ error: "Incorrect password." });
  }
  return response.json({ token: createAdminToken(), expiresIn: 7200 });
});

router.use(requireAdmin);

router.get("/sources", async (_request, response, next) => {
  try {
    response.json({ sources: await Source.find().sort({ company: 1 }) });
  } catch (error) {
    next(error);
  }
});

router.post("/sources", async (request, response, next) => {
  try {
    const source = validateSource(request.body?.company, request.body?.url);
    if (await Source.exists({ url: source.url })) {
      return response.status(409).json({ error: "This career source already exists." });
    }
    const created = await Source.create(source);
    try {
      await appendSourceToFile(source);
    } catch (error) {
      await Source.deleteOne({ _id: created._id });
      throw error;
    }
    return response.status(201).json({ source: created });
  } catch (error) {
    if (error instanceof TypeError) return response.status(400).json({ error: "Enter a valid career URL." });
    if (error.message?.startsWith("Company") || error.message?.startsWith("Enter")) {
      return response.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.post("/crawl", async (_request, response, next) => {
  try {
    const run = await crawlManager.start();
    response.status(202).json({ run });
  } catch (error) {
    if (error.message.includes("already running")) return response.status(409).json({ error: error.message });
    next(error);
  }
});

router.get("/crawl", async (_request, response, next) => {
  try {
    response.json({ run: await crawlManager.status() });
  } catch (error) {
    next(error);
  }
});

export default router;
