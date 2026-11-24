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

// yard land. 'base' is owned from the start. Walk onto the border expansion box or use the Land tab to expand!
var PLOTS = [
  { id: 'base',      name: 'Starter Yard',   x: 18, y: 18, w: 14, h: 14, cost: 0,    lvl: 1,  time: 0,      unlocks: [] },
  { id: 'north',     name: 'North Lawn',     x: 18, y: 6,  w: 14, h: 12, cost: 450,  lvl: 2,  time: 21600,  padX: 21, padY: 18, unlocks: ['🏖️ Sand Pit', '🥣 Kennel Chef Pad', '🧺 Picnic Table', '🚧 Agility Course'] },
  { id: 'east',      name: 'East Meadow',    x: 32, y: 18, w: 13, h: 14, cost: 1200, lvl: 4,  time: 86400,  padX: 30, padY: 23, unlocks: ['🏊 Splash Pool', '🛁 Pet Groomer Pad', '🎾 Play Trainer Pad', '🤖 Auto-Feeder'] },
  { id: 'northeast', name: 'Orchard Corner', x: 32, y: 6,  w: 13, h: 12, cost: 3200, lvl: 7,  time: 172800, padX: 30, padY: 11, unlocks: ['🦮 Pickup Runner Pad', '🪷 Lily Pond', '⛲ Fountain', '🦴 Golden Bone'] },
  { id: 'far',       name: 'Lakeside Field', x: 45, y: 6,  w: 12, h: 26, cost: 7500, lvl: 10, time: 345600, padX: 43, padY: 22, unlocks: ['🏛️ Royal Gazebo', '🏊 Lakeside Pool', '🚧 Agility Arena'] },
];
// tiles that must stay free so the yard door is never blocked
var KEEP_CLEAR = [[18, 23], [18, 24]];
var YARD_ENTRY = [18, 23];

