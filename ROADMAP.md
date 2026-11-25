# Paws & Play — Progression Research & Feature Release Roadmap

This roadmap combines **genre research** (arcade-idle, cozy management, pet-collection, and two-player co-op games) with concrete, phased releases (`v2.1`–`v2.7`) designed to slow macro progression gracefully while keeping every active session engaging, cozy, and rewarding.

---

## 1. Core Pacing & Retention Principles

*Paws & Play* sits at a unique three-way intersection:
1. **Arcade-Idle / Hybrid-Casual** (*My Mini Mart*, *Burger Please!*): One-thumb dynamic joystick, carry stacks, floor unlock pads, and staff delegation.
2. **Cozy Pet Sim & Collection** (*Animal Restaurant*, *Neko Atsume*, *Cats & Soup*, *Good Pizza, Great Pizza*): 45+ breeds with coats, traits, quirks, favorites, special guests, yard decorating, and a 4-phase day cycle.
3. **Real-Time & Async 2-Phone Co-op** (*Pocket Love*, *Stardew Valley* co-op): Shared synced daycare with live partner avatars and "What your partner did" return summaries.

To slow long-term progression **without** boring players, the roadmap uses seven interlocking design levers:

1. **The "Accordion" Pacing Cycle**: Busy manual care → hire staff for relief → unlock a new higher-order manual loop (crafting, spa styling, trick training, boutique stocking) so automation *evolves* the player's role instead of replacing it.
2. **Layered Loops**: Run **Micro** (15s–2m combos & timer shaving), **Mid** (15m–4h crafting, VIP bookings, regular bonds), and **Macro** (days–weeks land plots, rare breed habitats, weekly dog shows, sister branches) clocks in parallel so no single wait wall stalls the whole game.
3. **Active Play Shaves Passive Timers**: Keep Clash-style real-time timers for macro pacing, while rewarding active play (PAWSOME pickups, Goal Waves, Spot Events, and partner "Lend a Paw" taps) with real-time timer reductions.
4. **Multi-Currency Triangulation**: Separate **Cash (`$`)** (business ops, land, kennels, staff) from **Paw Hearts (`💛`)** (care & connection rewards spent on speed-ups, special boosts, decor, and cosmetics).
5. **Non-Capacity Kennel Luxury Upgrades (`1 Kennel = 1 Dog`)**: Keep dog capacity strictly tied to the number of built Kennels while turning Kennel upgrades (`Lv 1 Standard → Lv 2 Cozy Suite → Lv 3 Plush Villa → Lv 4 Deluxe Chalet → Lv 5+ Royal Penthouse`) into high-value quality upgrades: higher boarding & overnight tariffs, faster mood recovery, happier overnight mornings, higher VIP/Special Guest odds, bonus Paw Hearts, and extra Charm.
6. **Horizontal Emotional Collection**: Returning town Regulars with persistent memory, Bond Levels, Postcards, collectible Mementos, and yard-layout-gated rare breeds (*Neko Atsume* style).
7. **Asynchronous Co-op Reciprocity**: Make opening the app feel like checking a shared scrapbook via "Lend a Paw" build boosts, counter care packages, sticky notes, and joint daily contracts.

---

## 2. Target Pacing Curve (Minute 1 → Month 1+)

| Timeframe | Player Role | Active Hooks | Appointment / Slow Timers | Key Milestone |
| :--- | :--- | :--- | :--- | :--- |
| **0–15 min (Session 1)** | Solo Starter Keeper | Tutorial, first kennel & stations, serving first pups | `2.5s` tutorial builds → `15m–45m` first post-tutorial ramp | Tutorial complete, first Paw Hearts earned |
| **Hours 1–12 (Days 1–2)** | Busy Caretaker | Carry stacks, chores, PAWSOME timer shaves, ribbon cuts | `15m–3h` Kennel #2–3, starter upgrades & North Lawn | Hire Receptionist & Grounds Keeper; Kennel Suite Lv 2 |
| **Days 3–7 (Week 1)** | Specialty Host & Stylist | Doggy Kitchen, Grooming House, VIP Bookings, Co-op boosts | `3h–24h` East Meadow, Pool, Spa, Kitchen; `5m–45m` baking | First Mementos, Builder Crew Lv 2, Co-op streak |
| **Weeks 2–4 (Month 1)** | Yard Designer & Trainer | Trick Training Ring, Yard Synergy Combos, Habitat Rare Hunt | `24h–48h` Orchard Corner, Lakeside Field, Gazebo | 30+ breeds met, Bond Lv 5 Regulars, Weekend Show wins |
| **Month 2+ (Endless)** | Resort Director | Seasonal weather, Boutique retail, 2nd Branch Prestige | Weekly Show prep, Seasonal collections, Branch unlocks | Coastal / Alpine Branch unlocked, full Scrapbook |

