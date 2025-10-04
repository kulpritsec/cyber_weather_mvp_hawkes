import React from 'react'
export default function Advisories({items}:{items:any[]}){
  if(!items||items.length===0) return <div style={{color:'#6b7280'}}>No advisories right now.</div>
  return (<div><div style={{fontWeight:600,marginBottom:8}}>Advisories</div>
    {items.map(it=>(<div className="advisory" key={it.id}><h4>{it.title}</h4>
      <div style={{fontSize:12,color:'#6b7280'}}>{it.severity.toUpperCase()} · conf {Math.round(it.confidence*100)}%</div>
      <p style={{fontSize:13}}>{it.details}</p></div>))}
  </div>)
}
