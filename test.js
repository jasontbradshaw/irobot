var Robot = require('./irobot').Robot;

var robot = new Robot('/dev/ttyUSB0');

robot.on('ready', function () {
  console.log('ROBOT READY!');
});
