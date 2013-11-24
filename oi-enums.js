var _ = require('lodash');

// turn a buffer into an int intelligently depending on its length
var bufferToInt = function (buffer, signed) {
  var result = 0;

  // makes something like 'readUInt8' or 'readInt32'
  var method = [
    'read',
    signed ? '' : 'U', 'Int',
    buffer.length * 8,
    buffer.length > 1 ? 'BE' : ''
  ].join('');

  return buffer[method](0);
};

// return a value as a percentage scaled to the given ranges
var scaleValue = function (rawValue, options) {
  var defaults = {
    min_raw: 0,
    min_actual: 0
  };
  options = extend(defaults, options);

  var rangeRaw = options.max_raw - options.min_raw;
  var rangeActual = options.max_actual - options.min_actual;
  return (1.0 * rawValue / rangeRaw) * rangeActual;
};

// parse the first byte as a boolean and return it
var parseBool = function (bytes) { return !!(bytes[0]); }

// parse the given bytes into an unsigned integer
var parseUnsigned = function (bytes) { return bufferToInt(bytes); }

// parse the given bytes into a signed integer
var parseSigned = function (bytes) { return bufferToInt(bytes, true); }

// return the bits of a byte as a boolean array
var parseBits = function (b) {
  return [
    !!((b & 0x80) >> 7),
    !!((b & 0x40) >> 6),
    !!((b & 0x20) >> 5),
    !!((b & 0x10) >> 4),
    !!((b & 0x8) >> 3),
    !!((b & 0x4) >> 2),
    !!((b & 0x2) >> 1),
    !!(b & 0x1)
  ];
};

var buildParseInt = function (valueKey, signed) {
  return function (bytes) {
    var result = {};
    result[valueKey] = bufferToInt(bytes, signed);
    return result;
  };
};

var buildParseScaled = function (actualValueKey, options) {
  return function (bytes) {
    var result = {};

    result['min_' + actualValueKey] = options.min_actual || 0;
    result['max_' + actualValueKey] = options.max_actual;
    result[actualValueKey] = scaleValue(bufferToInt(bytes), options);

    return result;
  };
};

// build a function that parses some unsigned bytes and stores them under a key
var buildParseMagnitude = function (options) {
  return function (bytes) {
    var result = {
      min: options.min,
      max: options.max,
      range: options.max - options.min,
      raw: bufferToInt(bytes)
    };

    result.magnitude = 1.0 * result.raw / result.range;

    return result;
  };
};

// the various commands the robot accepts, with the number of bytes they take.
// null signifies a variable number of bytes.
var COMMANDS = {
  START: { opcode: 128, bytes: 0 },
  BAUD: { opcode: 129, bytes: 1 },
  SAFE: { opcode: 131, bytes: 0 },
  FULL: { opcode: 132, bytes: 0 },
  DEMO: { opcode: 136, bytes: 1 },
  DRIVE: { opcode: 137, bytes: 4 },
  DRIVE_DIRECT: { opcode: 145, bytes: 4 },
  LEDS: { opcode: 139, bytes: 3 },
  DIGITAL_OUTPUTS: { opcode: 147, bytes: 1 },
  PWM_LOW_SIDE_DRIVERS: { opcode: 144, bytes: 3 },
  SEND_IR: { opcode: 151, bytes: 1 },
  SONG: { opcode: 140, bytes: null },
  PLAY_SONG: { opcode: 141, bytes: 1 },
  SENSORS: { opcode: 142, bytes: 1 },
  QUERY_LIST: { opcode: 149, bytes: null },
  STREAM: { opcode: 148, bytes: null },
  PAUSE_RESUME_STREAM: { opcode: 150, bytes: 1 },
  SCRIPT: { opcode: 152, bytes: null },
  PLAY_SCRIPT: { opcode: 153, bytes: 0 },
  SHOW_SCRIPT: { opcode: 154, bytes: 0 },
  WAIT_TIME: { opcode: 155, bytes: 1 },
  WAIT_DISTANCE: { opcode: 156, bytes: 2 },
  WAIT_ANGLE: { opcode: 157, bytes: 2 },
  WAIT_EVENT: { opcode: 158, bytes: 1 }
};

