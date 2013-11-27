var Robot = require('./irobot').Robot;

var robot = new Robot({ device: '/dev/ttyUSB0' });

robot.on('sensordata', function (data) {
  console.log(
    '\n--------------------------------------------------------------------\n',
    JSON.stringify(data.wheels, null, '  ')
  );
});
