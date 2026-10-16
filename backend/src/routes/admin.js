import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { createAdminToken, requireAdmin } from "../middleware/auth.js";
import { Job } from "../models/Job.js";
import { Source } from "../models/Source.js";
import { crawlManager } from "../services/crawl-manager.js";
import { appendSourceToFile, appendSourcesToFile, removeSourceFromFile, removeSourcesFromFile } from "../services/source-sync.js";
import * as XLSX from "xlsx";

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

function sourceCompanyKey(value) {
  const key = String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const aliases = {
    "amazon india": "amazon",
    "capgemini engineering": "capgemini",
    "sharechat moj": "sharechat",
    "l and t technology services": "larsen and toubro l and t",
  };
  return aliases[key] || key;
}

export function parseSourceUpload({ fileName, data }) {
  if (typeof fileName !== "string" || !/\.(csv|xlsx?|xlsm)$/i.test(fileName)) {
    throw new Error("Upload a .csv or Excel workbook (.xls, .xlsx, or .xlsm).");
  }
  if (typeof data !== "string" || data.length > 3_800_000) {
    throw new Error("The file is missing or exceeds the 2.8 MB upload limit.");
  }
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length || buffer.length > 2_800_000) throw new Error("The file is empty or exceeds the 2.8 MB upload limit.");
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch {
    throw new Error("We couldn't read that file. Use a valid CSV or Excel workbook.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The spreadsheet has no worksheets.");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  if (!rows.length) throw new Error("The first worksheet has no data rows.");
  const normalized = (key) => String(key).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = Object.keys(rows[0]);
  const companyHeader = headers.find((key) => ["company", "companyname", "name"].includes(normalized(key)));
  const urlHeader = headers.find((key) => ["url", "link", "careerurl", "careerpage", "sourceurl", "careersite"].includes(normalized(key)));
  if (!companyHeader || !urlHeader) throw new Error("Add column headers named Company and Link (or URL) to the first row.");
  return rows.map((row, index) => {
    if (!String(row[companyHeader]).trim() && !String(row[urlHeader]).trim()) return null;
    try {
      return { source: validateSource(row[companyHeader], row[urlHeader]), rowNumber: index + 2 };
    } catch (error) {
      return { error: error.message, rowNumber: index + 2 };
    }
  }).filter(Boolean);
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

router.post("/sources/prune-without-jobs", async (_request, response, next) => {
  try {
    const [jobCompanies, sources] = await Promise.all([
      Job.distinct("companyName"),
      Source.find().select({ _id: 1, company: 1, url: 1 }).lean(),
    ]);
    if (!jobCompanies.length) {
      return response.status(503).json({ error: "No job companies were found; no sources were removed." });
    }
    const companiesWithJobs = new Set(jobCompanies.map(sourceCompanyKey));
    const sourcesToRemove = sources.filter((source) => !companiesWithJobs.has(sourceCompanyKey(source.company)));
    if (!sourcesToRemove.length) {
      return response.json({ removedSources: 0, removedCompanies: [] });
    }

    const result = await Source.deleteMany({ _id: { $in: sourcesToRemove.map((source) => source._id) } });
    let fileSynced = true;
    try {
      await removeSourcesFromFile(sourcesToRemove.map((source) => source.url));
    } catch (error) {
      fileSynced = false;
      console.error("Unable to sync pruned sources to career_urls.txt:", error.message);
    }
    return response.json({
      removedSources: result.deletedCount,
      removedCompanies: [...new Set(sourcesToRemove.map((source) => source.company))],
      fileSynced,
    });
  } catch (error) {
    return next(error);
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

router.delete("/sources/:sourceId", async (request, response, next) => {
  try {
    const sourceId = String(request.params.sourceId || "");
    if (!/^[a-f\d]{24}$/i.test(sourceId)) {
      return response.status(400).json({ error: "Select a valid career source." });
    }
    const source = await Source.findById(sourceId);
    if (!source) return response.status(404).json({ error: "That career source was not found." });
    await removeSourceFromFile(source.url);
    await Source.deleteOne({ _id: source._id });
    return response.json({ removed: source.id, company: source.company, url: source.url });
  } catch (error) {
    return next(error);
  }
});

router.post("/sources/upload", async (request, response, next) => {
  try {
    const rows = parseSourceUpload(request.body || {});
    const accepted = [];
    const skipped = [];
    const seen = new Set((await Source.distinct("url")).map((url) => url.toLowerCase()));
    for (const item of rows) {
      if (item.error) {
        skipped.push({ row: item.rowNumber, reason: item.error });
      } else if (seen.has(item.source.url.toLowerCase())) {
        skipped.push({ row: item.rowNumber, reason: "This career URL is already in the source list." });
      } else {
        seen.add(item.source.url.toLowerCase());
        accepted.push(item.source);
      }
    }
    if (accepted.length) {
      const created = await Source.insertMany(accepted, { ordered: true });
      try {
        await appendSourcesToFile(accepted);
      } catch (error) {
        await Source.deleteMany({ _id: { $in: created.map((source) => source._id) } });
        throw error;
      }
    }
    return response.status(200).json({ added: accepted.length, skipped, totalRows: rows.length });
  } catch (error) {
    if (error.message?.startsWith("Upload") || error.message?.startsWith("The file") || error.message?.startsWith("The spreadsheet") || error.message?.startsWith("The first worksheet") || error.message?.startsWith("Add column") || error.message?.startsWith("We couldn't read")) {
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

router.post("/crawl/company", async (request, response, next) => {
  try {
    const company = String(request.body?.company || "").trim().replace(/\s+/g, " ");
    if (company.length < 2 || company.length > 80) {
      return response.status(400).json({ error: "Company name must be 2 to 80 characters." });
    }
    const run = await crawlManager.start(company);
    return response.status(202).json({ run });
  } catch (error) {
    if (error.message.includes("already running")) return response.status(409).json({ error: error.message });
    if (error.message.startsWith("No career sources")) return response.status(404).json({ error: error.message });
    return next(error);
  }
});

router.post("/crawl/source", async (request, response, next) => {
  try {
    const sourceId = String(request.body?.sourceId || "");
    if (!/^[a-f\d]{24}$/i.test(sourceId)) {
      return response.status(400).json({ error: "Select a valid career source." });
    }
    const source = await Source.findById(sourceId).select({ company: 1, active: 1 });
    if (!source || source.active === false) {
      return response.status(404).json({ error: "That career source is unavailable or paused." });
    }
    const run = await crawlManager.start(source.company, sourceId);
    return response.status(202).json({ run });
  } catch (error) {
    if (error.message.includes("already running")) return response.status(409).json({ error: error.message });
    if (error.message.startsWith("No active career source")) return response.status(404).json({ error: error.message });
    return next(error);
  }
});

router.post("/companies/pause", async (request, response, next) => {
  try {
    const company = String(request.body?.company || "").trim().replace(/\s+/g, " ");
    const paused = request.body?.paused;
    if (company.length < 2 || company.length > 80 || typeof paused !== "boolean") {
      return response.status(400).json({ error: "Provide a valid company and paused boolean." });
    }
    return response.json(await crawlManager.setCompanyPaused(company, paused));
  } catch (error) {
    if (error.message.startsWith("No career sources") || error.message.includes("required")) {
      return response.status(404).json({ error: error.message });
    }
    return next(error);
  }
});

router.post("/crawl/skip", async (_request, response, next) => {
  try {
    response.status(202).json({ run: await crawlManager.skipCurrent() });
  } catch (error) {
    if (error.message.includes("No crawl") || error.message.includes("did not accept")) {
      return response.status(409).json({ error: error.message });
    }
    return next(error);
  }
});

router.post("/crawl/pause", async (request, response, next) => {
  try {
    if (typeof request.body?.paused !== "boolean") {
      return response.status(400).json({ error: "Provide a paused boolean." });
    }
    return response.json({ run: await crawlManager.setCrawlPaused(request.body.paused) });
  } catch (error) {
    if (error.message.includes("No crawl") || error.message.includes("did not accept")) {
      return response.status(409).json({ error: error.message });
    }
    return next(error);
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
