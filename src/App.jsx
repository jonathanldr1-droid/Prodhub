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
    // Delete all rows using a filter that always matches (id >= 0 for identity cols starting at 1)
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=gte.1`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "return=minimal" }
    });
    // Ignore delete errors — table may just be empty
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
  { name:"Brandon Edwards",  vocal:"Vocal 1", instrument:"none",             iem:"IEM 1",  position:"Downstage Center",    notes:"" },
  { name:"AJ Nelson",        vocal:"Vocal 2", instrument:"Acoustic Guitar",  iem:"IEM 2",  position:"Stage Right",         notes:"Wireless AG or EG" },
  { name:"Brittany Graham",  vocal:"Vocal 3", instrument:"none",             iem:"IEM 3",  position:"Stage Right",         notes:"" },
  { name:"Ashton Connerton", vocal:"Vocal 4", instrument:"none",             iem:"IEM 4",  position:"Upstage Center",      notes:"" },
  { name:"Danielle Holm",    vocal:"Vocal 5", instrument:"none",             iem:"IEM 5",  position:"Upstage Center",      notes:"" },
  { name:"Meghan Scheevel",  vocal:"Vocal 6", instrument:"none",             iem:"IEM 6",  position:"Far Far Stage Right", notes:"" },
  { name:"Brittany Sterkel", vocal:"Vocal 7", instrument:"none",             iem:"IEM 7",  position:"Far Far Stage Left",  notes:"" },
  { name:"",                 vocal:"none",    instrument:"none",             iem:"IEM 8",  position:"not in use",          notes:"Reserve" },
  { name:"Daniel Nickelson", vocal:"none",    instrument:"EG 1",             iem:"IEM 9",  position:"Far Stage Right",     notes:"JDI Stereo DI, 6' 1/4" },
  { name:"Caleb Scheevel",   vocal:"none",    instrument:"EG 2",             iem:"IEM 10", position:"Far Stage Left",      notes:"XLR only (amp sim pad)" },
  { name:"Abbie Youde",      vocal:"none",    instrument:"Keys 1",           iem:"IEM 11", position:"Keys 1 Riser (SR)",   notes:"Stand Height = VII" },
  { name:"Sterling Bain",    vocal:"none",    instrument:"Keys 2",           iem:"IEM 12", position:"Keys 2 Riser (SL)",   notes:"" },
  { name:"Kris Clone",       vocal:"none",    instrument:"Bass",             iem:"IEM 13", position:"Bass Riser",          notes:"" },
  { name:"Josh Roda",        vocal:"none",    instrument:"Drums",            iem:"IEM 14", position:"Drum Riser",          notes:"" },
  { name:"Eryn Dyk",         vocal:"none",    instrument:"Violin",           iem:"IEM 15", position:"Stage Left",          notes:"Violin mic + iPad" },
  { name:"",                 vocal:"none",    instrument:"none",             iem:"IEM 16", position:"not in use",          notes:"" },
];

const DEFAULT_LINKS = {
  dash: [
    { icon:"📋", color:"#c9962a22", title:"Run Sheets",        sub:"Current & archived show files", url:"#", chip:"New", chipColor:"#4caf82" },
    { icon:"☁️", color:"#4f8ef722", title:"Team Drive",         sub:"Google Drive shared folder",   url:"#", chip:"",   chipColor:"" },
    { icon:"📖", color:"#4caf8222", title:"Volunteer Handbook", sub:"Roles, expectations & culture", url:"#", chip:"",   chipColor:"" },
    { icon:"🖥️", color:"#9b72f522", title:"ProPresenter Files", sub:"Templates, assets & libraries", url:"#", chip:"",  chipColor:"" },
  ],
  gear: [
    { icon:"🎚️", color:"#c9962a22", title:"A&H dLive",          sub:"S5000 · DM0 · GX4816 · DX168",  url:"#", chip:"", chipColor:"" },
    { icon:"📹", color:"#4f8ef722", title:"ATEM Constellation",  sub:"2 M/E UHD 4K + SmartView Hub",  url:"#", chip:"", chipColor:"" },
    { icon:"💡", color:"#9b72f522", title:"grandMA3",            sub:"Patch, macros & show files",     url:"#", chip:"", chipColor:"" },
    { icon:"🎬", color:"#38bdb822", title:"Camera System",       sub:"Sony FX30 · FX6 · routing",      url:"#", chip:"", chipColor:"" },
    { icon:"🌐", color:"#4caf8222", title:"Network & IT",        sub:"VLANs, IPs & infra map",         url:"#", chip:"", chipColor:"" },
    { icon:"🔌", color:"#e0525222", title:"Cable Loom Spec",     sub:"175ft 23-conductor layout",      url:"#", chip:"", chipColor:"" },
  ],
  streaming: [
    { icon:"▶️", color:"#e0525222", title:"YouTube Live",     sub:"Live & archive",              url:"#", chip:"Live", chipColor:"#e05252" },
    { icon:"📘", color:"#4f8ef722", title:"Facebook",          sub:"Stream & replay",             url:"#", chip:"",    chipColor:"" },
    { icon:"✝️", color:"#c9962a22", title:"Church Online",     sub:"COPlatform dashboard",        url:"#", chip:"",    chipColor:"" },
    { icon:"📶", color:"#4caf8222", title:"Stream Health",     sub:"Encoder status & bitrate",    url:"#", chip:"",    chipColor:"" },
    { icon:"✉️", color:"#c9962a22", title:"Email Production",  sub:"production@thelifechurch.com",url:"mailto:production@thelifechurch.com", chip:"", chipColor:"" },
    { icon:"🚨", color:"#e0525222", title:"Submit Issue",      sub:"Gear faults & tech probs",    url:"#", chip:"",    chipColor:"" },
    { icon:"🙋", color:"#4f8ef722", title:"Volunteer Sign-Up", sub:"Schedule & serve",            url:"#", chip:"",    chipColor:"" },
  ],
};

const DEFAULT_SVCS = [
  { name:"Main Worship — First Service",  day:0, h:9,  m:0,  dur:90,  s:"9:00 AM",  e:"10:30 AM" },
  { name:"Main Worship — Second Service", day:0, h:11, m:0,  dur:90,  s:"11:00 AM", e:"12:30 PM" },
  { name:"Tuesday Rehearsal",             day:2, h:18, m:30, dur:150, s:"6:30 PM",  e:"9:00 PM"  },
];

// Standard Sunday rundown — shown every week
const DEFAULT_SUNDAY_RUNDOWN = [
  { time:"6:00 AM", name:"Load In / Call Time",          role:"All Crew",    note:"Doors locked, full team on floor" },
  { time:"7:00 AM", name:"Line Check / Rehearsal",       role:"Audio + Band", note:"" },
  { time:"7:30 AM", name:"Hard Run Through",             role:"Full Prod",    note:"Full band + lyrics + lights" },
  { time:"8:10 AM", name:"Check Speaker Mics / Content", role:"Graphics + AV", note:"Confirm all content cued" },
  { time:"8:30 AM", name:"Doors Open",                   role:"House",        note:"" },
  { time:"9:00 AM", name:"First Service",                role:"Full Prod",    note:"" },
  { time:"11:00 AM",name:"Second Service",               role:"Full Prod",    note:"" },
];

const DEFAULT_SCHEDULE = [
  { dot:"today", date:"SUN 4/27", name:"Main Worship — First Service",  role:"Full Prod", time:"9:00 AM" },
  { dot:"today", date:"SUN 4/27", name:"Main Worship — Second Service", role:"Full Prod", time:"11:00 AM" },
  { dot:"up",    date:"TUE 4/29", name:"Tuesday Rehearsal",             role:"Band + Prod", time:"6:30 PM" },
  { dot:"up",    date:"SUN 5/4",  name:"Main Worship — First Service",  role:"Full Prod", time:"9:00 AM" },
  { dot:"up",    date:"SUN 5/4",  name:"Main Worship — Second Service", role:"Full Prod", time:"11:00 AM" },
  { dot:"up",    date:"TUE 5/6",  name:"Tuesday Rehearsal",             role:"Band + Prod", time:"6:30 PM" },
];

const CHAT_MSG_DEFAULTS = [
  { name:"Jon Elder", initials:"JE", color:"#e8b84b", bg:"rgba(201,150,42,.14)", bc:"rgba(201,150,42,.35)", text:"Good morning team — let's have a great service today. FOH check at 8:15.", time:"8:02 AM", me:false },
  { name:"Mike K.",   initials:"MK", color:"#4f8ef7", bg:"rgba(79,142,247,.12)", bc:"rgba(79,142,247,.3)",  text:"On it. Confidence monitors patched and gain structure set.", time:"8:06 AM", me:false },
  { name:"Sarah L.",  initials:"SL", color:"#4caf82", bg:"rgba(76,175,130,.12)", bc:"rgba(76,175,130,.3)",  text:"ProPresenter ready, title slides cued for both services 🙏", time:"8:09 AM", me:false },
];

const CHAT_COLORS = [
  { color:"#e8b84b", bg:"rgba(201,150,42,.14)", bc:"rgba(201,150,42,.35)" },
  { color:"#4f8ef7", bg:"rgba(79,142,247,.12)", bc:"rgba(79,142,247,.3)" },
  { color:"#4caf82", bg:"rgba(76,175,130,.12)", bc:"rgba(76,175,130,.3)" },
  { color:"#9b72f5", bg:"rgba(155,114,245,.12)",bc:"rgba(155,114,245,.3)" },
  { color:"#38bdb8", bg:"rgba(56,189,184,.12)", bc:"rgba(56,189,184,.3)" },
];

/* ── STYLES ── */
const S = {
  app: { background:"#080809", color:"#f0ede8", fontFamily:"'Barlow', system-ui, sans-serif", minHeight:"100vh", width:"100%", maxWidth:"100%", overflowX:"hidden", display:"flex", flexDirection:"column" },
  topbar: { display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"12px 22px", borderBottom:"1px solid rgba(255,255,255,.06)", background:"rgba(8,8,9,.9)", backdropFilter:"blur(14px)", position:"sticky", top:0, zIndex:50, width:"100%" },
  cross: { width:24, height:24, background:GOLD, clipPath:"polygon(40% 0%,60% 0%,60% 40%,100% 40%,100% 60%,60% 60%,60% 100%,40% 100%,40% 60%,0% 60%,0% 40%,40% 40%)", flexShrink:0 },
  pill: { display:"flex", alignItems:"center", gap:6, borderRadius:100, padding:"5px 12px", fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase", cursor:"pointer", border:"1px solid transparent", whiteSpace:"nowrap", userSelect:"none" },
  tabNav: { display:"flex", alignItems:"center", gap:4, padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,.06)", background:"rgba(8,8,9,.85)", backdropFilter:"blur(16px)", overflowX:"auto", width:"100%", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" },
  tabBtn: (active) => ({ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color: active ? "#080809" : "#6b6b75", cursor:"pointer", borderRadius:100, border:"none", outline:"none", whiteSpace:"nowrap", userSelect:"none", flexShrink:0, background: active ? GOLD : "rgba(255,255,255,.05)", fontWeight: active ? 600 : 400, transition:"none" }),
  card: (hover) => ({ background: hover ? "#1a1a20" : "#141418", border:`1px solid ${hover ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.06)'}`, borderRadius:14, padding:"12px 14px", display:"flex", alignItems:"center", gap:12, cursor:"pointer", transition:"all .18s", transform: hover ? "translateX(3px)" : "none", textDecoration:"none", color:"#f0ede8", boxShadow: hover ? "0 4px 20px rgba(0,0,0,.3)" : "none" }),
};

