import {execFileSync} from 'node:child_process';
import {copyFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const dist=resolve('dist/portable');mkdirSync(dist,{recursive:true});
const exe=join(dist,process.platform==='win32'?'familyos-viewer.exe':'familyos-viewer');
execFileSync(process.execPath,['node_modules/esbuild/bin/esbuild','tools/portable-launcher.mjs','--bundle','--platform=node','--target=node22','--format=cjs','--outfile=dist/portable/app.cjs'],{stdio:'inherit'});
writeFileSync('dist/portable/sea-config.json',JSON.stringify({main:'dist/portable/app.cjs',output:'dist/portable/sea.blob',disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false},null,2));
execFileSync(process.execPath,['--experimental-sea-config','dist/portable/sea-config.json'],{stdio:'inherit'});
copyFileSync(process.execPath,exe);
if(process.platform==='darwin'){try{execFileSync('codesign',['--remove-signature',exe],{stdio:'inherit'})}catch{}}
const inject=['node_modules/postject/dist/cli.js',exe,'NODE_SEA_BLOB','dist/portable/sea.blob','--sentinel-fuse','NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if(process.platform==='darwin')inject.push('--macho-segment-name','NODE_SEA');
if(!existsSync(inject[0]))throw Error('postject not installed');
execFileSync(process.execPath,inject,{stdio:'inherit'});
if(process.platform==='darwin')execFileSync('codesign',['--sign','-','--force',exe],{stdio:'inherit'});
if(process.platform!=='win32')chmodSync(exe,0o755);
console.log(exe);
