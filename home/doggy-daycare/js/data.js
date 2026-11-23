'use strict';
// ---------- world constants ----------
var TILE = 48, W = 60, H = 38;

// Map layout (tile coordinates, inclusive ranges).
var MAP = {
  roadY0: 35, roadY1: 37, sidewalkY: 34,
  shop: {
    x0: 3, y0: 18, x1: 17, y1: 33,            // outer rectangle of the building (walls included)
    wallFaceY0: 18, wallFaceY1: 19,            // back wall, drawn as a tall wall face
    floor: { x0: 4, y0: 20, x1: 16, y1: 32 },  // walkable interior (minus furniture)
    streetDoor: { x0: 9, x1: 10, y: 33 },      // opening in the front (bottom) wall to the sidewalk
    yardDoor: { x: 17, y0: 23, y1: 24 },       // opening in the right wall to the yard
    counter: { x0: 4, x1: 11, y: 26, registerX: 5, bellX: 8 },
    // solid furniture tiles: [x, y, what]
    furniture: [
      [4, 20, 'shelf-food'], [5, 20, 'shelf-food'], [6, 20, 'shelf-food'], [7, 20, 'shelf-toys'], [8, 20, 'shelf-toys'],
      [9, 20, 'rack-leashes'], [10, 20, 'rack-leashes'], [11, 20, 'shelf-grooming'], [12, 20, 'shelf-grooming'],
      [13, 20, 'staff-desk'], [14, 20, 'staff-desk'], [15, 20, 'crates'], [16, 20, 'crates'],
      [4, 22, 'water-cooler'], [4, 23, 'towel-basket'],
      [4, 29, 'bench'], [4, 30, 'bench'], [4, 31, 'bench'],
      [15, 29, 'display-toys'], [16, 29, 'display-toys'], [15, 31, 'display-food'], [16, 31, 'display-food'],
      [4, 32, 'plant'], [16, 32, 'plant'], [16, 27, 'plant'],
    ],
  },
  yard: { x0: 18, y0: 6, x1: 56, y1: 31 },     // everything that can ever be owned
};
var FURN = {};
MAP.shop.furniture.forEach(function (f) { FURN[f[0] + ',' + f[1]] = f[2]; });

// yard land. 'base' is owned from the start.
var PLOTS = [
  { id: 'base',      name: 'Starter Yard',   x: 18, y: 18, w: 14, h: 14, cost: 0,    lvl: 1, time: 0 },
  { id: 'north',     name: 'North Lawn',     x: 18, y: 6,  w: 14, h: 12, cost: 450,  lvl: 2, time: 45 },
  { id: 'east',      name: 'East Meadow',    x: 32, y: 18, w: 13, h: 14, cost: 800,  lvl: 3, time: 60 },
  { id: 'northeast', name: 'Orchard Corner', x: 32, y: 6,  w: 13, h: 12, cost: 1200, lvl: 4, time: 90 },
  { id: 'far',       name: 'Lakeside Field', x: 45, y: 6,  w: 12, h: 26, cost: 2200, lvl: 6, time: 150 },
];
// tiles that must stay free so the yard door is never blocked
var KEEP_CLEAR = [[18, 23], [18, 24]];
var YARD_ENTRY = [18, 23];

// where owners queue at the customer side of the counter (tile units, centre of feet); the hand-over happens opposite the action box
var SLOTS = [[4.9, 27.5], [6.15, 27.5], [11.2, 27.5], [5.4, 29.6], [7.1, 29.6]];
var PLAYER_START = [8.9, 24.25];

