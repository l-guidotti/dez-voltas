import {documentRows,rowsDocument,overlayRows,validateChanges,rowKey} from '../dist/relational-contract.js';
import {validateAccountDocument} from '../dist/sync-contract.js';
export async function trainingStore({request,env,user,access,readBody,fail}){
 const origin=new URL(env.SUPABASE_URL).origin;
 const headers={apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+access,'content-type':'application/json'};
 async function rest(path,body){
  const r=await fetch(origin+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,signal:AbortSignal.timeout(20000),...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok){if(data?.code==='40001')throw fail(409,'Este registro foi alterado em outro aparelho. Sincronize novamente.');throw fail(r.status===401?401:502,'Não foi possível sincronizar. A cópia local foi preservada.');}return data;
 }
 async function read(cursor){
  for(let attempt=0;attempt<2;attempt++){
   const remote=await rest('rpc/read_training_store',{since_cursor:cursor});if(remote.initialized){if(request.headers.get('x-dv-training-format')!=='2'&&remote.rows.some(row=>row.kind==='sessions'&&row.data?.workout))throw fail(426,'Atualize o PWA para sincronizar treinos com etapas. As cópias foram preservadas.');return remote;}
   const legacy=(await rest('account_data?user_id=eq.'+encodeURIComponent(user.id)+'&select=revision,document'))[0];
   const empty={version:1,profile:null,draft:null,archive:{version:1,owner:user.id,plans:[]},state:{version:1,logs:{},checklist:{},timer:null}};
   let rows;try{rows=[...documentRows(validateAccountDocument(legacy?.document||empty,user.id),user.id).values()].map(row=>({...row,revision:0}));}catch{throw fail(502,'Não foi possível migrar os dados antigos. A cópia original foi preservada.');}
   try{return await rest('rpc/initialize_training_store',{expected_legacy_revision:legacy?.revision||0,initial_rows:rows});}catch(e){if(e.status!==409||attempt)throw e;}
  }
 }
 const url=new URL(request.url);
 if(request.method==='GET'){
  const cursor=Number(url.searchParams.get('since')||0);if(!Number.isSafeInteger(cursor)||cursor<0)throw fail(400,'Cursor inválido.');return read(cursor);
 }
 const body=await readBody(request,4194304);if(!Number.isSafeInteger(body.cursor)||body.cursor<0)throw fail(400,'Cursor inválido.');
 let changes;try{changes=validateChanges(body.changes);}catch(e){throw fail(400,e.message);}
 const current=await read(0),base=new Map(current.rows.map(row=>[rowKey(row),row]));
 for(const change of changes)if((base.get(rowKey(change))?.revision||0)!==change.revision)throw fail(409,'Este registro foi alterado em outro aparelho. Sincronize novamente.');
 let canonical;
 try{const doc=rowsDocument(overlayRows(base,changes),user.id);canonical=documentRows(doc,user.id);}catch(e){throw fail(400,e.message);}
 const sanitized=changes.map(change=>{
  if(change.data===null){if(change.kind!=='diary')throw fail(400,'A remoção é permitida apenas para registros do diário.');return change;}
  const row=canonical.get(rowKey(change));if(!row)throw fail(400,'Registro sem vínculo com o perfil ou diário.');return {...change,data:row.data};
 });
 if(sanitized.length)await rest('rpc/apply_training_changes',{changes:sanitized});
 return rest('rpc/read_training_store',{since_cursor:body.cursor});
}
