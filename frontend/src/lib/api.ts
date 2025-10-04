const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
export async function fetchNowcast(vector:string,res:number){ const r=await fetch(`${BASE}/v1/nowcast?vector=${encodeURIComponent(vector)}&res=${res}`); if(!r.ok) throw new Error('nowcast'); return r.json() }
export async function fetchForecast(vector:string,horizon:number,res:number){ const r=await fetch(`${BASE}/v1/forecast?vector=${encodeURIComponent(vector)}&horizon=${horizon}&res=${res}`); if(!r.ok) throw new Error('forecast'); return r.json() }
export async function fetchAdvisories(vector:string){ const r=await fetch(`${BASE}/v1/advisories?vector=${encodeURIComponent(vector)}`); if(!r.ok) throw new Error('advisories'); return r.json() }
