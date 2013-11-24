var Robot = require('./irobot-control').Robot;

var robot = new Robot({ device: '/dev/ttyUSB0' });

robot.on('data', function (data) {
  console.log(data);
});
