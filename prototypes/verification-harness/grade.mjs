// Grades an arm's JSON Schema validator against the official draft2020-12 suite (required tests only).
// Arm module must export: validate(schema, instance, { remotes }) -> { valid: boolean }
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
const SUITE = process.env.JSS_SUITE || new URL('./vendor/JSON-Schema-Test-Suite', import.meta.url).pathname;
const TESTS=join(SUITE,'tests','draft2020-12'), REMOTES=join(SUITE,'remotes');
const ARM=process.env.ARM_VALIDATOR; if(!ARM){console.error('set ARM_VALIDATOR');process.exit(2);}
const mod=await import(pathToFileURL(ARM).href);
const validate=mod.validate||(mod.default&&mod.default.validate);
if(typeof validate!=='function'){console.error('arm must export validate()');process.exit(2);}
const remotes={};
(function walk(d){for(const n of readdirSync(d)){const p=join(d,n);if(statSync(p).isDirectory())walk(p);
  else if(n.endsWith('.json')){try{remotes['http://localhost:1234/'+relative(REMOTES,p)]=JSON.parse(readFileSync(p,'utf8'));}catch{}}}})(REMOTES);
let pass=0,fail=0,threw=0; const byKw={};
for(const f of readdirSync(TESTS).filter(f=>f.endsWith('.json'))){
  const kw=f.replace('.json',''); byKw[kw]={p:0,f:0};
  for(const g of JSON.parse(readFileSync(join(TESTS,f),'utf8'))){
    for(const t of g.tests){
      let got; try{got=validate(g.schema,t.data,{remotes});}catch(e){threw++;fail++;byKw[kw].f++;continue;}
      if((!!got.valid)===(!!t.valid)){pass++;byKw[kw].p++;}else{fail++;byKw[kw].f++;}
    }
  }
}
const total=pass+fail;
console.log(`ARM=${ARM}`);
console.log(`RESULT: ${pass}/${total} (${(100*pass/total).toFixed(1)}%)  fail=${fail} threw=${threw}`);
const worst=Object.entries(byKw).filter(([,v])=>v.f>0).sort((a,b)=>b[1].f-a[1].f);
console.log('failing features:', worst.slice(0,15).map(([k,v])=>`${k} ${v.p}/${v.p+v.f}`).join('  ')||'(none)');
