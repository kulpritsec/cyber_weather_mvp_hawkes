import { useState, useEffect, useRef } from "react";

// ─── DESIGN TOKENS (matches globe) ─────────────────────────────────────
const C = {
  bg: "#050a12",
  panel: "rgba(8,18,38,0.95)",
  border: "rgba(0,180,255,0.15)",
  textPrimary: "#e0eaf8",
  textDim: "#5a7da8",
  textAccent: "#00ccff",
  textBright: "#f0f6ff",
  emergency: "#ef4444",
  warning: "#f97316",
  watch: "#eab308",
  advisory: "#3b82f6",
  clear: "#22c55e",
};

const VECTOR_COLORS = {
  ssh: "#00e5ff",
  rdp: "#ff6d00",
  http: "#b388ff",
  dns_amp: "#76ff03",
  brute_force: "#ff5252",
  botnet_c2: "#ea80fc",
  ransomware: "#ff1744",
  malware: "#fbbf24",
};

const SEVERITY_COLORS = {
  1: C.clear,
  2: C.advisory,
  3: C.watch,
  4: C.warning,
  5: C.emergency,
};

// Country code → flag emoji
function countryFlag(code) {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

const MONO = "'JetBrains Mono', monospace";

// ─── SOURCE LABEL MAPPING ──────────────────────────────────────────────
const SOURCE_LABELS = {
  dshield: "DShield",
  greynoise: "GreyNoise",
  abusech_threatfox: "ThreatFox",
  abusech_feodo: "Feodo",
  abusech_urlhaus: "URLhaus",
  synthetic: "Baseline",
  cisa_kev: "CISA KEV",
  otx: "OTX",
  abuseipdb: "AbuseIPDB",
};

function sourceLabel(src) {
  return SOURCE_LABELS[src] || src || "";
}

// ─── EVENT TICKER SCROLL ───────────────────────────────────────────────
// Memoize individual event items to prevent re-render on scroll
const TickerItem = ({ e: ev, VECTOR_COLORS, C, SEVERITY_COLORS, sourceLabel, countryFlag }) => {
  const vecColor = VECTOR_COLORS[ev.vector] || C.textAccent;
  const sevLevel = Math.min(5, Math.max(1, Math.ceil(ev.severity || 1)));
  const sevColor = SEVERITY_COLORS[sevLevel] || C.textDim;
  const flag = countryFlag(ev.source_country);
  let timeStr = "";
  try { const d = new Date(ev.ts); if (!isNaN(d.getTime())) timeStr = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch {}
  const maskedIp = ev.source_ip ? ev.source_ip.replace(/\.\d+$/, ".xxx") : "";
  const target = ev.target_port ? `:${ev.target_port}` : "";
  return (
    <span style={{ marginRight: "40px", display: "inline-block" }}>
      <span style={{ color: C.textDim }}>{timeStr}</span>
      <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: vecColor, boxShadow: `0 0 4px ${vecColor}`, margin: "0 6px", verticalAlign: "middle" }} />
      <span style={{ color: vecColor, fontWeight: 600, textTransform: "uppercase", fontSize: "9px" }}>{(ev.vector || "").replace("_", " ")}</span>
      <span style={{ color: C.textDim, margin: "0 4px" }}>|</span>
      <span style={{ color: sevColor, fontSize: "9px" }}>{ev.action || `${(ev.vector || "").toUpperCase()} Activity`}</span>
      <span style={{ color: C.textDim, margin: "0 4px" }}>|</span>
      <span style={{ color: C.textDim, fontSize: "9px" }}>{flag && <span style={{ marginRight: "3px" }}>{flag}</span>}{maskedIp}{ev.source_country && <span style={{ marginLeft: "3px" }}>({ev.source_country})</span>}</span>
      {target && <><span style={{ color: C.textDim, margin: "0 3px" }}>&rarr;</span><span style={{ color: C.textPrimary, fontSize: "9px" }}>{target}</span></>}
      {ev.source && <span style={{ marginLeft: "6px", padding: "1px 5px", borderRadius: "3px", background: `${vecColor}15`, border: `1px solid ${vecColor}30`, fontSize: "7px", color: vecColor, letterSpacing: "0.06em" }}>{sourceLabel(ev.source)}</span>}
      {ev.count > 1 && <span style={{ marginLeft: "4px", padding: "1px 4px", borderRadius: "3px", background: `${C.warning}15`, border: `1px solid ${C.warning}30`, fontSize: "7px", color: C.warning }}>x{ev.count}</span>}
    </span>
  );
};

