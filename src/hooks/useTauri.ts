// hooks/useTauri.ts — Typed wrappers around @tauri-apps/api invoke calls.

import { invoke } from "@tauri-apps/api/core";
import {
  AppConfig,
  BatchScanResult,
  ColumnDef,
  CustomTableDef,
  CustomTableRow,
  TableScanResult,
  TableBatchScanResult,
  Event,
  ExportFilter,
  Participant,
  ParticipantFilter,
  DuplicateCheckResult,
  ParticipantInput,
  QueueItemInput,
  ReportData,
  ScanResult,
} from "../types";

// ── Events ────────────────────────────────────────────────────────────────────

export const getEvents = (fy?: string, region?: string) =>
  invoke<Event[]>("get_events", { fy, region });

export const createEvent = (input: {
  title: string;
  startDate: string;
  endDate: string;
  region: string;
  venue?: string;
  eventType?: string;
  notes?: string;
}) => invoke<any>("create_event", { input });

export const deleteEvent = (eventId: string) =>
  invoke<boolean>("delete_event", { eventId });

export const getFinancialYears = () =>
  invoke<string[]>("get_financial_years");

// ── Participants ──────────────────────────────────────────────────────────────

export const getParticipants = (filter: ParticipantFilter) =>
  invoke<Participant[]>("get_participants", { filter });

export const saveParticipants = (eventId: string, rows: ParticipantInput[]) =>
  invoke<number>("save_participants", { eventId, rows });

export const updateParticipant = (participantId: string, input: ParticipantInput) =>
  invoke<boolean>("update_participant", { participantId, input });

export const deleteParticipant = (participantId: string) =>
  invoke<boolean>("delete_participant", { participantId });

// ── Scanning ──────────────────────────────────────────────────────────────────

export const scanSheet = (
  eventId: string,
  imageBytes: number[],
  filename: string,
) => invoke<ScanResult>("scan_sheet", { eventId, imageBytes, filename });

export const scanBatch = (
  items: QueueItemInput[],
) => invoke<BatchScanResult>("scan_batch", { items });

// ── Custom Tables ────────────────────────────────────────────────────────────
export const getCustomTables = () =>
  invoke<CustomTableDef[]>("get_custom_tables");

export const getCustomTable = (tableId: string) =>
  invoke<CustomTableDef>("get_custom_table", { tableId });

export const createCustomTable = (input: {
  name: string; description?: string;
  columns: ColumnDef[]; eventId?: string;
}) => invoke<CustomTableDef>("create_custom_table", { input });

export const updateCustomTable = (
  tableId: string, name: string, description?: string, eventId?: string
) => invoke<boolean>("update_custom_table", { tableId, name, description, eventId });

export const deleteCustomTable = (tableId: string) =>
  invoke<boolean>("delete_custom_table", { tableId });

export const getCustomTableRows = (tableId: string, limit?: number, offset?: number) =>
  invoke<CustomTableRow[]>("get_custom_table_rows", { tableId, limit, offset });

export const upsertCustomTableRows = (input: {
  tableId: string; rows: Record<string, unknown>[];
}) => invoke<number>("upsert_custom_table_rows", { input });

export const updateCustomTableRow = (rowId: string, data: Record<string, unknown>) =>
  invoke<boolean>("update_custom_table_row", { rowId, data });

export const deleteCustomTableRow = (rowId: string) =>
  invoke<boolean>("delete_custom_table_row", { rowId });

export const createFromList = (input: {
  name: string; description?: string; eventId?: string;
  rawText: string; columnName?: string;
}) => invoke<CustomTableDef>("create_from_list", { input });

export const exportCustomTableCsv = (tableId: string, path: string) =>
  invoke<boolean>("export_custom_table_csv", { tableId, path });

export const exportCustomTableExcel = (tableId: string, path: string) =>
  invoke<boolean>("export_custom_table_excel", { tableId, path });



export const scanIntoCustomTable = (input: {
  tableId: string; imageBytes: number[]; filename: string;
}) => invoke<TableScanResult>("scan_into_custom_table", { input });

export const scanBatchIntoCustomTable = (input: {
  tableId: string;
  items: { itemId: string; imageBytes: number[]; filename: string }[];
}) => invoke<TableBatchScanResult>("scan_batch_into_custom_table", { input });

export const checkConnectivity = () => invoke<boolean>("check_connectivity");

export const checkDuplicates = (rows: ParticipantInput[]) =>
  invoke<DuplicateCheckResult[]>("check_duplicates", { rows });

// ── Reports ───────────────────────────────────────────────────────────────────

export const getReport = (financialYear: string) =>
  invoke<ReportData>("get_report", { financialYear });

// ── Export ────────────────────────────────────────────────────────────────────

export const exportExcel = (filter: ExportFilter, path: string) =>
  invoke<boolean>("export_excel", { filter, path });

export const exportCsv = (filter: ExportFilter, path: string) =>
  invoke<boolean>("export_csv", { filter, path });

// ── Config ────────────────────────────────────────────────────────────────────

export const getConfig = () => invoke<AppConfig>("get_config");

export const saveConfig = (config: AppConfig) =>
  invoke<boolean>("save_config", { config });

export const backupDatabase = (destinationPath: string) =>
  invoke<boolean>("backup_database", { destinationPath });

export const restoreDatabase = (sourcePath: string) =>
  invoke<boolean>("restore_database", { sourcePath });

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authLogin = (username: string, password: string) =>
  invoke<any>("login", { input: { username, password } });

export const authLogout = () => invoke<boolean>("logout");

export const getSessionUser = () => invoke<any>("get_session");

export const setupProfile = (input: {
  newUsername: string; newPassword: string; fullName: string;
  email: string; phone: string; idNumber: string;
}) => invoke<any>("setup_profile", { input });

export const getUsers = () => invoke<any[]>("get_users");

export const createUser = (input: {
  username: string; password: string; role: string;
  fullName?: string; email?: string; phone?: string; idNumber?: string;
}) => invoke<any>("create_user", { input });

export const deleteUser = (userId: string) => invoke<boolean>("delete_user", { userId });

export const setUserRole = (userId: string, role: string) =>
  invoke<boolean>("set_user_role", { userId, role });

export const resetUserPassword = (userId: string, newPassword: string) =>
  invoke<boolean>("reset_user_password", { userId, newPassword });

// ── Sessions ──────────────────────────────────────────────────────────────────
export const getEventSessions = (eventId: string) =>
  invoke<any[]>("get_event_sessions", { eventId });

export const createSession = (input: {
  eventId: string; title?: string; date: string;
  startTime?: string; endTime?: string; region?: string; venue?: string;
}) => invoke<any>("create_session", { input });

export const deleteSession = (sessionId: string) =>
  invoke<boolean>("delete_session", { sessionId });

export const getEventStats = (eventId: string) =>
  invoke<any>("get_event_stats", { eventId });

// ── Import ────────────────────────────────────────────────────────────────────
export const importParticipants = (
  eventId: string,
  sessionId: string | null,
  rows: any[]
) => invoke<number>("import_participants", { eventId, sessionId, rows });
