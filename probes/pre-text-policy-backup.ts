import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {resolveDatabasePath} from '../runner/storage/index.ts';
// Independent pre-run backup; a failure exits nonzero and must block live startup.
const file=path.resolve('data/backups/pre-text-policy-live-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');
fs.mkdirSync(path.dirname(file),{recursive:true});
const db=new Database(resolveDatabasePath(),{readonly:true,fileMustExist:true});
try {await db.backup(file);} finally {db.close();}
const saved=new Database(file,{readonly:true});
try {const check=saved.pragma('quick_check',{simple:true});if(check!=='ok')throw Error('Backup integrity check failed');console.log(JSON.stringify({backup:file,quick_check:check}));}finally{saved.close();}
