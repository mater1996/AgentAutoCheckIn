import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ActivityService,type ActivityServiceOptions} from './service.ts';
import {pathToFileURL} from 'node:url';

export function createActivityMcp(options:ActivityServiceOptions){
 const service=new ActivityService(options),server=new McpServer({name:'checkin',version:'0.1.0'});
 for(const tool of service.tools())server.registerTool(tool.name,{description:tool.description,inputSchema:tool.inputSchema},async(args:any)=>{
  try{return await service.call(tool.name,args);}catch(error){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:error instanceof Error?error.message:String(error)})}]};}
 });
 return {server,service};
}
export async function startStdio(){
 const root=process.env.CHECKIN_WORKSPACE;if(!root)throw Error('CHECKIN_WORKSPACE must explicitly identify the existing project workspace');
 const {server,service}=createActivityMcp({root,allowDevice:process.env.CHECKIN_ALLOW_DEVICE==='1',allowRestart:process.env.CHECKIN_ALLOW_RESTART==='1'});
 const transport=new StdioServerTransport();let closing=false;
 const close=async()=>{if(closing)return;closing=true;try{await service.close();}finally{await server.close();}};
 transport.onclose=()=>{void close().catch(e=>console.error(String(e)));};
 process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});process.once('SIGINT',()=>{void close().finally(()=>process.exit(0));});
 await server.connect(transport);return {server,service,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startStdio().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
