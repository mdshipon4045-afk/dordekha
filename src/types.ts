/**
 * Shared domain types for দরদেখা (Dordekha).
 *
 * Data source: Ministry of Agriculture / DAM (কৃষি বিপণন অধিদপ্তর) official
 * price API at moa-services.com. See src/moa.ts for the transport.
 */

export type PriceType = "retail" | "wholesale";

/** A single price triple (min / max / average) with its unit provenance. */
export interface PriceTriple {
  min: number | null;
  max: number | null;
  avg: number | null;
  /**
   * The unit the value is expressed in. For wholesale this is the *retail*
   * unit, because the bulk figure has been divided down to it — labelling a
   * per-kilogram price "per quintal" is the exact confusion this service
   * exists to remove.
   */
  unitId: number;
  /** The unit the upstream originally used, kept for audit. */
  rawUnitId: number;
  /**
   * Divisor applied to the raw upstream figure to express it in the
   * retail unit of the same commodity. 1 means no conversion was needed.
   */
  divisor: number;
  /** How the divisor was chosen — recorded so every number is auditable. */
  divisorSource: DivisorSource;
}

export type DivisorSource =
  /** Taken from the evidence-backed lookup table. */
  | "table"
  /** Derived arithmetically from the two unit definitions. */
  | "derived"
  /** The primary factor produced an implausible value; an alternative was chosen. */
  | "corrected"
  /** No factor could be established; the figure is kept raw and flagged. */
  | "unknown";

/** A normalised price observation for one commodity in one place on one day. */
export interface PriceRecord {
  priceDate: string;
  districtId: number;
  upazilaId: number | null;
  commodityId: number;
  commodityGroupId: number;
  commoditySubGroupId: number;
  retail: PriceTriple | null;
  wholesale: PriceTriple | null;
  /**
   * True when upstream repeated the previous day's numbers instead of
   * collecting fresh ones. Surfaced so charts never imply movement that
   * was not reported.
   */
  carriedForward: boolean;
  /** Set when the row failed validation (e.g. implausible wholesale). */
  anomaly: string | null;
}

/** Master data reference records, cached from the upstream dropdowns endpoint. */
export interface District {
  id: number;
  nameBn: string;
  nameEn: string;
  divisionId: number;
}

export interface Upazila {
  id: number;
  nameBn: string;
  nameEn: string;
  districtId: number;
  divisionId: number;
}

export interface Commodity {
  id: number;
  nameBn: string;
  nameEn: string;
  groupId: number;
  subGroupId: number;
  /** Retail unit id used by upstream for this commodity. */
  unitRetail: number | null;
  unitWholesale: number | null;
}

export interface CommodityGroup {
  id: number;
  nameBn: string;
  nameEn: string;
}

export interface MasterData {
  districts: District[];
  upazilas: Upazila[];
  commodities: Commodity[];
  groups: CommodityGroup[];
  /** Unit id -> human label (Bangla / English). */
  units: Record<number, { bn: string; en: string }>;
  fetchedAt: string;
}

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  /** R2 is optional — the free plan may not have buckets enabled. */
  ARCHIVE?: R2Bucket;
  /** Service binding back into this Worker, used by the ingest chain. */
  SELF?: Fetcher;
  SITE_ORIGIN: string;
  SOURCE_NAME: string;
  SOURCE_API: string;
  /** Optional shared secret protecting administrative endpoints. */
  ADMIN_TOKEN?: string;
  /** Telegram bot token (stored as a Worker secret, never in the repo). */
  TELEGRAM_BOT_TOKEN?: string;
  /** Telegram channel username, e.g. "@dordekha_bazar". */
  TELEGRAM_CHANNEL?: string;
  /** bKash wallet number used to collect payments. */
  BKASH_NUMBER?: string;
}
