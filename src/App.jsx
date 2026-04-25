import { useState, useEffect, useRef, useCallback } from "react";

/* ── CONSTANTS ── */
const GOLD = "#c9962a", GOLD_LT = "#e8b84b";
const VOCAL_COLORS = {
  "Vocal 1": "#c0392b", "Vocal 2": "#e67e22", "Vocal 3": "#27ae60",
  "Vocal 4": "#2980b9", "Vocal 5": "#8e44ad", "Vocal 6": "#16a085",
  "Vocal 7": "#d35400", "Vocal 8": "#1a5276", "Vocal 9": "#6d4c41",
};
const INSTR_COLORS = {
  "Keys 1": "#c0392b", "Keys 2": "#1a5276", "Keys 3": "#16a085",
  "Bass": "#2c3e50", "Drums": "#27ae60",
  "EG 1": "#1a5276", "EG 2": "#c0392b",
  "Violin": "#8e44ad",
};
const INSTR_TEXT = { "Bass": "#7fb3e0" };

/* ── SUPABASE ── */
const SUPABASE_URL = "https://swgewtppzwsxarojnvvg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z2V3dHBwendzeGFyb2pudnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNzU1MjEsImV4cCI6MjA5MjY1MTUyMX0.Xtr2t1JyudrxJNyWSSmHRFp5DcRpp7zV8_JPazRS_wA";

const sb = {
  async get(table){
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?order=sort_order.asc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if(!r.ok) throw new Error(`GET ${table} failed: ${r.status}`);
    return r.json();
  },
  async upsert(table, rows){
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows)
    });
    if(!r.ok){ const t = await r.text(); throw new Error(`UPSERT ${table}: ${t}`); }
  },
  async replace(table, rows){
    // Delete all then insert — cleanest way to handle reordering
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=gte.0`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "return=minimal" }
    });
    if(rows.length === 0) return;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(rows)
    });
    if(!r.ok){ const t = await r.text(); throw new Error(`INSERT ${table}: ${t}`); }
  }
};

// Convert app state arrays → DB rows with sort_order
function toDbRows(arr, mapper){ return arr.map((item, i) => ({ ...mapper(item), sort_order: i })); }

// Serialize / deserialize helpers
const dbToSchedule = r => ({ dot: r.dot, date: r.date, name: r.name, role: r.role, time: r.time });
const dbToRundown  = r => ({ time: r.time, name: r.name, role: r.role, note: r.note || "" });
const dbToLinks    = r => ({ icon: r.icon, color: r.color, title: r.title, sub: r.sub, url: r.url, chip: r.chip || "", chipColor: r.chip_color || "", section: r.section });


const SHEET_ID = "1tFfJ7pWhhspDF_dq9NBwZn8fVu6baFl_jr5JyQAYED8";
const TLC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTlhHW0vbv50NxDFZ8t_00vyvT1kAwMlw-3svNEd7kagYIrPDOpUUETElp6jI2fYgbBdTXDiIK0kwRD/pub?gid=0&single=true&output=csv";
// Proxy URL — uses allorigins to bypass CORS on published CSV
function csvUrl(sheetId, gid="0"){
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/pub?gid=${gid}&single=true&output=csv`;
  return `https://api.allorigins.win/get?url=${encodeURIComponent(base)}`;
}

// Parse CSV text → array of objects using header row
function parseSheetCSV(raw){
  const lines = raw.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if(lines.length < 2) return [];

  // Find the header row (contains "Name")
  let headerIdx = lines.findIndex(l => l.toLowerCase().includes("name"));
  if(headerIdx < 0) headerIdx = 0;
  const headers = splitCSVRow(lines[headerIdx]).map(h => h.trim().toLowerCase());

  // Column index lookup — handles variations in header names
  const col = (candidates) => {
    for(const c of candidates){
      const i = headers.findIndex(h => h.includes(c));
      if(i >= 0) return i;
    }
    return -1;
  };
  const iName  = col(["name"]);
  const iVocal = col(["vocal"]);
