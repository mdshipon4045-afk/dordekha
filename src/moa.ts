/**
 * Transport for the official Ministry of Agriculture / DAM price API.
 *
 * Endpoints (all keyless, no cookies, no CSRF, verified 2026-10-20):
 *   POST /agri-service/crop-price-info/reports/price-report/market-daily-price-report
 *   GET  /agri-service/crop-price-info/reports/price-report/daily-price-scroll
 *   GET  /agri-service/common-all-dropdowns
 *
 * Behaviour that is easy to get wrong and is therefore handled here:
 *   - `district_id: []` does NOT mean "every district"; it returns a single
 *     aggregate. Every district must be requested explicitly.
 *   - `price_type_id` must not contain "Growers" — including it makes the
 *     whole call fail with "data Not found!".
 *   - `market_id` is not a functional filter; upazila is the finest working
 *     granularity.
 *   - some dates have no submissions at all (e.g. 2026-10-16, 2026-10-10).
 */

import type { MasterData, District, Upazila, Commodity, CommodityGroup } from "./types";
import type { RawUpstreamRow } from "./normalize";

const DEFAULT_BASE = "https://moa-services.com/agri-service";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

export interface MoaOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MoaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MoaError";
  }
}

function endpoint(path: string, base?: string): string {
  return `${(base ?? DEFAULT_BASE).replace(/\/$/, "")}${path}`;
}

async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "dordekha/0.1 (+https://dordekha.pages.dev; public-interest price data)",
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      if (!res.ok) throw new MoaError(`HTTP ${res.status} for ${url}`, res.status);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new MoaError(`Non-JSON response from ${url}: ${text.slice(0, 120)}`, res.status);
      }
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface DropdownResponse {
  data?: {
    divisionList?: { value: number; text_bn?: string; text_en?: string; text?: string }[];
    districtList?: { value: number; text_bn?: string; text_en?: string; text?: string; division_id?: number }[];
    upazilaList?: { value: number; text_bn?: string; text_en?: string; text?: string; district_id?: number; division_id?: number }[];
    commodityNameList?: {
      value: number;
      text_bn?: string;
      text_en?: string;
      text?: string;
      commodity_group_id?: number;
      commodity_sub_group_id?: number;
      unit_retail?: number | null;
      unit_whole_sale?: number | null;
    }[];
    commodityGroupList?: { value: number; text_bn?: string; text_en?: string; text?: string }[];
    measurementUnitList?: { value: number; text_bn?: string; text_en?: string; text?: string }[];
  };
}

/** Fetch and normalise the master data (districts, upazilas, commodities, units). */
export async function fetchMasterData(opts: MoaOptions = {}): Promise<MasterData> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const raw = await requestJson<DropdownResponse>(
    endpoint("/common-all-dropdowns", opts.baseUrl),
    { method: "GET" },
    opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
    fetchImpl,
  );
  const d = raw?.data ?? {};

  const districts: District[] = (d.districtList ?? []).map((x) => ({
    id: x.value,
    nameBn: (x.text_bn ?? x.text ?? "").trim(),
    nameEn: (x.text_en ?? "").trim(),
    divisionId: x.division_id ?? 0,
  }));

  const upazilas: Upazila[] = (d.upazilaList ?? []).map((x) => ({
    id: x.value,
    nameBn: (x.text_bn ?? x.text ?? "").trim(),
    nameEn: (x.text_en ?? "").trim(),
    districtId: x.district_id ?? 0,
    divisionId: x.division_id ?? 0,
  }));

  const commodities: Commodity[] = (d.commodityNameList ?? []).map((x) => ({
    id: x.value,
    nameBn: (x.text_bn ?? x.text ?? "").trim(),
    nameEn: (x.text_en ?? x.text ?? "").trim(),
    groupId: x.commodity_group_id ?? 0,
    subGroupId: x.commodity_sub_group_id ?? 0,
    unitRetail: x.unit_retail ?? null,
    unitWholesale: x.unit_whole_sale ?? null,
  }));

  const groups: CommodityGroup[] = (d.commodityGroupList ?? []).map((x) => ({
    id: x.value,
    nameBn: (x.text_bn ?? x.text ?? "").trim(),
    nameEn: (x.text_en ?? x.text ?? "").trim(),
  }));

  const units: MasterData["units"] = {};
  for (const u of d.measurementUnitList ?? []) {
    units[u.value] = { bn: (u.text_bn ?? u.text ?? "").trim(), en: (u.text_en ?? u.text ?? "").trim() };
  }

  return { districts, upazilas, commodities, groups, units, fetchedAt: new Date().toISOString() };
}

export interface PriceQuery {
  priceDate: string; // YYYY-MM-DD
  districtId?: number;
  upazilaId?: number;
  includeRetail?: boolean;
  includeWholesale?: boolean;
}

interface PriceResponse {
  success?: boolean;
  message?: string;
  data?: RawUpstreamRow[];
}

/** Fetch raw price rows for one place and one date. */
export async function fetchDailyPrices(query: PriceQuery, opts: MoaOptions = {}): Promise<RawUpstreamRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const priceTypes: string[] = [];
  if (query.includeRetail !== false) priceTypes.push("Retail");
  if (query.includeWholesale !== false) priceTypes.push("Wholesale");
  if (priceTypes.length === 0) priceTypes.push("Retail");

  const payload = {
    division_id: [],
    district_id: query.districtId === undefined ? [] : [query.districtId],
    upazila_id: query.upazilaId === undefined ? [] : [query.upazilaId],
    market_id: [],
    price_type_id: priceTypes,
    select_type: "Daily",
    year: 0,
    month_id: 0,
    week_id: 0,
    price_date: query.priceDate,
  };

  const res = await requestJson<PriceResponse>(
    endpoint("/crop-price-info/reports/price-report/market-daily-price-report", opts.baseUrl),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
    fetchImpl,
  );

  if (!res?.success) return [];
  return Array.isArray(res.data) ? res.data : [];
}

export interface ScrollRow {
  price_date: string;
  commodity_id: number;
  a_r_lowestPrice?: string;
  a_r_howestPrice?: string;
  a_w_lowestPrice?: string;
  a_w_howestPrice?: string;
}

interface ScrollResponse {
  success?: boolean;
  data?: ScrollRow[];
}

/** National daily averages — used as a fallback when a district is missing. */
export async function fetchNationalScroll(opts: MoaOptions = {}): Promise<ScrollRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await requestJson<ScrollResponse>(
    endpoint("/crop-price-info/reports/price-report/daily-price-scroll", opts.baseUrl),
    { method: "GET" },
    opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
    fetchImpl,
  );
  if (!res?.success) return [];
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Walk the last N days and report which dates actually have data.
 * Upstream silently returns an empty array for dates with no submissions.
 */
export async function findRecentDates(days: number, opts: MoaOptions = {}): Promise<string[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const found: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    const ymd = d.toISOString().slice(0, 10);
    const rows = await fetchDailyPrices({ priceDate: ymd, districtId: 47 }, { ...opts, fetchImpl });
    if (rows.length > 0) found.push(ymd);
  }
  return found;
}
