var Robot = require('./irobot').Robot;
var songs = require('./songs');

var robot = new Robot({ device: '/dev/ttyUSB0' });

robot.on('ready', function () {
  robot.sing(songs.OMINOUS);
});