// ---------- dogs ----------
var TRAITS = {
  glutton: { label: 'Glutton',         icon: '🍖', desc: 'gets hungry fast' },
  zoomies: { label: 'Zoomies',         icon: '⚡', desc: 'needs lots of play, runs fast' },
  cuddly:  { label: 'Cuddle Bug',      icon: '💕', desc: 'craves pets' },
  mud:     { label: 'Mud Magnet',      icon: '🟤', desc: 'gets dirty fast' },
  pooper:  { label: 'Frequent Pooper', icon: '💩', desc: 'poops a lot' },
  water:   { label: 'Water Baby',      icon: '💦', desc: 'adores the pool and baths' },
  chill:   { label: 'Chill',           icon: '😌', desc: 'needs drop slowly' },
  diva:    { label: 'Diva',            icon: '👑', desc: 'tips double, complains easily' },
  sleepy:  { label: 'Sleepyhead',      icon: '💤', desc: 'naps a lot' },
  social:  { label: 'Social Butterfly',icon: '🐾', desc: 'happier near other dogs' },
  nervous: { label: 'Nervous',         icon: '😰', desc: 'hates poop nearby, loves pets' },
  picky:   { label: 'Picky Eater',     icon: '🧐', desc: 'prefers treats to kibble' },
};
var TRAIT_IDS = Object.keys(TRAITS);

var FAVORITES = {
  pets:   { label: 'belly rubs',      icon: '🤲' },
  play:   { label: 'fetch',           icon: '🎾' },
  food:   { label: 'dinner time',     icon: '🍖' },
  treat:  { label: 'treats',          icon: '🍪' },
  bath:   { label: 'bubble baths',    icon: '🛁' },
};
var FAV_IDS = Object.keys(FAVORITES);

var QUIRKS = [
  'Howls at the mail truck', 'Steals socks', 'Sneezes when excited', 'Afraid of the vacuum', 'Sleeps upside down',
  'Tilts head at every sound', 'Chases own tail', 'Carries a stuffed duck everywhere', 'Smiles for photos',
  'Hates wearing booties', 'Thinks it is a cat', 'Loves squeaky toys', 'Does a little spin for treats',
  'Guards the water bowl', 'Talks back when scolded', 'Will not walk past a puddle', 'Gives high fives',
  'Snores like a grandpa', 'Buries toys in the sandpit', 'Best friends with every cat',
];

var DOG_NAMES = ['Biscuit','Luna','Max','Bella','Cooper','Daisy','Milo','Pepper','Rocky','Waffles','Nala','Ziggy','Mochi',
  'Bear','Rosie','Tucker','Olive','Scout','Peanut','Gizmo','Maple','Buster','Hazel','Oreo','Teddy','Pickles','Ruby',
  'Duke','Noodle','Sunny','Bruno','Pixie','Moose','Honey','Louie','Clover','Rex','Lola','Bingo','Juniper','Toast',
  'Sprout','Chewie','Marble','Fig','Nugget','Dumpling','Kona','Ollie','Winnie','Banjo','Poppy','Tofu','Basil','Frankie'];
var OWNER_NAMES = ['Alex','Sam','Priya','Jordan','Maria','Chen','Taylor','Omar','Grace','Diego','Aisha','Ben','Yuki',
  'Liam','Zoe','Marcus','Ines','Kai','Nora','Raj','Elena','Theo','Maya','Hugo','Lena','Felix','Sofia','Ivy','Leo','Ruth'];

