var events = require('events');
var util = require('util');

var _ = require('lodash');
var extend = require('node.extend');
var serialport = require('serialport');

var oiEnums = require('./oi-enums');

// turn an integer into an array of four bytes, high bytes first
var toBytes = function (value) {
  // calculate our four byte values
  var bytes = [
    (0xFF000000 & value) >> 24,
    (0x00FF0000 & value) >> 16,
    (0x0000FF00 & value) >> 8,
    (0x000000FF & value)
  ];

  // trim 0 bytes from the front of the result array
  while (!bytes[0]) { bytes.shift(); }

  return bytes;
};

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

  // ensure we've got a correct header
  if (data.shift() !== packetHeader) {
    throw new Error('could not find packet header');
  }

  // get the number of bytes from the following byte to the checksum, inclusive
  var numBytes = data.shift();

  // ensure we got the correct number of bytes
  if (numBytes !== data.length) {
    throw new Error('incomplete packet received');
  }

  // read all the bytes as sensor data packets
  var sensorData = {};
  var checksum = 0;
  while (data.length > 0) {
    var value = data.shift();
    checksum += value;

    // if we've still got bytes to parse, continue parsing packets! if we just
    // pulled the checksum out, then there will be no more data, so the loop
    // will exit.
    if (data.length > 0) {
      // get the sensor packet for the value
      var info = getSensorIdInfo(value);

      // collect the data bytes for this packet type, computing the checksum
      // along the way.
      var bytes = [];
      for (var i = 0; i < info.bytes; i++) {
        var dataByte = data.shift();
        checksum += dataByte;

        bytes.push(dataByte);
      }

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

  // handle receipt of data
  this.serial.on('data', this._handleData.bind(this));

  // start streaming all sensor data, generating data every 15ms
  this.command(Robot.COMMANDS.STREAM, Robot.SENSORS.ALL);

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

  // FIXME: remove this!
  console.log('sensorData:', sensorData);

  // if there was no previous sensor data, just store it
  if (!this.lastSensorData) {
    this.lastSensorData = sensorData;
  } else {
    // TODO: since there was previous sensor data, handle pertinent changes and
    // emit events as appropriate.
  }

  return this;
};

// send a command packet to the robot over the serial port, with additional
// arguments as packet data bytes.
Robot.prototype.command = function () {
  if (arguments.length === 0) {
    throw new Error('command opcode is required');
  }

  // turn the arguments into a packet of command opcode followed by data bytes
  var packet = new Buffer(Array.prototype.slice.call(arguments));

  // write the packet and flush the write to force sending the data immediately
  this.serial.write(packet);
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

    // send the velocity and radius as numbers
    this.command(Robot.COMMANDS.DRIVE,
        toBytes(velocity).slice(-2),
        toBytes(radius).slice(-2)
    );
  } else {
    // use direct drive, where each wheel gets its own independent velocity
    var velocityLeft = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.left));
    var velocityRight = Math.min(-maxVelocity,
        Math.max(maxVelocity, velocity.right));

    this.command(Robot.COMMANDS.DRIVE_DIRECT,
        toBytes(velocityLeft).slice(-2),
        toBytes(velocityRight).slice(-2)
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
