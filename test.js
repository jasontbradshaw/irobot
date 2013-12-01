var irobot = require('./index');

var robot = new irobot.Robot('/dev/ttyUSB0');

robot.on('ready', function () {
  console.log('READY');
});

// robot.on('sensordata', function (data) {
//   console.log('SENSOR DATA', data);
// });

robot.on('bump', function (e) { console.log('BUMP', e); });
robot.on('button', function (e) { console.log('BUTTON', e); });
robot.on('cliff', function (e) { console.log('CLIFF', e); });
robot.on('ir', function (e) { console.log('IR', e); });
robot.on('mode', function (e) { console.log('MODE', e); });
robot.on('overcurrent', function (e) { console.log('OVERCURRENT', e); });
robot.on('virtualwall', function (e) { console.log('VIRTUALWALL', e); });
robot.on('wall', function (e) { console.log('WALL', e); });
robot.on('wheeldrop', function (e) { console.log('WHEELDROP', e); });