/* ── HELPERS ── */
function pad2(n){ return n < 10 ? "0"+n : ""+n; }
function nextOccurrence(svc){
  const now = new Date();
  const d = new Date(now);
  const diff = (svc.day - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  d.setHours(svc.h, svc.m || 0, 0, 0);
  if(d <= now) d.setDate(d.getDate() + 7);
  return d;
}
function useNow(){
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

/* ══════════════════════════════════════════════════════
   LINK CARD
══════════════════════════════════════════════════════ */
function LinkCard({ item }){
  const [hover, setHover] = useState(false);
  return (
    <a href={item.url !== "#" ? item.url : undefined}
       onClick={item.url === "#" ? e => e.preventDefault() : undefined}
       className="link-card"
       style={S.card(hover)}
       onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ width:32, height:32, borderRadius:8, background:item.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>{item.icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
        <div style={{ fontSize:10, color:"#6b6b75", marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.sub}</div>
      </div>
      {item.chip && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.08em", textTransform:"uppercase", padding:"2px 6px", borderRadius:100, flexShrink:0, border:"1px solid", background:item.chipColor+"22", color:item.chipColor || GOLD_LT, borderColor:(item.chipColor||GOLD)+"55" }}>{item.chip}</span>}
      <span style={{ color: hover ? GOLD : "#6b6b75", fontSize:14, flexShrink:0, transition:"color .15s" }}>›</span>
    </a>
  );
}

function LinkSection({ title, items }){
  return (
    <section style={{ borderRight:"1px solid rgba(255,255,255,.06)", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
      <div style={{ padding:"14px 16px 11px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>{title}</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.06)", borderRadius:100, padding:"2px 7px" }}>{items.length} links</span>
      </div>
      <div style={{ padding:9, display:"flex", flexDirection:"column", gap:5 }}>
        {items.map((it,i) => <LinkCard key={i} item={it} />)}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════
   COUNTDOWN UNIT
══════════════════════════════════════════════════════ */
function CdUnit({ num, label }){
  return (
    <div className="cd-unit-wrap" style={{ background:"#141418", border:"1px solid rgba(255,255,255,.06)", borderRadius:12, padding:"12px 6px", textAlign:"center", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${GOLD},transparent)`, opacity:.5 }} />
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:"clamp(24px,3.8vw,46px)", color:GOLD_LT, lineHeight:1 }}>{num}</div>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, letterSpacing:"0.14em", textTransform:"uppercase", color:"#6b6b75", marginTop:2 }}>{label}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   DASHBOARD TAB
══════════════════════════════════════════════════════ */
function DashboardTab({ svcs, links, schedule, selSvc, setSelSvc, now }){
  const svc = svcs[selSvc] || svcs[0];
  const target = nextOccurrence(svc);
  const ms = Math.max(0, target - now);
  const days = pad2(Math.floor(ms/86400000));
  const hrs  = pad2(Math.floor(ms%86400000/3600000));
  const mins = pad2(Math.floor(ms%3600000/60000));
  const secs = pad2(Math.floor(ms%60000/1000));

  let live = null;
  for(const s of svcs){
    if(s.day !== now.getDay()) continue;
    const st = new Date(now); st.setHours(s.h, s.m||0, 0, 0);
    const en = new Date(st.getTime() + (s.dur||90)*60000);
    if(now >= st && now <= en){ live = {s, st, en}; break; }
  }
  const pct = live ? ((now-live.st)/(live.en-live.st)*100).toFixed(1) : 0;

  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  return (
    <div style={{ display:"flex", flexDirection:"column", width:"100%" }}>
      {/* HERO */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1.1fr", width:"100%", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
        <div style={{ padding:"clamp(24px,4vw,52px) clamp(20px,4vw,48px)", borderRight:"1px solid rgba(255,255,255,.06)", display:"flex", flexDirection:"column", justifyContent:"center", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:GOLD }}>
            <span style={{ width:20, height:1, background:GOLD, display:"inline-block" }}/>Production Hub
          </div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:"clamp(44px,7vw,88px)", lineHeight:.88, letterSpacing:"0.02em", textTransform:"uppercase" }}>
            Prod<span style={{ color:GOLD }}>Hub</span>
          </div>
          <p style={{ fontSize:12, fontWeight:300, fontStyle:"italic", color:"#9a9aa6", lineHeight:1.65, maxWidth:340, borderLeft:`2px solid ${GOLD}`, paddingLeft:13 }}>
            "Whatever you do, work at it with all your heart, as working for the Lord." — Col 3:23
          </p>
        </div>
        <div style={{ padding:"clamp(18px,3vw,40px) clamp(20px,4vw,44px)", display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:"#6b6b75" }}>Countdown To</div>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:"clamp(15px,2.4vw,22px)", letterSpacing:"0.04em", textTransform:"uppercase" }}>{svc.name}</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
            <CdUnit num={days} label="Days"/><CdUnit num={hrs} label="Hrs"/>
            <CdUnit num={mins} label="Min"/><CdUnit num={secs} label="Sec"/>
          </div>
          {/* Progress */}
          <div style={{ background:"#141418", border:"1px solid rgba(255,255,255,.06)", borderRadius:12, padding:"13px 15px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9 }}>
              <span style={{ fontSize:12, fontWeight:600 }}>{live ? live.s.name : svc.name}</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color: live ? "#4caf82" : GOLD }}>{live ? "Live Now" : "Upcoming"}</span>
            </div>
            <div style={{ height:4, background:"rgba(255,255,255,.06)", borderRadius:100, overflow:"hidden" }}>
              <div style={{ height:"100%", borderRadius:100, background:`linear-gradient(90deg,${GOLD},${GOLD_LT})`, width:`${pct}%`, transition:"width 1s linear" }}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", marginTop:5 }}>
              <span>{live ? live.s.s : svc.s}</span><span>{Math.round(pct)}%</span><span>{live ? live.s.e : svc.e}</span>
            </div>
          </div>
          {/* Service selector */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
            {svcs.map((s,i) => (
              <div key={i} onClick={() => setSelSvc(i)} className={`svc-pill${i===selSvc?" active-svc":""}`} style={{ background: i===selSvc ? "rgba(201,150,42,.1)" : "#141418", border:`1px solid ${i===selSvc ? GOLD : "rgba(255,255,255,.06)"}`, borderRadius:10, padding:"8px 5px", textAlign:"center", cursor:"pointer" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", textTransform:"uppercase" }}>{DAYS[s.day]}</div>
                <div style={{ fontSize:11, fontWeight:600, margin:"2px 0" }}>{String(s.name).split("—")[0].trim().split(" ").slice(-2).join(" ")}</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:GOLD }}>{s.s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* DASH GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", width:"100%" }}>
        <LinkSection title="📁 Quick Resources" items={links.dash} />
        {/* Next Up */}
        <section style={{ borderRight:"1px solid rgba(255,255,255,.06)", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
          <div style={{ padding:"14px 16px 11px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>📅 Next Up</span>
          </div>
          {schedule.slice(0,5).map((r,i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"8px 84px 1fr auto", alignItems:"center", gap:10, padding:"11px 16px", borderBottom: i<4 ? "1px solid rgba(255,255,255,.06)" : "none" }}>
              <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background: r.dot==="today" ? "#4caf82" : r.dot==="up" ? GOLD : "rgba(255,255,255,.12)", boxShadow: r.dot==="today" ? "0 0 8px rgba(76,175,130,.5)" : "none", display:"inline-block" }}/>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75", textTransform:"uppercase" }}>{r.date}</span>
              <span style={{ fontSize:13, fontWeight:500 }}>{r.name}</span>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75" }}>{r.time}</span>
            </div>
          ))}
        </section>
        {/* Quick Nav */}
        <section style={{ borderBottom:"1px solid rgba(255,255,255,.06)" }}>
          <div style={{ padding:"14px 16px 11px", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
            <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>🧭 Quick Nav</span>
          </div>
          <div style={{ padding:9, display:"flex", flexDirection:"column", gap:5 }}>
            {[["audio","🎚️","Mic Assignments"],["gear","🔧","Gear Docs"],["schedule","📅","Schedule"],["chat","💬","Team Chat"],["resources","📁","Resources"],["streaming","📡","Streaming"]].map(([tab,icon,title]) => (
              <div key={tab} className="quick-nav-item" style={S.card(false)} onClick={() => document.dispatchEvent(new CustomEvent("switchTab", {detail:tab}))}>
                <div style={{ width:32, height:32, borderRadius:8, background:"rgba(201,150,42,.1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>{icon}</div>
                <div style={{ flex:1, fontSize:12, fontWeight:600 }}>{title}</div>
                <span style={{ color:"#6b6b75", fontSize:14 }}>›</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* BOTTOM STRIP */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", borderTop:"1px solid rgba(255,255,255,.06)", width:"100%" }}>
        {[
          ["🕐","Local Time", now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true})],
          ["📅","Today", now.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})],
          ["📡","Stream Status","Ready"],
          ["👥","On-Site Team","Prod Active"],
        ].map(([icon,label,val],i) => (
          <div key={i} style={{ padding:"12px 16px", borderRight: i<3 ? "1px solid rgba(255,255,255,.06)" : "none", display:"flex", alignItems:"center", gap:9 }}>
            <span style={{ fontSize:16 }}>{icon}</span>
            <div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase", color:"#6b6b75" }}>{label}</div>
              <div style={{ fontSize:13, fontWeight:600, marginTop:1, color: label==="Stream Status" ? "#4caf82" : "#f0ede8" }}>{val}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MIC ASSIGNMENT TAB — matches the spreadsheet picture
══════════════════════════════════════════════════════ */
function VocalTag({ vocal }){
  if(!vocal || vocal === "none") return <span style={{ color:"#6b6b75", fontSize:12 }}>none</span>;
  const bg = VOCAL_COLORS[vocal] || "#555";
  return <span style={{ background:bg, color:"#fff", borderRadius:5, padding:"5px 14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, letterSpacing:"0.05em", textTransform:"uppercase", display:"inline-block", minWidth:80, textAlign:"center" }}>{vocal}</span>;
}

function InstrTag({ instrument }){
  if(!instrument || instrument === "none") return <span style={{ color:"#6b6b75", fontSize:12 }}>none</span>;
  const bg = INSTR_COLORS[instrument] || "#2a2a35";
  const color = INSTR_TEXT[instrument] || "#fff";
  return <span style={{ background:bg, color, borderRadius:5, padding:"5px 14px", fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:14, letterSpacing:"0.05em", textTransform:"uppercase", display:"inline-block", minWidth:80, textAlign:"center" }}>{instrument}</span>;
}

function MicTab({ mics, adminOn, onEdit, onAdd }){
  const [search, setSearch] = useState("");
  const filtered = search ? mics.filter(r =>
    [r.name,r.vocal,r.instrument,r.iem,r.position,r.notes].some(v => String(v||"").toLowerCase().includes(search.toLowerCase()))
  ) : mics;

  const thStyle = { fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.13em", textTransform:"uppercase", color:"#6b6b75", padding:"11px 16px", borderBottom:"1px solid rgba(255,255,255,.12)", borderRight:"1px solid rgba(255,255,255,.06)", textAlign:"left", background:"#0d0d10", whiteSpace:"nowrap" };
  const tdStyle = { padding:"9px 16px", borderRight:"1px solid rgba(255,255,255,.06)", verticalAlign:"middle" };

  return (
    <div style={{ display:"flex", flexDirection:"column", width:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 22px", borderBottom:"1px solid rgba(255,255,255,.06)", flexWrap:"wrap" }}>
        <div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:GOLD }}>Weekend</div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:700, fontSize:22, letterSpacing:"0.04em", textTransform:"uppercase", color:GOLD_LT }}>Band/Vocal Assignments</div>
        </div>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.06)", borderRadius:100, padding:"2px 8px" }}>{mics.length} rows</span>
        <div style={{ marginLeft:"auto" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, instrument…"
            style={{ background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.06)", borderRadius:8, padding:"6px 12px", fontFamily:"'Barlow',sans-serif", fontSize:12, color:"#f0ede8", outline:"none", width:220 }}/>
        </div>
      </div>
      <div style={{ overflowX:"auto", width:"100%" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:700 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width:160 }}>Name</th>
              <th style={{ ...thStyle, width:120 }}>Vocal</th>
              <th style={{ ...thStyle, width:140 }}>Instrument(s)</th>
              <th style={{ ...thStyle, width:110 }}>IEM</th>
              <th style={{ ...thStyle, width:200 }}>Position</th>
              <th style={{ ...thStyle }}>Notes</th>
              {adminOn && <th style={{ ...thStyle, width:50, borderRight:"none" }}>Edit</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={adminOn?7:6} style={{ padding:50, textAlign:"center", fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:"#6b6b75" }}>No rows match</td></tr>
            ) : filtered.map((row, fi) => {
              const isNotInUse = String(row.position||"").toLowerCase().includes("not in use");
              const trStyle = { borderBottom:"1px solid rgba(255,255,255,.06)", background: fi%2===1 ? "rgba(255,255,255,.012)" : "transparent" };
              return (
                <tr key={fi} className="mic-row" style={trStyle}>
                  {/* Name — dark bar like spreadsheet */}
                  <td style={{ ...tdStyle, background:"#0a0a0c", color: row.name ? "#cfcfd6" : "#6b6b75", fontWeight:500 }}>
                    {row.name || <span style={{ fontStyle:"italic" }}>—</span>}
                  </td>
                  <td style={tdStyle}><VocalTag vocal={row.vocal}/></td>
                  <td style={tdStyle}><InstrTag instrument={row.instrument}/></td>
                  <td style={tdStyle}>
                    {row.iem ? (
                      <span style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.08)", borderRadius:5, padding:"4px 10px", fontFamily:"'Barlow',sans-serif", fontSize:13, display:"inline-block", minWidth:80 }}>{row.iem}</span>
                    ) : <span style={{ color:"#6b6b75" }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    {row.position ? (
                      <span style={{ background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.08)", borderRadius:5, padding:"4px 10px", fontFamily:"'Barlow',sans-serif", fontSize:13, color: isNotInUse ? "#6b6b75" : "#f0ede8", fontStyle: isNotInUse ? "italic" : "normal", display:"inline-block", minWidth:140 }}>{row.position}</span>
                    ) : <span style={{ color:"#6b6b75" }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, borderRight:"none" }}>
                    <span style={{ fontSize:12, color:"#9a9aa6", maxWidth:220, display:"block" }}>{row.notes || <span style={{ color:"#6b6b75" }}>—</span>}</span>
                  </td>
                  {adminOn && (
                    <td style={{ ...tdStyle, borderRight:"none", textAlign:"center" }}>
                      <button onClick={() => onEdit(mics.indexOf(row))}
                        style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.08)", borderRadius:6, padding:"4px 8px", fontSize:11, cursor:"pointer", color:"#9a9aa6" }}>✏️</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {adminOn && (
          <div onClick={onAdd} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7, padding:14, fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase", color:"#6b6b75", cursor:"pointer", borderTop:"1px solid rgba(255,255,255,.06)" }}>
            ＋ Add Row
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SCHEDULE TAB
══════════════════════════════════════════════════════ */
function ScheduleTab({ schedule, sundayRundown }){
  const now = new Date();
  // Highlight the current time slot in the Sunday rundown
  const currentSlot = (() => {
    if(now.getDay() !== 0) return -1; // only on Sundays
    const mins = now.getHours()*60 + now.getMinutes();
    for(let i = sundayRundown.length-1; i >= 0; i--){
      const [t, period] = sundayRundown[i].time.split(" ");
      const [h, m] = t.split(":").map(Number);
      const slotMins = ((period==="PM" && h!==12) ? h+12 : (period==="AM" && h===12) ? 0 : h)*60 + m;
      if(mins >= slotMins) return i;
    }
    return -1;
  })();

  return (
    <div style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr 1fr" }}>

      {/* LEFT — Standard Sunday Schedule (permanent) */}
      <div style={{ borderRight:"1px solid rgba(255,255,255,.06)" }}>
        <div style={{ padding:"14px 18px 11px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>☀️ Standard Sunday Schedule</span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:GOLD, background:"rgba(201,150,42,.1)", border:"1px solid rgba(201,150,42,.25)", borderRadius:100, padding:"2px 8px" }}>Every Week</span>
        </div>
        {sundayRundown.map((item, i) => {
          const isActive = i === currentSlot;
          const isPast   = i < currentSlot;
          return (
            <div key={i} style={{
              display:"grid", gridTemplateColumns:"80px 1fr auto", alignItems:"center", gap:12,
              padding:"12px 18px",
              borderBottom: i < sundayRundown.length-1 ? "1px solid rgba(255,255,255,.04)" : "none",
              background: isActive ? "rgba(201,150,42,.06)" : "transparent",
              borderLeft: isActive ? `3px solid ${GOLD}` : "3px solid transparent",
            }}>
              <span style={{
                fontFamily:"'Barlow Condensed',sans-serif", fontSize:18, fontWeight:800,
                color: isActive ? GOLD_LT : isPast ? "rgba(255,255,255,.2)" : "#f0ede8",
                letterSpacing:"0.02em", lineHeight:1,
              }}>{item.time}</span>
              <div>
                <div style={{ fontSize:13, fontWeight: isActive ? 600 : 500, color: isPast ? "rgba(255,255,255,.3)" : "#f0ede8" }}>{item.name}</div>
                {item.note && <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", marginTop:2 }}>{item.note}</div>}
              </div>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color: isActive ? GOLD : "#6b6b75", textTransform:"uppercase", letterSpacing:"0.07em", textAlign:"right", whiteSpace:"nowrap" }}>{item.role}</span>
            </div>
          );
        })}
      </div>

      {/* RIGHT — This Week's Services */}
      <div>
        <div style={{ padding:"14px 18px 11px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>📅 This Week's Services</span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.06)", borderRadius:100, padding:"2px 7px" }}>Upcoming</span>
        </div>
        {schedule.map((r,i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:"8px 84px 1fr auto auto", alignItems:"center", gap:12, padding:"12px 18px", borderBottom: i<schedule.length-1 ? "1px solid rgba(255,255,255,.06)" : "none" }}>
            <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, display:"inline-block",
              background: r.dot==="today" ? "#4caf82" : r.dot==="up" ? GOLD : "rgba(255,255,255,.12)",
              boxShadow: r.dot==="today" ? "0 0 8px rgba(76,175,130,.5)" : "none"
            }}/>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75", textTransform:"uppercase" }}>{r.date}</span>
            <span style={{ fontSize:13, fontWeight:500 }}>{r.name}</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#9a9aa6", textTransform:"uppercase" }}>{r.role}</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75" }}>{r.time}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

/* ══════════════════════════════════════════════════════
   CHAT TAB
══════════════════════════════════════════════════════ */
const nameColorIdx = {};
function getChatColor(name){
  if(nameColorIdx[name] === undefined) nameColorIdx[name] = Object.keys(nameColorIdx).length % CHAT_COLORS.length;
  return CHAT_COLORS[nameColorIdx[name]];
}
function initials(n){ return String(n).trim().split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2); }

/* ══════════════════════════════════════════════════════
   CHAT — Supabase real-time
══════════════════════════════════════════════════════ */
function useChatSubscription(setMsgs){
  useEffect(() => {
    // Load last 50 messages on mount
    fetch(`${SUPABASE_URL}/rest/v1/tlc_chat?order=created_at.asc&limit=50`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    })
    .then(r => r.json())
    .then(rows => {
      if(Array.isArray(rows)) setMsgs(rows.map(dbToMsg));
    })
    .catch(() => {});

    // Subscribe to new messages via Supabase Realtime
    let es;
    try {
      const realtimeUrl = `${SUPABASE_URL}/realtime/v1/sse?apikey=${SUPABASE_KEY}`;
      es = new EventSource(realtimeUrl + "&vsn=1.0.0");
      // Poll fallback every 4s if SSE not available
    } catch(e) {}

    // Polling fallback — fetch new messages every 4 seconds
    let lastId = 0;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/tlc_chat?order=created_at.asc&id=gt.${lastId}&limit=20`, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const rows = await r.json();
        if(Array.isArray(rows) && rows.length > 0){
          lastId = rows[rows.length-1].id;
          setMsgs(m => {
            const existing = new Set(m.map(x => x.id));
            const newMsgs = rows.filter(r => !existing.has(r.id)).map(dbToMsg);
            return newMsgs.length ? [...m, ...newMsgs] : m;
          });
        }
      } catch(e){}
    }, 4000);

    return () => {
      clearInterval(poll);
      if(es) es.close();
    };
  }, []);
}

function dbToMsg(r){
  const c = getChatColor(r.author);
  return {
    id: r.id,
    name: r.author,
    initials: initials(r.author),
    color: c.color, bg: c.bg, bc: c.bc,
    text: r.message,
    time: new Date(r.created_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}),
    me: false // server messages — we track "me" locally by name match
  };
}

async function sendChatMsg(author, message){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tlc_chat`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ author, message })
  });
  if(!r.ok) throw new Error("Send failed");
  return r.json();
}

function ChatTab(){
  const [msgs, setMsgs] = useState([]);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem("tlc_chat_name") || ""; } catch(e){ return ""; }
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [connStatus, setConnStatus] = useState("connecting");
  const msgsRef = useRef(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  useChatSubscription(rows => {
    setMsgs(rows);
    setConnStatus("live");
  });

  // Also update conn status on first load
  useEffect(() => {
    const t = setTimeout(() => setConnStatus(prev => prev === "connecting" ? "live" : prev), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if(msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [msgs]);

  const saveName = (n) => {
    setName(n);
    try { localStorage.setItem("tlc_chat_name", n); } catch(e){}
  };

  const send = async () => {
    const nm = nameRef.current.trim();
    const txt = text.trim();
    if(!txt || !nm || sending) return;
    setSending(true);
    setText("");
    // Optimistic local message
    const c = getChatColor(nm);
    const optimistic = { id: `opt_${Date.now()}`, name:nm, initials:initials(nm), color:c.color, bg:c.bg, bc:c.bc, text:txt, time:new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true}), me:true };
    setMsgs(m => [...m, optimistic]);
    try {
      await sendChatMsg(nm, txt);
    } catch(e) {
      // Keep optimistic message even if send fails
    }
    setSending(false);
  };

  const onKey = e => { if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send(); } };

  const showEmpty = msgs.length === 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 120px)", minHeight:500 }}>
      {/* Header */}
      <div style={{ padding:"12px 18px", borderBottom:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>💬 Team Chat</span>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ width:7, height:7, borderRadius:"50%", background: connStatus==="live" ? "#4caf82" : "#e8b84b", boxShadow: connStatus==="live" ? "0 0 8px rgba(76,175,130,.5)" : "none", display:"inline-block", animation: connStatus==="connecting" ? "blink 1.5s infinite" : "none" }}/>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color: connStatus==="live" ? "#4caf82" : "#e8b84b" }}>{connStatus === "live" ? "Live" : "Connecting…"}</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={msgsRef} style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ textAlign:"center", fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", color:"rgba(255,255,255,.15)", textTransform:"uppercase", padding:"4px 0" }}>
          The Life Church Production — Team Chat
        </div>
        {showEmpty && (
          <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8, opacity:.4 }}>
            <div style={{ fontSize:32 }}>💬</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:"#6b6b75" }}>No messages yet — say something</div>
          </div>
        )}
        {msgs.map((m, i) => {
          const isMe = m.me || m.name === name.trim();
          return (
            <div key={m.id || i} className="chat-msg-enter" style={{ display:"flex", gap:9, alignItems:"flex-end", flexDirection: isMe ? "row-reverse" : "row" }}>
              <div style={{ width:28, height:28, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, border:`1px solid ${m.bc}`, background:m.bg, color:m.color }}>{m.initials}</div>
              <div style={{ maxWidth:"72%" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.08em", color:m.color, textTransform:"uppercase", marginBottom:3, textAlign: isMe ? "right" : "left" }}>{m.name}</div>
                <div style={{ background: isMe ? `linear-gradient(135deg, rgba(201,150,42,.25), rgba(201,150,42,.1))` : "#1a1a20", border:`1px solid ${isMe ? "rgba(201,150,42,.3)" : "rgba(255,255,255,.07)"}`, borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding:"9px 13px", boxShadow: isMe ? "0 2px 12px rgba(201,150,42,.15)" : "0 2px 8px rgba(0,0,0,.2)" }}>
                  <div style={{ fontSize:13, lineHeight:1.55, color:"#f0ede8" }}>{m.text}</div>
                </div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(255,255,255,.2)", marginTop:3, textAlign: isMe ? "right" : "left" }}>{m.time}</div>
              </div>
            </div>
          );
        })}
        {sending && (
          <div style={{ display:"flex", justifyContent:"flex-end", paddingRight:37 }}>
            <div style={{ background:"rgba(201,150,42,.08)", border:"1px solid rgba(201,150,42,.15)", borderRadius:"14px 14px 4px 14px", padding:"8px 13px" }}>
              <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                {[0,1,2].map(i => <span key={i} style={{ width:5, height:5, borderRadius:"50%", background:GOLD, opacity:.6, animation:`blink 1.2s ${i*0.2}s infinite`, display:"inline-block" }}/>)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,.08)", background:"rgba(8,8,9,.6)", backdropFilter:"blur(10px)" }}>
        <div style={{ padding:"8px 14px 0", display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background: getChatColor(name.trim()||"You").color, flexShrink:0 }}/>
          <input value={name} onChange={e=>saveName(e.target.value)} placeholder="Enter your name…" maxLength={24}
            style={{ flex:1, background:"transparent", border:"none", outline:"none", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:GOLD_LT, letterSpacing:"0.06em" }}/>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", padding:"6px 14px 12px" }}>
          <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={onKey}
            placeholder={name.trim() ? `Message as ${name.trim()}…` : "Set your name above first…"}
            disabled={!name.trim()}
            rows={1}
            style={{ flex:1, background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:12, padding:"10px 14px", fontFamily:"'Barlow',sans-serif", fontSize:13, color:"#f0ede8", outline:"none", resize:"none", minHeight:40, maxHeight:100, lineHeight:1.4, transition:"border-color .2s", borderColor: text ? "rgba(201,150,42,.4)" : "rgba(255,255,255,.08)" }}/>
          <button onClick={send} disabled={!text.trim() || !name.trim() || sending}
            style={{ width:40, height:40, borderRadius:12, background: text.trim() && name.trim() ? GOLD : "rgba(255,255,255,.06)", border:"none", cursor: text.trim() && name.trim() ? "pointer" : "default", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0, transition:"background .2s, transform .1s", transform: sending ? "scale(0.92)" : "scale(1)" }}>➤</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ADMIN — PIN + DRAWER
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   SUPABASE SYNC HOOK
══════════════════════════════════════════════════════ */
function useSupabase({ setSchedule, setSundayRundown, setLinks }){
  const [dbState, setDbState] = useState("idle"); // idle | loading | saving | error | ok
  const [dbMsg,   setDbMsg]   = useState("");

  const loadAll = useCallback(async () => {
    setDbState("loading"); setDbMsg("Loading…");
    try {
      const [schedRows, rundownRows, linkRows] = await Promise.all([
        sb.get("tlc_schedule"),
        sb.get("tlc_rundown"),
        sb.get("tlc_links"),
      ]);
      if(schedRows.length)   setSchedule(schedRows.map(dbToSchedule));
      if(rundownRows.length) setSundayRundown(rundownRows.map(dbToRundown));
      if(linkRows.length){
        const bySection = { dash:[], gear:[], streaming:[] };
        linkRows.forEach(r => { if(bySection[r.section]) bySection[r.section].push(dbToLinks(r)); });
        if(linkRows.length) setLinks(bySection);
      }
      setDbState("ok"); setDbMsg("");
    } catch(e){
      // Silent fail on load — app works fine with local defaults
      setDbState("idle"); setDbMsg("");
      console.warn("Supabase load:", e.message);
    }
  }, [setSchedule, setSundayRundown, setLinks]);

  const saveAll = useCallback(async (schedule, sundayRundown, links) => {
    setDbState("saving"); setDbMsg("Saving…");
    try {
      const schedRows   = toDbRows(schedule,      r => ({ dot:r.dot, date:r.date, name:r.name, role:r.role, time:r.time }));
      const rundownRows = toDbRows(sundayRundown,  r => ({ time:r.time, name:r.name, role:r.role, note:r.note||"" }));
      const linkRows    = toDbRows(
        [...links.dash.map(l=>({...l,section:"dash"})),
         ...links.gear.map(l=>({...l,section:"gear"})),
         ...links.streaming.map(l=>({...l,section:"streaming"}))],
        r => ({ icon:r.icon, color:r.color, title:r.title, sub:r.sub, url:r.url, chip:r.chip||"", chip_color:r.chipColor||"", section:r.section })
      );
      await Promise.all([
        sb.replace("tlc_schedule", schedRows),
        sb.replace("tlc_rundown",  rundownRows),
        sb.replace("tlc_links",    linkRows),
      ]);
      setDbState("ok"); setDbMsg("Saved ✓");
      setTimeout(() => setDbMsg(""), 2500);
    } catch(e){
      setDbState("error"); setDbMsg(e.message);
    }
  }, []);

  return { dbState, dbMsg, loadAll, saveAll };
}

/* ══════════════════════════════════════════════════════
   GOOGLE SHEETS SYNC HOOK
══════════════════════════════════════════════════════ */
function useSheetSync(setMics){
  const [syncState, setSyncState] = useState("idle"); // idle | loading | success | error
  const [syncMsg,   setSyncMsg]   = useState("");
  const [csvUrl_,   setCsvUrl_]   = useState(TLC_CSV_URL);
  const [lastSync,  setLastSync]  = useState(null);

  const sync = async (urlOverride) => {
    const url = urlOverride || csvUrl_;
    if(!url){ setSyncState("error"); setSyncMsg("Paste your published CSV URL first."); return; }
    setSyncState("loading"); setSyncMsg("");

    // Try multiple proxies in sequence — the sandbox blocks direct fetch,
    // but when hosted on Vercel/Netlify the direct fetch will work immediately.
    const attempts = [
      // 1. Direct (works when hosted, blocked in claude.ai preview)
      () => fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))),
      // 2. corsproxy.io
      () => fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.text() : Promise.reject()),
      // 3. allorigins — returns JSON wrapper
      () => fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) })
              .then(r => r.ok ? r.json() : Promise.reject())
              .then(j => { if(!j.contents) throw new Error("empty"); return j.contents; }),
      // 4. thingproxy
      () => fetch(`https://thingproxy.freeboard.io/fetch/${url}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.text() : Promise.reject()),
    ];

    let raw = null;
    let lastErr = "";
    for(const attempt of attempts){
      try { raw = await attempt(); if(raw && raw.length > 10) break; }
      catch(e){ lastErr = e.message || "blocked"; raw = null; }
    }

    if(!raw){
      setSyncState("error");
      setSyncMsg("⚠️ Sync works when hosted (Vercel/Netlify) — blocked in claude.ai preview. Export CSV manually to test here.");
      return;
    }

    try {
      const rows = parseSheetCSV(raw);
      if(rows.length === 0) throw new Error("No data rows found — check column headers: Name, Vocal, Instrument, IEM, Position, Notes");
      setMics(rows);
      setSyncState("success");
      setSyncMsg(`✓ Synced ${rows.length} rows`);
      setLastSync(new Date());
    } catch(err){
      setSyncState("error");
      setSyncMsg(err.message || "Parse failed");
    }
  };

  const [pasteText, setPasteText] = useState("");
  const [pasteMsg,  setPasteMsg]  = useState("");

  const syncFromPaste = () => {
    if(!pasteText.trim()){ setPasteMsg("Paste your CSV text above first."); return; }
    try {
      const rows = parseSheetCSV(pasteText);
      if(rows.length === 0) throw new Error("No rows found — check headers: Name, Vocal, Instrument, IEM, Position, Notes");
      setMics(rows);
      setPasteMsg(`✓ Loaded ${rows.length} rows`);
      setLastSync(new Date());
      setTimeout(() => setPasteMsg(""), 4000);
    } catch(e){
      setPasteMsg(e.message || "Parse error");
    }
  };

  return { syncState, syncMsg, csvUrl_, setCsvUrl_, sync, lastSync, pasteText, setPasteText, pasteMsg, syncFromPaste };
}

function PinModal({ onSuccess, onClose }){
  const [buf, setBuf] = useState("");
  const [err, setErr] = useState("");
  const PIN = "1234";
  const press = (n) => {
    if(buf.length >= 4) return;
    const next = buf + n;
    setBuf(next);
    if(next.length === 4){
      if(next === PIN){ setTimeout(() => { setBuf(""); onSuccess(); }, 120); }
      else { setTimeout(() => { setBuf(""); setErr("Incorrect PIN"); setTimeout(() => setErr(""), 1200); }, 120); }
    }
  };
  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(8,8,9,.94)", backdropFilter:"blur(18px)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#141418", border:"1px solid rgba(255,255,255,.13)", borderRadius:18, padding:"34px 30px", width:310, textAlign:"center", position:"relative" }}>
        <button onClick={onClose} style={{ position:"absolute", top:12, right:14, background:"none", border:"none", color:"#6b6b75", fontSize:17, cursor:"pointer" }}>✕</button>
        <div style={{ width:30, height:30, background:GOLD, clipPath:"polygon(40% 0%,60% 0%,60% 40%,100% 40%,100% 60%,60% 60%,60% 100%,40% 100%,40% 60%,0% 60%,0% 40%,40% 40%)", margin:"0 auto 14px" }}/>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:20, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>Admin Access</div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.12em", color:"#6b6b75", textTransform:"uppercase", marginBottom:22 }}>Enter your PIN · Default: 1234</div>
        <div style={{ display:"flex", justifyContent:"center", gap:10, marginBottom:18 }}>
          {[0,1,2,3].map(i => <div key={i} style={{ width:12, height:12, borderRadius:"50%", border:`2px solid ${i<buf.length ? (err ? "#e05252" : GOLD) : "rgba(255,255,255,.13)"}`, background: i<buf.length ? (err ? "#e05252" : GOLD) : "transparent", transition:"all .15s" }}/>)}
        </div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#e05252", letterSpacing:"0.1em", textTransform:"uppercase", height:13, marginBottom:8 }}>{err}</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:9, marginBottom:14 }}>
          {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} onClick={()=>press(String(n))} style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.08)", borderRadius:11, padding:13, fontFamily:"'Barlow Condensed',sans-serif", fontSize:21, fontWeight:700, cursor:"pointer", color:"#f0ede8" }}>{n}</button>)}
          <div/>
          <button onClick={()=>press("0")} style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.08)", borderRadius:11, padding:13, fontFamily:"'Barlow Condensed',sans-serif", fontSize:21, fontWeight:700, cursor:"pointer", color:"#f0ede8" }}>0</button>
          <button onClick={()=>setBuf(b=>b.slice(0,-1))} style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.08)", borderRadius:11, padding:13, fontSize:15, cursor:"pointer", color:"#6b6b75" }}>⌫</button>
        </div>
      </div>
    </div>
  );
}

