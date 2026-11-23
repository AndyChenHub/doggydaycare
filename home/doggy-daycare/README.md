# Paws & Play — Doggy Daycare

A cosy 2D browser game: run a doggy daycare, keep every dog happy, get paid, and grow the place.

**Play:** open http://localhost:8000/ (the "Play Paws & Play" shortcut starts the server and opens it),
or open `index.html` directly in Chrome. Everything is self-contained: no downloads, no internet needed.

**iOS App (`.ipa`):** `PawsAndPlay.ipa` is built and ready for iOS/iPadOS installation (via AltStore, SideStore, Sideloadly, TrollStore, or Xcode). To rebuild the `.ipa` at any time, run:
```bash
python build_ipa.py
# or: npm run build:ipa
```

## Controls
There are no action buttons: **walk into a box and stand there for a moment** — a little ring above your head fills up and the action happens.
On **iOS / touch screens**, drag anywhere to steer with a floating virtual thumbstick, tap any spot or box to walk to it, tap the bottom hint pill to act immediately or let go, and pinch with two fingers to zoom.

| Action | Keys |
|---|---|
| Move | W A S D (or arrow keys) |
| Do it now instead of waiting (optional) | E (or Space) |
| Let go of a dog / drop what you carry (optional) | Q |
| Build mode | B |
| Dog glossary | G |
| Multiplayer Co-op | C |
| Pause menu | Esc or P |
| Zoom | mouse wheel (or two-finger pinch on phone) |

(On a phone or tablet, drag anywhere or use the bottom-left thumbstick to walk, or tap a spot/dog/mat to walk right to it.)

## Multiplayer Co-op & Playing Together on Phones
- Start the server with `node server.js` (runs on port `8000` across your local network).
- Open **📱 Co-op** (`C` or from the Title screen / bottom toolbar) to see your **QR Code**, **Join Link** (e.g. `http://192.168.x.x:8000/?room=PAWS`), and **Room Code** (`PAWS`).
- Point your other phone's camera at the QR code (or open the link) to connect and play together in real time.
- Both players can log on together or at different times to care for dogs, build new facilities, clear land plots, buy business perks, and hire staff.
- When one player has been playing, the other player receives a **"What Your Partner Did"** summary popup as soon as they log on.

(Change keys and the waiting time in Menu → Settings / `js/config.js`.)

## How a day goes
1. **Drop-off:** owners walk in from the street and ring the bell. Stand in the **SERVE box behind the counter**: the owner walks up and their dog trots round the counter to you. Walk the dog through the side door into the yard — it runs off to play by itself.
2. **Dogs mostly look after themselves.** Now and then one of them needs you — only a few at a time. A bubble and a ring on the ground show who:
   - ❤️ cuddles: stand next to the dog
   - 🍖 food: stand on the Food Bin's mat to take a bowl, then stand next to the dog
   - 🎾 play: the same with a ball from the Toy Box
   - 🛁 muddy: stand next to the dog to leash it, then stand on the Bath Tub's mat
   Dogs that wait too long get upset.
3. **Little accidents:** every dog goes once or twice a day, and soon after a meal — you see it squat. Stand on a poop to scoop it, then on the Poop Bin's mat. The **Pooper Scooper** (Business tab) carries five at a time.
4. **Pickup:** the owner comes back and the dog gets a house marker (arrows at the edge of the screen and the mini-map point the way). Stand next to the dog to leash it, then stand in the SERVE box: the owner comes over, the dog trots round to them and they pay. Happy dog = big tip; an upset dog or a long wait = a complaint, which costs reputation stars.
5. **Overnight:** with a Kennel built, some owners book overnight stays (much better pay). The dog sleeps in its kennel and is picked up the next day.
6. At closing time you get a summary of the day.

## Growing the business
- **Build mode (B):** pick something in the shop and click the yard. Every build takes **real time** (it keeps building while the game is closed). Click a building site to finish it early for cash, use Sell mode to remove things, buy more land in the Land tab.
- **Business tab:** permanent upgrades (faster shoes, flyers, premium kibble, a pooper scooper, loyalty cards…) and **staff**: a Receptionist (level 3, $90/day) handles the counter whenever you are not standing in the SERVE box — check-ins and pickups, the dogs walk to and from the yard by themselves; a Yard Helper (level 4, $130/day) cuddles, feeds and plays with dogs that ask and scoops poop (baths stay yours). Wages come off your cash at closing time.
- **Special guests:** eight rare named dogs (a mayor's corgi, a racing champion, a film star…) each turn up only once a hidden requirement is met, pay five times the usual price and get a golden name tag. The glossary shows which you have found and a hint for each of the rest.
- **Daily gift:** the first time you open the daycare each real day you get a cash gift, and it grows for every day in a row you come back (up to 7).
- **Dogs at play:** dogs wander over to a Water Station for a drink, and pairs of dogs chase, pounce and wrestle in the yard.
- **Daily goals:** three goals each day pay bonus cash.
- **Dog glossary (G):** every breed you meet is added with its portrait, coat colours and facts — 44 breeds and mixes to discover.
- Play areas, a pool and the Auto-Feeder let dogs sort themselves out, so fewer of them need you.
- Levels unlock more buildings, land and upgrades; decorations add charm (bigger tips, more customers).

## Settings you can edit
- In the game: Menu → Settings — key bindings (two keys per action), music / ambience / sound-effect volume, camera zoom, day length, difficulty (Relaxed means fewer dogs need you at once). Remembered in the browser.
- In `js/config.js`: the defaults for the same things, plus starting cash, walking speed and `standSeconds` (how long you stand in a box before the action happens).

Progress saves automatically in the browser (title screen → New game to start over).

## What is in the folder
- `index.html`, `style.css` — page and interface styling
- `js/config.js` — settings you can edit; `js/data.js` — map, buildings, upgrades, goals; `js/breeds.js` — the dog breeds
- `js/game.js` — rules and simulation; `js/render.js` — camera, drawing, lighting, particles; `js/ui.js` — menus, panels, input
- `js/dogart.js`, `js/dogportrait.js`, `js/people.js`, `js/objects_a.js`, `js/objects_b.js`, `js/worldart.js`, `js/shopart.js` — all artwork, drawn by code (no image files)
- `js/sound.js`, `js/music.js` — sound effects, ambience and soundtrack, synthesised in the browser (no audio files)
- `fonts/` — Jersey 25 and Nunito (open-source fonts, licences included)
