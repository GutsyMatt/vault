import { sha256Hex } from "../core/util";
import type { Env } from "../types";
import { MAX_UPLOAD } from "../storage/person-vault";

export interface DriveItem { id:string; name:string; mimeType:string; size?:string; md5Checksum?:string; modifiedTime?:string }
export function acceptedDriveItem(f:DriveItem):boolean {
 return !!f.id && !!f.name && !f.mimeType.startsWith("application/vnd.google-apps.") &&
 /^(application\/pdf|text\/plain|image\/(png|jpeg)|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/.test(f.mimeType) &&
 Number(f.size)>0 && Number(f.size)<=MAX_UPLOAD;
}
export async function syncDriveFolder(env: Env, person:string, folder:string, opts:{fetcher?:typeof fetch; dryRun?:boolean}={}):Promise<{scanned:number;stored:number;duplicates:number;skipped:number;errors:number}> {
 const result={scanned:0,stored:0,duplicates:0,skipped:0,errors:0};
 if(!/^[A-Za-z0-9_-]{8,200}$/.test(folder)||!["callum","finnley"].includes(person))throw Error("Invalid approved Drive folder or person");
 if(!env.DRIVE_CLIENT_ID||!env.DRIVE_CLIENT_SECRET||!env.DRIVE_REFRESH_TOKEN)throw Error("Google Drive OAuth secrets not configured");
 const fetcher=opts.fetcher||fetch;
 const tokenRes=await fetcher("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.DRIVE_CLIENT_ID,client_secret:env.DRIVE_CLIENT_SECRET,refresh_token:env.DRIVE_REFRESH_TOKEN,grant_type:"refresh_token"})});
 if(!tokenRes.ok)throw Error("Drive OAuth refresh failed: "+tokenRes.status);
 const tokenJson=await tokenRes.json() as {access_token?:string};
 if(!tokenJson.access_token)throw Error("Drive OAuth did not return an access token");
 const headers={Authorization:"Bearer "+tokenJson.access_token};
 const url=new URL("https://www.googleapis.com/drive/v3/files");
 url.searchParams.set("q",`'${folder.replace(/'/g,"\\'")}' in parents and trashed = false`);
 url.searchParams.set("fields","nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)");
 url.searchParams.set("page_size","30"); // bounded per scheduled tick
 url.searchParams.set("pageSize","30");
 url.searchParams.delete("page_size");
 url.searchParams.set("orderBy","modifiedTime desc");
 const list=await fetcher(url,{headers});
 if(!list.ok)throw Error("Drive folder listing failed: "+list.status);
 const payload=await list.json() as {files?:DriveItem[]};
 for(const f of (payload.files||[])){
  result.scanned++;
  if(!acceptedDriveItem(f)){result.skipped++;continue}
  if(opts.dryRun){result.skipped++;continue}
  try{
   const dest=env.PERSON_VAULT.get(env.PERSON_VAULT.idFromName(person));
   const prior=await dest.fetch("https://vault/drive-imports/"+encodeURIComponent(f.id),{headers:{"x-actor":"system:drive-ingestion"}});
   if(!prior.ok){result.errors++;continue}
   const old=await prior.json() as {source_hash?:string|null;source_version?:string|null};
   // Google Drive md5 is metadata only; it determines whether to skip an unchanged source.
   const sourceVersion=[f.md5Checksum||"",f.modifiedTime||"",f.size||""].join(":");
   if(old.source_version && sourceVersion === old.source_version){result.duplicates++;continue}
   const response=await fetcher("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(f.id)+"?alt=media",{headers});
   if(!response.ok){result.errors++;continue}
   const data=await response.arrayBuffer();
   if(!data.byteLength||data.byteLength>MAX_UPLOAD){result.skipped++;continue}
   const docUrl=new URL("https://vault/documents");
   docUrl.searchParams.set("filename",f.name);
   docUrl.searchParams.set("verification","EXTRACTED");
   docUrl.searchParams.set("note","Google Drive file ID: "+f.id);
   const saved=await dest.fetch(new Request(docUrl,{method:"POST",headers:{"content-type":f.mimeType,"x-actor":"system:drive-ingestion","x-route":"/documents"},body:data}));
   if(!saved.ok){result.errors++;continue}
   const receipt=await saved.json() as {duplicate?:boolean;id?:string;sha256?:string};
   const computedHash=await sha256Hex(new Uint8Array(data));
   if(receipt.sha256!==computedHash){result.errors++;continue}
   if(!receipt.id){result.errors++;continue}
   const confirmed=await dest.fetch("https://vault/drive-imports/"+encodeURIComponent(f.id),{method:"POST",headers:{"content-type":"application/json","x-actor":"system:drive-ingestion"},body:JSON.stringify({document_id:receipt.id,source_hash:receipt.sha256,source_version:sourceVersion})});
   if(!confirmed.ok){result.errors++;continue}
   if(receipt.duplicate)result.duplicates++;else result.stored++;
  }catch{result.errors++}
 }
 return result;
}
export async function runDriveSync(env:Env, opts:{fetcher?:typeof fetch;dryRun?:boolean}={}) {
 if(env.DRIVE_SYNC_ENABLED!=="true")return {status:"DISABLED"} as const;
 let mapping:Record<string,string>;
 try {mapping=JSON.parse(env.DRIVE_FOLDER_PERSON_MAP||"{}") as Record<string,string>}catch{throw Error("Invalid DRIVE_FOLDER_PERSON_MAP")}
 const receipts=[];
 for(const person of ["callum","finnley"]){
  const folder=mapping[person];
  if(!folder)continue;
  receipts.push({person,...await syncDriveFolder(env,person,folder,opts)});
 }
 return {status:"EXECUTED",receipts} as const;
}
