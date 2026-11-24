const fs = require('fs');
const os = require('os');
const path = require('path');
const { Anixart } = require('./node_modules/anixapi');

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.anixapp', 'web-config.json'), 'utf8'));

(async () => {
  const client = new Anixart({ token: cfg.token });
  const hub = await client.endpoints.collection.hub();
  fs.mkdirSync('.tmp-previews', { recursive: true });
  fs.writeFileSync('.tmp-previews/hub.json', JSON.stringify(hub));
  console.log('hub saved', hub.weekly?.length, hub.my?.length, hub.recommended?.length);
})();