---

## 3. Phased Feature Releases

### Release `v2.1` — Smooth Pacing, Kennel Suites & Active Builders *(Implemented)*
**Goal:** Replace empty wait walls and punitive blockers with active timer-shaving, a second care currency, non-blocking upgrades, and meaningful Kennel Luxury Suites while keeping strict `1 Kennel = 1 Dog`.

- **Paw Hearts (`💛`) Currency**:
  - Earned from PAWSOME pickups (`+2💛`), favorite care (`+1💛`), yard/shop chores (`+1💛`), spot events (`+2💛`), new breeds (`+3💛`), breed mastery (`+2💛`), daily goals (`+2💛` / `+5💛` wave bonus), ribbon cuts (`+3💛`–`+5💛`), and partner "Lend a Paw" assists (`+3💛`).
  - Spendable on **Heart Speed-Ups (`-30m` for `5💛`)** directly on any construction/upgrade site, plus **Paw Heart Rewards** in `Shop → Research & Staff` (*Builder Boost `-1h`*, *Pack Joy Party*, *VIP Guest Magnet*).
- **Kennel Luxury Suite Upgrades (`1 Kennel = 1 Dog`)**:
  - Upgrading Kennels promotes them from *Standard Kennel* → *Cozy Suite* → *Plush Villa* → *Deluxe Chalet* → *Royal Penthouse* without changing the `1 Kennel = 1 Dog` rule:
    - `+8%` boarding & overnight pay per average Kennel upgrade level.
    - `+6%` overnight stay chance & `+8` overnight morning happiness per upgrade level.
    - Faster passive happiness recovery for dogs resting in upgraded Kennels.
    - `+12%` Special Guest attraction chance per average Kennel upgrade level + bonus overnight Paw Hearts.
    - `+2.5` Yard Charm per upgrade level & golden luxury crown badge on Lv 2+ Kennels.
- **Franchise Tier Alignment**:
  - Accurately reflects and awards `+15% All Boarding Pay`, `+15% Paw Hearts`, `+10 Yard Charm`, and `+2m Extra Builder Boost` per PAWSOME pickup on every Franchise Tier.
- **Stepped Real-Time Timer Ramp + Builder Crew Cap**:
  - Smooth post-tutorial ramp (`15m–45m` for early Kennels/utility stations → `3h–12h` mid-tier → `18h–48h` major attractions & land expansions) instead of an abrupt `2.5s → 2h+` cliff.
  - Structured **1 Builder Slot** by default, expandable via the new **👷 Builder Crew** Research perk (`+1` simultaneous build/upgrade/land slot per level).
- **Non-Blocking Station Upgrades**:
  - Upgrading an already-built station keeps it `100%` usable at its current level while an overhead upgrade progress bar ticks down.
- **Active Play Shaves Timers ("Builder Boost")**:
  - PAWSOME pickups shave `10m` (`+2m` per Franchise Tier), Daily Goals shave `5m`, Goal Waves shave `30m`, and Spot Events shave `15m` off active builds/upgrades/land timers.
- **Partner "Lend a Paw" Co-op Boost**:
  - Walk up to (or tap in Build mode) a building, upgrade, or land plot started by your partner to hammer on it once per project — shaving `20%` (`30m`–`2h`) off the timer and earning `+3💛`.
- **Ribbon-Cutting Ceremonies**:
  - Real-time builds (`>= 5m`) finish with a festive `🎀 Cut Ribbon!` celebration bow on the yard so you can walk over (or tap) to trigger fireworks, XP, and bonus Paw Hearts.
- **Fair Counterplay for Rival Flyers**:
  - Replaces the unavoidable `rival_down` RNG hit with an interactive timed front-shop counter-event (`📣 Counter Rival Flyers`).

---

### Release `v2.2` — Regulars, Bonds & Mementos *(Next)*
**Goal:** Turn anonymous daily visitors into memorable neighborhood Regulars and make yard layout a discovery game.

- **Persistent Town Regulars (`S.regulars`)**: ~55% of daily guests return from a persistent town roster preserving name, breed, coat, owner, quirk, visit count, Bestie pairs, and **Bond Level (`1–5`)**.
- **Bond Rewards, Postcards & Mementos**:
  - `Lv 2`: Favorite icon displayed on collar + `+10%` tips.
  - `Lv 3`: Cozy owner **Postcard** + `+10💛`.
  - `Lv 4`: Requests overnight Luxury Suite stays (`+25%` pay).
  - `Lv 5`: Drops a unique collectible **Memento** displayed on a new **Scrapbook / Trophy Shelf** inside the Glossary.
