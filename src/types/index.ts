export interface Event {
  id: string; title: string; date: string; region: string;
  venue?: string; financialYear: string; notes?: string;
  createdAt: string; participantCount?: number;
}

export interface Participant {
  id: string; eventId: string; name: string;
  businessType?: string; ageCategory?: string; gender?: string;
  phone?: string; consent?: string; location?: string;
  extraFields?: string; addedAt: string;
}

export interface ParticipantInput {
  name: string; businessType?: string; ageCategory?: string;
  gender?: string; phone?: string; consent?: string;
  location?: string; extraFields?: string;
}

export interface ParticipantFilter {
  eventId?: string; financialYear?: string; region?: string;
  gender?: string; ageCategory?: string; consent?: string; query?: string;
}

export interface ScanResult {
  scanId: string; method: "gemini" | "tesseract" | "manual";
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
  id: string; title: string; date: string; region: string;
  venue?: string; participantCount: number;
}

export interface AppConfig {
  geminiApiKey?: string; defaultRegion?: string;
  scanMethodPreference: "auto" | "online" | "offline";
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

export const KIBT_REGIONS = [
  "Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Thika","Nyeri","Meru",
  "Garissa","Kakamega","Kitale","Machakos","Embu","Kisii","Kericho",
  "Malindi","Nanyuki","Bungoma",
] as const;

export const BUSINESS_TYPES = [
  "Sole proprietor","Partnership","Limited company","Cooperative","Association","Other",
] as const;

export const SCAN_METHOD_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  gemini:    { label: "Online — Gemini",     color: "text-green-700", bg: "bg-green-100" },
  tesseract: { label: "Offline — Tesseract", color: "text-amber-700", bg: "bg-amber-100" },
  manual:    { label: "Manual Entry",        color: "text-gray-600",  bg: "bg-gray-100"  },
  failed:    { label: "Failed",              color: "text-red-700",   bg: "bg-red-100"   },
};
