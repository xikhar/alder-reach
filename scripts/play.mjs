import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname,relative,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.glb':'model/gltf-binary'};
try{await stat(resolve(dir,'index.html'));}catch{console.error('Build the game with npm run build or use the supplied release folder.');process.exit(1);}
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(dir,'.'+(pathname==='/'?'/index.html':pathname));
    const rel=relative(dir,file);
    if(!['GET','HEAD'].includes(req.method)||rel.startsWith('..')||isAbsolute(rel)){res.writeHead(403).end();return;}
    const info=await stat(file);if(!info.isFile())throw new Error('Missing');
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size,'X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+server.address().port+'/';
  console.log('Alder Reach is ready at '+url+'\nClose this window or press Ctrl+C to stop the local server.');
  if(process.argv.includes('--open')&&process.platform==='win32'){
    const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true});child.unref();
  }
});