// the various sensors the robot has access to. each has a parse function that,
// when given a Buffer of the data bytes the packet defines, returns an object
// containing the relevant data in a nice format.
var SENSORS = {
  ALL: {
    id: 6,
    bytes: null,
    parse: _.identity
  },

  BUMP_AND_WHEEL_DROP: {
    id: 7,
    bytes: 1,
    parse: function (bytes) {
      var bits = parseBits(bytes[0]);

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
    }
  },

  WALL: {
    id: 8,
    bytes: 1,
    parse: parseBool
  },

  CLIFF_LEFT: {
    id: 9,
    bytes: 1,
    parse: parseBool
  },

  CLIFF_FRONT_LEFT: {
    id: 10,
    bytes: 1,
    parse: parseBool
  },

  CLIFF_FRONT_RIGHT: {
    id: 11,
    bytes: 1,
    parse: parseBool
  },

  CLIFF_RIGHT: {
    id: 12,
    bytes: 1,
    parse: parseBool
  },

  VIRTUAL_WALL: {
    id: 13,
    bytes: 1,
    parse: parseBool
  },

  LOW_SIDE_DRIVER_AND_WHEEL_OVERCURRENTS: {
    id: 14,
    bytes: 1,
    parse: function (bytes) {
      var bits = parseBits(bytes[0]);

      var leftWheel = bits[4];
      var rightWheel = bits[3];
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
    }
  },

  INFRARED_BYTE: {
    id: 17,
    bytes: 1,
    parse: function (bytes) {
      var b = bytes[0];

      return {
        // b === 255 means "not receiving"
        receiving: b !== 255,
        value: b
      };
    }
  },

  BUTTONS: {
    id: 18,
    bytes: 1,
    parse: function (bytes) {
      var bits = parseBits(bytes[0]);
      return {
        advance: bits[2],
        play: bits[0]
      };
    }
  },

  DISTANCE: {
    id: 19,
    bytes: 2,
    parse: parseSigned
  },

  ANGLE: {
    id: 20,
    bytes: 2,
    parse: parseSigned
  },

  CHARGING_STATE: {
    id: 21,
    bytes: 1,
    parse: function (bytes) {
      var stateId = bytes[0];
      return {
        not_charging: stateId === 0,
        reconditioning_charging: stateId === 1,
        full_charging: stateId === 2,
        trickle_charging: stateId === 3,
        waiting: stateId === 4,
        charging_fault_condition: stateId === 5
      };
    }
  },

  VOLTAGE: {
    id: 22,
    bytes: 2,
    parse: buildParseInt('millivolts')
  },

  CURRENT: {
    id: 23,
    bytes: 2,
    parse: buildParseInt('milliamp_hours', true)
  },

  BATTERY_TEMPERATURE: {
    id: 24,
    bytes: 1,
    parse: buildParseInt('celcius', true)
  },

  BATTERY_CHARGE: {
    id: 25,
    bytes: 2,
    parse: buildParseInt('milliamp_hours')
  },

  BATTERY_CAPACITY: {
    id: 26,
    bytes: 2,
    parse: buildParseInt('milliamp_hours')
  },

  WALL_SIGNAL: {
    id: 27,
    bytes: 2,
    parse: buildParseMagnitude({
      min: 0,
      max: 4095
    })
  },

  CLIFF_LEFT_SIGNAL: {
    id: 28,
    bytes: 2,
    parse: buildParseMagnitude({
      min: 0,
      max: 4095
    })
  },

  CLIFF_FRONT_LEFT_SIGNAL: {
    id: 29,
    bytes: 2,
    parse: buildParseMagnitude({
      min: 0,
      max: 4095
    })
  },

  CLIFF_FRONT_RIGHT_SIGNAL: {
    id: 30,
    bytes: 2,
    parse: buildParseMagnitude({
      min: 0,
      max: 4095
    })
  },

  CLIFF_RIGHT_SIGNAL: {
    id: 31,
    bytes: 2,
    parse: buildParseMagnitude({
      min: 0,
      max: 4095
    })
  },

  CARGO_BAY_DIGITAL_INPUTS: {
    id: 32,
    bytes: 1,
    parse: function (bytes) {
      var bits = parseBits(bytes[0]);

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
    }
  },

  CARGO_BAY_ANALOG_SIGNAL: {
    id: 33,
    bytes: 2,
    parse: buildParseScaled('volts', {
      max_raw: 1023,
      max_actual: 5.0
    })
  },

  CHARGING_SOURCES_AVAILABLE: {
    id: 34,
    bytes: 1,
    parse: function (bytes) {
      var bits = parseBits(bytes[0]);
      return {
        home_base: bits[1],
        internal_charger: bits[0]
      };
    }
  },

  OI_MODE: {
    id: 35,
    bytes: 1,
    parse: function (bytes) {
      var modeId = bytes[0];
      return (['off', 'passive', 'safe', 'full'])[modeId] || null;
    }
  },

  SONG_NUMBER: {
    id: 36,
    bytes: 1,
    parse: parseUnsigned
  },

  SONG_PLAYING: {
    id: 37,
    bytes: 1,
    parse: function (bytes) {
      return {
        playing: !!(bytes[0])
      };
    }
  },

  NUMBER_STREAM_PACKETS: {
    id: 38,
    bytes: 1,
    parse: parseUnsigned
  },

  REQUESTED_VELOCITY: {
    id: 39,
    bytes: 2,
    parse: parseSigned
  },

  REQUESTED_RADIUS: {
    id: 40,
    bytes: 2,
    parse: parseSigned
  },

  REQUESTED_RIGHT_VELOCITY: {
    id: 41,
    bytes: 2,
    parse: parseSigned
  },

  REQUESTED_LEFT_VELOCITY: {
    id: 42,
    bytes: 2,
    parse: parseSigned
  }
};

// the three modes the robot can operate in. since these are each individual
// commands but still function logically as a group, we simply map them to their
// respective commands.
var MODES = {
  PASSIVE: COMMANDS.START, // same as the 'start' command
  SAFE: COMMANDS.SAFE,
  FULL: COMMANDS.FULL
};

// the various demos the robot can perform. these map to the data byte sent with
// the 'demo' command.
var DEMOS = {
  ABORT: 255, // same as -1
  COVER: 0,
  COVER_AND_DOCK: 1,
  SPOTCOVER: 2,
  MOUSE: 3,
  FIGUREEIGHT: 4,
  WIMP: 5,
  HOME: 6,
  TAG: 7,
  PACHELBEL: 8,
  BANJO: 9
};

module.exports = {
  COMMANDS: COMMANDS,
  SENSORS: SENSORS,
  DEMOS: DEMOS,
  MODES: MODES
};
