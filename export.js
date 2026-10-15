#!/usr/bin/env node
// export.js (Node 18+) --project <name|path|id|all> [--days 14] [--out file.json]  : read-only, redacted project activity for reports
const fs=require("fs"),path=require("path"),os=require("os");
const die=(c,m)=>{console.error(c+": "+m);process.exit(1)};
if(+process.versions.node.split(".")[0]<18||typeof fetch==="undefined")die("NODE_TOO_OLD","needs Node 18 or newer (found "+process.version+"). Install the current LTS from https://nodejs.org");
const t3Dir=()=>{const H=os.homedir();for(let v of [process.env.T3_HOME,process.env.T3CODE_HOME]){v=(v||"").trim();if(!v)continue;if(v.startsWith("~"))v=path.join(H,v.slice(1));return fs.existsSync(path.join(v,"server-runtime.json"))||fs.existsSync(path.join(v,"statev2.sqlite"))?v:path.join(v,"userdata")}
 const b=path.join(H,".t3");return ["userdata","dev"].map(d=>path.join(b,d)).find(d=>fs.existsSync(path.join(d,"server-runtime.json")))||path.join(b,"userdata")};
let rt;try{rt=JSON.parse(fs.readFileSync(path.join(t3Dir(),"server-runtime.json"),"utf8"))}catch{die("T3_NOT_RUNNING","T3 Code isn't running on this computer (no server-runtime.json). Open T3 Code and try again.")}
let T="";try{T=fs.readFileSync(path.join(__dirname,"token"),"utf8").trim()}catch{}if(!T)die("NO_TOKEN","no `token` file next to this script yet. Ask T3 Tots to issue one (setup step), then retry.");
const H={Authorization:"Bearer "+T,"x-t3-orchestration-protocol":"2"};const B=`http://${!rt.host||rt.host==="0.0.0.0"||rt.host==="::"?"127.0.0.1":rt.host.includes(":")?`[${rt.host}]`:rt.host}:${rt.port}`;
const get=async p=>{let r;try{r=await fetch(B+p,{headers:H})}catch(e){throw new Error(`T3_NOT_REACHABLE: can't reach T3 at ${B} (${(e.cause&&e.cause.code)||e.message}). Is T3 Code open?`)}
 if(r.status===401||r.status===403)throw new Error(`TOKEN_REJECTED (HTTP ${r.status}): the T3 Tots token expired or was revoked. Reissue it (t3-tots-rules rule 8).`);if(!r.ok)throw new Error(p+" "+r.status);return r.json()};
const a={};for(let i=2;i<process.argv.length;i++)if(process.argv[i].startsWith("--"))a[process.argv[i].slice(2)]=process.argv[i+1];
const RED=/(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{12,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_.-]+|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S{8,})/gi;
const red=s=>String(s??"").replace(RED,"[redacted]").replaceAll(os.homedir(),"~");
const np=s=>String(s||"").toLowerCase().replace(/\\/g,"/").replace(/\/+$/,"");
const cut=(s,n)=>{s=red(s);return s.length>n?s.slice(0,n)+"…":s};
(async()=>{const sh=await get("/api/orchestration/shell");const days=+a.days||14,since=Date.now()-days*864e5;const q=(a.project||"all").toLowerCase();
const projs=sh.projects.filter(p=>q==="all"||p.id===q||p.title.toLowerCase()===q||np(p.workspaceRoot)===np(path.resolve(q.replace(/^~/,os.homedir())))||p.title.toLowerCase().includes(q));
if(!projs.length)throw new Error("project not found: "+q);const pid=new Set(projs.map(p=>p.id));
const ts=sh.threads.filter(t=>pid.has(t.projectId)&&Date.parse(t.updatedAt)>=since);const out={generatedAt:new Date().toISOString(),days,computer:os.hostname(),projects:projs.map(p=>({title:p.title,root:red(p.workspaceRoot)})),threads:[]};
for(const t of ts){const p=(await get("/api/orchestration/threads/"+encodeURIComponent(t.id))).projection;const items=p.turnItems;
 const files=new Map();for(const i of items)if(i.type==="file_change")files.set(red(i.fileName),(files.get(red(i.fileName))||0)+1);
 for(const c of p.checkpoints||[])for(const f of c.files||[])files.set(red(f.path||f),1);
 const conv=items.filter(i=>(i.type==="user_message"||i.type==="assistant_message")&&i.text).map(i=>({role:i.type==="user_message"?"user":"assistant",at:i.createdAt||i.startedAt,text:cut(i.text,i.type==="user_message"?700:900)}));
 out.threads.push({title:red(t.title),project:projs.find(x=>x.id===t.projectId).title,spawned:/^(mcp|provider)$/.test(t.creationSource),model:t.modelSelection?.model,effort:(t.modelSelection?.options||[]).find(o=>/effort|variant/i.test(o.id))?.value||null,
  status:t.activeRunId?"running":t.status,settled:!!(t.settledAt||t.settledOverride==="settled"),pendingRequest:!!t.pendingRuntimeRequest,actionablePlan:!!t.hasActionableProposedPlan,lastError:t.lastError?cut(t.lastError.message||JSON.stringify(t.lastError),200):null,
  createdAt:t.createdAt,updatedAt:t.updatedAt,runs:p.runs.length,commands:items.filter(i=>i.type==="command_execution").length,files:[...files].map(([f,n])=>({file:f,edits:n})).slice(0,60),conversation:conv.slice(0,4).concat(conv.length>8?[{role:"gap",text:`… ${conv.length-8} more messages …`}]:[],conv.slice(Math.max(4,conv.length-4)))});}
const s=JSON.stringify(out,null,1);if(a.out){fs.mkdirSync(path.dirname(path.resolve(a.out)),{recursive:true});fs.writeFileSync(a.out,s);console.log("wrote",a.out,out.threads.length,"threads")}else console.log(s);})().catch(e=>{console.error("error:",e.message);process.exit(1)});
