import React, { useEffect, useState } from 'react'
import MapView from './components/MapView'
import Controls from './components/Controls'
import Advisories from './components/Advisories'
import { fetchAdvisories } from './lib/api'

function Header(){ return <div className="header"><h3>🌐 Cyber Weather</h3><div style={{marginLeft:12,color:'#6b7280'}}>Nowcast & Hawkes forecast</div></div> }

export default function App(){
  const [vector, setVector] = useState('ssh')
  const [mode, setMode] = useState<'nowcast' | 'forecast'>('nowcast')
  const [horizon, setHorizon] = useState(24)
  const [res, setRes] = useState(2.5)
  const [advisories, setAdvisories] = useState<any[]>([])
  useEffect(()=>{ fetchAdvisories(vector).then(setAdvisories).catch(()=>setAdvisories([])) },[vector])
  return (
    <div className="app">
      <Header />
      <div className="sidebar">
        <div className="controls">
          <Controls vector={vector} setVector={setVector} mode={mode} setMode={setMode} horizon={horizon} setHorizon={setHorizon} res={res} setRes={setRes} />
        </div>
        <div className="legend"><div style={{fontSize:12,color:'#374151',marginBottom:4}}>Intensity</div><div className="legend-bar"/><div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#6b7280'}}><span>Low</span><span>High</span></div></div>
        <div style={{marginTop:16}}><Advisories items={advisories} /></div>
      </div>
      <div className="main"><MapView vector={vector} mode={mode} horizon={horizon} res={res}/></div>
    </div>
  )
}
