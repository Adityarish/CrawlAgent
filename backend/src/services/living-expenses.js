import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { loadDistrictLocations } from "./district-locations.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultCostOfLivingFile = path.resolve(currentDirectory, "../../../dataset/CostOfLiving.csv");

const COST_FIELDS = [
  ["rent", "single_rent_1bhk_inr", "family3_rent_2bhk_inr"],
  ["foodGroceries", "single_food_inr", "family3_food_inr"],
  ["transportation", "single_transport_inr", "family3_transport_inr"],
  ["utilities", "single_utilities_inr", "family3_utilities_inr"],
  ["miscellaneous", "single_other_inr", "family3_other_inr"],
  ["total", "single_total_monthly_inr", "family3_total_monthly_inr"],
];

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

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readCsvRows(source) {
  const workbook = XLSX.read(source, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Cost-of-living CSV has no worksheet.");
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function districtMatcher(districts) {
  const byName = new Map();
  for (const district of districts) {
    for (const alias of new Set([district.district, district.boundaryName].map(normalized))) {
      if (!alias) continue;
      if (!byName.has(alias)) byName.set(alias, []);
      byName.get(alias).push(district);
    }
  }
  return (districtName, state) => {
    const matches = byName.get(normalized(districtName)) || [];
    if (matches.length === 1) return matches[0];
    const stateMatches = matches.filter((district) => normalized(district.state) === normalized(state));
    return stateMatches.length === 1 ? stateMatches[0] : null;
  };
}

export function parseLivingExpenseRows(rows, districts) {
  const findDistrict = districtMatcher(districts);
  const estimates = new Map();

  for (const row of rows) {
    const costs = Object.fromEntries(COST_FIELDS.map(([key, singleField, familyField]) => [key, {
      single: numberOrNull(row[singleField]),
      family3: numberOrNull(row[familyField]),
    }]));
    if (Object.values(costs).some((cost) => cost.single == null || cost.family3 == null)) continue;

    const latitude = numberOrNull(row.latitude);
    const longitude = numberOrNull(row.longitude);
    const hasCityCoordinates = latitude != null && longitude != null
      && latitude >= 6 && latitude <= 38 && longitude >= 68 && longitude <= 98
      && !String(row.coordinate_source || "").includes("district_centroid_proxy");
    let location;
    if (hasCityCoordinates) {
      const city = String(row.benchmark_city || row.city || "").trim();
      if (!city) continue;
      location = {
        key: `city-${normalized(city)}-${normalized(row.state)}`,
        kind: "city",
        name: city,
        state: String(row.state || "").trim(),
        position: [latitude, longitude],
        coordinateBasis: String(row.coordinate_source || "").trim(),
        districtCode: "",
      };
    } else {
      const district = findDistrict(row.district_centroid_match, row.state);
      if (!district) continue;
      location = {
        key: `district-${district.districtCode}`,
        kind: "district",
        name: district.district,
        state: district.state,
        position: [district.latitude, district.longitude],
        coordinateBasis: district.coordinateBasis,
        districtCode: district.districtCode,
      };
    }

    if (!estimates.has(location.key)) estimates.set(location.key, { location, rows: [] });
    estimates.get(location.key).rows.push({ city: String(row.city || "").trim(), costs });
  }

  return [...estimates.values()].map(({ location, rows: sources }) => {
    const costs = Object.fromEntries(COST_FIELDS.map(([key]) => [key, {
      single: Math.round(sources.reduce((sum, item) => sum + item.costs[key].single, 0) / sources.length),
      family3: Math.round(sources.reduce((sum, item) => sum + item.costs[key].family3, 0) / sources.length),
    }]));
    return {
      ...location,
      sourceCities: sources.map((source) => source.city).filter(Boolean),
      sourceCount: sources.length,
      costs,
      currency: "INR",
      period: "2026-10 monthly",
      estimate: true,
    };
  });
}

let expensesPromise;
export async function loadLivingExpenses(filePath = defaultCostOfLivingFile) {
  if (filePath !== defaultCostOfLivingFile) {
    const [source, districts] = await Promise.all([fs.readFile(filePath), loadDistrictLocations()]);
    return parseLivingExpenseRows(readCsvRows(source), districts);
  }
  if (!expensesPromise) {
    expensesPromise = Promise.all([fs.readFile(filePath), loadDistrictLocations()])
      .then(([source, districts]) => parseLivingExpenseRows(readCsvRows(source), districts))
      .catch((error) => {
        expensesPromise = null;
        throw error;
      });
  }
  return expensesPromise;
}
