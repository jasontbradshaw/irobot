var Demo = function (name, id) {
  this.name = name;
  this.id = id;
};

module.exports.Abort = new Demo('abort', 255);
module.exports.Cover = new Demo('cover ', 0);
module.exports.CoverAndDock = new Demo('cover_and_dock', 1);
module.exports.SpotCover = new Demo('spot_cover', 2);
module.exports.Mouse = new Demo('mouse', 3);
module.exports.FigureEight = new Demo('figure_eight', 4);
module.exports.Wimp = new Demo('wimp', 5);
module.exports.Home = new Demo('home', 6);
module.exports.Tag = new Demo('tag', 7);
module.exports.Pachelbel = new Demo('pachelbel', 8);
module.exports.Banjo = new Demo('banjo', 9);