// where owners queue at the customer side of the counter (well-spaced so portrait bubbles never overlap)
var SLOTS = [[5.2, 27.6], [11.6, 27.6], [14.5, 27.6], [6.4, 30.3], [11.8, 30.3]];
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
// time = real-life seconds to build (continues in real time while app is closed, Clash of Clans style).
// Every placed building can also be upgraded infinitely (Lv 1 -> Lv 2 -> Lv 3...) for higher capacity, charm & care bonus.
var CATALOG = [
  { id: 'kennel',     cat: 'care',  name: 'Kennel',          icon: '🏠', w: 2, h: 2, cost: 50,   time: 7200,   lvl: 1,  cap: 1, solid: true,
    desc: 'Each Kennel allows 1 dog in your daycare (1 Kennel = 1 Dog allowed) and unlocks overnight stays. Unlock more Kennels as you level up!' },
  { id: 'foodbin',    cat: 'care',  name: 'Food Bin',        icon: '🍖', w: 1, h: 1, cost: 60,   time: 7200,   lvl: 1,  solid: true, desc: 'Stack bowls of kibble. Upgrade for +care bonus & charm.' },
  { id: 'toybox',     cat: 'care',  name: 'Toy Box',         icon: '🎾', w: 1, h: 1, cost: 65,   time: 9000,   lvl: 1,  solid: true, desc: 'Stack balls for fetch. Upgrade for +care bonus & charm.' },
  { id: 'trash',      cat: 'care',  name: 'Poop Bin',        icon: '🗑️', w: 1, h: 1, cost: 40,   time: 5400,   lvl: 1,  solid: true, desc: 'Toss scooped poop away. Upgrade for +XP & charm.' },
  { id: 'tub',        cat: 'care',  name: 'Bath Tub',        icon: '🛁', w: 2, h: 1, cost: 110,  time: 14400,  lvl: 1,  solid: true, desc: 'Wash muddy dogs. Upgrade for faster baths & +charm.' },
  { id: 'waterbowl',  cat: 'care',  name: 'Water Fountain',  icon: '💧', w: 1, h: 1, cost: 55,   time: 7200,   lvl: 1,  solid: true, desc: 'Fresh drinking fountain! Thirsty dogs trot over for a drink and +happiness.' },
  { id: 'treatjar',   cat: 'care',  name: 'Treat Jar',       icon: '🍪', w: 1, h: 1, cost: 420,  time: 28800,  lvl: 3,  solid: true, desc: 'Stack gourmet dog treats. Upgrade for bigger mood boosts.' },
  { id: 'autofeeder', cat: 'care',  name: 'Auto-Feeder',     icon: '🤖', w: 1, h: 1, cost: 3200, time: 345600, lvl: 10, solid: true, desc: 'Hungry dogs walk over and feed themselves automatically.' },
  { id: 'playzone',   cat: 'fun',   name: 'Play Zone',       icon: '🛝', w: 3, h: 3, cost: 520,  time: 43200,  lvl: 3,  charm: 4, floor: true, desc: 'Dogs inside play and stay happy on their own. +4 charm.' },
  { id: 'napmat',     cat: 'fun',   name: 'Nap Mat',         icon: '🛏️', w: 2, h: 1, cost: 320,  time: 28800,  lvl: 4,  charm: 3, floor: true, desc: 'Dogs resting here lose needs slower and nap happily. +3 charm.' },
  { id: 'sandpit',    cat: 'fun',   name: 'Sand Pit',        icon: '🏖️', w: 2, h: 2, cost: 640,  time: 86400,  lvl: 5,  charm: 5, floor: true, desc: 'Great fun to dig in. +5 charm.' },
  { id: 'pool',       cat: 'fun',   name: 'Splash Pool',     icon: '🏊', w: 3, h: 2, cost: 1350, time: 172800, lvl: 6,  charm: 8, floor: true, desc: 'Fun and cooling. Water Babies adore it. +8 charm.' },
  { id: 'agility',    cat: 'fun',   name: 'Agility Course',  icon: '🚧', w: 4, h: 2, cost: 2400, time: 259200, lvl: 8,  charm: 12, floor: true, desc: 'High-energy obstacle course (3-day build). +12 charm.' },
  { id: 'path',       cat: 'decor', name: 'Stone Path',      icon: '🪨', w: 1, h: 1, cost: 20,   time: 1800,   lvl: 1,  charm: 0.25, floor: true, desc: 'A tidy stepping-stone path.' },
  { id: 'flowers',    cat: 'decor', name: 'Flower Bed',      icon: '🌷', w: 1, h: 1, cost: 45,   time: 3600,   lvl: 1,  charm: 1, floor: true, desc: '+1 charm (upgradeable).' },
  { id: 'hydrant',    cat: 'decor', name: 'Fire Hydrant',    icon: '🧯', w: 1, h: 1, cost: 75,   time: 7200,   lvl: 1,  charm: 1, solid: true, desc: '+1 charm (upgradeable).' },
  { id: 'bush',       cat: 'decor', name: 'Berry Bush',      icon: '🌿', w: 1, h: 1, cost: 95,   time: 9000,   lvl: 2,  charm: 2, solid: true, desc: '+2 charm (upgradeable).' },
  { id: 'bench',      cat: 'decor', name: 'Garden Bench',    icon: '🪑', w: 2, h: 1, cost: 150,  time: 14400,  lvl: 2,  charm: 2, solid: true, desc: '+2 charm (upgradeable).' },
  { id: 'lamp',       cat: 'decor', name: 'Lamp Post',       icon: '💡', w: 1, h: 1, cost: 180,  time: 21600,  lvl: 3,  charm: 2, solid: true, desc: '+2 charm. Glows at dusk.' },
  { id: 'tree',       cat: 'decor', name: 'Apple Tree',      icon: '🌳', w: 1, h: 1, cost: 240,  time: 28800,  lvl: 3,  charm: 3, solid: true, desc: '+3 charm (upgradeable).' },
  { id: 'birdbath',   cat: 'decor', name: 'Bird Bath',       icon: '🐦', w: 1, h: 1, cost: 310,  time: 43200,  lvl: 4,  charm: 3, solid: true, desc: '+3 charm (upgradeable).' },
  { id: 'topiary',    cat: 'decor', name: 'Dog Topiary',     icon: '🐩', w: 1, h: 1, cost: 460,  time: 64800,  lvl: 5,  charm: 4, solid: true, desc: '+4 charm. Shaped like a very good dog.' },
  { id: 'picnic',     cat: 'decor', name: 'Picnic Table',    icon: '🧺', w: 2, h: 2, cost: 580,  time: 86400,  lvl: 6,  charm: 5, solid: true, desc: '+5 charm (upgradeable).' },
  { id: 'statue',     cat: 'decor', name: 'Golden Bone',     icon: '🦴', w: 1, h: 1, cost: 850,  time: 129600, lvl: 7,  charm: 7, solid: true, desc: '+7 charm (upgradeable).' },
  { id: 'pond',       cat: 'decor', name: 'Lily Pond',       icon: '🪷', w: 3, h: 2, cost: 1600, time: 172800, lvl: 9,  charm: 10, solid: true, desc: '+10 charm (upgradeable).' },
  { id: 'fountain',   cat: 'decor', name: 'Fountain',        icon: '⛲', w: 2, h: 2, cost: 2200, time: 259200, lvl: 10, charm: 12, solid: true, desc: '+12 charm (upgradeable).' },
  { id: 'gazebo',     cat: 'decor', name: 'Gazebo',          icon: '🏛️', w: 3, h: 3, cost: 4800, time: 432000, lvl: 12, charm: 20, solid: true, desc: '+20 charm. The crown jewel of the daycare.' },
];

