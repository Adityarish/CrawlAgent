import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Source } from "../models/Source.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultSourcesFile = path.resolve(currentDirectory, "../../../crawler/career_urls.txt");

function companyFromUrl(url) {
  const ignored = new Set(["www", "job", "jobs", "career", "careers", "apply", "recruitment"]);
  const candidates = new URL(url).hostname
    .toLowerCase()
    .split(".")
    .filter((part) => part && !ignored.has(part));
  return (candidates[0] || "company").replaceAll("-", " ");
}

export function parseSources(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("|");
      if (separator < 0) {
        const url = line.trim();
        return { company: companyFromUrl(url), url };
      }
      return {
        company: line.slice(0, separator).trim(),
        url: line.slice(separator + 1).trim(),
      };
    });
}

export async function syncSourcesFromFile(filePath = defaultSourcesFile) {
  try {
    const value = await fs.readFile(filePath, "utf8");
    const sources = parseSources(value);
    if (sources.length) {
      await Source.bulkWrite(
        sources.map((source) => ({
          updateOne: { filter: { url: source.url }, update: { $setOnInsert: source }, upsert: true },
        })),
        { ordered: false }
      );
    }
    return sources.length;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

export async function appendSourceToFile(source, filePath = defaultSourcesFile) {
  return appendSourcesToFile([source], filePath);
}

export async function appendSourcesToFile(sources, filePath = defaultSourcesFile) {
  if (!sources.length) return;
  let previous = "";
  try {
    previous = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const prefix = previous && !previous.endsWith("\n") ? "\n" : "";
  const lines = sources.map(({ company, url }) => `${company} | ${url}`).join("\n");
  await fs.appendFile(filePath, `${prefix}${lines}\n`, "utf8");
}
