var events = require('events');
var util = require('util');

var _ = require('lodash');
var extend = require('node.extend');
var serialport = require('serialport');

var commands = require('./commands');
var demos = require('./demos');
var sensors = require('./sensors');
var songs = require('./songs');

var Robot = function (device, options) {
  events.EventEmitter.call(this);

  if (!_.isString(device)) {
    var err = new Error('a valid serial device string is required!');
    err.invalid_device = device;
    throw err;
  }

  // set up our options. we pull in the device we were given for convenience
  var defaults = {
    device: device,
    baudrate: 57600
  };
  this.options = extend(defaults, options);

  // the parsed contents of the most recent streamed data response, kept around
  // so we can compare subsequent responses for differences.
  this._sensorData = null;

  // initiate a serial connection to the robot
  this.serial = new serialport.SerialPort(this.options.device, {
    baudrate: this.options.baudrate,
    databits: 8,
    stopbits: 1,
    parity: 'none',

    // use our custom packet parser
    parser: this._parseSerialData.bind(this)
  });

  // run our setup function once the serial connection is ready
  this.serial.on('open', this._init.bind(this));

  // handle incoming sensor data whenever we get it
  this.on('sensordata', this._handleSensorData.bind(this));

  // where incoming serial data is held until a complete packet is received
  this._buffer = [];
};

util.inherits(Robot, events.EventEmitter);

// run once the serial port reports a connection
Robot.prototype._init = function () {
  // send the required initial start command to the robot
  this._sendCommand(commands.Start);

  // enter safe mode by default
  this.safeMode();

  // start streaming all sensor data. we manually specify the packet ids we need
  // since streaming with the special bytes (id < 7) returns responses that
  // require special cases to correctly parse.
  var packets = _.pluck(sensors.ALL_SENSOR_PACKETS, 'id');
  this._sendCommand(commands.Stream, packets.length, packets);

  // give feedback that we've connected
  this.sing(songs.START);

  // emit an event to alert that we're now ready to receive commands once we've
  // received the first sensor data. that means that the robot is communicating
  // with us and ready to go!
  this.once('sensordata', _.bind(this.emit, this, 'ready'));

  return this;
};

// collect serial data in an internal buffer until we receive an entire packet,
// and then emit a 'packet' event so that packet can be specifically parsed.
Robot.prototype._parseSerialData = function (emitter, data) {
  // add the received bytes to our internal buffer in-place
  Array.prototype.push.apply(this._buffer, data);

  // attempt to find a valid packet in our stored bytes
  for (var i = this._buffer.length; i >= 0; i--) {
    if (this._buffer[i] === sensors.PACKET_HEADER) {
      // the packet length byte value and the packet end index (exclusive)
      var packetLength = this._buffer[i + 1];
      var endIndex = i + packetLength + 3;

      // set our indexes if we got a valid packet
      var packet = this._buffer.slice(i, endIndex);
      if (sensors.isValidSensorPacket(packet)) {
        // discard all bytes up to the packet's last byte inclusive
        this._buffer.splice(0, endIndex);

        // strip off the header, length, and checksum since we don't need them
        packet = packet.slice(2, -1);

        // parse the sensor data and emit an event with it. if we fail, just
        // alert that we got a bad packet and continue. since there are lots of
        // packets coming through, some are bound to end up corrupted.
        try {
          this.emit('sensordata', sensors.parseSensorData(packet));
        } catch (e) {
          var err = new Error('bad sensor data packet received');
          err.parse_error = e;
          err.packet = packet;
          this.emit('badpacket', err);
        }

        break;
      }
    }
  }

  return this;
};

// handle incoming sensor data and emit events to notify of changes
Robot.prototype._handleSensorData = function (sensorData) {
  // if there was previous sensor data, handle pertinent state changes and emit
  // events as appropriate.
  if (this._sensorData) {
    // TODO: emit events and update state
  }

  // update the stored sensor values now that we're done looking at them
  this._sensorData = sensorData;

  return this;
};

// send a command packet to the robot over the serial port, with additional
// arguments recursively flattened into individual bytes.
Robot.prototype._sendCommand = function (command) {
  // turn the arguments into a packet of command opcode followed by data bytes.
  // arrays in arguments after the first are flattened.
  var packet = _.flatten(Array.prototype.slice.call(arguments, 1));
  packet.unshift(command.opcode);

  // write the bytes and flush the write to force sending the data immediately
  this.serial.write(new Buffer(packet));
  this.serial.flush();

  return this;
};