function AdminDrawer({ mics, setMics, links, setLinks, schedule, setSchedule, svcs, setSvcs, onLock, onSave, editTarget, syncState, syncMsg, csvUrl_, setCsvUrl_, onSync, lastSync, pasteText, setPasteText, pasteMsg, syncFromPaste, sundayRundown, setSundayRundown }){
  const inp = (label, val, onChange, placeholder="") => (
    <div style={{ marginBottom:5 }}>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:2 }}>{label}</div>
      <input value={val||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow',sans-serif", fontSize:12, color:"#f0ede8", outline:"none" }}/>
    </div>
  );
  const sel = (label, val, options, onChange) => (
    <div style={{ marginBottom:5 }}>
      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:2 }}>{label}</div>
      <select value={val||""} onChange={e=>onChange(e.target.value)}
        style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow',sans-serif", fontSize:12, color:"#f0ede8", outline:"none", cursor:"pointer" }}>
        {options.map(o => <option key={o.value||o} value={o.value||o} style={{ background:"#141418" }}>{o.label||o}</option>)}
      </select>
    </div>
  );
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const [lockConfirm, setLockConfirm] = useState(false);
  const updateMic = (i, field, val) => setMics(m => m.map((r,idx) => idx===i ? {...r, [field]:val} : r));
  const updateSched = (i, field, val) => setSchedule(s => s.map((r,idx) => idx===i ? {...r, [field]:val} : r));

  const secTitle = (t) => (
    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:GOLD, marginBottom:9, display:"flex", alignItems:"center", gap:8 }}>
      {t}<div style={{ flex:1, height:1, background:"rgba(201,150,42,.2)" }}/>
    </div>
  );
  const card = (children) => <div style={{ background:"#141418", border:"1px solid rgba(255,255,255,.08)", borderRadius:10, padding:11, marginBottom:6 }}>{children}</div>;

  return (
    <div style={{ position:"fixed", top:0, right:0, bottom:0, width:"min(540px,100vw)", zIndex:150, background:"#101013", borderLeft:"1px solid rgba(255,255,255,.13)", display:"flex", flexDirection:"column", overflowY:"auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 18px", borderBottom:"1px solid rgba(255,255,255,.08)", position:"sticky", top:0, background:"#101013", zIndex:10 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:17, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>⚙ Admin <span style={{ color:GOLD }}>Mode</span></div>
        <button onClick={() => document.dispatchEvent(new CustomEvent("closeAdmin"))} style={{ background:"none", border:"none", color:"#6b6b75", fontSize:19, cursor:"pointer" }}>✕</button>
      </div>
      <div style={{ padding:14, flex:1 }}>
        {/* GOOGLE SHEETS SYNC */}
        <div style={{ marginBottom:22 }}>
          {secTitle("📊 Google Sheets Sync")}
          <div style={{ background:"#141418", border:"1px solid rgba(255,255,255,.08)", borderRadius:10, padding:12, marginBottom:8 }}>
            {/* Instructions */}
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.08em", color:"#6b6b75", lineHeight:1.7, marginBottom:10 }}>
              <div style={{ color:"#9a9aa6", marginBottom:4, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase" }}>TLC Sheet already published ✓</div>
              Click <strong>Quick Sync</strong> below to pull the latest weekend data.<br/>
              URL is pre-filled. For a different sheet, paste its published CSV URL above.
            </div>
            {/* URL input */}
            <div style={{ marginBottom:8 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:4 }}>Published CSV URL</div>
              <input
                value={csvUrl_}
                onChange={e => setCsvUrl_(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…/pub?output=csv"
                style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"7px 10px", fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#f0ede8", outline:"none", wordBreak:"break-all" }}
              />
            </div>
            {/* Sync button + status */}
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <button onClick={() => onSync(csvUrl_)} disabled={syncState === "loading"}
                style={{ padding:"9px 18px", background: syncState==="loading" ? "rgba(201,150,42,.3)" : GOLD, color:"#080809", border:"none", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", cursor: syncState==="loading" ? "wait" : "pointer", fontWeight:700, display:"flex", alignItems:"center", gap:7, flexShrink:0 }}>
                {syncState === "loading" ? <>⟳ Syncing…</> : <>⟳ Resync from Sheet</>}
              </button>
              {syncMsg && (
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.08em", color: syncState==="success" ? "#4caf82" : "#e05252" }}>
                  {syncMsg}
                </span>
              )}
            </div>
            {lastSync && (
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", marginTop:7 }}>
                Last synced: {lastSync.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})} · {lastSync.toLocaleDateString("en-US",{month:"short",day:"numeric"})}
              </div>
            )}
          </div>
          {/* Quick-fill for known sheet */}
          <button onClick={() => { setCsvUrl_(TLC_CSV_URL); onSync(TLC_CSV_URL); }}
            style={{ width:"100%", padding:"8px 14px", background:"rgba(201,150,42,.08)", border:"1px solid rgba(201,150,42,.2)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:GOLD_LT, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            ⚡ Quick Sync — Weekend RF Assignments
          </button>

          {/* Manual CSV paste — works in claude.ai preview */}
          <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid rgba(255,255,255,.06)" }}>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:6 }}>
              📋 Paste CSV manually (works in preview)
            </div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", lineHeight:1.6, marginBottom:8 }}>
              In Google Sheets: <strong style={{color:"#9a9aa6"}}>File → Download → CSV</strong><br/>
              Open the file, select all, paste below:
            </div>
            <textarea
              value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder={"Name,Vocal,Instrument,IEM,Position,Notes\nBrandon Edwards,Vocal 1,none,IEM 1,Downstage Center,..."}
              style={{ width:"100%", height:80, background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"7px 10px", fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#f0ede8", outline:"none", resize:"vertical", lineHeight:1.4 }}
            />
            <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:6 }}>
              <button onClick={syncFromPaste}
                style={{ padding:"8px 14px", background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"#9a9aa6", cursor:"pointer" }}>
                Load Pasted CSV
              </button>
              {pasteMsg && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color: pasteMsg.startsWith("✓") ? "#4caf82" : "#e05252" }}>{pasteMsg}</span>}
            </div>
          </div>
        </div>

        {/* MIC ASSIGNMENTS */}
        <div style={{ marginBottom:22 }}>
          {secTitle("🎚️ Mic Assignments")}
          {mics.map((r,i) => (
            <div key={i} data-idx={i} style={{ background:"#141418", border: editTarget===i ? `1px solid ${GOLD}` : "1px solid rgba(255,255,255,.08)", borderRadius:10, padding:11, marginBottom:6 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                <input value={r.name||""} onChange={e=>updateMic(i,"name",e.target.value)} placeholder="Name"
                  style={{ flex:1, background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow',sans-serif", fontSize:12, fontWeight:600, color:"#f0ede8", outline:"none" }}/>
                <button onClick={()=>setMics(m=>m.filter((_,idx)=>idx!==i))} style={{ background:"rgba(224,82,82,.08)", border:"1px solid rgba(224,82,82,.2)", color:"#e05252", borderRadius:7, padding:"4px 9px", fontSize:11, cursor:"pointer" }}>✕</button>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                {sel("Vocal",r.vocal,["none","Vocal 1","Vocal 2","Vocal 3","Vocal 4","Vocal 5","Vocal 6","Vocal 7","Vocal 8","Vocal 9"],v=>updateMic(i,"vocal",v))}
                {inp("Instrument(s)",r.instrument==="none"?"":r.instrument,v=>updateMic(i,"instrument",v||"none"),"e.g. Keys 1, Bass")}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                {inp("IEM",r.iem,v=>updateMic(i,"iem",v),"e.g. IEM 1")}
                {inp("Position",r.position,v=>updateMic(i,"position",v),"e.g. Stage Left")}
              </div>
              {inp("Notes",r.notes,v=>updateMic(i,"notes",v),"Notes…")}
            </div>
          ))}
          <button onClick={()=>setMics(m=>[...m,{name:"",vocal:"none",instrument:"none",iem:`IEM ${m.length+1}`,position:"",notes:""}])}
            style={{ width:"100%", padding:"8px 14px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"#9a9aa6", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>＋ Add Row</button>
        </div>

        {/* SUNDAY RUNDOWN */}
        <div style={{ marginBottom:22 }}>
          {secTitle("☀️ Standard Sunday Schedule")}
          {sundayRundown.map((item, i) => (
            <div key={i} style={{ background:"#141418", border:"1px solid rgba(255,255,255,.08)", borderRadius:10, padding:11, marginBottom:6 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                <div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:2 }}>Time</div>
                  <input value={item.time} onChange={e => setSundayRundown(r => r.map((x,idx) => idx===i ? {...x, time:e.target.value} : x))}
                    placeholder="e.g. 6:00 AM"
                    style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:700, color:GOLD_LT, outline:"none" }}/>
                </div>
                <div style={{ display:"flex", alignItems:"flex-end", gap:6 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:2 }}>Role / Crew</div>
                    <input value={item.role} onChange={e => setSundayRundown(r => r.map((x,idx) => idx===i ? {...x, role:e.target.value} : x))}
                      placeholder="e.g. Full Prod"
                      style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow',sans-serif", fontSize:12, color:"#f0ede8", outline:"none" }}/>
                  </div>
                  <button onClick={() => setSundayRundown(r => r.filter((_,idx) => idx !== i))}
                    style={{ background:"rgba(224,82,82,.08)", border:"1px solid rgba(224,82,82,.2)", color:"#e05252", borderRadius:7, padding:"6px 9px", fontSize:11, cursor:"pointer", marginBottom:0, flexShrink:0 }}>✕</button>
                </div>
              </div>
              <div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:2 }}>Event Name</div>
                <input value={item.name} onChange={e => setSundayRundown(r => r.map((x,idx) => idx===i ? {...x, name:e.target.value} : x))}
                  placeholder="e.g. Load In / Call Time"
                  style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow',sans-serif", fontSize:12, color:"#f0ede8", outline:"none" }}/>
              </div>
              <div style={{ marginTop:6 }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", color:"#6b6b75", marginBottom:2 }}>Note (optional)</div>
                <input value={item.note||""} onChange={e => setSundayRundown(r => r.map((x,idx) => idx===i ? {...x, note:e.target.value} : x))}
                  placeholder="e.g. Full band + lyrics + lights"
                  style={{ width:"100%", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:7, padding:"6px 9px", fontFamily:"'Barlow',sans-serif", fontSize:12, color:"#f0ede8", outline:"none" }}/>
              </div>
            </div>
          ))}
          <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
            <button onClick={() => setSundayRundown(r => [...r, { time:"", name:"New Item", role:"", note:"" }])}
              style={{ flex:1, padding:"8px 14px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"#9a9aa6", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>＋ Add Item</button>
            <button onClick={() => setSundayRundown(JSON.parse(JSON.stringify(DEFAULT_SUNDAY_RUNDOWN)))}
              style={{ padding:"8px 14px", background:"rgba(201,150,42,.08)", border:"1px solid rgba(201,150,42,.2)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:GOLD_LT, cursor:"pointer" }}>↺ Reset to Standard</button>
          </div>
        </div>

        {/* SCHEDULE */}
        <div style={{ marginBottom:22 }}>
          {secTitle("📅 Schedule")}
          {schedule.map((r,i) => card(
            <div key={i}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                {inp("Date",r.date,v=>updateSched(i,"date",v))}
                {inp("Time",r.time,v=>updateSched(i,"time",v))}
              </div>
              {inp("Service Name",r.name,v=>updateSched(i,"name",v))}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:6, alignItems:"flex-end" }}>
                {inp("Role/Crew",r.role,v=>updateSched(i,"role",v))}
                {sel("Status",r.dot,[{value:"today",label:"Today"},{value:"up",label:"Upcoming"},{value:"past",label:"Past"}],v=>updateSched(i,"dot",v))}
                <button onClick={()=>setSchedule(s=>s.filter((_,idx)=>idx!==i))} style={{ background:"rgba(224,82,82,.08)", border:"1px solid rgba(224,82,82,.2)", color:"#e05252", borderRadius:7, padding:"6px 9px", fontSize:11, cursor:"pointer", marginBottom:5 }}>✕</button>
              </div>
            </div>
          ))}
          <button onClick={()=>setSchedule(s=>[...s,{dot:"up",date:"SUN",name:"New Service",role:"Full Prod",time:"9:00 AM"}])}
            style={{ width:"100%", padding:"8px 14px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.1)", borderRadius:8, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:"#9a9aa6", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>＋ Add Row</button>
        </div>

        {/* RESET */}
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
  const [links, setLinks] = useState(JSON.parse(JSON.stringify(DEFAULT_LINKS)));
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [sundayRundown, setSundayRundown] = useState(JSON.parse(JSON.stringify(DEFAULT_SUNDAY_RUNDOWN)));
  const [svcs] = useState(DEFAULT_SVCS);
  const now = useNow();
  const { syncState, syncMsg, csvUrl_, setCsvUrl_, sync, lastSync, pasteText, setPasteText, pasteMsg, syncFromPaste } = useSheetSync(setMics);
  const { dbState, dbMsg, loadAll, saveAll: dbSave } = useSupabase({ setSchedule, setSundayRundown, setLinks });

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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body,#root{width:100%;min-height:100vh;margin:0;padding:0;background:#080809;}
body{overflow-x:hidden;}
a{color:inherit;text-decoration:none;}
button{font-family:inherit;cursor:pointer;}
input,textarea,select{font-family:inherit;}
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes fadeSlideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes glow{0%,100%{box-shadow:0 0 8px rgba(201,150,42,0)}50%{box-shadow:0 0 18px rgba(201,150,42,0.35)}}
.tab-panel-enter{animation:scaleUp 0.84s cubic-bezier(0.34,1.08,0.64,1) forwards;}
@keyframes scaleUp{from{opacity:0;transform:scale(0.98) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes fadeSlideIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:translateX(0)}}
.chat-msg-enter{animation:fadeSlideUp 0.6s cubic-bezier(0.4,0,0.2,1) forwards;}
.link-card{transition:transform 0.44s cubic-bezier(0.4,0,0.2,1),box-shadow 0.44s,border-color 0.44s,background 0.44s;}
.link-card:hover{transform:translateX(4px) translateY(-1px);box-shadow:0 6px 24px rgba(0,0,0,0.4);}
.nav-tab{position:relative;transition:color 0.36s,background 0.36s;}
.nav-tab::after{content:'';position:absolute;bottom:0;left:50%;width:0;height:2px;background:linear-gradient(90deg,transparent,#e8b84b,transparent);transform:translateX(-50%);transition:width 0.64s cubic-bezier(0.4,0,0.2,1);}
.nav-tab:hover::after{width:80%;}
.nav-tab.active-tab::after{width:100%;background:#c9962a;}
.nav-tab:hover{color:#9a9aa6;background:rgba(255,255,255,0.03);}
.nav-tab.active-tab{color:#e8b84b;background:linear-gradient(180deg,rgba(201,150,42,0.06) 0%,transparent 100%);}
.quick-nav-item{transition:transform 0.44s cubic-bezier(0.4,0,0.2,1),box-shadow 0.44s,border-color 0.44s,background 0.44s;}
.quick-nav-item:hover{transform:translateX(5px);box-shadow:0 4px 20px rgba(0,0,0,0.35);border-color:rgba(255,255,255,0.12)!important;background:#1a1a20!important;}
.svc-pill{transition:transform 0.44s,border-color 0.44s,background 0.44s,box-shadow 0.44s;}
.svc-pill:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(201,150,42,0.15);}
.svc-pill.active-svc{box-shadow:0 0 0 1px #c9962a, 0 4px 20px rgba(201,150,42,0.2);}
.cd-unit-wrap{transition:transform 0.44s cubic-bezier(0.4,0,0.2,1);}
.cd-unit-wrap:hover{transform:scale(1.04);}
.schedule-row{transition:background 0.4s,transform 0.4s;}
.schedule-row:hover{background:rgba(255,255,255,0.03)!important;transform:translateX(3px);}
.mic-row{transition:background 0.3s;}
.mic-row:hover{background:rgba(255,255,255,0.04)!important;}
`}</style>

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
        {savedMsg && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", color:"#4caf82", textTransform:"uppercase" }}>Saved ✓</span>}
        {dbState==="saving" && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"#6b6b75", letterSpacing:"0.1em" }}>⟳ Saving…</span>}
        {dbState==="error" && dbMsg && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.1em", color:"#e05252", textTransform:"uppercase" }}>⚠ {dbMsg}</span>}
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
            className={`nav-tab${activeTab===t.id?" active-tab":""}`}
            style={S.tabBtn(activeTab===t.id)}>
            <span style={{ fontSize:12 }}>{t.icon}</span>
            <span>{t.label}</span>
            {t.id==="audio" && <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, background: activeTab==="audio" ? "rgba(8,8,9,.3)" : "rgba(255,255,255,.07)", borderRadius:100, padding:"1px 6px", color: activeTab==="audio" ? "#080809" : "#6b6b75", marginLeft:2 }}>{mics.length}</span>}
          </button>
        ))}
      </nav>

      {/* Tab Panels */}
      <div style={{ flex:1, display:"flex", flexDirection:"column" }} key={activeTab} className="tab-panel-enter">
        {activeTab === "dashboard"  && <DashboardTab svcs={svcs} links={links} schedule={schedule} selSvc={selSvc} setSelSvc={setSelSvc} now={now}/>}
        {activeTab === "audio"      && <MicTab mics={mics} adminOn={adminOn} onEdit={handleMicEdit} onAdd={()=>setMics(m=>[...m,{name:"",vocal:"none",instrument:"none",iem:`IEM ${m.length+1}`,position:"",notes:""}])}/>}
        {activeTab === "gear"       && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", width:"100%", flex:1 }}><LinkSection title="🔧 Gear Documentation" items={links.gear}/></div>}
        {activeTab === "schedule"   && <ScheduleTab schedule={schedule} sundayRundown={sundayRundown}/>}
        {activeTab === "chat"       && <ChatTab/>}
        {activeTab === "resources"  && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", width:"100%", flex:1 }}><LinkSection title="📁 Team Resources" items={links.dash}/></div>}
        {activeTab === "streaming"  && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", width:"100%", flex:1 }}><LinkSection title="📡 Streaming & Contact" items={links.streaming}/></div>}
      </div>

      <footer style={{ padding:"12px 22px", borderTop:"1px solid rgba(255,255,255,.06)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, width:"100%" }}>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75" }}>The <strong style={{ color:GOLD }}>Life Church</strong> Production · Richmond, VA</div>
        <div style={{ fontSize:12, fontStyle:"italic", color:"#6b6b75", textAlign:"center", flex:1 }}>"Whatever you do, work at it with all your heart" — Col 3:23</div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#6b6b75", textAlign:"right" }}>Built for the team</div>
      </footer>

    </div>
  );
}
