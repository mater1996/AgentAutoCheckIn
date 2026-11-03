import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';import path from 'node:path';
const root=process.cwd(),transport=new StdioClientTransport({command:path.join(root,'plugins/codex/checkin/bin/start-mcp'),env:{PATH:process.env.PATH!,CHECKIN_WORKSPACE:root,CHECKIN_ALLOW_DEVICE:'0',CHECKIN_ALLOW_RESTART:'0'},stderr:'pipe'});
const client=new Client({name:'checkin-install-verification',version:'0.1.0'});
try{
 await client.connect(transport);const tools=await client.listTools();
 const context=await client.callTool({name:'get_activity_context',arguments:{configFile:'config/plugin/taobao-coin.json'}});if(context.isError)throw Error(JSON.stringify(context));
 const payload=JSON.parse((context.content as any[])[0].text);
 const output={tools:tools.tools.map(t=>t.name),scope:payload.scope,knowledge:payload.knowledge.map((x:any)=>({path:x.path,sha256:x.sha256})),deviceEnabled:false,modelRequests:0};
 fs.mkdirSync('evidence/plugin-integration-20261103',{recursive:true});fs.writeFileSync('evidence/plugin-integration-20261103/mcp-installed-workspace.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
}finally{await client.close();}
