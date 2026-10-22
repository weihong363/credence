import {fetchSnapshot} from '../src/providers/source.js';
import {inventory} from '../src/providers/contracts.js';
import {verifyResult} from '../src/providers/verify.js';
import {hash} from '../src/domain/json.js';
const snapshot=await fetchSnapshot({repository:{owner:'expressjs',name:'cors',commitSha:'5317ebe670db2aaebc1d496eb5d33493deefb3ed'}});
const verification=verifyResult('repo.inventory',inventory(snapshot),snapshot);
if(!verification.pass)throw new Error('SOURCE_INVENTORY_VERIFICATION_FAILED');
console.log(JSON.stringify({repository:snapshot.repository,files:snapshot.files.length,
 sourceBytes:snapshot.files.reduce((sum,file)=>sum+Buffer.byteLength(file.content),0),exclusions:snapshot.exclusions.length,
 snapshotHash:hash(snapshot),verification,modelCalls:0,paypalCalls:0},null,2));
