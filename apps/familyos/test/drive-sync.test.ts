import { createHash } from "node:crypto";
import { describe,it,expect,vi } from "vitest";
import { runDriveSync,acceptedDriveItem } from "../src/connectors/drive-sync";
describe("opt-in Drive ingestion",()=>{
 it("never connects without explicit enable",async()=>{const result=await runDriveSync({DRIVE_SYNC_ENABLED:"false"} as any,{fetcher:vi.fn() as any});expect(result.status).toBe("DISABLED")});
 it("validates accepted safe file types and size",()=>{expect(acceptedDriveItem({id:"x",name:"test.pdf",mimeType:"application/pdf",size:"200"})).toBe(true);expect(acceptedDriveItem({id:"x",name:"test",mimeType:"application/vnd.google-apps.document",size:"200"})).toBe(false);expect(acceptedDriveItem({id:"x",name:"bad.exe",mimeType:"application/octet-stream",size:"200"})).toBe(false)});
 it("dry-run lists authorized folder but does not download or store",async()=>{
  const requested:string[]=[];
  const fetcher=vi.fn(async(input:string,init?:RequestInit)=>{const url=String(input);requested.push(url);if(url.includes("oauth2.googleapis.com"))return new Response(JSON.stringify({access_token:"synthetic"}),{status:200});if(url.includes("drive/v3/files"))return new Response(JSON.stringify({files:[{id:"file1",name:"record.pdf",mimeType:"application/pdf",size:"123"}]}),{status:200});throw Error("unexpected remote access")});
  const env={DRIVE_SYNC_ENABLED:"true",DRIVE_FOLDER_PERSON_MAP:JSON.stringify({callum:"folderAAA"}),DRIVE_CLIENT_ID:"id",DRIVE_CLIENT_SECRET:"dummy",DRIVE_REFRESH_TOKEN:"dummy"} as any;
  const result=await runDriveSync(env,{fetcher:fetcher as any,dryRun:true});
  expect(result.receipts[0].scanned).toBe(1);expect(result.receipts[0].stored).toBe(0);expect(requested).toHaveLength(2);
 });
 it("imports a source through the existing person vault only",async()=>{
  const bytes=new Uint8Array([37,80,68,70,45,49,46,55]);
  let stored=0,person="";
  const fetcher=vi.fn(async(input:string)=>{const url=String(input);if(url.includes("oauth2.googleapis.com"))return new Response(JSON.stringify({access_token:"synthetic"}));if(url.includes("drive/v3/files")&&!url.includes("alt=media"))return new Response(JSON.stringify({files:[{id:"file1",name:"record.pdf",mimeType:"application/pdf",size:String(bytes.length)}]}));if(url.includes("alt=media"))return new Response(bytes);throw Error("unexpected fetch")});
  const env={DRIVE_SYNC_ENABLED:"true",DRIVE_FOLDER_PERSON_MAP:JSON.stringify({finnley:"folderBBB"}),DRIVE_CLIENT_ID:"id",DRIVE_CLIENT_SECRET:"dummy",DRIVE_REFRESH_TOKEN:"dummy",PERSON_VAULT:{idFromName:(p:string)=>{person=p;return p},get:()=>({fetch:async(request:Request)=>{if(request.method==="GET")return Response.json({source_hash:null,source_version:null});if(new URL(request.url).pathname.startsWith("/drive-imports/")||new URL(request.url).pathname.startsWith("/drive-sync/"))return Response.json({recorded:true});stored++;return Response.json({duplicate:false,id:"doc1",sha256:createHash("sha256").update(bytes).digest("hex")})}})}} as any;
  const result=await runDriveSync(env,{fetcher:fetcher as any});expect(person).toBe("finnley");expect(stored).toBe(1);expect(result.receipts[0].stored).toBe(1)
 });
});
