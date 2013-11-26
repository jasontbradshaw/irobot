var Robot = require('./irobot').Robot;

var robot = new Robot({ device: '/dev/ttyUSB0' });

robot.on('data', function (data) {
  console.log('data:', data);
});

robot.on('badpacket', function (e) {
  console.error('badpacket:', e);
});
