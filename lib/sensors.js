var _ = require('lodash');

var misc = require('./misc');

// parse the given bytes into a signed integer
var parseSigned = _.partialRight(misc.bufferToInt, true);

// build a function that takes in some bytes, parses them as an integer, and
// returns an object with that value assigned to the given key.
var buildParseInt = function (valueKey, signed) {
  return function (bytes) {
    var result = {};
    result[valueKey] = misc.bufferToInt(bytes, signed);
    return result;
  };
};

// build a function that takes in some bytes, parses them as an unsigned int,
// then scales the returned value between the minimum and maximum values
// provided, then returns an object with min_{{key}}, max_{{key}}, and {{key}}
// values.
var buildParseScaled = function (actualValueKey, options) {
  return function (bytes) {
    var result = {};

    result['min_' + actualValueKey] = options.min_actual || 0;
    result['max_' + actualValueKey] = options.max_actual;
    result[actualValueKey] = misc.scaleValue(misc.bufferToInt(bytes), options);

    return result;
  };
};

// build a function that takes in some bytes, parses them as an unsigned int,
// and returns an object with useful data about the value's magnitude between
// some minimum and maximum.
var buildParseMagnitude = function (options) {
  return function (bytes) {
    var result = {
      min: options.min,
      max: options.max,
      range: options.max - options.min,
      raw: misc.bufferToInt(bytes)
    };

    result.magnitude = 1.0 * result.raw / result.range;

    return result;
  };
};

// stores data about a sensor packet, and holds a function that parses its raw
// bytes into a more descriptive object format.
var Packet = function (name, id, bytes, parser) {
  this.name = name;
  this.id = id;
  this.bytes = bytes;

  // the parser is null by default, otherwise the specified function
  this.parser = _.isFunction(parser) ? parser : function () {};
};

// proxy to the parser function given on creation
Packet.prototype.parse = function () {
  return this.parser.apply(this, arguments);
};

//
// EXPORTS
//

// the first byte in a packet always has this value
module.exports.PACKET_HEADER = 19;

// retrieve the sensor packet object with the given id, or null none was found
module.exports.getById = function (id) {
  return module.exports.SENSOR_PACKETS_BY_ID[id] || null;
};

// determine whether some sensor packet data is valid, and return true if so
module.exports.isValidSensorPacket = function (packet) {
  // format looks like:
  //   [packet-header][bytes-count][id-1][data-1...][id-2][data-2...][checksum]
  //
  // checksum is the sum of all bytes in a packet, header to checksum inclusive,
  // that when bitwise-ANDed with 0xFF should produce 0. this is in contrast
  // with what the docs claim, but this implementation has been verified to be
  // correct.

  // if the packet header doesn't match, it's invalid
  var packetHeader = packet[0];
  if (packetHeader !== module.exports.PACKET_HEADER) {
    return false;
  }

  // if the length doesn't match, it's invalid. the "+ 3" accounts for the
  // length byte, header, and checksum.
  var packetLength = packet[1];
  if (packetLength + 3 !== packet.length) {
    return false;
  }

  // sum all the bytes in the packet
  var checksum = 0;
  for (var i = packet.length - 1; i >= 0; i--) {
    checksum += packet[i];
  }

  // if the checksum is non-zero, it's invalid. otherwise it passed validation!
  // jshint bitwise:false
  return !(checksum & 0xFF);
};

