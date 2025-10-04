import React from 'react'
type Props={vector:string,setVector:(v:string)=>void,mode:'nowcast'|'forecast'|'params',setMode:(m:'nowcast'|'forecast'|'params')=>void,horizon:number,setHorizon:(h:number)=>void,res:number,setRes:(r:number)=>void}
export default function Controls({vector,setVector,mode,setMode,horizon,setHorizon,res,setRes}:Props){
  return (<div>
    <label>Traffic Vector</label>
    <select value={vector} onChange={e=>setVector(e.target.value)}>
      <option value="ssh">SSH</option><option value="rdp">RDP</option><option value="http">HTTP</option><option value="dns_amp">DNS Amplification</option>
    </select>
    <label style={{marginTop:8}}>Mode</label>
    <select value={mode} onChange={e=>setMode(e.target.value as any)}>
      <option value="nowcast">Nowcast</option><option value="forecast">Forecast</option><option value="params">Parameters</option>
    </select>
    {mode==='forecast'&&(<><label style={{marginTop:8}}>Horizon (hours)</label><select value={horizon} onChange={e=>setHorizon(parseInt(e.target.value))}><option value={6}>+6h</option><option value={24}>+24h</option><option value={72}>+72h</option></select></>)}
    <label style={{marginTop:8}}>Grid Resolution (degrees)</label>
    <select value={res} onChange={e=>setRes(parseFloat(e.target.value))}><option value={5}>5.0°</option><option value={2.5}>2.5°</option><option value={1}>1.0°</option></select>
    
    {mode === 'params' && (
      <div style={{marginTop:12,padding:8,backgroundColor:'#f8fafc',borderRadius:6,fontSize:11,color:'#475569'}}>
        <div><strong>Parameters Legend:</strong></div>
        <div style={{marginTop:4}}>
          <div><span style={{color:'#2563eb'}}>■</span> Stable (n&lt;0.5)</div>
          <div><span style={{color:'#f59e0b'}}>■</span> Moderate (0.5≤n&lt;0.8)</div>
          <div><span style={{color:'#dc2626'}}>■</span> Unstable (n≥0.8)</div>
        </div>
      </div>
    )}
  </div>)
}
