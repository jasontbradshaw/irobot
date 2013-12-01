var _ = require('lodash');
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

// create a byte that's a combination of the given bits, in low to high order.
// only the lowest values need to be specified - all others will be assumed 0.
module.exports.bitsToByte = function (bits) {
  // jshint bitwise:false
  var b = 0;

  b = b ^ (!!bits[0] << 0);
  b = b ^ (!!bits[1] << 1);
  b = b ^ (!!bits[2] << 2);
  b = b ^ (!!bits[3] << 3);
  b = b ^ (!!bits[4] << 4);
  b = b ^ (!!bits[5] << 5);
  b = b ^ (!!bits[6] << 6);
  b = b ^ (!!bits[7] << 7);

  return b;
};

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

// given a 'previous' version of an object, the current version of the same
// object, and a dot-delimited key string, determine if that key's value has
// changed between objects using a deep-equals comparison. if the value has
// changed, return it in a 'value' key in the result object. if the values are
// the same, returns an empty object. if a callback is specified, it is run with
// the current value if that value differs from the previous one. if context is
// specified, the callback will be run with it as its 'this' value.
module.exports.compare = function (prevObj, curObj, keyString, callback, context) {
  var keyParts = keyString.trim().split('.');
  var i, length, key;

  // get the previous and current values at our key location
  var prevVal = prevObj;
  var curVal = curObj;
  for (i = 0, length = keyParts.length; key = keyParts[i], i < length; i++) {
    prevVal = prevVal[key];
    curVal = curVal[key];
  }

  // return information about whether the values differed
  var result = {
    key: keyString,
    changed: !_.isEqual(curVal, prevVal),
    value: curVal
  };

  // run the callback function if the value changed
  if (result.changed && _.isFunction(callback)) {
    callback.call(context || null, result.value);
  }


  return result;
};
