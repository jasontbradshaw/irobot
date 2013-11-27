var events = require('events');
var util = require('util');

var _ = require('lodash');
var extend = require('node.extend');
var serialport = require('serialport');

var oiEnums = require('./oi-enums');

// retrieve the sensor packet info that has the given id, or null none was
// found. includes the lowercase name of the packet type on a 'name' property,
// inluding the other data on its enum.
var getSensorIdInfo = _.memoize(function (id) {
  var result = null;

  // find the sensor packet info that has the given id
  _.each(oiEnums.SENSORS, function (info, name) {
    if (info.id === id) {
      // make a copy of the sensor info so we can modify it
      result = _.extend({}, info);

      // store the name on the info for easy access
      result.name = name.toLowerCase();

      // stop iteration since we found the result
      return false;
    }
  });

  return result;
});

// parse a complete data packet array and return the parsed results
var parsePacket = function (data) {
  // format looks like:
  //   [header][bytes-count][id-1][data-1...][id-2][data-2...][checksum]
  //
  // checksum is sum of all bytes from bytes-count to checksum inclusive, which
  // when bitwise-ANDed with 0xFF should produce 0.

  // ensure we've got a correct header (the first byte)
  var packetHeader = data.shift();
  if (packetHeader !== oiEnums.PACKET_HEADER) {
    throw new Error('invalid packet header (' + packetHeader + ')');
  }

  // ensure we got the correct number of bytes. the "+ 2" accounts for the
  // length byte itself and the checksum.
  var packetLength = data[0];
  if (packetLength + 2 !== data.length) {
    throw new Error('incomplete packet received (got ' + data.length +
        ' bytes, expected ' + packetLength + ')');
  }

  // compute the packet checksum and fail if it's non-zero
  var checksum = 0;
  for (var i = data.length - 1; i >= 0; i--) {
    checksum += data[i];
  }

  // jshint bitwise:false
  if (checksum & 0x01) {
    throw new Error('packet checksum (' + checksum + ') failed');
  }

  // remove the length (first) and checksum (last) since we no longer need them
  data.shift();
  data.pop();

  // read all the bytes as sensor data packets
  var sensorData = {};
  while (data.length > 0) {
    // get the next packet it from the buffer
    var value = data.shift();

    // get the sensor packet for the value
    var packetInfo = getSensorIdInfo(value);

    // error if we can't parse this packet
    if (!packetInfo) {
      throw new Error('unrecognized packet id: ' + value);
    }

    // splice out the data bytes for this packet type from the remaining bytes
    var bytes = data.splice(0, packetInfo.bytes);

    // parse the bytes according to the sensor info's method and store the
    // result under the name of the sensor packet. if there's no method, the
    // data is effectively thrown away. the parse method needs a buffer so it
    // can handle the bytes directly.
    if (_.isFunction(packetInfo.parse)) {
      sensorData[packetInfo.name] = packetInfo.parse(new Buffer(bytes));
    }
  }

  return sensorData;
};

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

    // parse packets our own way, since we need to look for delimiters
    parser: this._serialParser.bind(this)
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

// inherit enums from the other module, to simplify access to them
Robot.COMMANDS = oiEnums.COMMANDS;
Robot.SENSORS = oiEnums.SENSORS;
Robot.MODES = oiEnums.MODES;
Robot.DEMOS = oiEnums.DEMOS;

// collect serial data in an internal buffer until we receive an entire packet,
// and then emit a 'packet' event so that packet can be specifically parsed.
Robot.prototype._serialParser = function (emitter, data) {
  var i, length, b;

  // add the received bytes to our internal buffer
  for (i = 0, length = data.length, b; i < length, (b = data[i]); i++) {
    this._buffer.push(b);
  }

  // attempt to find a packet header in our stored bytes
  var packetHeaderIndex = -1;
  var packetLengthIndex = -1;
  for (i = 0, length = this._buffer.length, b; i < length, (b = data[i]); i++) {
    if (b === oiEnums.PACKET_HEADER) {
      // store the indexes we'll need to continue parsing
      packetHeaderIndex = i;
      packetLengthIndex = i + 1;
      break;
    }
  }

  // if we found a packet header and there's room for both a length byte and
  // checksum following it, grab the rest of the packet data.
  if (packetHeaderIndex >= 0 && packetHeaderIndex < this._buffer.length - 2) {
    var packetLength = this._buffer[packetLengthIndex];

    // if we've got enough bytes for an entire packet, parse it out.
    // NOTE: length accounts only for the bytes after the length byte but before
    // the checksum.
    if (packetLengthIndex + packetLength < this._buffer.length) {
      // remove any bytes preceding the packet header
      this._buffer.splice(0, packetHeaderIndex);

      // splice out the packet bytes, header and checksum included
      var packetBytes = this._buffer.splice(0, packetLength + 3);
      console.log('packetBytes:', '[' + packetBytes.join(', ') + ']');

      // emit a packet event with the data we just parsed
      emitter.emit('packet', packetBytes);
    }
  }

  return this;
};

