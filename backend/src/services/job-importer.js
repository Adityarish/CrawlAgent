import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Job } from "../models/Job.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultJobsFile = path.resolve(currentDirectory, "../../../crawler/parsing/output/structured_jobs.json");

function fingerprint(record) {
  const identity = [
    record.company_name,
    record.external_id,
    record.title,
    record.application_url,
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeJob(record) {
  return {
    externalId: record.external_id || null,
    companyName: record.company_name,
    title: record.title,
    domain: record.domain || null,
    subdomain: record.subdomain || null,
    description: record.description,
    summary: record.summary || record.description,
    responsibilities: record.responsibilities || [],
    requiredQualifications: record.required_qualifications || [],
    preferredQualifications: record.preferred_qualifications || [],
    educationRequirements: record.education_requirements || [],
    skills: record.skills || [],
    minExperience: record.min_experience ?? null,
    maxExperience: record.max_experience ?? null,
    fresherEligible: record.fresher_eligible ?? null,
    employmentType: record.employment_type || null,
    workplaceType: record.workplace_type || null,
    fullLocationText: record.full_location_text,
    city: record.city || null,
    state: record.state || null,
    country: record.country || "India",
    salaryMin: record.salary_min ?? null,
    salaryMax: record.salary_max ?? null,
    salaryCurrency: record.salary_currency || null,
    salaryPeriod: record.salary_period || null,
    salaryDisclosed: Boolean(record.salary_disclosed),
    applicationUrl: record.application_url,
    sourceUrl: record.source_url,
    datePosted: toDate(record.date_posted),
    applicationDeadline: toDate(record.application_deadline),
    rawPayload: record.raw_payload || {},
    fingerprint: fingerprint(record),
    importedAt: new Date(),
  };
}

export async function importJobsFromFile(filePath = defaultJobsFile) {
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { imported: 0, skipped: true };
    throw error;
  }

  const records = JSON.parse(source);
  if (!Array.isArray(records)) throw new Error("Structured jobs file must contain a JSON array.");

  const jobs = records
    .filter((record) => record.company_name && record.title && record.description && record.application_url && record.source_url)
    .map(normalizeJob);

  if (!jobs.length) return { imported: 0, skipped: false };

  const operations = jobs.map((job) => ({
    updateOne: {
      filter: { fingerprint: job.fingerprint },
      update: { $set: job },
      upsert: true,
    },
  }));
  await Job.bulkWrite(operations, { ordered: false });
  return { imported: jobs.length, skipped: false };
}