// In-world floor unlock pads (only appear in newly expanded land plots — starter lawn is 100% empty so you place buildings yourself!)
var UNLOCK_PADS = [
  // Unlocked when North Lawn ('north') is expanded!
  { id: 'pad_n_sand',    plot: 'north',     kind: 'obj',   type: 'sandpit',    x: 20, y: 13, ignoreLvl: true },
  { id: 'pad_n_feeder',  plot: 'north',     kind: 'staff', staffId: 'feeder',  x: 24, y: 14, w: 2, h: 2 },
  { id: 'pad_n_picnic',  plot: 'north',     kind: 'obj',   type: 'picnic',     x: 27, y: 13, ignoreLvl: true },
  { id: 'pad_n_agility', plot: 'north',     kind: 'obj',   type: 'agility',    x: 22, y: 8,  ignoreLvl: true },
  // Unlocked when East Meadow ('east') is expanded!
  { id: 'pad_e_pool',    plot: 'east',      kind: 'obj',   type: 'pool',       x: 35, y: 22, ignoreLvl: true },
  { id: 'pad_e_groomer', plot: 'east',      kind: 'staff', staffId: 'groomer', x: 33, y: 25, w: 2, h: 2 },
  { id: 'pad_e_trainer', plot: 'east',      kind: 'staff', staffId: 'trainer', x: 39, y: 20, w: 2, h: 2 },
  { id: 'pad_e_feeder',  plot: 'east',      kind: 'obj',   type: 'autofeeder', x: 34, y: 19, ignoreLvl: true },
  { id: 'pad_e_kennel2', plot: 'east',      kind: 'obj',   type: 'kennel',     x: 36, y: 28, ignoreLvl: true },
  { id: 'pad_e_topiary', plot: 'east',      kind: 'obj',   type: 'topiary',    x: 41, y: 24, ignoreLvl: true },
  // Unlocked when Orchard Corner ('northeast') is expanded!
  { id: 'pad_ne_runner', plot: 'northeast', kind: 'staff', staffId: 'runner',  x: 33, y: 11, w: 2, h: 2 },
  { id: 'pad_ne_pond',   plot: 'northeast', kind: 'obj',   type: 'pond',       x: 35, y: 10, ignoreLvl: true },
  { id: 'pad_ne_fount',  plot: 'northeast', kind: 'obj',   type: 'fountain',   x: 40, y: 13, ignoreLvl: true },
  { id: 'pad_ne_statue', plot: 'northeast', kind: 'obj',   type: 'statue',     x: 34, y: 14, ignoreLvl: true },
  // Unlocked when Lakeside Field ('far') is expanded!
  { id: 'pad_f_gazebo',  plot: 'far',       kind: 'obj',   type: 'gazebo',     x: 49, y: 13, ignoreLvl: true },
  { id: 'pad_f_pool2',   plot: 'far',       kind: 'obj',   type: 'pool',       x: 48, y: 21, ignoreLvl: true },
  { id: 'pad_f_agil2',   plot: 'far',       kind: 'obj',   type: 'agility',    x: 48, y: 26, ignoreLvl: true },
];
var CAT_BY_ID = {};
CATALOG.forEach(function (c) { CAT_BY_ID[c.id] = c; });