// parse an initial raw sensor data object into a more useful version
var prettifySensorData = function (raw) {
  var data = {};

  // consolidate various sensor data into more localized representations
  data.wheels = {
    right: {
      dropped: raw.bump_and_wheel_drop.wheel_drop.right,
      overcurrent: raw.low_side_driver_and_wheel_overcurrents.wheel.right
    },
    left: {
      dropped: raw.bump_and_wheel_drop.wheel_drop.left,
      overcurrent: raw.low_side_driver_and_wheel_overcurrents.wheel.left
    },
    caster: {
      dropped: raw.bump_and_wheel_drop.wheel_drop.caster
    }
  };

  // give the low side drivers explicit overcurrent properties
  data.low_side_drivers = _.map(raw.low_side_driver_and_wheel_overcurrents.low_side_drivers, function (lsd) {
    return  { overcurrent: lsd }
  });

  data.bumpers = {
    left: { activated: raw.bump_and_wheel_drop.bump.left },
    right: { activated: raw.bump_and_wheel_drop.bump.right },
    both: {
      // true if both bumpers are activated at once
      activated: (raw.bump_and_wheel_drop.bump.right &&
                  raw.bump_and_wheel_drop.bump.left)
    }
  };

  data.cliff_sensors = {
    left: {
      detecting: raw.cliff_left,
      signal: raw.cliff_left_signal
    },
    front_left: {
      detecting: raw.cliff_front_left,
      signal: raw.cliff_front_left_signal
    },
    front_right: {
      detecting: raw.cliff_front_right,
      signal: raw.cliff_front_right_signal
    },
    right: {
      detecting: raw.cliff_right,
      signal: raw.cliff_right_signal
    },
  };

  data.wall_sensor = {
    detecting: raw.wall,
    signal: raw.wall_signal
  };

  data.virtual_wall_sensor = {
    detecting: raw.virtual_wall
  };

  // TODO: verify that this works
  data.ir = {
    receiving: raw.infrared_byte.receiving,
    received_value: raw.infrared_byte.receiving ? raw.infrared_byte.value : null
  };

  data.buttons = {
    advance: { pressed: raw.buttons.advance },
    play: { pressed: raw.buttons.play }
  };

  data.battery = {
    charging: {
      recharging: !raw.charging_state.not_charging,
      from: raw.charging_sources_available,
      type: {
        reconditioning: raw.charging_state.reconditioning_charging,
        full: raw.charging_state.full_charging,
        trickle: raw.charging_state.trickle_charging,
        waiting: raw.charging_state.waiting,
        fault: raw.charging_state.charging_fault_condition
      }
    },

    voltage: {
      volts: raw.voltage.millivolts / 1000,
      millivolts: raw.voltage.millivolts
    },

    current: {
      amps: raw.current.milliamps / 1000,
      milliamps: raw.current.milliamps
    },

    temperature: {
      celsius: raw.battery_temperature.celsius,
      fahrenheit: raw.battery_temperature.celsius * 9 / 5 + 32,
    },

    capacity: {
      percent: (raw.battery_charge.milliamp_hours /
                raw.battery_capacity.milliamp_hours),
      current: raw.battery_charge,
      max: raw.battery_capacity,
    }
  };

  data.cargo_bay = {
    // these are both the same value since they come to the same cargo bay pin,
    // but it will make for more readable client code to separate them.
    device_detected: raw.cargo_bay_digital_inputs.device_detect_baudrate_change,
    baudrate_change_requested: raw.cargo_bay_digital_inputs.device_detect_baudrate_change,

    digital_input: raw.cargo_bay_digital_inputs.digital_inputs,
    analog_signal: raw.cargo_bay_analog_signal
  };

  data.song = {
    playing: raw.song_playing,
    number: raw.song_number
  };

  data.state = {
    mode: raw.oi_mode,
    distance: raw.distance,
    angle: raw.angle,

    requested_velocity: raw.requested_velocity,
    requested_radius: raw.requested_radius,
    requested_right_velocity: raw.requested_right_velocity,
    requested_left_velocity: raw.requested_left_velocity,
  };

  // NOTE: we ignore "number_stream_packets" (who would need that here anyway?)

  return data;
};

// parse a complete data packet byte array and return the parsed results
module.exports.parseSensorData = function (data) {
  // read all the bytes as sensor data packets
  var rawSensorData = {};

  // we use a 'for' loop to ensure that it must eventually terminate
  var i, length, packetId;
  for (i = 0, length = data.length; (packetId = data[i]), i < length; i++) {
    // get the sensor packet for the value
    var packetInfo = module.exports.getById(packetId);

    // error if we can't parse this packet
    if (!packetInfo) {
      throw new Error('unrecognized packet id:' + packetId);
    }

    // parse the packet's data bytes and store the result under the packet's
    // name. if the parse function returns undefined, the data is thrown away.
    // the parse method needs a buffer so it can handle the bytes directly.
    var dataIndex = i + 1;
    var bytes = data.slice(dataIndex, dataIndex + packetInfo.bytes);
    var parsedData = packetInfo.parse(new Buffer(bytes));

    if (!_.isUndefined(parsedData)) {
      rawSensorData[packetInfo.name] = parsedData;
    }

    // skip over the bytes we just consumed
    i += packetInfo.bytes;
  }

  // return the preffified result
  return prettifySensorData(rawSensorData);
};

