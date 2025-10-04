import React, { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polygon, Polyline, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchCyberData } from '../lib/api'
import { colorFor } from '../lib/colors'
import { generateContours } from '../lib/contours'

export default function MapView({ vector, mode, horizon, res }:{vector:string,mode:'nowcast'|'forecast'|'params',horizon:number,res:number}){
  const [geo,setGeo]=useState<any>(null); const [err,setErr]=useState<string|null>(null); const [loading,setLoading]=useState(false)
  const [showContours, setShowContours] = useState(false)
  const [contours, setContours] = useState<any[]>([])
  
  useEffect(()=>{ 
    setLoading(true)
    fetchCyberData(mode, vector, horizon, res)
      .then(data => {
        setGeo(data)
        // Generate contours for intensity data
        if (mode !== 'params' && data.features) {
          const gridPoints = data.features.map((f: any) => {
            const bounds = f.geometry.coordinates[0]
            const lats = bounds.map((p: number[]) => p[1])
            const lons = bounds.map((p: number[]) => p[0])
            return {
              lat: (Math.min(...lats) + Math.max(...lats)) / 2,
              lon: (Math.min(...lons) + Math.max(...lons)) / 2,
              value: f.properties.pressure ?? f.properties.normalized ?? 0
            }
          })
          const contourLines = generateContours(gridPoints)
          setContours(contourLines)
        } else {
          setContours([])
        }
      })
      .catch(e=>setErr(String(e)))
      .finally(()=>setLoading(false))
  },[vector,mode,horizon,res])
  
  return (<div className="map-container">
    <MapContainer center={[20,0]} zoom={2} scrollWheelZoom style={{height:'100%'}}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      
      {geo && geo.features && geo.features.map((f:any)=>{
        const coords=f.geometry.coordinates[0].map((p:number[])=>[p[1],p[0]])
        
        if (mode === 'params') {
          // Color by branching ratio for parameters view
          const stability = f.properties.n_br
          const color = stability < 0.5 ? '#2563eb' : stability < 0.8 ? '#f59e0b' : '#dc2626'
          return (<Polygon key={f.properties.grid_id+'-'+f.properties.vector} pathOptions={{color,weight:1,fillColor:color,fillOpacity:0.4}} positions={coords}>
            <Tooltip><div style={{fontSize:12}}>
              <div><b>Grid:</b> {f.properties.grid_id}</div>
              <div><b>μ (baseline):</b> {f.properties.mu?.toFixed(3)} ± {(f.properties.mu_std || 0).toFixed(3)} events/hr</div>
              <div><b>β (decay):</b> {f.properties.beta?.toFixed(3)} ± {(f.properties.beta_std || 0).toFixed(3)} /hr</div>
              <div><b>n (branching):</b> {f.properties.n_br?.toFixed(3)} ± {(f.properties.n_br_std || 0).toFixed(3)}</div>
              <div><b>α (excitement):</b> {f.properties.alpha?.toFixed(3)}</div>
              <div><b>Stability:</b> {f.properties.stability}</div>
              <div><b>Updated:</b> {f.properties.updated_at}</div>
            </div></Tooltip>
          </Polygon>)
        } else {
          // Regular intensity visualization
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
        }
      })}
      
      {/* Contour lines */}
      {showContours && mode !== 'params' && contours.map((contour, i) => 
        contour.coordinates.map((ring: any, j: number) => 
          ring.map((polygon: any, k: number) => (
            <Polyline
              key={`contour-${i}-${j}-${k}`}
              positions={polygon.map(([lon, lat]: [number, number]) => [lat, lon])}
              pathOptions={{
                color: `hsl(${240 - contour.level * 120}, 70%, 50%)`,
                weight: 2,
                opacity: 0.8
              }}
            />
          ))
        )
      )}
    </MapContainer>
    
    {/* Controls overlay */}
    <div style={{position:'absolute',top:10,right:10,background:'rgba(255,255,255,0.9)',padding:'8px',borderRadius:'6px',boxShadow:'0 2px 8px rgba(0,0,0,0.1)'}}>
      {mode !== 'params' && (
        <label style={{display:'block',fontSize:'12px',cursor:'pointer'}}>
          <input type="checkbox" checked={showContours} onChange={e=>setShowContours(e.target.checked)} style={{marginRight:'4px'}} />
          Show Contours
        </label>
      )}
    </div>
    
    {loading && <div style={{position:'absolute',top:70,right:20,background:'#fff',padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:6,boxShadow:'0 1px 4px rgba(0,0,0,0.08)',fontSize:12}}>Loading…</div>}
    {err && <div style={{position:'absolute',top:70,right:20,background:'#fee2e2',padding:'6px 10px',border:'1px solid #fecaca',borderRadius:6,boxShadow:'0 1px 4px rgba(0,0,0,0.08)',fontSize:12,color:'#991b1b'}}>Error: {err}</div>}
  </div>)
}
