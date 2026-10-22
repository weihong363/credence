import { createHash, randomUUID } from 'node:crypto';
import { object, text } from '../domain/json.js';

export interface Repository { owner:string; name:string; commitSha:string }
export interface SourceFile { path:string; language:string; sha256:string; content:string }
export interface Snapshot { id:string; repository:Repository; files:SourceFile[]; exclusions:{path:string;reason:string}[] }
export type Fetcher = typeof fetch;
const languages:Record<string,string>={ts:'TypeScript',js:'JavaScript',json:'JSON',md:'Markdown',py:'Python',rs:'Rust',go:'Go',java:'Java',yml:'YAML',yaml:'YAML',html:'HTML',css:'CSS',txt:'Text'};
export function repositoryInput(value:unknown): {owner:string;name:string;commitSha?:string} {
 const input=object(value,['repository']);
 const repo=input.repository as Record<string,unknown>;
 if(!repo || Object.keys(repo).some(key=>!['owner','name','commitSha'].includes(key)))throw new Error('INVALID_REPOSITORY');
 const owner=text(repo.owner,100),name=text(repo.name,100);
 if(!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner)||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)||name==='.'||name==='..')throw new Error('INVALID_REPOSITORY');
 const commitSha=repo.commitSha===undefined?undefined:text(repo.commitSha,40);
 if(commitSha && !/^[a-f0-9]{40}$/i.test(commitSha))throw new Error('INVALID_REVISION');
 return {owner,name,...(commitSha?{commitSha}: {})};
}
export async function readBounded(response:Response, limit:number):Promise<string>{
 if(!response.body)throw new Error('EMPTY_RESPONSE');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
 if(bytes>limit)throw new Error('RESPONSE_TOO_LARGE');chunks.push(part.value);}
 return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel();}
}
async function github(path:string,fetcher:Fetcher,deadline:number):Promise<any>{
 const remaining=deadline-Date.now();if(remaining<=0)throw new Error('SOURCE_TIMEOUT');
 const response=await fetcher(`https://api.github.com${path}`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(Math.min(15000,remaining))});
 if(!response.ok)throw new Error(`SOURCE_HTTP_${response.status}`);
 return JSON.parse(await readBounded(response,2_000_000));
}
export async function fetchSnapshot(input:unknown,fetcher:Fetcher=fetch):Promise<Snapshot>{
 const deadline=Date.now()+60000;const read=(path:string)=>github(path,fetcher,deadline);
 const repo=repositoryInput(input);const base=`/repos/${repo.owner}/${repo.name}`;
 const metadata=await read(base);
 if(metadata.private!==false)throw new Error('PUBLIC_REPOSITORY_REQUIRED');
 const commit=await read(`${base}/commits/${repo.commitSha??encodeURIComponent(metadata.default_branch)}`);
 if(!/^[a-f0-9]{40}$/.test(commit.sha)|| (repo.commitSha && repo.commitSha!==commit.sha))throw new Error('REVISION_MISMATCH');
 const tree=await read(`${base}/git/trees/${commit.sha}?recursive=1`);
 if(tree.truncated || !Array.isArray(tree.tree) || tree.tree.length>20000)throw new Error('SOURCE_TREE_LIMIT');
 const snapshot:Snapshot={id:randomUUID(),repository:{owner:repo.owner,name:repo.name,commitSha:commit.sha},files:[],exclusions:[]};
 let bytes=0,requests=0;
 for(const entry of tree.tree){
  if(entry.type==='tree')continue;
  const reason=requests>=100?'FETCH_LIMIT':exclusion(entry,snapshot.files.length,bytes);
  if(reason){snapshot.exclusions.push({path:String(entry.path).slice(0,500),reason});continue;}
  requests++;
  const blob=await read(`${base}/git/blobs/${entry.sha}`);
  if(blob.encoding!=='base64'||typeof blob.content!=='string')throw new Error('INVALID_BLOB');
  const data=Buffer.from(blob.content,'base64');
  if(data.length!==entry.size||data.length>204800)throw new Error('BLOB_SIZE_MISMATCH');
  bytes+=data.length;
  const gitHash=createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if(gitHash!==entry.sha)throw new Error('BLOB_HASH_MISMATCH');
  let content:string;
  try{content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);}catch{snapshot.exclusions.push({path:entry.path,reason:'NON_UTF8'});continue;}
  if(content.includes('\0')){snapshot.exclusions.push({path:entry.path,reason:'BINARY'});continue;}
  snapshot.files.push({path:entry.path,language:languages[entry.path.split('.').at(-1)]??'Text',content,sha256:createHash('sha256').update(data).digest('hex')});
 }
 if(snapshot.files.length<2)throw new Error('INSUFFICIENT_SOURCE');
 return snapshot;
}
function exclusion(entry:any,count:number,bytes:number):string|undefined{
 if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some((part:string)=>part==='..'||part==='.'||!part)||entry.path.includes('\\'))return 'UNSAFE_PATH';
 if(entry.type!=='blob'||!['100644','100755'].includes(entry.mode))return 'UNSUPPORTED_ENTRY';
 if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>204800)return 'FILE_SIZE_LIMIT';
 if(count>=100||bytes+entry.size>1048576)return 'SNAPSHOT_LIMIT';
 if(!languages[entry.path.split('.').at(-1)]&&!/^(Dockerfile|Makefile|LICENSE)$/.test(entry.path.split('/').at(-1)))return 'NON_TEXT_EXTENSION';
 if(!/^[a-f0-9]{40}$/.test(entry.sha))return 'INVALID_BLOB_ID';
}

export function githubFetcher(token?:string,transport:Fetcher=fetch):Fetcher {
 return async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin!=='https://api.github.com')throw new Error('SOURCE_HOST_DENIED');
  const headers=new Headers(init?.headers);
  if(token)headers.set('Authorization',`Bearer ${token}`);
  return transport(input,{...init,headers,redirect:'error'});
 };
}