// create and export all the various sensor packet types
_.extend(module.exports, {
  BumpAndWheelDrop: new Packet('bump_and_wheel_drop', 7, 1, function (bytes) {
    var bits = misc.byteToBits(bytes[0]);

    var wheelDropCaster = bits[4];
    var wheelDropLeft = bits[3];
    var wheelDropRight = bits[2];
    var bumpLeft = bits[1];
    var bumpRight = bits[0];

    return {
      bump: {
        left: bumpLeft,
        right: bumpRight
      },

      wheel_drop: {
        caster: wheelDropCaster,
        left: wheelDropLeft,
        right: wheelDropRight
      }
    };
  }),

  Wall: new Packet('wall', 8, 1, misc.byteToBool),
  CliffLeft: new Packet('cliff_left', 9, 1, misc.byteToBool),
  CliffFrontLeft: new Packet('cliff_front_left', 10, 1, misc.byteToBool),
  CliffFrontRight: new Packet('cliff_front_right', 11, 1, misc.byteToBool),
  CliffRight: new Packet('cliff_right', 12, 1, misc.byteToBool),
  VirtualWall: new Packet('virtual_wall', 13, 1, misc.byteToBool),

  Overcurrents: new Packet('low_side_driver_and_wheel_overcurrents', 14, 1, function (bytes) {
    var bits = misc.byteToBits(bytes[0]);

    var leftWheel = bits[4];
    var rightWheel = bits[3];

    // odd, but this is what the docs say...
    var ld2 = bits[2];
    var ld0 = bits[1];
    var ld1 = bits[0];

    return {
      wheel: {
        left: leftWheel,
        right: rightWheel
      },

      // an array since it's just a map of LD index to value anyway
      low_side_drivers: [
        ld0,
        ld1,
        ld2
      ]
    };
  }),

  InfraredByte: new Packet('infrared_byte', 17, 1, function (bytes) {
    var b = bytes[0];

    return {
      // b === 255 means "not receiving"
      receiving: b !== 255,
      value: b
    };
  }),

  Buttons: new Packet('buttons', 18, 1, function (bytes) {
    var bits = misc.byteToBits(bytes[0]);
    return {
      advance: bits[2],
      play: bits[0]
    };
  }),

  Distance: new Packet('distance', 19, 2, buildParseInt('millimeters', true)),
  Angle: new Packet('angle', 20, 2, buildParseInt('degrees_ccw', true)),

  ChargingState: new Packet('charging_state', 21, 1, function (bytes) {
    var stateId = bytes[0];
    return {
      not_charging: stateId === 0,
      reconditioning_charging: stateId === 1,
      full_charging: stateId === 2,
      trickle_charging: stateId === 3,
      waiting: stateId === 4,
      charging_fault_condition: stateId === 5
    };
  }),

  Voltage: new Packet('voltage', 22, 2, buildParseInt('millivolts')),
  Current: new Packet('current', 23, 2, buildParseInt('milliamps', true)),

  BatteryTemperature: new Packet('battery_temperature', 24, 1, buildParseInt('celsius', true)),
  BatteryCharge: new Packet('battery_charge', 25, 2, buildParseInt('milliamp_hours')),
  BatteryCapacity: new Packet('battery_capacity', 26, 2, buildParseInt('milliamp_hours')),

  WallSignal: new Packet('wall_signal', 27, 2, buildParseMagnitude({
    min: 0,
    max: 4095
  })),

  CliffLeftSignal: new Packet('cliff_left_signal', 28, 2, buildParseMagnitude({
    min: 0,
    max: 4095
  })),

  CliffFrontLeftSignal: new Packet('cliff_front_left_signal', 29, 2, buildParseMagnitude({
    min: 0,
    max: 4095
  })),

  CliffFrontRightSignal: new Packet('cliff_front_right_signal', 30, 2, buildParseMagnitude({
    min: 0,
    max: 4095
  })),

  CliffRightSignal: new Packet('cliff_right_signal', 31, 2, buildParseMagnitude({
    min: 0,
    max: 4095
  })),

  CargoBayDigitalInputs: new Packet('cargo_bay_digital_inputs', 32, 1, function (bytes) {
    var bits = misc.byteToBits(bytes[0]);

    var deviceDetectBaudrateChange = bits[4];
    var digitalInput3 = bits[3];
    var digitalInput2 = bits[2];
    var digitalInput1 = bits[1];
    var digitalInput0 = bits[0];

    return {
      device_detect_baudrate_change: deviceDetectBaudrateChange,

      digital_inputs: [
        digitalInput0,
        digitalInput1,
        digitalInput2,
        digitalInput3
      ]
    };
  }),

  CargoBayAnalogSignal: new Packet('cargo_bay_analog_signal', 33, 2, buildParseScaled('volts', {
    max_raw: 1023,
    max_actual: 5.0
  })),

  ChargingSourcesAvailable: new Packet('charging_sources_available', 34, 1, function (bytes) {
    var bits = misc.byteToBits(bytes[0]);
    return {
      home_base: bits[1],
      internal_charger: bits[0]
    };
  }),

  OIMode: new Packet('oi_mode', 35, 1, function (bytes) {
    var modeId = bytes[0];
    return {
      off: modeId === 0,
      passive: modeId === 1,
      safe: modeId === 2,
      full: modeId === 3
    };
  }),

  SongNumber: new Packet('song_number', 36, 1, misc.bufferToInt),
  SongPlaying: new Packet('song_playing', 37, 1, misc.byteToBool),
  NumberStreamPackets: new Packet('number_stream_packets', 38, 1, misc.bufferToInt),
  RequestedVelocity: new Packet('requested_velocity', 39, 2, parseSigned),
  RequestedRadius: new Packet('requested_radius', 40, 2, parseSigned),
  RequestedRightVelocity: new Packet('requested_right_velocity', 41, 2, parseSigned),
  RequestedLeftVelocity: new Packet('requested_left_velocity', 42, 2, parseSigned)
});

// an array of all sensor packets sorted by their id
module.exports.ALL_SENSOR_PACKETS = _(module.exports).pick(function (p) {
  return p instanceof Packet;
}).values().sortBy('id').value();

// create a map of packet ids to packets
module.exports.SENSOR_PACKETS_BY_ID = {};
_.each(module.exports.ALL_SENSOR_PACKETS, function (p) {
  module.exports.SENSOR_PACKETS_BY_ID[p.id] = p;
});