// ---------- buildables ----------
// time = real-life seconds to build. floor = dogs & player can walk over it.
var CATALOG = [
  { id: 'kennel',     cat: 'care',  name: 'Kennel',          icon: '🏠', w: 2, h: 2, cost: 150, time: 30,  lvl: 1, cap: 1, solid: true,
    desc: 'Lets owners book overnight stays (big pay). Dogs can nap here. +1 dog capacity.' },
  { id: 'foodbin',    cat: 'care',  name: 'Food Bin',        icon: '🍖', w: 1, h: 1, cost: 80,  time: 10,  lvl: 1, solid: true, desc: 'Grab a bowl of kibble.' },
  { id: 'toybox',     cat: 'care',  name: 'Toy Box',         icon: '🎾', w: 1, h: 1, cost: 80,  time: 10,  lvl: 1, solid: true, desc: 'Grab a ball to play fetch.' },
  { id: 'trash',      cat: 'care',  name: 'Poop Bin',        icon: '🗑️', w: 1, h: 1, cost: 50,  time: 8,   lvl: 1, solid: true, desc: 'Throw scooped poop away here.' },
  { id: 'tub',        cat: 'care',  name: 'Bath Tub',        icon: '🛁', w: 2, h: 1, cost: 250, time: 40,  lvl: 2, solid: true, desc: 'Bring a leashed dog here to wash it.' },
  { id: 'treatjar',   cat: 'care',  name: 'Treat Jar',       icon: '🍪', w: 1, h: 1, cost: 150, time: 20,  lvl: 2, solid: true, desc: 'Treats: a bit of food and a lot of love.' },
  { id: 'waterbowl',  cat: 'care',  name: 'Water Station',   icon: '💧', w: 1, h: 1, cost: 120, time: 15,  lvl: 2, solid: true, desc: 'Dogs wander over for a drink now and then — a little happiness boost.' },
  { id: 'autofeeder', cat: 'care',  name: 'Auto-Feeder',     icon: '🤖', w: 1, h: 1, cost: 600, time: 90,  lvl: 5, solid: true, desc: 'Hungry dogs walk over and feed themselves.' },
  { id: 'playzone',   cat: 'fun',   name: 'Play Zone',       icon: '🛝', w: 3, h: 3, cost: 220, time: 45,  lvl: 2, cap: 2, floor: true, desc: 'Dogs inside have fun on their own. +2 capacity.' },
  { id: 'sandpit',    cat: 'fun',   name: 'Sand Pit',        icon: '🏖️', w: 2, h: 2, cost: 180, time: 30,  lvl: 2, cap: 1, floor: true, desc: 'Great fun to dig in — but dogs get dirty. +1 capacity.' },
  { id: 'pool',       cat: 'fun',   name: 'Splash Pool',     icon: '🏊', w: 3, h: 2, cost: 450, time: 75,  lvl: 3, cap: 2, floor: true, desc: 'Fun and a little cleaning. Water Babies go wild. +2 capacity.' },
  { id: 'napmat',     cat: 'fun',   name: 'Nap Mat',         icon: '🛏️', w: 2, h: 1, cost: 120, time: 20,  lvl: 3, cap: 1, floor: true, desc: 'Dogs resting here lose needs slower. +1 capacity.' },
  { id: 'agility',    cat: 'fun',   name: 'Agility Course',  icon: '🚧', w: 4, h: 2, cost: 650, time: 120, lvl: 4, cap: 3, floor: true, desc: 'Lots of fun, zoomies dogs love it. +3 capacity.' },
  { id: 'path',       cat: 'decor', name: 'Stone Path',      icon: '🪨', w: 1, h: 1, cost: 8,   time: 2,   lvl: 1, charm: 0.25, floor: true, desc: 'A tidy stepping-stone path.' },
  { id: 'flowers',    cat: 'decor', name: 'Flower Bed',      icon: '🌷', w: 1, h: 1, cost: 20,  time: 5,   lvl: 1, charm: 1, floor: true, desc: '+1 charm.' },
  { id: 'hydrant',    cat: 'decor', name: 'Fire Hydrant',    icon: '🧯', w: 1, h: 1, cost: 30,  time: 6,   lvl: 1, charm: 1, solid: true, desc: '+1 charm. A classic.' },
  { id: 'bush',       cat: 'decor', name: 'Berry Bush',      icon: '🌿', w: 1, h: 1, cost: 35,  time: 8,   lvl: 1, charm: 2, solid: true, desc: '+2 charm.' },
  { id: 'bench',      cat: 'decor', name: 'Garden Bench',    icon: '🪑', w: 2, h: 1, cost: 60,  time: 12,  lvl: 1, charm: 2, solid: true, desc: '+2 charm.' },
  { id: 'lamp',       cat: 'decor', name: 'Lamp Post',       icon: '💡', w: 1, h: 1, cost: 50,  time: 10,  lvl: 2, charm: 2, solid: true, desc: '+2 charm. Glows in the evening.' },
  { id: 'tree',       cat: 'decor', name: 'Apple Tree',      icon: '🌳', w: 1, h: 1, cost: 70,  time: 15,  lvl: 2, charm: 3, solid: true, desc: '+3 charm.' },
  { id: 'birdbath',   cat: 'decor', name: 'Bird Bath',       icon: '🐦', w: 1, h: 1, cost: 90,  time: 15,  lvl: 2, charm: 3, solid: true, desc: '+3 charm.' },
  { id: 'topiary',    cat: 'decor', name: 'Dog Topiary',     icon: '🐩', w: 1, h: 1, cost: 140, time: 25,  lvl: 3, charm: 4, solid: true, desc: '+4 charm. A hedge shaped like a very good dog.' },
  { id: 'picnic',     cat: 'decor', name: 'Picnic Table',    icon: '🧺', w: 2, h: 2, cost: 160, time: 30,  lvl: 3, charm: 4, solid: true, desc: '+4 charm.' },
  { id: 'statue',     cat: 'decor', name: 'Golden Bone',     icon: '🦴', w: 1, h: 1, cost: 220, time: 40,  lvl: 3, charm: 6, solid: true, desc: '+6 charm.' },
  { id: 'pond',       cat: 'decor', name: 'Lily Pond',       icon: '🪷', w: 3, h: 2, cost: 420, time: 80,  lvl: 4, charm: 9, solid: true, desc: '+9 charm.' },
  { id: 'fountain',   cat: 'decor', name: 'Fountain',        icon: '⛲', w: 2, h: 2, cost: 380, time: 90,  lvl: 4, charm: 10, solid: true, desc: '+10 charm.' },
  { id: 'gazebo',     cat: 'decor', name: 'Gazebo',          icon: '🏛️', w: 3, h: 3, cost: 900, time: 150, lvl: 6, charm: 18, solid: true, desc: '+18 charm. The pride of the neighbourhood.' },
];
var CAT_BY_ID = {};
CATALOG.forEach(function (c) { CAT_BY_ID[c.id] = c; });

