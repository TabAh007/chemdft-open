/** Isolated frontend acceptance only. Never used by the application or deployed. */
import http from 'node:http';
let failOnce = true;
let messagePosts = 0;
http.createServer(async (request, response) => {
  const chunks=[]; for await (const chunk of request) chunks.push(chunk);
  const body=Buffer.concat(chunks);
  if (request.method==='POST' && /\/ai\/conversations\/[^/]+\/messages$/.test(request.url)) {
    messagePosts++;
    if (failOnce) {
      failOnce=false;
      // A controlled unavailable server response; no AI or scientific record is written.
      setTimeout(()=>{response.writeHead(503,{'Content-Type':'application/json'});response.end(JSON.stringify({detail:'Controlled frontend acceptance failure; retry is available.'}));},1000);
      return;
    }
  }
  if (request.url==='/acceptance-request-count') {
    response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({messagePosts}));return;
  }
  const upstream=http.request({hostname:'127.0.0.1',port:8123,path:request.url,method:request.method,headers:{...request.headers,host:'127.0.0.1:8123'}}, reply=> {
    response.writeHead(reply.statusCode,reply.headers);reply.pipe(response);
  });
  upstream.on('error',()=>{response.writeHead(502);response.end('Upstream unavailable');});upstream.end(body);
}).listen(8125,'127.0.0.1',()=>console.log('Isolated acceptance proxy on 8125; one controlled message failure.'));
