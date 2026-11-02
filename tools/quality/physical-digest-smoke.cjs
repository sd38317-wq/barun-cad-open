const {app}=require('electron');
try {console.log(require('../../quality-install.cjs').artifactDigest(require('path').resolve('installer-6.0.2/win-unpacked/resources'),require('path').resolve('installer-6.0.2/win-unpacked/Barun CAD 6.exe')));app.exit(0);}catch(error){console.error(error.stack);app.exit(2);}
