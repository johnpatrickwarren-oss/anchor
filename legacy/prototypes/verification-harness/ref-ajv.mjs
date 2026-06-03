import Ajv2020 from 'ajv/dist/2020.js';
export function validate(schema, instance, options={}) {
  const ajv=new Ajv2020({strict:false, validateFormats:false});
  for(const [uri,sch] of Object.entries(options.remotes||{})){ try{ajv.addSchema(sch,uri);}catch{} }
  try{ return { valid: !!ajv.validate(schema, instance) }; }
  catch(e){ return { valid:false, _err:String(e.message||e) }; }
}
