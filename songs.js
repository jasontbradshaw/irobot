
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