// ---------- business upgrades (bought once, permanent) ----------
var UPGRADES = [
  { id: 'sneakers',   name: 'Comfy Sneakers',     icon: '👟', cost: 250, lvl: 2, desc: 'Walk 15% faster.' },
  { id: 'flyers',     name: 'Neighbourhood Flyers', icon: '📣', cost: 300, lvl: 2, desc: '20% more customers.' },
  { id: 'kibble',     name: 'Premium Kibble',     icon: '🥩', cost: 350, lvl: 3, desc: 'Feeding also gives +12 love.' },
  { id: 'scooper',    name: 'Pooper Scooper',     icon: '🧹', cost: 300, lvl: 2, desc: 'Carry up to 5 poops before emptying it into the bin.' },
  { id: 'lounge',     name: 'Cosy Waiting Area',  icon: '🛋️', cost: 400, lvl: 3, desc: 'Owners wait 35% longer before complaining.' },
  { id: 'loyalty',    name: 'Loyalty Cards',      icon: '💳', cost: 500, lvl: 4, desc: 'All tips +25%.' },
  { id: 'nightstaff', name: 'Night Sitter',       icon: '🌙', cost: 450, lvl: 4, desc: 'Overnight guests wake up fed, clean and happy.' },
  { id: 'webcam',     name: 'Pup Cam',            icon: '📷', cost: 700, lvl: 5, desc: 'Owners love watching: base prices +20%.' },
];
// ---------- staff you can hire (paid per day, at closing time) ----------
var STAFF = [
  { id: 'receptionist', name: 'Receptionist', icon: '🧑‍💼', wage: 90,  lvl: 3, desc: 'Stands behind the counter and handles check-ins and pickups when you are not there.' },
  { id: 'helper',       name: 'Yard Helper',  icon: '🧑‍🌾', wage: 130, lvl: 4, desc: 'Walks round the yard cuddling, feeding and playing with dogs that ask, and scooping poop. Baths are still your job.' },
];
var STAFF_BY_ID = {};
STAFF.forEach(function (s) { STAFF_BY_ID[s.id] = s; });

