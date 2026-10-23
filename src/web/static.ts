import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function consoleRoute(req:IncomingMessage,res:ServerResponse,url:URL):boolean{
 const asset=/^\/assets\/([\w-]+\.(js|css))$/.exec(url.pathname);
 if(url.pathname!=='/'&&!asset)return false;
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return true;}
 const path=asset?`assets/${asset[1]}`:'index.html';
 try{
  const data=readFileSync(resolve('dist/console',path));
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Console assets unavailable; run pnpm build.');}
 return true;
}
