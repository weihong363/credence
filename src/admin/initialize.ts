import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openDatabase} from '../persistence/database.js';
import {initializeDemo} from '../application/initialize.js';

const [limit,...extra]=process.argv.slice(2);
if(!limit||!/^\d+$/.test(limit)||extra.length)throw new Error('USAGE_INITIALIZE_LIMIT_MINOR');
const configuredPath=process.env.CREDENCE_DB_PATH??(process.env.DATA_DIR?join(process.env.DATA_DIR,'credence.sqlite'):undefined);
if(!configuredPath)throw new Error('EXPLICIT_DATABASE_PATH_REQUIRED');
const path=resolve(configuredPath);
if(!existsSync(path))throw new Error('DATABASE_MUST_EXIST_START_SERVER_FIRST');
const db=openDatabase(path);
try{
 const identity=initializeDemo(db,Number(limit));
 console.log(JSON.stringify({status:'INITIALIZED',...identity,limitMinor:Number(limit),currency:'USD'}));
}catch(error){
 console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INITIALIZATION_FAILED');
 process.exitCode=1;
}finally{db.close();}