// ---------- multi-level repeatable business research perks (Lv 1 -> Lv ∞) ----------
var UPGRADES = [
  { id: 'sneakers',   name: 'Comfy Sneakers',       icon: '👟', cost: 280,  lvl: 2, desc: '+8% walk speed per level.' },
  { id: 'scooper',    name: 'Carry Harness',        icon: '🎒', cost: 340,  lvl: 2, desc: '+1 carry stack capacity (bowls, toys, poop) per level.' },
  { id: 'flyers',     name: 'Town Flyers',          icon: '📣', cost: 420,  lvl: 3, desc: '+10% customer arrival rate per level.' },
  { id: 'kibble',     name: 'Gourmet Kibble',       icon: '🥩', cost: 520,  lvl: 3, desc: '+5 extra happiness from every meal per level.' },
  { id: 'lounge',     name: 'Cosy Waiting Area',    icon: '🛋️', cost: 680,  lvl: 4, desc: 'Owners wait +18% longer per level.' },
  { id: 'loyalty',    name: 'VIP Loyalty Club',     icon: '💳', cost: 900,  lvl: 5, desc: '+15% bigger tips on all pickups per level.' },
  { id: 'nightstaff', name: 'Overnight Suite Care', icon: '🌙', cost: 1200, lvl: 6, desc: 'Overnight guests wake up happy & pay +15% per level.' },
  { id: 'webcam',     name: 'HD Pup Cam',           icon: '📷', cost: 1650, lvl: 8, desc: '+12% base boarding pay per level.' },
];
// ---------- staff you can hire as you expand your business (paid per day, at closing time) ----------
var STAFF = [
  { id: 'receptionist', name: 'Receptionist',     icon: '🧑‍💼', wage: 55,  lvl: 2, look: 1, spot: [6.6, 24.3],  desc: 'Moves around the front shop, welcomes drop-off customers, and polishes the counter.' },
  { id: 'cleaner',      name: 'Grounds Keeper',   icon: '🧹', wage: 60,  lvl: 2, look: 2, spot: [20.5, 25.5], desc: 'Patrols the yard scooping poop into the Poop Bin and sweeping leaves & yard chores.' },
  { id: 'feeder',       name: 'Kennel Chef',      icon: '🥣', wage: 75,  lvl: 3, look: 3, spot: [21.5, 20.5], desc: 'Walks to the Food Bin and Treat Jar to feed hungry and picky dogs across the yard.' },
  { id: 'groomer',      name: 'Pet Groomer',      icon: '🛁', wage: 90,  lvl: 3, look: 0, spot: [27.5, 20.5], desc: 'Walks out to muddy dogs, leashes them to the Bath Tub for a scrub, and cuddles nervous pups.' },
  { id: 'trainer',      name: 'Play Trainer',     icon: '🎾', wage: 105, lvl: 4, look: 1, spot: [24.5, 22.5], desc: 'Grabs balls from the Toy Box to play fetch with energetic dogs and keeps morale high.' },
  { id: 'runner',       name: 'Pickup Runner',    icon: '🦮', wage: 115, lvl: 5, look: 2, spot: [19.5, 23.5], desc: 'Searches the yard when an owner asks for pickup, walks to that dog, and brings it to the counter!' },
  { id: 'helper',       name: 'Yard Manager',     icon: '🧑‍🌾', wage: 145, lvl: 6, look: 3, spot: [23.5, 25.5], desc: 'Veteran all-rounder who pitches in on feeding, playing, cuddling, scooping, and chores.' },
];
var STAFF_BY_ID = {};
STAFF.forEach(function (s) { STAFF_BY_ID[s.id] = s; });

