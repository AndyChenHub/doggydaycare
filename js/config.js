// Paws & Play Daycare — default settings.
// You can change these here, or in the game's Settings menu (the menu remembers your choices in the browser
// and those take priority over this file; "Restore defaults" in the menu goes back to what is written here).
// Key names are browser key codes: 'KeyW', 'KeyE', 'Space', 'ArrowUp', 'ShiftLeft', 'Digit1', ...
window.GAME_CONFIG = {
  keys: {
    up:       ['KeyW', 'ArrowUp'],
    down:     ['KeyS', 'ArrowDown'],
    left:     ['KeyA', 'ArrowLeft'],
    right:    ['KeyD', 'ArrowRight'],
    interact: ['KeyE', 'Space'],   // check in, pet, feed, wash, scoop, return a dog...
    grab:     ['KeyQ', ''],        // leash / let go of a dog, drop what you carry
    build:    ['KeyB', ''],        // open / close build mode
    dex:      ['KeyG', ''],        // open the dog glossary
    pause:    ['Escape', 'KeyP'],
  },
  dayLengthSeconds: 300,   // real seconds per in-game day (8 AM to 6 PM)
  difficulty: 'normal',    // 'relaxed' | 'normal' | 'hectic'
  musicVolume: 0.5,        // 0 to 1
  ambienceVolume: 0.5,     // 0 to 1 (birds, breeze, crickets)
  sfxVolume: 0.8,          // 0 to 1
  startingCash: 300,
  playerSpeed: 250,        // pixels per second
  standSeconds: 1,         // how long you stand in a box / next to a dog before the action happens
  cameraZoom: 1,           // 0.8 = see more of the map, 1.2 = closer
};
