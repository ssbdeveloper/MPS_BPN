// uninstall-service.js
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'Timesheet API',
  script: 'D:\\WEB\\timesheet-project\\API\\server.js'
});

svc.on('uninstall', () => {
  console.log('Service uninstalled successfully');
});

svc.on('alreadyuninstalled', () => {
  console.log('Service is already uninstalled');
});

svc.on('error', (err) => {
  console.error('Error:', err);
});

svc.uninstall();