- **Habitat-Gated Rare Breeds & Coats**: Tie 12 rare breeds & coat variants to specific yard setups (e.g., Splash Pool + Tree for Samoyed; Agility Course for Greyhound; Grooming House + Flowers for Standard Poodle) with silhouettes & hints in the Glossary.

---

### Release `v2.3` — Cozy Garden, Baking Queue & VIP Bookings
**Goal:** Deepen the existing **Doggy Kitchen** and **Grooming House** into a tactile *My Mini Mart* + *Hay Day* appointment loop so players stay active even with full staff.

- **Wilt-Free Garden Planters**: Grow Carrots (`5m`), Blueberries (`15m`), Pumpkins (`30m`), and Peanuts (`1h`) in the yard.
- **Doggy Kitchen Baking Queue**: Convert garden harvests into specialty treats (*Carrot Bites*, *Blueberry Pupcakes*, *Frozen Pup Cups*, *Birthday Bone Cakes*) on `3m–45m` real-time timers (cooks offline).
- **Grooming House Styling Accessories**: Dogs pampered in the Grooming House emerge wearing visible temporary bows/bandanas for `+25%` pickup tips.
- **VIP Booking Clipboard**: 3 special owner reservations refreshing every 4 hours (e.g., *"Milo's Birthday: Blueberry Pupcake + Spa Groom → +$120 & +12💛"*).

---

### Release `v2.4` — Co-op Rituals & Partner Love
**Goal:** Expand 2-phone sync into a cozy daily relationship ritual.

- **Counter Care Packages & Sticky Notes**: Leave 1 daily gift box at the shop `staff-desk` (baked treat, Barista Coffee speed buff, or sanitized cozy note/sticker) waiting on the counter for your partner's next login.
- **Shared Daily Co-op Contract**: Two-color progress bar synced across the room unlocking partner-exclusive decor (*Heart Flower Arch*, *Double Hammock*, *Alfie & Teddy Friendship Bench*).
- **Live Duo Synergy & Reunited Welcome**: Playing online together grants a `"Teamwork Sparkle"` (`+15%` move speed, `+25%` Paw Hearts); returning after days away grants a guilt-free `"Missed You!"` welcome buff.

---

### Release `v2.5` — Pup Academy & Weekend Dog Shows
**Goal:** Introduce a weekly appointment cadence and one-thumb skill expression that staff never automate.

- **Trick Training Ring**: Teach Regulars 6 collectible tricks (*Sit*, *High Five*, *Spin*, *Roll Over*, *Hoop Jump*, *Bow*) via a simple one-thumb rhythm ring (`+10%` tip per mastered trick).
- **Weekend Cozy Dog Show (Fri–Sun)**: Rotating weekly categories (*Best Groomed*, *Agility Champion*, *Best Tricks*, *Fluffiest Charm*) announced on Monday so Mon–Thu play prepares your Regulars for the weekend parade, Ribbons, and Trophies.

---

### Release `v2.6` — Weather, Seasons & Yard Synergy Combos
**Goal:** Keep the world visually fresh over weeks and reward creative yard layouts.

- **Daily Weather Forecast** (shown in End-of-Day Summary): *Sunny Bright* (Pool/Water bonus), *Gentle Rain* (puddles, cute dog raincoats, `1.75×` Spa pay), *Breezy Petals/Leaves* (bonus heart chores), and *Cozy Snow* (Arctic breeds at `100%` bliss).
- **Rotating 7-Day Seasons**: Spring, Summer, Autumn, and Winter palette shifts + seasonal decor & bakery recipes.
- **Yard Synergy Combos (*Kairosoft* Adjacency)**: Placing matching stations/decor within 2 tiles creates glowing Zone Combos (*Resort Deck*, *Zen Corner*, *Zoomies Track*, *Cozy Nap Nook*) with passive buffs.

---

### Release `v2.7` — Front-Shop Boutique, Wardrobe & Branch Prestige
**Goal:** Long-term endgame cosmetic sinks and soft prestige without erasing the main daycare.

- **Live Front-Shop Boutique**: Stock baked treats, plushies, and bandanas on the shop shelves so departing owners impulse-buy on their way out.
- **Paw Heart Wardrobe & Architecture Themes**: Spend `💛` on keeper outfits, permanent accessories for Regulars, and shop/yard visual themes (*Sunny Cottage*, *Sakura Courtyard*, *Coastal Boardwalk*, *Alpine Lodge*).
- **Daycare Passport (2nd & 3rd Branches)**: Unlock *Coastal Pup Cove* and *Alpine Snow Lodge* while keeping your Starter Daycare, Paw Hearts, Regulars, Wardrobe, and Breed Glossary shared across branches.
