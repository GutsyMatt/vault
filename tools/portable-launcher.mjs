import {openSnapshot,openEncryptedSnapshot,createOfflineServer} from './offline-viewer.mjs';
import {isSea} from 'node:sea';
const input=process.argv[1] && !isSea() ? process.argv[2] : process.argv[1];
(async()=>{if(!input){console.error('FamilyOS read-only portable viewer\nUsage: familyos-viewer <snapshot-folder|encrypted.fosbkp>');process.exitCode=2;}
else{try{const snapshot=input.endsWith('.fosbkp')?await openEncryptedSnapshot(input,process.env.FAMILYOS_ARCHIVE_PASSWORD||''):await openSnapshot(input);const {server,token}=createOfflineServer(snapshot);server.listen(0,'127.0.0.1',()=>{console.log('FamilyOS is running locally. Open: http://127.0.0.1:'+server.address().port+'/'+token+'/app');console.log('Close this window to lock the session. No cloud connection is used.');});}catch(e){console.error('Cannot open snapshot:',e.message);process.exitCode=1}})();