function EventTickerScroll({ events }) {
  // Refs-only approach: never re-render for scroll, only for new event content
  const eventsRef = useRef(events);
  const [displayEvents, setDisplayEvents] = useState(events || []);
  
  // Only update displayed events every 3 seconds max
  useEffect(() => {
    const id = setInterval(() => {
      setDisplayEvents(eventsRef.current || []);
    }, 3000);
    eventsRef.current = events;
    return () => clearInterval(id);
  }, [events]);

  if (!displayEvents || displayEvents.length === 0) return null;

  const doubled = displayEvents.concat(displayEvents);
  const duration = Math.max(36, displayEvents.length * 4.8);

  return (
    <div style={{ overflow: "hidden", whiteSpace: "nowrap", height: "22px", lineHeight: "22px", fontFamily: MONO, fontSize: "10px" }}>
      <style>{`
        @keyframes cwticker { 0% { transform: translate3d(0,0,0); } 100% { transform: translate3d(-50%,0,0); } }
      `}</style>
      <div style={{ display: "inline-block", animation: `cwticker ${duration}s linear infinite`, willChange: "transform" }}>
        {doubled.map((ev, i) => (
          <TickerItem key={i} e={ev} VECTOR_COLORS={VECTOR_COLORS} C={C} SEVERITY_COLORS={SEVERITY_COLORS} sourceLabel={sourceLabel} countryFlag={countryFlag} />
        ))}
      </div>
    </div>
  );
}

// ─── MAIN EXPORT ───────────────────────────────────────────────────────
export default function LiveThreatTicker() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const sseRef = useRef(null);
  const reconnectRef = useRef(null);
  const lastIdRef = useRef(null);

  useEffect(() => {
    function connect() {
      // Build SSE URL — relative URL through Caddy proxy
      const baseUrl = import.meta.env.VITE_API_BASE ?? "";
      let url = `${baseUrl}/v1/events/stream`;

      // Support reconnection with Last-Event-ID
      if (lastIdRef.current) {
        url += `?last_event_id=${lastIdRef.current}`;
      }

      const evtSource = new EventSource(url);
      sseRef.current = evtSource;

      evtSource.onopen = () => {
        setConnected(true);
        if (reconnectRef.current) {
          clearTimeout(reconnectRef.current);
          reconnectRef.current = null;
        }
      };

      evtSource.onmessage = (msg) => {
        if (msg.lastEventId) {
          lastIdRef.current = msg.lastEventId;
        }
        if (!msg.data || msg.data.trim() === "" || msg.data === ":keepalive") {
          return;
        }
        try {
          const data = JSON.parse(msg.data);
          setEvents((prev) => {
            const exists = prev.some((e) => e.id === data.id);
            if (exists) return prev;
            return [data, ...prev].slice(0, 50);
          });
          setEventCount((c) => c + 1);
        } catch {}
      };

      evtSource.onerror = () => {
        evtSource.close();
        setConnected(false);
        reconnectRef.current = setTimeout(() => connect(), 5000);
      };
    }

    connect();

    return () => {
      if (sseRef.current) sseRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, []);

  // Stats
  const uniqueVectors = [...new Set(events.map((e) => e.vector))].length;
  const uniqueCountries = [...new Set(events.map((e) => e.source_country).filter(Boolean))].length;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        background:
          "linear-gradient(0deg, rgba(5,10,18,0.95) 0%, rgba(5,10,18,0.85) 60%, transparent 100%)",
        padding: "12px 20px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "4px",
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: "8px",
            color: C.textDim,
            letterSpacing: "0.15em",
          }}
        >
          LIVE THREAT FEED
        </div>
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: connected ? C.clear : C.emergency,
            animation: "pulse-dot 1s ease-in-out infinite",
          }}
        />
        <div
          style={{
            fontFamily: MONO,
            fontSize: "7px",
            color: connected ? C.clear : C.textDim,
            letterSpacing: "0.1em",
          }}
        >
          {connected ? "SSE CONNECTED" : "RECONNECTING…"}
        </div>

        {/* Live stats */}
        {events.length > 0 && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: "12px",
              fontFamily: MONO,
              fontSize: "8px",
            }}
          >
            <span style={{ color: C.textDim }}>
              EVENTS{" "}
              <span style={{ color: C.textAccent, fontWeight: 700 }}>
                {events.length}
              </span>
            </span>
            <span style={{ color: C.textDim }}>
              VECTORS{" "}
              <span style={{ color: C.textAccent, fontWeight: 700 }}>
                {uniqueVectors}
              </span>
            </span>
            <span style={{ color: C.textDim }}>
              COUNTRIES{" "}
              <span style={{ color: C.textAccent, fontWeight: 700 }}>
                {uniqueCountries}
              </span>
            </span>
          </div>
        )}
      </div>
      <EventTickerScroll events={events} />
    </div>
  );
}
