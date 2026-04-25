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
  const iInstr = col(["instrument"]);
  const iIem   = col(["iem"]);
  const iPos   = col(["position"]);
  const iNotes = col(["notes"]);

  const rows = [];
  for(let i = headerIdx + 1; i < lines.length; i++){
    const cells = splitCSVRow(lines[i]);
    const get = (idx) => idx >= 0 ? (cells[idx] || "").trim() : "";
    const name  = get(iName);
    const vocal = get(iVocal);
    const instr = get(iInstr);
    const iem   = get(iIem);
    const pos   = get(iPos);
    const notes = get(iNotes);
    // skip fully empty rows but keep "not in use" IEM placeholders
    if(!name && !vocal && !instr && !iem && !pos && !notes) continue;
    rows.push({
      name,
      vocal:      vocal && vocal.toLowerCase() !== "none" ? vocal : "none",
      instrument: instr && instr.toLowerCase() !== "none" ? instr : "none",
      iem:        iem   || "",
      position:   pos   || "",
      notes:      notes || "",
    });
  }
  return rows;
}

// RFC-4180 CSV row splitter (handles quoted fields with commas inside)
function splitCSVRow(line){
  const result = [];
  let cur = "", inQuote = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(ch === '"'){
      if(inQuote && line[i+1] === '"'){ cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if(ch === ',' && !inQuote){
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}


const DEFAULT_MICS = [
< truncated lines 151-1038 >
        <div style={{ marginBottom:22 }}>
          {secTitle("⚠️ Reset")}
          <button onClick={()=>{ setMics(JSON.parse(JSON.stringify(DEFAULT_MICS))); setSchedule(JSON.parse(JSON.stringify(DEFAULT_SCHEDULE))); }}
            style={{ padding:"8px 14px", background:"rgba(224,82,82,.08)", border:"1px solid rgba(224,82,82,.2)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"#e05252", cursor:"pointer" }}>Reset to Defaults</button>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ display:"flex", gap:7, alignItems:"center", padding:"12px 18px", borderTop:"1px solid rgba(255,255,255,.08)", position:"sticky", bottom:0, background:"#101013" }}>
        <button onClick={() => onSave(schedule, sundayRundown, links)} style={{ padding:"8px 14px", background:GOLD, color:"#080809", border:"none", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", fontWeight:600 }}>💾 Save All</button>
        <button onClick={()=>{ if(lockConfirm){ onLock(); } else { setLockConfirm(true); setTimeout(()=>setLockConfirm(false),3000); } }}
          style={{ padding:"8px 14px", background: lockConfirm ? "rgba(224,82,82,.25)" : "rgba(224,82,82,.08)", border:`1px solid ${lockConfirm ? "rgba(224,82,82,.5)" : "rgba(224,82,82,.2)"}`, borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"#e05252", cursor:"pointer" }}>
          {lockConfirm ? "🔒 Tap again to confirm" : "🔒 Lock & Exit"}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════ */
const TABS = [
  { id:"dashboard", icon:"🏠", label:"Dashboard" },
  { id:"audio",     icon:"🎚️", label:"Mic Assignments" },
  { id:"gear",      icon:"🔧", label:"Gear Docs" },
  { id:"schedule",  icon:"📅", label:"Schedule" },
  { id:"chat",      icon:"💬", label:"Team Chat" },
  { id:"resources", icon:"📁", label:"Resources" },
  { id:"streaming", icon:"📡", label:"Streaming" },
];

export default function App(){
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selSvc, setSelSvc] = useState(0);
  const [adminOn, setAdminOn] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [mics, setMics] = useState(DEFAULT_MICS);
  const { syncState, syncMsg, csvUrl_, setCsvUrl_, sync, lastSync, pasteText, setPasteText, pasteMsg, syncFromPaste } = useSheetSync(setMics);
  const { dbState, dbMsg, loadAll, saveAll: dbSave } = useSupabase({ setSchedule, setSundayRundown, setLinks });
  const [links, setLinks] = useState(JSON.parse(JSON.stringify(DEFAULT_LINKS)));
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [sundayRundown, setSundayRundown] = useState(JSON.parse(JSON.stringify(DEFAULT_SUNDAY_RUNDOWN)));
  const [svcs] = useState(DEFAULT_SVCS);
  const now = useNow();

  // Load from Supabase on mount
  useEffect(() => { loadAll(); }, []);

  // custom event bridge for Quick Nav inside DashboardTab
  useEffect(() => {
    const handler = e => setActiveTab(e.detail);
    document.addEventListener("switchTab", handler);
    return () => document.removeEventListener("switchTab", handler);
  }, []);
  useEffect(() => {
    const handler = () => setShowDrawer(false);
    document.addEventListener("closeAdmin", handler);
    return () => document.removeEventListener("closeAdmin", handler);
  }, []);

  const handleAdminBtn = () => {
    if(adminOn){ setShowDrawer(true); }
    else { setShowPin(true); }
  };
  const handlePinSuccess = () => { setShowPin(false); setAdminOn(true); setShowDrawer(true); };
  const handleLock = () => { setAdminOn(false); setShowDrawer(false); };
  const handleSave = (sched, rundown, lnks) => { dbSave(sched || schedule, rundown || sundayRundown, lnks || links); setSavedMsg(true); setTimeout(()=>setSavedMsg(false),2500); };
  const handleMicEdit = (i) => { setEditTarget(i); setShowDrawer(true); };

  return (
    <div style={S.app}>
      {/* Google Fonts */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'); *{box-sizing:border-box;} a{color:inherit;}`}</style>

      {/* PIN */}
      {showPin && <PinModal onSuccess={handlePinSuccess} onClose={()=>setShowPin(false)}/>}

      {/* Scrim */}
      {showDrawer && <div onClick={()=>setShowDrawer(false)} style={{ position:"fixed", inset:0, zIndex:140, background:"rgba(8,8,9,.6)" }}/>}

      {/* Admin Drawer */}
      {showDrawer && adminOn && (
        <AdminDrawer mics={mics} setMics={setMics} links={links} setLinks={setLinks} schedule={schedule} setSchedule={setSchedule} svcs={svcs} setSvcs={()=>{}}
          onLock={handleLock} onSave={handleSave} editTarget={editTarget}
          syncState={syncState} syncMsg={syncMsg} csvUrl_={csvUrl_} setCsvUrl_={setCsvUrl_} onSync={sync} lastSync={lastSync}
          pasteText={pasteText} setPasteText={setPasteText} pasteMsg={pasteMsg} syncFromPaste={syncFromPaste}
          sundayRundown={sundayRundown} setSundayRundown={setSundayRundown}/>
      )}

      {/* Topbar */}
      <header style={S.topbar}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0, marginRight:"auto" }}>
          <div style={S.cross}/>
          <div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:16, letterSpacing:"0.09em", textTransform:"uppercase", lineHeight:1.1 }}>The <span style={{ color:GOLD }}>Life</span> Church</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.14em", color:"#6b6b75", textTransform:"uppercase" }}>Production Hub · Richmond, VA</div>
          </div>
        </div>
        <a href="#" onClick={e=>e.preventDefault()} style={{ ...S.pill, background:"rgba(224,82,82,.1)", borderColor:"rgba(224,82,82,.25)", color:"#e05252" }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background:"#e05252", animation:"blink 1.5s infinite", display:"inline-block" }}/>Stream Live
        </a>
        <div onClick={handleAdminBtn} style={{ ...S.pill, background: adminOn ? "rgba(201,150,42,.15)" : "rgba(255,255,255,.04)", borderColor: adminOn ? "rgba(201,150,42,.4)" : "rgba(255,255,255,.1)", color: adminOn ? GOLD_LT : "#9a9aa6" }}>
          ⚙ {adminOn ? "Admin ✓" : "Admin"}
        </div>
        {(savedMsg || dbMsg) && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", color: dbState==="error" ? "#e05252" : "#4caf82", textTransform:"uppercase" }}>{dbMsg || "Saved ✓"}</span>}
        {dbState==="loading" && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", letterSpacing:"0.1em" }}>⟳ syncing…</span>}
      </header>

      {adminOn && (
        <div style={{ padding:"6px 22px", background:"rgba(201,150,42,.08)", borderBottom:"1px solid rgba(201,150,42,.2)", fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.14em", textTransform:"uppercase", color:GOLD, textAlign:"center" }}>
          ⚙ Admin Mode Active — Click tabs to navigate · Click ✏️ on any mic row to edit
        </div>
      )}

      {/* Tab Nav */}
      <nav style={S.tabNav}>
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={()=>setActiveTab(t.id)}
            style={{ ...S.tabBtn(activeTab===t.id), background:"transparent", outline:"none" }}>
            <span style={{ fontSize:13 }}>{t.icon}</span>{t.label}
            {t.id==="audio" && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, background: activeTab==="audio" ? "rgba(201,150,42,.1)" : "rgba(255,255,255,.07)", border:"1px solid rgba(255,255,255,.08)", borderRadius:100, padding:"1px 6px", color: activeTab==="audio" ? GOLD : "#6b6b75" }}>{mics.length}</span>}
          </button>
        ))}
      </nav>

      {/* Tab Panels */}
      <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
        {activeTab === "dashboard"  && <DashboardTab svcs={svcs} links={links} schedule={schedule} selSvc={selSvc} setSelSvc={setSelSvc} now={now}/>}
        {activeTab === "audio"      && <MicTab mics={mics} adminOn={adminOn} onEdit={handleMicEdit} onAdd={()=>setMics(m=>[...m,{name:"",vocal:"none",instrument:"none",iem:`IEM ${m.length+1}`,position:"",notes:""}])}/>}
        {activeTab === "gear"       && <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", width:"100%" }}><LinkSection title="🔧 Gear Documentation" items={links.gear}/></div>}
        {activeTab === "schedule"   && <ScheduleTab schedule={schedule} sundayRundown={sundayRundown}/>}
        {activeTab === "chat"       && <ChatTab/>}
        {activeTab === "resources"  && <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", width:"100%" }}><LinkSection title="📁 Team Resources" items={links.dash}/></div>}
        {activeTab === "streaming"  && <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", width:"100%" }}><LinkSection title="📡 Streaming & Contact" items={links.streaming}/></div>}
      </div>

      <footer style={{ padding:"12px 22px", borderTop:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, width:"100%" }}>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75" }}>The <strong style={{ color:GOLD }}>Life Church</strong> Production · Richmond, VA</div>
        <div style={{ fontSize:12, fontStyle:"italic", color:"#6b6b75", textAlign:"center", flex:1 }}>"Whatever you do, work at it with all your heart" — Col 3:23</div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75", textAlign:"right" }}>Built for the team</div>
      </footer>

      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}`}</style>
    </div>
  );
}
