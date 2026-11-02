const {app}=require('electron');
console.log('quality wrapper started');
require('../../quality-verifier.cjs').runVerification({reportPath:require('node:path').resolve(__dirname,'quality-verifier-smoke.json'),timeoutMs:45000}).then(r=>{console.log(JSON.stringify(r));app.exit(r.status==='passed'?0:2);},e=>{console.error(e);app.exit(2);});
