import { Router } from "express";
import mongoose from "mongoose";
import { Job } from "../models/Job.js";
import { crawlManager } from "../services/crawl-manager.js";

const router = Router();

function list(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function safePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildJobQuery(query) {
  const filter = {};
  const search = String(query.search || "").trim();
  const companies = list(query.company);
  const locations = list(query.location);
  const domains = list(query.domain);
  const employmentTypes = list(query.employmentType);
  const workplaceTypes = list(query.workplaceType);

  if (search) {
    const pattern = new RegExp(safePattern(search), "i");
    filter.$or = [
      { title: pattern },
      { companyName: pattern },
      { description: pattern },
      { skills: pattern },
    ];
  }
  if (companies.length) filter.companyName = { $in: companies };
  if (locations.length) filter.city = { $in: locations };
  if (domains.length) filter.domain = { $in: domains };
  if (employmentTypes.length) filter.employmentType = { $in: employmentTypes };
  if (workplaceTypes.length) filter.workplaceType = { $in: workplaceTypes };
  if (query.fresher === "true") {
    filter.$and = [{ $or: [{ fresherEligible: true }, { minExperience: 0 }] }];
  }
  return filter;
}

router.get("/health", async (_request, response) => {
  const connected = mongoose.connection.readyState === 1;
  response.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "degraded",
    database: connected ? "connected" : "disconnected",
    adminConfigured: Boolean(process.env.ADMIN_PASSWORD),
  });
});

router.get("/crawl/status", async (_request, response, next) => {
  try {
    const run = await crawlManager.status();
    response.json({ state: run?.state || "idle" });
  } catch (error) {
    next(error);
  }
});

router.get("/jobs", async (request, response, next) => {
  try {
    const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(request.query.limit, 10) || 20));
    const sort = request.query.sort === "title" ? { title: 1 } : { datePosted: -1, createdAt: -1 };
    const filter = buildJobQuery(request.query);
    const [jobs, total] = await Promise.all([
      Job.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
      Job.countDocuments(filter),
    ]);
    response.json({ jobs, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
  } catch (error) {
    next(error);
  }
});

router.get("/jobs/:id", async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(404).json({ error: "Job not found." });
    }
    const job = await Job.findById(request.params.id);
    if (!job) return response.status(404).json({ error: "Job not found." });
    return response.json({ job });
  } catch (error) {
    return next(error);
  }
});

router.get("/filters", async (_request, response, next) => {
  try {
    const [companies, locations, domains, employmentTypes, workplaceTypes] = await Promise.all([
      Job.distinct("companyName"),
      Job.distinct("city"),
      Job.distinct("domain"),
      Job.distinct("employmentType"),
      Job.distinct("workplaceType"),
    ]);
    const clean = (values) => values.filter(Boolean).sort((a, b) => a.localeCompare(b));
    response.json({
      companies: clean(companies),
      locations: clean(locations),
      domains: clean(domains),
      employmentTypes: clean(employmentTypes),
      workplaceTypes: clean(workplaceTypes),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/stats", async (_request, response, next) => {
  try {
    const [totalJobs, companies, cities, recentJobs] = await Promise.all([
      Job.countDocuments(),
      Job.distinct("companyName"),
      Job.distinct("city"),
      Job.countDocuments({ datePosted: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ]);
    response.json({ totalJobs, companies: companies.length, cities: cities.filter(Boolean).length, recentJobs });
  } catch (error) {
    next(error);
  }
});

export default router;