// ---------- special guests: rare dogs that turn up once a hidden requirement is met ----------
var SPECIALS = [
  { id: 'alfie',    name: 'Alfie',     title: "Andrew's best buddy",        ownerName: 'Andrew', ownerLook: 'andrew', moraleBoost: true, collar: '#d94b43', breed: 'alfie_terrier', coat: 0, traits: ['social', 'cuddly'],   hint: 'Visits with Andrew and boosts all dogs\' friendships and morale.', check: function () { return true; } },
  { id: 'teddy',    name: 'Teddy',     title: "Annie's scruffy sweetheart", ownerName: 'Annie',  ownerLook: 'annie',  moraleBoost: true, collar: '#7a2e46', breed: 'teddy_terrier', coat: 0, traits: ['social', 'cuddly'],   hint: 'Visits with Annie and boosts all dogs\' friendships and morale.', check: function () { return true; } },
  { id: 'mayor',    name: 'Duchess',   title: "the Mayor's Corgi",        breed: 'corgi',     coat: 1, traits: ['diva', 'social'],   hint: 'Likes a yard with plenty of charm.', check: function (S) { return charm() >= 40; } },
  { id: 'champ',    name: 'Blitz',     title: 'the racing champion',       breed: 'greyhound', coat: 2, traits: ['zoomies', 'chill'], hint: 'Only trusts a daycare that has served many dogs.', check: function (S) { return S.life.served >= 50; } },
  { id: 'moon',     name: 'Midnight',  title: 'the moonlit Husky',         breed: 'husky',     coat: 1, traits: ['zoomies', 'sleepy'], hint: 'Comes to places where dogs have stayed the night.', check: function (S) { return (S.life.overnights || 0) >= 10; } },
  { id: 'star',     name: 'Biscuit',   title: 'the film star',             breed: 'golden',    coat: 1, traits: ['diva', 'cuddly'],   hint: 'Visits only the very best daycares.', check: function (S) { return S.rep >= 4.9; } },
  { id: 'tiny',     name: 'Peanut',    title: 'the smallest dog in town',  breed: 'chihuahua', coat: 2, traits: ['nervous', 'cuddly'], hint: 'Shows up after a truly pawsome day.', check: function (S) { return (S.life.bestPerfectDay || 0) >= 4; } },
  { id: 'grandpa',  name: 'Moose',     title: 'the grand old Bernese',     breed: 'bernese',   coat: 0, traits: ['chill', 'sleepy'],  hint: 'Takes his time. A daycare has to be around for a while.', check: function (S) { return S.day >= 10; } },
  { id: 'scholar',  name: 'Pixel',     title: 'the know-it-all Poodle',    breed: 'poodle',    coat: 2, traits: ['picky', 'diva'],    hint: 'Curious about daycares that have met many breeds.', check: function (S) { return dexCount() >= 20; } },
  { id: 'boo',      name: 'Boo',       title: 'the cloud dog',             breed: 'samoyed',   coat: 0, traits: ['social', 'water'],  hint: 'Appears for keepers who come back day after day.', check: function (S) { return (S.playDays || 0) >= 5; } },
];
var UPG_BY_ID = {};
UPGRADES.forEach(function (u) { UPG_BY_ID[u.id] = u; });

