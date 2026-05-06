const http = require('http');
async function run() {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/teachers?year=2025%2F2026',
    method: 'GET',
    headers: {
      'Cookie': 'session_userId=54d23d8b-01e1-4b6a-b6de-a75b3a01ff25'
    }
  };

  const req = http.request(options, res => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log('BODY:', data.substring(0, 500));
    });
  });

  req.on('error', e => {
    console.error(`problem with request: ${e.message}`);
  });
  req.end();
}
run();
