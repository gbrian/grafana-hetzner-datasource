const r2 = require('r2');
const http = require('http');

class HetznerAPI{
  constructor(options){
    this.options = Object.assign({
      metrics:{
        windowSecs:10
      }
    }, options);
    this.headers = {
      "Authorization": `Bearer ${this.options.token}`
    };
  }

  build_url(url){
    url = `https://api.hetzner.cloud/v1${url}`;
    this.options.log && console.log(url);
    return url;
  }
  async get(url){
    let headers = this.headers;
    return await r2.get(this.build_url(url), {headers}).json; 
  }
  
  async get_serers(){
    var servers = await this.get('/servers');
    // var prices = await this.get_prices();
    return servers;
  }
  
  async get_server_metrics(serverId){
    let end = new Date();
    let start = new Date(end - (this.options.metrics.windowSecs * 1000));
    return this.get(`/servers/${serverId}/metrics?type=cpu,network,disk&start=${start.toISOString()}&end=${end.toISOString()}&step=500`);
  }

  async get_prices(){
    return await this.get('/pricing');
  }

  metrics_to_infulxdb(server, metrics){
    var now = new Date().getTime() * 1000000;
    var server_base = k => `${k},source=hetzner,host=${server.name},id=${server.id},datacenter.region=${server.datacenter.name},type=${server.server_type.name},memory=${server.server_type.memory},ip=${server.public_net.ipv4.ip}`;      
    var ts = metrics.metrics.time_series;
    var server_metrics = Object.keys(ts)
            .map(k => ts[k].values.map(v => ({k:k.split('.'), v:parseFloat(v[1]), t:new Date(v[0]*1000).getTime() * 1000000})))
            .reduce((acc,v) => acc.concat(v), [])
            .map(m => `${server_base(m.k[0])} ${m.k.join("_")}=${m.v} ${m.t}`);
    var server_counters = [
      `${server_base('network')} traffic_free=${server.included_traffic - server.outgoing_traffic} ${now}`,
      `${server_base('network')} traffic_acc_out=${server.outgoing_traffic} ${now}`,
      `${server_base('network')} traffic_acc_in=${server.ingoing_traffic} ${now}`,
      `${server_base('server')} status=${server.status === "running" ? 1:0} ${now}`
    ];
    return server_metrics.concat(server_counters);
  }

  post_to_influxDB(data){
    var settings = this.options.influxDB;
    const options = {
      hostname: settings.host,
      port: settings.port,
      path: `/write?db=${settings.db}&u=${settings.user}&p=${settings.pwd}!`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(options, (res) => {
      res.setEncoding('utf8');
      res.resume();
    });
    req.on('error', (e) => {
      this.options.log && console.error(`problem with request: ${e.message}`);
    });

    req.write(data);
    req.end();
  }
}

var token = process.env.HETZNER_TOKEN;
var influxDB = {
  host: process.env.INFLUXDB_HOST,
  port: process.env.INFLUXDB_PORT || "8086",
  db: process.env.INFLUXDB_DB,
  user: process.env.INFLUXDB_USER,
  pwd: process.env.INFLUXDB_PWD
};
let api = new HetznerAPI({
  log: process.env.HETZNER_LOG,
  token: token,
  influxDB: influxDB
});

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

