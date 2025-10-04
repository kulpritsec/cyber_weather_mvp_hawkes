const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

// Unified API endpoint
export async function fetchCyberData(mode: string, vector: string, horizon?: number, res: number = 2.5, levels?: number) {
  const params = new URLSearchParams({
    mode,
    vector,
    res: res.toString()
  })
  if (mode === 'forecast' && horizon) {
    params.append('horizon', horizon.toString())
  }
  if (mode === 'contours' && levels) {
    params.append('levels', levels.toString())
  }
  if (mode === 'contours' && horizon) {
    params.append('horizon', horizon.toString())
  }
  
  const r = await fetch(`${BASE}/v1/data?${params}`)
  if (!r.ok) throw new Error(`Failed to fetch ${mode} data`)
  return r.json()
}

// Legacy API functions for backward compatibility
export async function fetchNowcast(vector: string, res: number) { 
  return fetchCyberData('nowcast', vector, undefined, res)
}

export async function fetchForecast(vector: string, horizon: number, res: number) { 
  return fetchCyberData('forecast', vector, horizon, res)
}

export async function fetchParams(vector: string, res: number) { 
  return fetchCyberData('params', vector, undefined, res)
}

export async function fetchContours(vector: string, horizon: number, res: number, levels: number = 5) { 
  return fetchCyberData('contours', vector, horizon, res, levels)
}

export async function fetchAdvisories(vector: string) { 
  const r = await fetch(`${BASE}/v1/advisories?vector=${encodeURIComponent(vector)}`)
  if (!r.ok) throw new Error('advisories')
  return r.json()
}

export async function fetchHealth() {
  const r = await fetch(`${BASE}/health`)
  if (!r.ok) throw new Error('health check failed')
  return r.json()
}