// run once the serial port connects successfully
Robot.prototype._init = function () {
  // handle incoming data
  this.serial.on('packet', this._handlePacket.bind(this));

  // send the required initial start command to the robot
  this.command(Robot.COMMANDS.START);

  // enter safe mode by default
  this.safeMode();

  // start streaming all sensor data
  this.command(Robot.COMMANDS.STREAM, 1, oiEnums.SENSORS.ALL.id);

  // emit an event to alert that we're now ready to receive commands!
  this.emit('ready');

  return this;
};

// handle when a complete data packet is received from the robot
Robot.prototype._handlePacket = function (data) {
  var sensorData;

  // try to parse the sensor data, emitting an event and giving up if it fails
  try {
    sensorData = parsePacket(data);
  } catch (e) {
    this.emit('badpacket', e);
    return this;
  }

  // emit an event to alert that we got new sensor data
  this.emit('data', sensorData);

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
// arguments as packet data bytes.
Robot.prototype.command = function (command) {
  // turn the arguments into a packet of command opcode followed by data bytes
  var packet = [command.opcode];
  packet = packet.concat(Array.prototype.slice.call(arguments, 1));

  var bytes = new Buffer(packet);

  // write the bytes and flush the write to force sending the data immediately
  this.serial.write(bytes);
  this.serial.flush();

  return this;
};

// put the robot into the mode specified by the given mode command
Robot.prototype.mode = function (modeCommand) {
  this.command(modeCommand);
  return this;
};

// make the robot play a song. notes is an array of arrays, where each item is a
// pair of note number to duration in 64ths of a second.
Robot.prototype.sing = function (notes) {
  // add the song to slot 0, then play it immediately
  var args = [Robot.COMMANDS.SONG, 0, notes.length];
  args = args.concat(_.flatten(notes));

  // store the song
  this.command.apply(this, args);

  // play the stored song
  this.command(Robot.COMMANDS.PLAY_SONG, 0);

  return this;
};

// shortcuts for putting the robot into its various modes
Robot.prototype.passiveMode = function () {
  this.mode(Robot.MODES.PASSIVE);
  return this;
};

Robot.prototype.safeMode = function () {
  this.mode(Robot.MODES.SAFE);
  return this;
};

Robot.prototype.fullMode = function () {
  this.mode(Robot.MODES.FULL);
  return this;
};

// run one of the built-in demos specified by the demo id
Robot.prototype.demo = function (demoId) {
  this.command(Robot.COMMANDS.DEMO, demoId);
  return this;
};

// tell the robot to seek out and mate with its dock
Robot.prototype.dock = function () {
  this.demo(Robot.DEMOS.COVER_AND_DOCK);
  return this;
};

// drive the robot in one of two ways:
//  (velocity, radius), or ({ right: velocity, left: velocity })
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

    this.command(Robot.COMMANDS.DRIVE, b[0], b[1], b[2], b[3]);
  } else {
    // use direct drive, where each wheel gets its own independent velocity
    var velocityLeft = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.left));
    var velocityRight = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.right));

    b.writeInt16BE(velocityLeft, 0);
    b.writeInt16BE(velocityRight, 2);

    this.command(Robot.COMMANDS.DRIVE_DIRECT, b[0], b[1], b[2], b[3]);
  }

  return this;
};

// stop the robot from moving/rotating
Robot.prototype.stop = function () {
  this.drive({
    left: 0,
    right: 0
  });

  return this;
};

module.exports.Robot = Robot;
