import http from 'node:http';

const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }
    console.log(
      JSON.stringify({
        method: request.method,
        url: request.url,
        body: parsed,
      }),
    );
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result: { message_id: 42 } }));
  });
});

server.listen(4010, '127.0.0.1', () => {
  console.log('fake telegram listening on 4010');
});