// ---------- special guests: rare dogs that turn up once a hidden requirement is met ----------
var SPECIALS = [
  { id: 'alfie',    name: 'Alfie',     title: "Andrew's best buddy",        ownerName: 'Andrew', ownerLook: 'andrew', moraleBoost: true, collar: '#d94b43', breed: 'alfie_terrier', coat: 0, traits: ['social', 'cuddly'],   hint: 'Rare VIP visitor with Andrew — boosts all dogs\' friendships and morale.', check: function (S) { return S.day >= 2 && S.rep >= 3.2; } },
  { id: 'teddy',    name: 'Teddy',     title: "Annie's scruffy sweetheart", ownerName: 'Annie',  ownerLook: 'annie',  moraleBoost: true, collar: '#7a2e46', breed: 'teddy_terrier', coat: 0, traits: ['social', 'cuddly'],   hint: 'Rare VIP visitor with Annie — boosts all dogs\' friendships and morale.', check: function (S) { return S.day >= 2 && S.rep >= 3.2; } },
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

// ---------- rotating daily events (keeps every day feeling fresh in endless play) ----------
var DAILY_EVENTS = [
  { id: 'sunny',   icon: '☀️', name: 'Sunny Fetch Festival',   short: 'Fetch Day',   desc: '+25% pickup tips & extra fetch happiness all day!' },
  { id: 'muddy',   icon: '🌧️', name: 'Muddy Paws Rush',        short: 'Muddy Rush',  desc: 'Every bath pays +$6 bonus cash & +50% bath XP!' },
  { id: 'gala',    icon: '👑', name: 'VIP & Celebrity Gala',   short: 'VIP Gala',    desc: '2× Special Guest chance & +30% boarding pay all day!' },
  { id: 'feast',   icon: '🍖', name: 'Gourmet Feast Day',      short: 'Feast Day',   desc: 'Every meal & treat pays +$4 bonus tip & extra happiness!' },
  { id: 'cuddle',  icon: '💕', name: 'Cuddle & Care Fest',     short: 'Cuddle Fest', desc: '2× cash from cuddles & yard chores, plus 1.5× Star Rating gain!' },
  { id: 'zoomies', icon: '⚡', name: 'Agility & Zoomies Cup',  short: 'Zoomies Cup', desc: 'Goal Waves pay +35% bonus rewards & dogs play faster!' },
];

// ---------- endless lifetime empire milestones (scale Tier 1 -> Tier ∞ forever!) ----------
var MILESTONES = [
  { id: 'served',   icon: '🐕', name: 'Pack Leader',      base: 8,   scale: 1.65, reward: 75,  text: 'Serve {n} dogs lifetime' },
  { id: 'perfect',  icon: '⭐', name: 'Five-Star Legend', base: 5,   scale: 1.65, reward: 90,  text: 'Earn {n} PAWSOME pickups' },
  { id: 'earned',   icon: '💰', name: 'Daycare Tycoon',   base: 500, scale: 1.85, reward: 100, text: 'Earn ${n} total revenue' },
  { id: 'care',     icon: '❤️', name: 'Master Caretaker', base: 20,  scale: 1.70, reward: 65,  text: 'Complete {n} dog care actions' },
  { id: 'mastery',  icon: '📖', name: 'Breed Scholar',    base: 3,   scale: 1.55, reward: 110, text: 'Reach {n} total Breed & Mastery stars' },
  { id: 'empire',   icon: '🏗️', name: 'Empire Architect', base: 5,   scale: 1.55, reward: 95,  text: 'Reach {n} total Building, Staff & Research levels' },
];

var DIFFICULTY = {
  relaxed: { decay: 0.65, patience: 1.5, label: 'Relaxed' },
  normal:  { decay: 1.0,  patience: 1.0, label: 'Normal' },
  hectic:  { decay: 1.35, patience: 0.75, label: 'Hectic' },
};

var TUTORIAL = [
  { id: 'build_kennel', reward: 25, text: 'Tap 🔨 Shop and place your first 🏠 Kennel ($50) on the lawn (1 Kennel = 1 Dog allowed)' },
  { id: 'checkin',      reward: 20, text: 'Step onto the SERVE pad behind the counter to welcome your first dog' },
  { id: 'pet',          reward: 20, text: 'Walk out to the lawn and stand next to your dog to ❤️ cuddle it' },
  { id: 'build_food',   reward: 25, text: 'Tap 🔨 Shop and place a 🍖 Food Bin ($60) anywhere on the lawn' },
  { id: 'feed',         reward: 20, text: 'Grab a kibble bowl from your Food Bin and feed your hungry dog' },
  { id: 'build_water',  reward: 25, text: 'Tap 🔨 Shop and place a 💧 Water Fountain ($55) on the lawn so pups can drink' },
  { id: 'scoop',        reward: 25, text: 'Place a 🗑️ Poop Bin ($40) from 🔨 Shop, scoop poop on the lawn, and toss it away' },
  { id: 'build_toy',    reward: 25, text: 'Place a 🎾 Toy Box ($65) from 🔨 Shop, grab a ball, and play fetch with your dog' },
  { id: 'build_tub',    reward: 35, text: 'Place a 🛁 Bath Tub ($110) from 🔨 Shop, leash the muddy dog, and give it a bath' },
  { id: 'return',       reward: 35, text: 'When the owner arrives for pickup, find their dog on the lawn, leash it, and return it at the SERVE pad' },
];

// Steep Clash of Clans XP curve for long-term endless play
function lvlNeed(l) { return Math.round(150 * Math.pow(l, 1.85)); }

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
