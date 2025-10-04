export function colorFor(value:number){
  const stops=[{t:0.0,c:[254,240,217]},{t:0.25,c:[253,204,138]},{t:0.5,c:[252,141,89]},{t:0.75,c:[227,74,51]},{t:1.0,c:[179,0,0]}]
  for(let i=1;i<stops.length;i++){ if(value<=stops[i].t){ const a=stops[i-1],b=stops[i]; const f=(value-a.t)/(b.t-a.t); const r=Math.round(a.c[0]+f*(b.c[0]-a.c[0])); const g=Math.round(a.c[1]+f*(b.c[1]-a.c[1])); const bl=Math.round(a.c[2]+f*(b.c[2]-a.c[2])); return `rgb(${r},${g},${bl})` } }
  return 'rgb(179,0,0)'
}
