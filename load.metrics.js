const HetznerAPI = require('./heztner.api.js');

var token = process.env.HETZNER_TOKEN;
var settings = {
  log: process.env.HETZNER_LOG||false ? true: false,
  token: token||"",
  influxDB:{
    host: process.env.INFLUXDB_HOST||"",
    port: process.env.INFLUXDB_PORT || "8086",
    db: process.env.INFLUXDB_DB||"",
    user: process.env.INFLUXDB_USER||"",
    pwd: process.env.INFLUXDB_PWD||""
  }
};
console.log(JSON.stringify(settings));
let api = new HetznerAPI(settings);

async function read_server_metrics(server){
  var metrics = await api.get_server_metrics(server.id);
  var res = api.metrics_to_infulxdb(server, metrics);
  api.post_to_influxDB(res.join('\n'));
}

async function read(){
  try{
    var servers = await api.get_serers();
    await Promise.all(servers.servers
      .map(async s => await read_server_metrics(s)));
  }catch(e){}
  setTimeout(read, 10000);
}

read();