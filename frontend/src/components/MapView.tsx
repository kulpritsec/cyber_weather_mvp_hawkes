import React, { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polygon, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchNowcast, fetchForecast } from '../lib/api'
import { colorFor } from '../lib/colors'

export default function MapView({ vector, mode, horizon, res }:{vector:string,mode:'nowcast'|'forecast',horizon:number,res:number}){
  const [geo,setGeo]=useState<any>(null); const [err,setErr]=useState<string|null>(null); const [loading,setLoading]=useState(false)
  useEffect(()=>{ setLoading(true); const p = mode==='nowcast'?fetchNowcast(vector,res):fetchForecast(vector,horizon,res);
    p.then(setGeo).catch(e=>setErr(String(e))).finally(()=>setLoading(false)) },[vector,mode,horizon,res])
  return (<div className="map-container">
    <MapContainer center={[20,0]} zoom={2} scrollWheelZoom style={{height:'100%'}}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {geo && geo.features && geo.features.map((f:any)=>{
        const coords=f.geometry.coordinates[0].map((p:number[])=>[p[1],p[0]])
        const val=(f.properties.pressure ?? f.properties.normalized) ?? 0
        const color=colorFor(val)
        return (<Polygon key={f.properties.grid_id+'-'+f.properties.vector} pathOptions={{color,weight:1,fillColor:color,fillOpacity:0.35}} positions={coords}>
          <Tooltip><div style={{fontSize:12}}>
            <div><b>Vector:</b> {f.properties.vector}</div>
            <div><b>Intensity:</b> {f.properties.intensity?.toFixed(1)}</div>
            <div><b>Confidence:</b> {Math.round((f.properties.confidence ?? 0)*100)}%</div>
            {f.properties.horizon_h && <div><b>Horizon:</b> +{f.properties.horizon_h}h</div>}
            <div><b>Updated:</b> {f.properties.updated_at}</div>
          </div></Tooltip>
        </Polygon>)
      })}
    </MapContainer>
    {loading && <div style={{position:'absolute',top:70,right:20,background:'#fff',padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:6,boxShadow:'0 1px 4px rgba(0,0,0,0.08)',fontSize:12}}>Loading…</div>}
    {err && <div style={{position:'absolute',top:70,right:20,background:'#fee2e2',padding:'6px 10px',border:'1px solid #fecaca',borderRadius:6,boxShadow:'0 1px 4px rgba(0,0,0,0.08)',fontSize:12,color:'#991b1b'}}>Error: {err}</div>}
  </div>)
}
