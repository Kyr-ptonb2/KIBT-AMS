// types/index.ts — Shared TypeScript interfaces mirroring Rust structs.

export interface Event {
  id: string;
  title: string;
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  region: string;
  venue?: string;
  financialYear: string;
  eventType: "in-person" | "online" | "hybrid";
  notes?: string;
  createdAt: string;
  participantCount?: number;
  sessionCount?: number;
}

export interface EventSession {
  id: string;
  eventId: string;
  sessionNo: number;
  title?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  region?: string;
  venue?: string;
  participantCount?: number;
}

export interface Participant {
  id: string; eventId: string; name: string;
  businessType?: string; ageCategory?: string; gender?: string;
  phone?: string; consent?: string; location?: string;
  region?: string; extraFields?: string; addedAt: string;
}

export interface ParticipantInput {
  name: string; businessType?: string; ageCategory?: string;
  gender?: string; phone?: string; consent?: string;
  location?: string; region?: string; extraFields?: string; idNumber?: string;
}

export interface ParticipantFilter {
  eventId?: string; financialYear?: string; region?: string;
  gender?: string; ageCategory?: string; consent?: string; query?: string;
  limit?: number; offset?: number;
}

export interface QueueItemInput {
  itemId: string; eventId: string; imageBytes: number[];
  filename: string;
}

export interface ScanResult {
  scanId: string; method: "gemini" | "manual";
  rows: ParticipantInput[]; extractedCount: number;
  accuracyNote?: string; detectedColumns: string[];
}

export interface BatchItemResult {
  itemId: string; scanId: string; eventId: string; filename: string;
  status: "done" | "failed"; method: string;
  rows: ParticipantInput[]; error?: string; detectedColumns: string[];
}

export interface BatchScanResult {
  batchId: string; results: BatchItemResult[]; totalExtracted: number;
}

export interface BatchProgressEvent {
  batchId: string; itemId: string; index: number; total: number;
  status: "processing" | "done" | "failed"; method?: string;
  extractedCount?: number; error?: string;
}

export interface ReportData {
  financialYear: string; totalParticipants: number; totalEvents: number;
  activeRegions: number; maleCount: number; femaleCount: number;
  consentCount: number; ageACount: number; ageBCount: number;
  regions: RegionSummary[]; businessTypes: BusinessTypeSummary[]; events: EventSummary[];
}

export interface RegionSummary {
  region: string; events: number; participants: number;
  male: number; female: number; consent: number; ageA: number; ageB: number;
}
export interface BusinessTypeSummary { businessType: string; count: number; }
export interface EventSummary {
  date: string;
  id: string; title: string; startDate: string; region: string;
  venue?: string; participantCount: number;
}

export interface AppConfig {
  geminiApiKey?: string; defaultRegion?: string;
  scanMethodPreference: "online";
  autoUpdate: boolean; databasePath?: string;
}

export interface ExportFilter { financialYear?: string; region?: string; eventId?: string; }

export interface QueueItem {
  itemId: string; eventId: string; imageBytes: number[];
  filename: string; previewUrl: string;
  status: "waiting" | "processing" | "done" | "failed";
  method?: string; extractedCount?: number; error?: string;
  rows?: ParticipantInput[];
}

// All 47 Kenya counties
export const KIBT_REGIONS = [
  "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita-Taveta",
  "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru",
  "Tharaka-Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua",
  "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot",
  "Samburu", "Trans-Nzoia", "Uasin Gishu", "Elgeyo-Marakwet", "Nandi",
  "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho",
  "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya",
  "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi",
] as const;

export const BUSINESS_TYPES = [
  "Sole proprietor", "Partnership", "Limited company",
  "Cooperative", "Association", "Other",
] as const;

export const EVENT_TYPES = [
  { value: "in-person", label: "In-Person",  color: "bg-green-100 text-green-700" },
  { value: "online",    label: "Online",      color: "bg-blue-100 text-blue-700"  },
  { value: "hybrid",    label: "Hybrid",      color: "bg-purple-100 text-purple-700" },
] as const;

export interface DuplicateMatch {
  participantId: string;
  name: string;
  phone?: string;
  idNumber?: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  region: string;
  addedAt: string;
  matchOn: "phone" | "id_number" | "name_phone";
}

export interface DuplicateCheckResult {
  inputIndex: number;
  inputName: string;
  inputPhone?: string;
  inputIdNumber?: string;
  matches: DuplicateMatch[];
}


// ── Custom Tables ─────────────────────────────────────────────────────────────

export interface ColumnDef {
  name: string;
  colType: "text" | "number" | "date" | "boolean";
  required: boolean;
}

export interface CustomTableDef {
  id: string;
  name: string;
  description?: string;
  columns: ColumnDef[];
  eventId?: string;
  eventTitle?: string;
  createdBy: string;
  createdAt: string;
  rowCount: number;
}

export interface CustomTableRow {
  id: string;
  tableId: string;
  data: Record<string, string | number | boolean | null>;
  addedAt: string;
  addedBy?: string;
}



export interface TableScanResult {
  scanId: string;
  rowsInserted: number;
  detectedColumns: string[];
  matchedColumns: string[];
  skippedColumns: string[];
}

export interface TableBatchItemResult {
  itemId: string;
  filename: string;
  status: "done" | "failed";
  rowsInserted: number;
  matchedColumns: string[];
  skippedColumns: string[];
  error?: string;
}

export interface TableBatchScanResult {
  batchId: string;
  results: TableBatchItemResult[];
  totalInserted: number;
}

export const SCAN_METHOD_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  gemini:    { label: "Online — Gemini",     color: "text-green-700", bg: "bg-green-100" },
  manual:    { label: "Manual Entry",        color: "text-gray-600",  bg: "bg-gray-100"  },
  failed:    { label: "Failed",              color: "text-red-700",   bg: "bg-red-100"   },
};