// return a copy of the most recently received sensor data, or null if none has
// been received yet.
Robot.getSensorData = function () {
  return this._sensorData ? extend({}, this._sensorData) : null;
};

// make the robot play a song. notes is an array of arrays, where each item is a
// pair of note frequency in Hertz and its duration in milliseconds. non-numeric
// note values (like null) are treated as pauses, as are out-of-range values.
Robot.prototype.sing = function (notes) {
  if (notes && notes.length > 0) {
    // split the notes into segments and add them to song slots sequentially
    var segments = [];
    while (notes.length > 0) {
      segments.push(notes.splice(0, songs.MAX_LENGTH));
    }

    // fill all the available song slots with our segments, and store their
    // durations away so we can set timeouts to play them in turn.
    var delays = _.map(segments.splice(0, songs.MAX_SONGS), function (seg, slot) {
      // store the converted song in the given slot
      var song = songs.toCreateFormat(seg);
      this._sendCommand(commands.Song, slot, song.length, song);

      // calculate and return the delay from the 64ths of second parts, since it
      // will be more accurate than using the milliseconds, which were lossily
      // converted to 64ths of a second before being stored on the robot.
      var sixtyFourthsDuration = 0;
      _.each(song, function (note) { sixtyFourthsDuration += note[1]; });

      // use ceil so we don't accidentally call our callback before the previous
      // segment is done, which would cause the new requested playback to fail.
      return Math.ceil(sixtyFourthsDuration * 1000 / 64);
    }, this);

    // schedule all the segments for playback, one after another
    var cumulativeDelay = 0;
    _.each(delays, function (delay, index) {
      setTimeout(_.bind(this._playSong, this, index), cumulativeDelay);
      cumulativeDelay += delay;
    }, this);

    // if there are segments still left, schedule another #sing() call after the
    // final segment is done. we give it our remaining notes and let it
    // overwrite the now-finished song slots.
    if (segments.length > 0) {
      // only flatten to one level, since we need to keep the note pairs
      var remainingNotes = _.flatten(segments, true);
      setTimeout(_.bind(this.sing, this, remainingNotes), cumulativeDelay);
    }
  }

  return this;
};

// start the playback of the given song number
Robot.prototype._playSong = function (index) {
  this._sendCommand(commands.PlaySong, index);
};

// start the playback of the given song number
Robot.prototype._playSong = function (index) {
  this._sendCommand(commands.PlaySong, index);
};

// put the robot into passive mode
Robot.prototype.passiveMode = function () {
  this._sendCommand(commands.Start);
  return this;
};

// put the robot into safe mode
Robot.prototype.safeMode = function () {
  this._sendCommand(commands.Safe);
  return this;
};

// put the robot into full mode
Robot.prototype.fullMode = function () {
  this._sendCommand(commands.Full);
  return this;
};

// run one of the built-in demos specified by the demo id. to stop the demo,
// use #halt().
Robot.prototype.demo = function (demoId) {
  this._sendCommand(commands.Demo, demoId);
  return this;
};

// tell the robot to seek out and mate with its dock. to cancel the docking
// maneuver, use #halt().
Robot.prototype.dock = function () {
  this.demo(demos.CoverAndDock);
  return this;
};

// drive the robot in one of two ways:
//  - velocity, radius
//  - { right: velocity, left: velocity }
Robot.prototype.drive = function (velocity, radius) {
  var maxVelocity = 500; // millimeters per second
  var maxRadius = 2000; // millimeters

  // the command we'll eventually run
  var command = null;

  // for transforming our numbers into individual bytes
  var data = new Buffer(4);

  // handle the two different calling conventions
  if (_.isNumber(velocity)) {
    command = commands.Drive;

    // constrain values
    velocity = Math.min(-maxVelocity, Math.max(maxVelocity, velocity));
    radius = Math.min(-maxRadius, Math.max(maxRadius, radius));

    // build the bytes for our velocity numbers
    data.writeInt16BE(velocity, 0);
    data.writeInt16BE(radius, 2);
  } else {
    command = commands.DriveDirect;

    // use direct drive, where each wheel gets its own independent velocity
    var velocityLeft = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.left));
    var velocityRight = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.right));

    data.writeInt16BE(velocityLeft, 0);
    data.writeInt16BE(velocityRight, 2);
  }

  this._sendCommand(command, data.toJSON());

  return this;
};

// stop the robot from moving/rotating, and stop any current demo
Robot.prototype.halt = function () {
  this.demo(demos.Abort);
  this.drive(0, 0);
  return this;
};

module.exports.Robot = Robot;
