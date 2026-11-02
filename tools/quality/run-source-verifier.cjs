// Same runtime probes as the installer, without packaging/installing or touching its DB.
const path=require('node:path');
require('../../quality-verifier.cjs').runVerification({reportPath:path.resolve(__dirname,'../../tmp/release-6.0.4/source-quality.json')}).then(report=>require('electron').app.exit(report.status==='passed'?0:2));
