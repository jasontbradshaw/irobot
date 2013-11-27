var events = require('events');
var util = require('util');

var _ = require('lodash');
var extend = require('node.extend');
var serialport = require('serialport');

var commands = require('./commands');
var demos = require('./demos');
var sensors = require('./sensors');

var Robot = function (options) {
  events.EventEmitter.call(this);

  // set up our options
  var defaults = {
    device: null,
    baudrate: 57600
  };
  this.options = extend(defaults, options);

  // set up the serial connection to the given device
  this.serial = new serialport.SerialPort(options.device, {
    baudrate: this.options.baudrate,
    databits: 8,
    stopbits: 1,
    parity: 'none',

    // use our custom packet parser
    parser: this._parseSerialData.bind(this)
  });

  // run our setup function once the serial connection is ready
  this.serial.on('open', this._init.bind(this));

  // the parsed contents of the most recent streamed data response, kept around
  // so we can compare them for differences.
  this.lastSensorData = null;

  // where incoming serial data is held until a complete packet is received
  this._buffer = [];
};

util.inherits(Robot, events.EventEmitter);

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

        // parse the sensor data and emit an event with it
        this.emit('sensordata', sensors.parseSensorData(packet));

        break;
      }
    }
  }

  return this;
};

// run once the serial port connects successfully
Robot.prototype._init = function () {
  // handle incoming sensor data
  this.on('sensordata', this._handleSensorData.bind(this));

  // send the required initial start command to the robot
  this._sendCommand(commands.Start);

  // enter safe mode by default
  this.safeMode();

  // start streaming all sensor data. we manually collect the packet ids we need
  // since streaming with the special bytes (id < 7) returns funky responses
  // that require lots of special cases to parse.
  var packets = _.pluck(sensors.ALL_SENSOR_PACKETS, 'id');
  this._sendCommand(commands.Stream, packets.length, packets);

  // emit an event to alert that we're now ready to receive commands!
  this.emit('ready');

  return this;
};

// handle when a parsed data packet is received from the robot
Robot.prototype._handleSensorData = function (sensorData) {
  // if there was previous sensor data, handle pertinent state changes and emit
  // events as appropriate.
  if (this.lastSensorData) {
    // TODO: emit events and update state
  }

  // update the previous sensor values now that we're done looking at them
  this.lastSensorData = sensorData;

  return this;
};

// send a command packet to the robot over the serial port, with additional
// arguments flattened into packet data bytes.
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

// make the robot play a song. notes is an array of arrays, where each item is a
// pair of note number to duration in milliseconds. null note values are treated
// as pauses. notes are treated as frequencies in Hertz unless treatAsMIDI is
// true.
Robot.prototype.sing = function (notes, treatAsMIDI) {
  // use only the first 16 notes since the robot can't store more
  // TODO: store longer sequences in multiple song slots and play sequentially
  notes = notes.slice(0, 16);

  // transform given note values to a [MIDI note, 64ths/second] format
  notes = _.map(notes, function (note) {
    var noteValue = note[0];
    var durationMS = note[1];

    // convert notes to the MIDI note number format
    var midiNote;
    if (noteValue === null) {
      // convert null notes to out-of-range notes, i.e. pauses
      midiNote = 0;
    } else if (!treatAsMIDI) {
      // convert the Hertz value to a MIDI note number
      // see: http://en.wikipedia.org/wiki/MIDI_Tuning_Standard#Frequency_values
      midiNote = Math.round(69 + 12 * (Math.log(noteValue / 440) / Math.log(2)));
    }

    // convert the note lengths from milliseconds to 64ths of a second
    var durations64ths = Math.round(64 * durationMS / 1000);

    return [midiNote, durations64ths];
  });

  // store the song in the first slot
  this._sendCommand(commands.Song, 0, notes.length, _.flatten(notes));

  // play the stored song immediately
  this._sendCommand(commands.PlaySong, 0);

  return this;
};

// shortcuts for putting the robot into its various modes
Robot.prototype.passiveMode = function () {
  this._sendCommand(commands.Start);
  return this;
};

Robot.prototype.safeMode = function () {
  this._sendCommand(commands.Safe);
  return this;
};

Robot.prototype.fullMode = function () {
  this._sendCommand(commands.Full);
  return this;
};

// run one of the built-in demos specified by the demo id
Robot.prototype.demo = function (demoId) {
  this._sendCommand(commands.Demo, demoId);
  return this;
};

// stop any currently active demo
Robot.prototype.abortDemo = function () {
  this._sendCommand(commands.Demo, demos.Abort);
  return this;
};

// tell the robot to seek out and mate with its dock
Robot.prototype.dock = function () {
  this.demo(demos.CoverAndDock);
  return this;
};

// since docking is a demo, just alias the demo abort method
Robot.prototype.abortDock = Robot.prototype.abortDemo;

// drive the robot in one of two ways:
//  - velocity, radius
//  - { right: velocity, left: velocity }
Robot.prototype.drive = function (velocity, radius) {
  var maxVelocity = 500; // millimeters per second
  var maxRadius = 2000; // millimeters

  // for transforming our numbers into individual bytes
  var b = new Buffer(4);

  // handle the two different calling conventions
  if (_.isNumber(velocity)) {
    // constrain values
    velocity = Math.min(-maxVelocity, Math.max(maxVelocity, velocity));
    radius = Math.min(-maxRadius, Math.max(maxRadius, radius));

    // build the bytes for our velocity numbers
    b.writeInt16BE(velocity, 0);
    b.writeInt16BE(radius, 2);

    this._sendCommand(commands.Drive, b.toJSON());
  } else {
    // use direct drive, where each wheel gets its own independent velocity
    var velocityLeft = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.left));
    var velocityRight = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.right));

    b.writeInt16BE(velocityLeft, 0);
    b.writeInt16BE(velocityRight, 2);

    this._sendCommand(commands.DriveDirect, b.toJSON());
  }

  return this;
};

// stop the robot from moving/rotating
Robot.prototype.halt = function () {
  this.drive(0, 0);
  return this;
};

module.exports.Robot = Robot;
