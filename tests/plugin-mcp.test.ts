import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import Database from 'better-sqlite3';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createActivityMcp} from '../runner/mcp/server.ts';
test('real MCP handshake lists two-skill business API and reviews evidence without device enablement',async()=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'plugin-mcp-'));fs.mkdirSync(path.join(root,'data'));new Database(path.join(root,'data/checkin.db')).close();
 fs.mkdirSync(path.join(root,'evidence','e1'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/e1/manifest.json'),JSON.stringify({id:'e1',tasks:[]}));fs.writeFileSync(path.join(root,'evidence/e1/summary.json'),JSON.stringify({status:'stopped',gainCoins:0}));
 const {server,service}=createActivityMcp({root});const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();
 const client=new Client({name:'offline-test',version:'1'});
 try{await server.connect(serverSide);await client.connect(clientSide);const tools=await client.listTools();assert(tools.tools.some(x=>x.name==='submit_decision'));assert(!tools.tools.some(x=>/shell|edit/.test(x.name)));
 const result=await client.callTool({name:'review_execution',arguments:{executionId:'e1'}});assert.equal(result.isError,undefined);assert.equal(JSON.parse((result.content as any)[0].text).readOnly,true);
 const denied=await client.callTool({name:'begin_execution',arguments:{configFile:'x',live:true}});assert.equal(denied.isError,true);assert.match((denied.content as any)[0].text,/not enabled/);
 }finally{await client.close();await service.close();await server.close();}
});
