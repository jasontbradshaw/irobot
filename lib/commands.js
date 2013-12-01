var _ = require('lodash');

var Command = function (name, opcode, bytes) {
  this.name = name;
  this.opcode = opcode;
  this.bytes = _.isNumber(bytes) ? bytes : null;
};

module.exports.Start = new Command('start', 128, 0);
module.exports.Baud = new Command('baud', 129, 1);
module.exports.Safe = new Command('safe', 131, 0);
module.exports.Full = new Command('full', 132, 0);
module.exports.Demo = new Command('demo', 136, 1);
module.exports.Drive = new Command('drive', 137, 4);
module.exports.DriveDirect = new Command('drive_direct', 145, 4);
module.exports.LEDs = new Command('leds', 139, 3);
module.exports.DigitalOutputs = new Command('digital_outputs', 147, 1);
module.exports.LowSideDrivers = new Command('low_side_drivers', 144, 3);
module.exports.SendIR = new Command('send_ir', 151, 1);
module.exports.Song = new Command('song', 140);
module.exports.PlaySong = new Command('play_song', 141, 1);
module.exports.Sensors = new Command('sensors', 142, 1);
module.exports.QueryList = new Command('query_list', 149);
module.exports.Stream = new Command('stream', 148);
module.exports.ToggleStream = new Command('pause_resume_stream', 150, 1);
module.exports.Script = new Command('script', 152);
module.exports.PlayScript = new Command('play_script', 153, 0);
module.exports.ShowScript = new Command('show_script', 154, 0);
module.exports.WaitTime = new Command('wait_time', 155, 1);
module.exports.WaitDistance = new Command('wait_distance', 156, 2);
module.exports.WaitAngle = new Command('wait_angle', 157, 2);
module.exports.WaitEvent = new Command('wait_event', 158, 1);
