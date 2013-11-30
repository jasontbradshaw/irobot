var _ = require('lodash');

module.exports.MAX_SONG_LENGTH = 16;
module.exports.MAX_STORED_SONGS = 16;

// convert an array from Hertz/milliseconds format to MIDI note/64ths of a second
module.exports.toCreateFormat = function (notes) {
  // transform given note values to a [MIDI note, 64ths/second] format
  return _.map(notes || [], function (note) {
    var noteValue = note[0];
    var durationMS = note[1];

    // non-numeric and out-of-range notes are treated as pauses by the robot
    var midiNote = 0;
    if (_.isNumber(noteValue)) {
      // convert the Hertz value to a MIDI note number
      // see: http://en.wikipedia.org/wiki/MIDI_Tuning_Standard#Frequency_values
      midiNote = Math.round(69 + 12 *
          (Math.log(noteValue / 440) / Math.log(2))); // log base change
    }

    // convert the note lengths from milliseconds to 64ths of a second
    var durations64ths = Math.round(64 * durationMS / 1000);

    return [midiNote, durations64ths];
  });
};

// tone played on connect
module.exports.START = [
  [640, 100],
  [650, 100]
];

// tone played on disconnect
module.exports.STOP = module.exports.START.slice().reverse();

module.exports.OMINOUS = [
  [400, 600],
  [400, 350],
  [null, 50],
  [400, 200],
  [400, 600],

  [470, 400],

  [440, 200],
  [440, 400],

  [400, 200],
  [400, 400],

  [365, 242],
  [400, 600],
];

module.exports.IMPERIAL_MARCH = [
  [392, 600],
  [392, 600],
  [392, 600],

  [311.1, 450],
  [466.2, 200],
  [392, 600],

  [311.1, 450],
  [466.2, 200],
  [392, 800],

  [null, 400],

  [587.3, 600],
  [587.3, 600],
  [587.3, 600],

  [622.3, 450],
  [466.2, 200],
  [370, 600],

  [311.1, 450],
  [466.2, 200],
  [392, 800],

  [null, 400],

  [784, 600],
  [392, 400],
  [392, 200],
  [784, 600],

  [740, 450],
  [698.5, 150],
  [659.3, 150],
  [622.3, 150],
  [659.3, 600],

  [415.3, 300],
  [554.4, 600],

  [523.3, 450],
  [493.9, 150],
  [466.2, 150],
  [440, 150],
  [466.2, 600],

  [311.1, 300],
  [370, 600],

  [311.1, 450],
  [370, 200],
  [466.2, 600],

  [392, 450],
  [466.2, 200],
  [587.3, 800],

  [null, 400],

  [784, 600],
  [392, 400],
  [392, 200],
  [784, 600],

  [740, 450],
  [698.5, 150],
  [659.3, 150],
  [622.3, 150],
  [659.3, 600],

  [415.3, 300],
  [554.4, 600],

  [523.3, 450],
  [493.9, 150],
  [466.2, 150],
  [440, 150],
  [466.2, 600],

  [311.1, 300],
  [370, 600],

  [311.1, 450],
  [466.2, 200],
  [392, 600],

  [311.1, 450],
  [466.2, 200],
  [392, 800],
];
