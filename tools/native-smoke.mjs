import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const exe=resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Usage: node tools/native-smoke.mjs path/to/familyos-viewer[.exe]');
const folder=await mkdtemp(join(tmpdir(),'familyos-native-smoke-'));await mkdir(join(folder,'originals'));
const bytes=Buffer.from('synthetic original for native viewer');const sha256=createHash('sha256').update(bytes).digest('hex');
await writeFile(join(folder,'originals','sample1'),bytes);
await writeFile(join(folder,'export.json'),JSON.stringify({format:'familyos-person-export/v1',tables:{documents:[{id:'sample1',filename:'test.txt',sha256,size:bytes.length}],appointments:[{id:'appt1',title:'synthetic appointment'}]}}));
const child=spawn(exe,[folder],{stdio:['ignore','pipe','pipe'],env:{...process.env,FAMILYOS_ARCHIVE_PASSWORD:''}});
let output='',error='',timer;
try {
  const base=await new Promise((resolveUrl,reject)=>{
    timer=setTimeout(()=>reject(Error('Native binary did not launch local server; stdout: '+output+' stderr: '+error)),25000);
    child.stdout.on('data',data=>{output+=data.toString();const match=output.match(/http:\/\/127\.0\.0\.1:\d+\/[a-f\d]+\/app/);if(match)resolveUrl(match[0])});
    child.stderr.on('data',data=>error+=data.toString());
    child.once('error',reject);
    child.once('exit',code=>reject(Error('Native process exited '+code+'; '+error)));
  });
  const ui=await fetch(base);if(ui.status!==200||!(await ui.text()).includes('offline read-only snapshot'))throw Error('HTML UI smoke test failed');
  const dataUrl=base.replace(/\/app$/,'/snapshot');
  const snapshot=await (await fetch(dataUrl)).json();
  if(snapshot.tables.appointments[0].title!=='synthetic appointment')throw Error('Export data mismatch');
  const originalUrl=base.replace(/\/app$/,'/original/sample1');
  const result=await fetch(originalUrl);if(result.status!==200||!Buffer.from(await result.arrayBuffer()).equals(bytes))throw Error('Original evidence mismatch');
  console.log('PASS: native binary served offline UI, records and original evidence');
} finally {clearTimeout(timer);child.kill()}
