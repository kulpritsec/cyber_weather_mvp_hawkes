# 🔬 IOC Enrichment Panel — "Indicator Microscope"

## What This Adds

An interactive IOC enrichment layer to weather.kulpritstudios.com. Click an IP on the globe → instant pivot to reputation, geolocation, ASN, associated malware, passive DNS, and linked threat campaigns.

### Three Views

| Tab | What It Shows |
|-----|--------------|
| **🔬 GRAPH** | Radial "microscope" visualization — center IOC with three rings: reputation sources → infrastructure → campaigns/pulses. Animated scan line, threat-colored nodes. |
| **📡 SOURCES** | Detailed cards for each API source with full enrichment data, pulse lists, passive DNS records, VT detection ratios, URLhaus URLs, ThreatFox IOCs |
| **⏱ TIMELINE** | Chronological history of when this indicator first appeared across all feeds, with source attribution and color-coded dots |

### API Sources (All Free)

| Source | Data | Rate Limit | Auth |
|--------|------|-----------|------|
| **AlienVault OTX** | Reputation, pulses, passive DNS, geo, ASN | Generous | API key (free) |
| **AbuseIPDB** | Abuse score, ISP, reports, Tor detection | 1,000/day | API key (free) |
| **VirusTotal** | Detection ratio, engines, network info | 500/day (~4/min) | API key (free) |
| **URLhaus** | Malware URLs, payloads, threats | Unlimited | None |
| **ThreatFox** | IOC sharing, malware families, confidence | Unlimited | None |

## Architecture

```
User clicks IP on globe
       │
       ▼
  Frontend: IOCEnrichmentPanel.tsx
  (radial graph, source cards, timeline)
       │
       ▼  /v1/ioc/enrich?indicator=1.2.3.4
  Backend: ioc_enrichment.py
  (asyncio.gather → 5 APIs in parallel)
       │
       ├──→ AlienVault OTX  (general + pulse_info + geo + passive_dns)
       ├──→ AbuseIPDB       (IP check)
       ├──→ VirusTotal       (IP/domain/file/URL analysis)
       ├──→ URLhaus          (malware URL lookup)
       └──→ ThreatFox        (IOC search)
       │
       ▼
  Aggregated response with:
    - Composite threat score (0-100)
    - Per-source enrichment data
    - Unified timeline of first-seen dates
```

## Deployment

### Files Created

```
backend/app/routers/ioc_enrichment.py   ← Backend proxy router
frontend/src/components/Panels/IOCEnrichmentPanel.tsx  ← Frontend panel
deploy_ioc_enrichment.sh                ← Automated deployer
```

### Quick Deploy

```bash
# 1. SCP files to Linode
scp IOCEnrichmentPanel.tsx deploy@<LINODE_IP>:~/cyber-weather/app/frontend/src/components/Panels/
scp deploy_ioc_enrichment.sh deploy@<LINODE_IP>:~/cyber-weather/app/

# 2. SSH in and run
ssh deploy@<LINODE_IP>
cd ~/cyber-weather/app
bash deploy_ioc_enrichment.sh

# 3. Add API keys (edit .env)
nano .env
# Fill in: OTX_API_KEY, ABUSEIPDB_API_KEY, VT_API_KEY

# 4. Verify
curl -s https://weather.kulpritstudios.com/v1/ioc/health | python3 -m json.tool
curl -s 'https://weather.kulpritstudios.com/v1/ioc/enrich?indicator=8.8.8.8' | python3 -m json.tool
```

### Get API Keys

1. **OTX**: Sign up at https://otx.alienvault.com → Settings → API Key
2. **AbuseIPDB**: Sign up at https://www.abuseipdb.com → Account → API
3. **VirusTotal**: Sign up at https://www.virustotal.com → Profile → API Key

### What the Deploy Script Does

1. Creates `backend/app/routers/ioc_enrichment.py`
2. Registers the router in `main.py`
3. Places `IOCEnrichmentPanel.tsx` in the Panels directory
4. Updates `Panels/index.ts` exports
5. Patches `CyberWeatherGlobe.tsx`:
   - Adds import
   - Adds `showIOCEnrich` + `iocIndicator` state hooks
   - Adds `🔬 IOC ENRICH` header button
   - Adds panel conditional render
   - Extends Escape key handler
6. Adds API key placeholders to `.env`
7. Optionally builds and deploys Docker containers

## Future: Globe Click → Enrich

To wire globe clicks directly to the enrichment panel, add to the hotspot/arc click handler in CyberWeatherGlobe.tsx:

```typescript
// In the click handler for hotspots or arcs:
const handleHotspotClick = (ip: string) => {
  setIOCIndicator(ip);
  setShowIOCEnrich(true);
};
```

This connects the existing globe interaction (clicking threat hotspots and attack arcs) directly to the microscope panel, pre-filling the indicator and auto-enriching.
