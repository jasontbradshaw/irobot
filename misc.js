var extend = require('node.extend');

// turn a buffer into an int intelligently depending on its length
module.exports.bufferToInt = function (buffer, signed) {
  // builds something like 'readUInt8' or 'readInt32'
  var method = [
    'read',
    signed ? '' : 'U',
    'Int',
    buffer.length * 8,
    buffer.length > 1 ? 'BE' : ''
  ].join('');

  return buffer[method](0);
};

// return a value as a percentage scaled to the given ranges
module.exports.scaleValue = function (rawValue, options) {
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
module.exports.byteToBool = function (bytes) { return !!(bytes[0]); }

// return the bits of a byte as a boolean array
module.exports.byteToBits = function (b) {
  // jshint bitwise:false
  return [
    !!(b & 0x1),
    !!((b & 0x2) >> 1),
    !!((b & 0x4) >> 2),
    !!((b & 0x8) >> 3),
    !!((b & 0x10) >> 4),
    !!((b & 0x20) >> 5),
    !!((b & 0x40) >> 6),
    !!((b & 0x80) >> 7)
  ];
};
