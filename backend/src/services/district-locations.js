import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultDistrictsFile = path.resolve(currentDirectory, "../../../dataset/District.csv");

const CITY_ALIASES = new Map([
  ["bangalore", "Bengaluru Urban"],
  ["bengaluru", "Bengaluru Urban"],
  ["bombay", "Mumbai"],
  ["delhi", "New Delhi"],
  ["gurgaon", "Gurugram"],
  ["madras", "Chennai"],
  ["noida", "Gautam Buddha Nagar"],
]);

const GENERIC_DISTRICT_NAMES = new Set(["central", "east", "north", "south", "west"]);
const districtIndexCache = new WeakMap();

function normalized(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value == null) return [];
  return [String(value)];
}

function districtPoint(district) {
  return {
    districtCode: district.districtCode,
    district: district.district,
    state: district.state,
    latitude: district.latitude,
    longitude: district.longitude,
    coordinateBasis: district.coordinateBasis,
  };
}

export function parseDistrictRows(rows) {
  return rows.map((row) => ({
    districtCode: String(row.district_code || "").trim(),
    district: String(row.district || "").trim(),
    state: String(row.state || "").trim(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    coordinateBasis: String(row.coordinate_basis || "").trim(),
    boundaryName: String(row.boundary_name || "").trim(),
  })).filter((row) => (
    row.districtCode
    && row.district
    && row.state
    && Number.isFinite(row.latitude)
    && Number.isFinite(row.longitude)
  ));
}

export async function loadDistrictLocations(filePath = defaultDistrictsFile) {
  const source = await fs.readFile(filePath);
  const workbook = XLSX.read(source, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("District coordinate CSV has no worksheet.");
  return parseDistrictRows(XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }));
}

function districtAliases(district) {
  const aliases = new Set([normalized(district.district), normalized(district.boundaryName)]);
  for (const [alias, target] of CITY_ALIASES) {
    if (normalized(target) === normalized(district.district)) aliases.add(alias);
  }
  aliases.delete("");
  return [...aliases];
}

function chooseDistrict(matches, state) {
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];
  const normalizedState = normalized(state);
  if (!normalizedState) return null;
  const stateMatches = matches.filter((district) => normalized(district.state) === normalizedState);
  return stateMatches.length === 1 ? stateMatches[0] : null;
}

function districtIndex(districts) {
  const cached = districtIndexCache.get(districts);
  if (cached) return cached;
  const aliases = new Map();
  for (const district of districts) {
    for (const alias of districtAliases(district)) {
      if (!aliases.has(alias)) aliases.set(alias, []);
      aliases.get(alias).push(district);
    }
  }
  const searchableAliases = [...aliases.entries()]
    .filter(([alias]) => alias.length >= 5 && !GENERIC_DISTRICT_NAMES.has(alias))
    .sort((left, right) => right[0].length - left[0].length);
  const index = { aliases, searchableAliases };
  districtIndexCache.set(districts, index);
  return index;
}

export function resolveDistrictLocations(record, districts) {
  if (!Array.isArray(districts) || !districts.length) return [];

  const candidates = [...values(record.city), ...values(record.full_location_text)];
  const candidateParts = candidates.flatMap((value) => value.split(/[,;|\[\]]/));
  const searchable = ` ${normalized(candidates.join(" "))} `;
  const state = values(record.state)[0] || "";
  const { aliases, searchableAliases } = districtIndex(districts);

  const resolved = new Map();
  const add = (district) => {
    if (district) resolved.set(district.districtCode, districtPoint(district));
  };

  for (const part of candidateParts) {
    const exact = normalized(part
      .replace(/^hybrid\s*-\s*/i, "")
      .replace(/\([^)]*\)/g, ""));
    add(chooseDistrict(aliases.get(exact), state));
  }

  for (const [alias, matches] of searchableAliases) {
    if (searchable.includes(` ${alias} `)) add(chooseDistrict(matches, state));
  }

  return [...resolved.values()];
}