// ---------- daily goals (three random ones each day once the tutorial is done) ----------
// {n} is replaced by the target number
var GOALS = [
  { id: 'serve',    text: 'Return {n} dogs to their owners', stat: 'served',  n: [4, 6, 8],    reward: 60 },
  { id: 'perfect',  text: 'Get {n} PAWSOME pickups',         stat: 'perfect', n: [2, 3, 4],    reward: 90 },
  { id: 'tips',     text: 'Earn ${n} in tips',               stat: 'tips',    n: [40, 80, 150], reward: 70 },
  { id: 'pets',     text: 'Cuddle dogs {n} times',              stat: 'pets',    n: [3, 5, 8], reward: 40 },
  { id: 'scoops',   text: 'Scoop {n} poops',                 stat: 'scoops',  n: [2, 4, 6],   reward: 50 },
  { id: 'baths',    text: 'Give {n} baths',                  stat: 'baths',   n: [1, 2, 3],    reward: 50 },
  { id: 'feeds',    text: 'Feed dogs {n} times',             stat: 'feeds',   n: [2, 3, 5],   reward: 40 },
  { id: 'fetch',    text: 'Play fetch {n} times',            stat: 'fetches', n: [1, 2, 4],   reward: 40 },
  { id: 'earn',     text: 'Earn ${n} today',                 stat: 'earned',  n: [200, 400, 700], reward: 80 },
];

var DIFFICULTY = {
  relaxed: { decay: 0.65, patience: 1.5, label: 'Relaxed' },
  normal:  { decay: 1.0,  patience: 1.0, label: 'Normal' },
  hectic:  { decay: 1.35, patience: 0.75, label: 'Hectic' },
};

var ACTION_LABELS = { up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  interact: 'Do it now (skip the wait)', grab: 'Let go / drop', build: 'Build mode', dex: 'Dog glossary', pause: 'Pause' };

var TUTORIAL = [
  { id: 'checkin', text: 'Stand in the box behind the counter — the owner brings their dog to you' },
  { id: 'release', text: 'Walk the dog through the side door into the yard' },
  { id: 'pet',     text: 'A dog wants cuddles: stand next to it for a moment' },
  { id: 'feed',    text: 'A dog is hungry: stand on the Food Bin mat, then next to the dog' },
  { id: 'scoop',   text: 'Stand on a poop to scoop it, then on the Poop Bin mat' },
  { id: 'wash',    text: 'A dog is muddy: stand by it to leash it, then on the Bath Tub mat' },
  { id: 'return',  text: 'An owner is back: fetch their dog and stand in the box behind the counter' },
  { id: 'build',   text: 'Open build mode and build something' },
];

function lvlNeed(l) { return Math.round(80 * Math.pow(l, 1.5)); }

// base tile kind from the fixed layout (ownership of yard land is decided by the game, see game.js)
function layoutKind(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return 'void';
  if (ty >= MAP.roadY0) return 'road';
  if (ty === MAP.sidewalkY) return 'sidewalk';
  var s = MAP.shop;
  if (tx >= s.x0 && tx <= s.x1 && ty >= s.y0 && ty <= s.y1) {
    if (ty === s.streetDoor.y && tx >= s.streetDoor.x0 && tx <= s.streetDoor.x1) return 'door';
    if (tx === s.yardDoor.x && ty >= s.yardDoor.y0 && ty <= s.yardDoor.y1) return 'door';
    if (tx === s.x0 || tx === s.x1 || ty === s.y1 || ty <= s.wallFaceY1) return 'wall';
    if (ty === s.counter.y && tx >= s.counter.x0 && tx <= s.counter.x1) return 'counter';
    if (FURN[tx + ',' + ty]) return 'furniture';
    return 'shopfloor';
  }
  var y = MAP.yard;
  if (tx >= y.x0 && tx <= y.x1 && ty >= y.y0 && ty <= y.y1) return 'yard';
  return 'scenery';
}
