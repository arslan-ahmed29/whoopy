// Local, membership-free data source: reads the SQLite database produced by
// the openwhoop CLI (https://github.com/bWanShiTong/openwhoop), which syncs
// WHOOP 4.0/5.0 bands over your computer's Bluetooth and computes sleep,
// HRV, stress, and strain locally.
//
// Records are mapped to the same shapes the WHOOP cloud API returns so the
// frontend works identically in both modes. Requires Node >= 22.5 for the
// built-in node:sqlite module.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const dbPath =
  process.env.OPENWHOOP_DB || path.join(os.homedir(), ".openwhoop", "db.sqlite");

let db = null;

async function getDb() {
  if (!db) {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbPath);
  }
  return db;
}

export function isAvailable() {
  return fs.existsSync(dbPath);
}

// sea-orm stores DateTime as 'YYYY-MM-DD HH:MM:SS' text in SQLite.
function toSqlite(isoString) {
  return new Date(isoString).toISOString().slice(0, 19).replace("T", " ");
}

export async function getRecovery({ start, end, limit }) {
  const rows = (await getDb())
    .prepare(
      `SELECT sleep_id, "end", score, avg_hrv, min_bpm, avg_bpm
       FROM sleep_cycles
       WHERE "end" BETWEEN ? AND ?
       ORDER BY "end" DESC LIMIT ?`
    )
    .all(toSqlite(start), toSqlite(end), limit);
  return rows.map((r) => ({
    created_at: r.end,
    score:
      r.avg_hrv != null
        ? {
            recovery_score: r.score,
            hrv_rmssd_milli: r.avg_hrv,
            resting_heart_rate: r.min_bpm,
          }
        : null,
  }));
}

export async function getSleep({ start, end, limit }) {
  const rows = (await getDb())
    .prepare(
      `SELECT start, "end", score
       FROM sleep_cycles
       WHERE "end" BETWEEN ? AND ?
       ORDER BY "end" DESC LIMIT ?`
    )
    .all(toSqlite(start), toSqlite(end), limit);
  return rows.map((r) => ({
    start: r.start,
    end: r.end,
    nap: false,
    score: {
      sleep_performance_percentage: r.score,
      stage_summary: {
        total_in_bed_time_milli: new Date(r.end) - new Date(r.start),
      },
    },
  }));
}

export async function getCycles({ start, end, limit }) {
  const rows = (await getDb())
    .prepare(
      `SELECT date, strain FROM strain
       WHERE date BETWEEN ? AND ?
       ORDER BY date DESC LIMIT ?`
    )
    .all(start.slice(0, 10), end.slice(0, 10), limit);
  return rows.map((r) => ({
    start: r.date,
    score: { strain: r.strain, kilojoule: null },
  }));
}

export async function getWorkouts({ start, end, limit }) {
  const rows = (await getDb())
    .prepare(
      `SELECT a.start, a."end", a.activity, a.strain,
              (SELECT CAST(AVG(bpm) AS INTEGER) FROM heart_rate
                WHERE time BETWEEN a.start AND a."end") AS avg_hr,
              (SELECT MAX(bpm) FROM heart_rate
                WHERE time BETWEEN a.start AND a."end") AS max_hr
       FROM activities a
       WHERE a.activity != 'Sleep' AND a.start BETWEEN ? AND ?
       ORDER BY a.start DESC LIMIT ?`
    )
    .all(toSqlite(start), toSqlite(end), limit);
  return rows.map((r) => ({
    start: r.start,
    end: r.end ?? r.start,
    sport_name: r.activity,
    score: {
      strain: r.strain,
      average_heart_rate: r.avg_hr,
      max_heart_rate: r.max_hr,
      kilojoule: null,
    },
  }));
}

// Daily vitals (openwhoop-only extras): average stress, SpO2, skin temp, HR.
export async function getVitals({ start, end }) {
  return (await getDb())
    .prepare(
      `SELECT date(time) AS day,
              ROUND(AVG(stress), 2) AS stress,
              ROUND(AVG(spo2), 1) AS spo2,
              ROUND(AVG(skin_temp), 2) AS skin_temp,
              CAST(AVG(bpm) AS INTEGER) AS avg_hr
       FROM heart_rate
       WHERE time BETWEEN ? AND ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(toSqlite(start), toSqlite(end));
}
