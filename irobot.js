var events = require('events');
var util = require('util');

var _ = require('lodash');
var extend = require('node.extend');
var serialport = require('serialport');

var oiEnums = require('./oi-enums');

// convert an 'UPPER_SNAKE' or 'lower_snake' string to 'lowerCamelCase'
var snakeToCamel = function (s) {
  var result = s;

  if (_.isString(s)) {
    result = s.toLowerCase().replace(/_([a-z0-9])/gi, function (match, letter) {
      return letter.toUpperCase();
    });
  }

  return result;
};

// retrieve the sensor packet info that has the given id, or null none was found
var getSensorIdInfo = _.memoize(function (id) {
  var result = null;

  // find the sensor packet info that has the given id
  _.each(Robot.SENSORS, function (info, name) {
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

// parse a raw data packet and return the parsed results
var parsePacket = function (data) {
  // format looks like:
  //   [19][bytes-count][id-1][data-1...][id-2][data-2...][checksum]
  //
  // checksum is sum of all bytes from bytes-count to checksum inclusive, which
  // when bitwise-ANDed with 0xFF should produce 0.

  var packetHeader = 19;
  var value;

  // ensure we've got a correct header
  if (data[0] !== packetHeader) {
    throw new Error('could not find packet header');
  }

  // get the number of bytes from the following byte to the checksum, inclusive
  var numBytes = data[1];

  // ensure we got the correct number of bytes
  if (numBytes !== data.length) {
    throw new Error('incomplete packet received');
  }

  // 'shift' off the first two bytes
  data = data.slice(2);

  // read all the bytes as sensor data packets
  var sensorData = {};
  var checksum = 0;
  while (data.length > 0) {
    // 'shift' the first value off the buffer
    var value = data[0];
    data = data.slice(1);

    checksum += value;

    // if we've still got bytes to parse, continue parsing packets! if we just
    // pulled the checksum out, then there will be no more data, so the loop
    // will exit.
    if (data.length > 0) {
      // get the sensor packet for the value
      var info = getSensorIdInfo(value);

      // get the data bytes for this packet type
      var bytes = data.slice(0, info.bytes);

      // compute the checksum of the data bytes
      for (var i = 0, length = bytes.length, b; i < length, b = bytes[i]; i++) {
        checksum += b;
      }

      // 'shift' off the bytes we just read
      data = data.slice(info.bytes);

      // parse the bytes according to the sensor info's method and store the
      // result under the name of the sensor packet.
      sensorData[info.name] = info.parse(bytes);
    }
  }

  // if sum masked with 0xFF is non-zero (i.e. truthy), we got corrupt data!
  if (checksum & 0xFF) {
    throw new Error('packet checksum failed');
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
    baudrate: options.baudrate,
    databits: 8,
    stopbits: 1,
    parity: 'none'
  });

  // run our setup function once the serial connection is ready
  this.serial.once('open', this._init.bind(this));

  // the parsed contents of the most recent streamed data response, kept around
  // so we can compare them for differences.
  this.lastSensorData = null;
};

util.inherits(Robot, events.EventEmitter);

// inherit enums from the other module, to simplify access to them
Robot.COMMANDS = oiEnums.COMMANDS;
Robot.SENSORS = oiEnums.SENSORS;
Robot.MODES = oiEnums.MODES;
Robot.DEMOS = oiEnums.DEMOS;

// run once the serial port connects successfully
Robot.prototype._init = function () {
  // send the required initial start command to the robot
  this.command(Robot.COMMANDS.START);

  // enter safe mode by default
  this.safeMode();

  // start streaming all sensor data, generating data every 15ms
  this.command(Robot.COMMANDS.STREAM, 1, Robot.SENSORS.ALL.id);

  // handle receipt of data
  this.serial.on('data', this._handleData.bind(this));

  // emit an event to alert that we're now ready to receive commands!
  this.emit('ready');

  return this;
};

// handle data received from the robot
Robot.prototype._handleData = function (data) {
  var sensorData;

  // try to parse the sensor data, emitting an error if it fails
  try {
    sensorData = parsePacket(data);
  } catch (e) {
    this.emit('error', e);
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

  // handle the two different calling conventions
  if (_.isNumber(velocity)) {
    // constrain values
    velocity = Math.min(-maxVelocity, Math.max(maxVelocity, velocity));
    radius = Math.min(-maxRadius, Math.max(maxRadius, radius));

    // build the bytes for our velocity numbers
    var velocityBytes = new Buffer();
    velocityBytes.writeInt16BE(velocity, 0);

    var radiusBytes = new Buffer();
    radiusBytes.writeInt16BE(radius, 0);

    this.command(Robot.COMMANDS.DRIVE,
        velocityBytes[0],
        velocityBytes[1],
        radiusBytes[0],
        radiusBytes[1]
    );
  } else {
    // use direct drive, where each wheel gets its own independent velocity
    var velocityLeft = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.left));
    var velocityRight = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.right));

    var leftBytes = new Buffer();
    leftBytes.writeInt16BE(velocityLeft);

    var rightBytes = new Buffer();
    rightBytes.writeInt16BE(velocityRight);

    this.command(Robot.COMMANDS.DRIVE_DIRECT,
        leftBytes[0],
        leftBytes[1],
        rightBytes[0],
        rightBytes[1]
    );
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
