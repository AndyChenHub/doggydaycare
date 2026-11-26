'use strict';
/* ============================================================================================
   minigames.js — Randomly Timed Surprise Mini-Games for Paws & Play
   - Every 10 seconds during active post-tutorial play, 20% chance of a random mini-game
   - 5..4..3..2..1 countdown warning banner (pauses daycare simulation once modal opens)
   - Universal 3-tier difficulty system for EVERY game:
       Easy (60%) · Medium (25%) · Hard (15%)
   - Adapted failure consequences matched to each mini-game (fines, lost stars, lost hearts,
     yard poops, muddy pups, mood drops, impatient waiting owners)
   - 10 portrait iPhone-friendly mini-games:
       1.  audit         — 📊 Company Accounts Audit (math & order of operations)
       2.  find_dog      — 📸 Speed Photo Check (spot target dogs one at a time)
       3.  treat_catch   — 🍪 Treat Delivery Spill (reflex basket-catch arcade)
       4.  trick_memory  — 🎵 Talent Scout Audition (musical Simon-says sequence)
       5.  bubble_pop    — 🛁 Sudsy Bubble Blitz (speed-tap bubble & ducky popper)
       6.  kibble_sort   — 🍖 Safe Snack Inspector (fast safe vs toxic dog food sorter)
       7.  whack_mole    — 🐿️ Lawn Pest Patrol (3×3 whack-a-mole garden defense)
       8.  pair_match    — 🃏 Cubby Pair Match (timed breed portrait memory cards)
       9.  groom_timing  — ✂️ Show-Dog Salon Trim (sweeping needle precision gauge)
       10. order_rush    — 📞 Paw-Phone Booking Rush (fast care-kit order packing)
   ============================================================================================ */

var MINIGAMES = (function () {
  var ROLL_INTERVAL = 10.0; // check every 10s
  var ROLL_CHANCE = 0.20;   // 20% chance per 10s check

  var ALL_KINDS = [
    'audit', 'find_dog', 'treat_catch', 'trick_memory', 'bubble_pop',
    'kibble_sort', 'whack_mole', 'pair_match', 'groom_timing', 'order_rush',
  ];

  var DIFFICULTIES = [
    { id: 'easy',   label: 'Easy',   badge: '🟢 Easy',   weight: 60 },
    { id: 'medium', label: 'Medium', badge: '🟡 Medium', weight: 25 },
    { id: 'hard',   label: 'Hard',   badge: '🔴 Hard',   weight: 15 },
  ];

  var DIFF_BY_ID = {};
  DIFFICULTIES.forEach(function (d) { DIFF_BY_ID[d.id] = d; });

  var KIND_META = {
    audit: {
      icon: '📊',
      title: 'Company Accounts Audit',
      warn: 'Random audit on company accounts in {s}…',
    },
    find_dog: {
      icon: '📸',
      title: 'Speed Photo Check',
      warn: 'Speed photo check! Spot the pups in {s}…',
    },
    treat_catch: {
      icon: '🍪',
      title: 'Treat Delivery Spill',
      warn: 'Treat box tipping over! Catch snacks in {s}…',
    },
    trick_memory: {
      icon: '🎵',
      title: 'Talent Scout Audition',
      warn: 'Puppy talent scout arrives in {s}…',
    },
    bubble_pop: {
      icon: '🛁',
      title: 'Sudsy Bubble Blitz',
      warn: 'Grooming tub bubble overflow in {s}…',
    },
    kibble_sort: {
      icon: '🍖',
      title: 'Safe Snack Inspector',
      warn: 'Mixed-up snack shipment! Sort safe food in {s}…',
    },
    whack_mole: {
      icon: '🐿️',
      title: 'Lawn Pest Patrol',
      warn: 'Gophers invading the yard! Defend lawn in {s}…',
    },
    pair_match: {
      icon: '🃏',
      title: 'Cubby Pair Match',
      warn: 'Puppy cubby tags scrambled! Match pairs in {s}…',
    },
    groom_timing: {
      icon: '✂️',
      title: 'Show-Dog Salon Trim',
      warn: 'VIP show dog needs an urgent trim in {s}…',
    },
    order_rush: {
      icon: '📞',
      title: 'Paw-Phone Booking Rush',
      warn: 'Phone lines ringing off the hook! Pack kits in {s}…',
    },
  };

  // Runtime state (never persisted in S)
  var rollTimer = ROLL_INTERVAL;
  var recentKinds = [];
  var pending = null; // { kind, diff, timeLeft, lastSec }
  var active = null;  // live minigame instance while UI.mode === 'minigame'

  function randRange(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function playNote(freq, dur, vol) {
    try {
      if (typeof AC === 'undefined' || !AC || typeof AU_S === 'undefined' || !AU_S) return;
      var t0 = AC.currentTime;
      var osc = AC.createOscillator();
      var g = AC.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.22, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.22));
      osc.connect(g);
      g.connect(AU_S.bus && AU_S.bus.sfx ? AU_S.bus.sfx.dry : AC.destination);
      osc.start(t0);
      osc.stop(t0 + (dur || 0.22) + 0.03);
    } catch (e) {}
  }

  function rollDifficulty(forcedId) {
    if (forcedId === 'extreme') forcedId = 'hard';
    if (forcedId && DIFF_BY_ID[forcedId]) return DIFF_BY_ID[forcedId];
    var tot = 0;
    for (var i = 0; i < DIFFICULTIES.length; i++) tot += DIFFICULTIES[i].weight;
    var r = Math.random() * tot;
    for (var j = 0; j < DIFFICULTIES.length; j++) {
      r -= DIFFICULTIES[j].weight;
      if (r <= 0) return DIFFICULTIES[j];
    }
    return DIFFICULTIES[0];
  }

  function pickNextKind(forcedKind) {
    if (forcedKind && KIND_META[forcedKind]) return forcedKind;
    var pool = ALL_KINDS.filter(function (k) { return recentKinds.indexOf(k) < 0; });
    if (!pool.length) pool = ALL_KINDS.slice();
    return pickOne(pool);
  }

  function rememberKind(k) {
    recentKinds.push(k);
    if (recentKinds.length > 3) recentKinds.shift();
  }

  function diffPillHtml(diff) {
    return '<span class="mg-tier-pill ' + diff.id + '">' + diff.badge + '</span>';
  }

  // ---------------- Daycare Penalty Helpers (for failure consequences) ----------------
  function applySpawnPoops(count) {
    if (!S || !(count > 0) || !Array.isArray(S.poops)) return 0;
    var tiles = [];
    if (typeof MAP !== 'undefined' && MAP.yard && typeof dogWalkable === 'function' && typeof TILE !== 'undefined') {
      for (var ty = MAP.yard.y0; ty <= MAP.yard.y1; ty++) {
        for (var tx = MAP.yard.x0; tx <= MAP.yard.x1; tx++) {
          if (dogWalkable(tx, ty)) tiles.push([tx, ty]);
        }
      }
    }
    var placed = 0;
    var shuffled = shuffle(tiles);
    for (var i = 0; i < count && S.poops.length < 14; i++) {
      var px, py;
      if (shuffled.length) {
        var t = shuffled[i % shuffled.length];
        px = (t[0] + 0.5) * TILE + randRange(-8, 8);
        py = (t[1] + 0.5) * TILE + randRange(-8, 8);
      } else if (S.player) {
        px = S.player.x + randRange(-40, 40);
        py = S.player.y + randRange(-40, 40);
      } else {
        break;
      }
      var pid = typeof nid === 'function' ? nid() : Math.floor(Math.random() * 1e7);
      S.poops.push({ id: pid, x: px, y: py, age: 0, seed: Math.random() });
      if (typeof burst === 'function') burst(px, py, 'dust', 5);
      placed++;
    }
    return placed;
  }

  function applyMuddyDogs(count) {
    if (!S || !(count > 0) || !Array.isArray(S.dogs)) return 0;
    var cands = S.dogs.filter(function (d) {
      return d && d.checkedIn && d.state !== 'leaving' && d.state !== 'bath' && d.state !== 'kennel'
        && d.state !== 'leashed' && d.state !== 'npcLeashed' && (!d.need || d.need.type !== 'bath');
    });
    cands = shuffle(cands);
    var muddied = 0;
    for (var i = 0; i < Math.min(count, cands.length); i++) {
      var d = cands[i];
      d.need = { type: 'bath', t: 0, self: null };
      if (d.needs) d.needs.clean = 12;
      d.happy = Math.max(20, (d.happy == null ? 75 : d.happy) - 8);
      if (typeof burst === 'function') burst(d.x, d.y - 16, 'dust', 7);
      if (typeof float === 'function') float(d.x, d.y - 52, '🛁 Got muddy!', '#ffab91', 1.1);
      muddied++;
    }
    return muddied;
  }

  function applyMoodDrop(delta) {
    if (!S || !(delta > 0) || !Array.isArray(S.dogs)) return 0;
    var hit = 0;
    S.dogs.forEach(function (d) {
      if (!d || !d.checkedIn || d.state === 'leaving') return;
      d.happy = Math.max(15, (d.happy == null ? 75 : d.happy) - delta);
      hit++;
    });
    return hit;
  }

  function applyPatienceDrop(frac) {
    if (!S || !(frac > 0) || !Array.isArray(S.owners)) return 0;
    var hit = 0;
    S.owners.forEach(function (o) {
      if (!o || (o.state !== 'waitCheckin' && o.state !== 'waitPickup')) return;
      o.patience = Math.max(10, o.patience * (1 - frac));
      hit++;
    });
    return hit;
  }

  // ---------------- Math Audit Question Generator (Easy / Medium / Hard) ----------------
  function makeIntChoices(ans, traps) {
    var set = {};
    set[String(ans)] = true;
    var out = [ans];
    (traps || []).forEach(function (v) {
      if (out.length < 4 && isFinite(v) && Math.floor(v) === v && !set[String(v)]) {
        set[String(v)] = true;
        out.push(v);
      }
    });
    var spread = Math.max(4, Math.round(Math.abs(ans) * 0.16));
    var tries = 0;
    while (out.length < 4 && tries < 60) {
      tries++;
      var off = randInt(1, spread) * (Math.random() < 0.5 ? -1 : 1);
      var cand = ans + off;
      if (ans >= 0 && cand < 0) cand = Math.abs(cand) + 1;
      if (!set[String(cand)]) {
        set[String(cand)] = true;
        out.push(cand);
      }
    }
    return shuffle(out).map(function (v) { return { label: String(v), val: String(v), correct: v === ans }; });
  }

  function makeDecimalChoices(ans1Dec, traps) {
    var ansStr = ans1Dec.toFixed(1);
    var set = {};
    set[ansStr] = true;
    var out = [ansStr];
    (traps || []).forEach(function (v) {
      var s = Number(v).toFixed(1);
      if (out.length < 4 && !set[s] && Number(s) > 0) {
        set[s] = true;
        out.push(s);
      }
    });
    var deltas = [-0.8, -0.5, -0.3, 0.3, 0.5, 0.7, 1.1, -1.1, 0.4, -0.4];
    var shuffled = shuffle(deltas);
    for (var i = 0; i < shuffled.length && out.length < 4; i++) {
      var cand = Math.max(0.5, ans1Dec + shuffled[i]).toFixed(1);
      if (!set[cand]) { set[cand] = true; out.push(cand); }
    }
    return shuffle(out).map(function (s) { return { label: s, val: s, correct: s === ansStr }; });
  }

  function generateMathQuestion(diffId) {
    if (diffId === 'extreme') diffId = 'hard';
    var a, b, c, ans, expr, hint = '';

    if (diffId === 'easy') {
      var op = randInt(0, 3);
      if (op === 0) { // simple multiply like 4 x 2
        a = randInt(2, 9); b = randInt(2, 9); ans = a * b;
        expr = a + ' × ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + a, ans - b, a + b]) };
      } else if (op === 1) {
        a = randInt(6, 28); b = randInt(4, 19); ans = a + b;
        expr = a + ' + ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 10, ans - 2, ans + 1]) };
      } else if (op === 2) {
        a = randInt(14, 42); b = randInt(4, a - 3); ans = a - b;
        expr = a + ' − ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 2, ans - 3, ans + 10]) };
      } else {
        b = randInt(2, 8); ans = randInt(2, 9); a = b * ans;
        expr = a + ' ÷ ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 1, ans - 1, ans + 2]) };
      }
    }

    if (diffId === 'medium') {
      var mop = randInt(0, 4);
      if (mop === 0) {
        a = randInt(11, 19); b = randInt(3, 9); ans = a * b;
        expr = a + ' × ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + b, ans - a, ans + 10]) };
      } else if (mop === 1) {
        a = randInt(4, 9); b = randInt(4, 9); c = randInt(6, 25); ans = a * b + c;
        expr = a + ' × ' + b + ' + ' + c;
        return { expr: expr, hint: 'Multiply before adding', choices: makeIntChoices(ans, [a * (b + c), ans + 4, ans - 6]) };
      } else if (mop === 2) {
        b = randInt(6, 13); ans = randInt(6, 14); a = b * ans;
        expr = a + ' ÷ ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 2, ans - 1, ans + 3]) };
      } else if (mop === 3) {
        a = randInt(62, 135); b = randInt(24, 58); ans = a - b;
        expr = a + ' − ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 10, ans - 10, ans + 2]) };
      } else {
        var r = randInt(7, 14); c = randInt(4, 18); ans = r + c;
        expr = '√' + (r * r) + ' + ' + c;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [r + c + 2, r + c - 1, r * 2 + c]) };
      }
    }

    // HARD tier: PEMDAS like 100 - 2 x 4, non-perfect square roots like √125, squares & percentages!
    var hop = randInt(0, 4);
    if (hop === 0) { // Order of operations like 100 - 2 x 4 or 200 - 7 x 13
      a = pickOne([100, 120, 150, 180, 200, 240]);
      b = randInt(2, 11); c = randInt(4, 12);
      ans = a - b * c;
      expr = a + ' − ' + b + ' × ' + c;
      return { expr: expr, hint: 'Order of operations (× before −)', choices: makeIntChoices(ans, [(a - b) * c, ans + b, ans - c]) };
    } else if (hop === 1) { // Non-perfect square root like √125 ≈ 11.2
      var rads = [50, 75, 80, 90, 110, 125, 135, 150, 180, 200, 240, 300];
      var rad = pickOne(rads);
      var exact = Math.round(Math.sqrt(rad) * 10) / 10;
      expr = '√' + rad;
      return {
        expr: expr,
        hint: 'Round to 1 decimal place',
        choices: makeDecimalChoices(exact, [exact + 0.6, exact - 0.5, Math.round((rad / 10) * 10) / 10]),
      };
    } else if (hop === 2) { // Square minus product: 13² - 8 × 7
      a = randInt(10, 16); b = randInt(4, 9); c = randInt(5, 9);
      ans = a * a - b * c;
      expr = a + '² − ' + b + ' × ' + c;
      return { expr: expr, hint: 'Square & multiply before subtracting', choices: makeIntChoices(ans, [a * a - b + c, ans + 12, ans - 8]) };
    } else if (hop === 3) { // Parentheses divide
      c = randInt(4, 9);
      ans = randInt(8, 17);
      var sum = c * ans;
      a = randInt(14, sum - 10); b = sum - a;
      expr = '(' + a + ' + ' + b + ') ÷ ' + c;
      return { expr: expr, hint: hint, choices: makeIntChoices(ans, [Math.round(a + b / c), ans + 2, ans - 2]) };
    } else { // Percentage: 15% of 240
      var pct = pickOne([15, 25, 35, 40, 60]);
      var base = pickOne([120, 160, 180, 200, 240, 280, 320]);
      ans = Math.round(base * pct / 100);
      expr = pct + '% of ' + base;
      return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 12, ans - 6, Math.round(base * (pct + 5) / 100)]) };
    }
  }

  function buildAuditQuestions(diffId, count) {
    var qs = [], seen = {}, tries = 0;
    while (qs.length < count && tries < 80) {
      tries++;
      var q = generateMathQuestion(diffId);
      if (!seen[q.expr]) { seen[q.expr] = true; qs.push(q); }
    }
    return qs;
  }

  // ---------------- Countdown Warning Banner ----------------
  function hideBanner() {
    var el = document.getElementById('mgBanner');
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }

  function renderBanner() {
    var el = document.getElementById('mgBanner');
    if (!el || !pending) { hideBanner(); return; }
    var meta = KIND_META[pending.kind];
    var sec = Math.max(1, Math.ceil(pending.timeLeft));
    var pill = pending.diff ? (' ' + diffPillHtml(pending.diff)) : '';
    el.hidden = false;
    el.innerHTML =
      '<div class="mg-warn-inner">' +
        '<span class="mg-warn-ico">' + meta.icon + '</span>' +
        '<div class="mg-warn-txt"><b>' + esc(meta.warn.replace('{s}', String(sec))) + '</b>' + pill + '</div>' +
        '<span class="mg-warn-num">' + sec + '</span>' +
        '<button type="button" id="mgStartNowBtn" class="mg-warn-go">Go!</button>' +
      '</div>';
    var btn = document.getElementById('mgStartNowBtn');
    if (btn) {
      btn.onclick = function () {
        if (typeof initAudio === 'function') initAudio();
        if (pending) {
          var k = pending.kind, d = pending.diff;
          pending = null;
          hideBanner();
          launch(k, d ? d.id : null);
        }
      };
    }
  }

  function startCountdown(forcedKind, forcedDiffId) {
    if (active || pending) return false;
    var kind = pickNextKind(forcedKind);
    var diff = rollDifficulty(forcedDiffId);
    pending = { kind: kind, diff: diff, timeLeft: 5.0, lastSec: 6 };
    rememberKind(kind);
    renderBanner();
    if (typeof sfx === 'function') sfx('bell');
    return true;
  }

  // ---------------- Reward & Adapted Failure Finalizer ----------------
  function finishMinigame(won, info) {
    if (!active || active.finished) return;
    active.finished = true;
    var mg = active;
    if (S) {
      if (!S.life) S.life = {};
      S.life.mgPlayed = (S.life.mgPlayed || 0) + 1;
      if (won) S.life.mgWon = (S.life.mgWon || 0) + 1;
    }

    var cash = info.cash || 0;
    var hearts = info.hearts || 0;
    var rep = info.rep || 0;
    var shave = info.shave || 0;

    // Failure consequences adapted to each game
    var fine = info.fine || 0;
    var actualFine = 0;
    var actualHeartsLost = 0;
    var poopsAdded = 0;
    var dogsMuddied = 0;
    var dogsMoodHit = 0;
    var ownersHit = 0;

    if (S) {
      if (won) {
        if (cash > 0) {
          S.cash += cash;
          if (S.stats) S.stats.earned = (S.stats.earned || 0) + cash;
          if (S.life) S.life.earned = (S.life.earned || 0) + cash;
        }
        if (hearts > 0 && typeof gainHearts === 'function') gainHearts(hearts, S.player.x, S.player.y - 60);
        if (rep > 0 && typeof boostRep === 'function') boostRep(rep, S.player.x, S.player.y - 80);
        if (shave > 0 && typeof shaveActiveTimers === 'function') shaveActiveTimers(shave, info.shortTag || 'Mini-Game!', S.player.x, S.player.y - 40);
        if (typeof gainXP === 'function') gainXP(info.xp || 14);
        if (typeof confetti === 'function') confetti(S.player.x, S.player.y - 40, 46);
        if (typeof sfx === 'function') sfx('level');
      } else {
        if (info.spawnPoops > 0) poopsAdded = applySpawnPoops(info.spawnPoops);
        if (info.muddyDogs > 0) {
          dogsMuddied = applyMuddyDogs(info.muddyDogs);
          // If no yard dogs were eligible to get muddy, convert unapplied mud into extra cleanup cost
          if (dogsMuddied < info.muddyDogs) fine += (info.muddyDogs - dogsMuddied) * 12;
        }
        if (info.moodDrop > 0) dogsMoodHit = applyMoodDrop(info.moodDrop);
        if (info.patienceDrop > 0) ownersHit = applyPatienceDrop(info.patienceDrop);
        if (info.loseHearts > 0) {
          actualHeartsLost = Math.min(Math.floor(S.hearts || 0), info.loseHearts);
          S.hearts = Math.max(0, (S.hearts || 0) - actualHeartsLost);
        }
        if (fine > 0) {
          actualFine = Math.min(Math.floor(S.cash || 0), fine);
          S.cash = Math.max(0, S.cash - actualFine);
          if (S.stats) S.stats.spent = (S.stats.spent || 0) + actualFine;
        }
        if (rep < 0 && typeof dropRep === 'function') {
          dropRep(Math.abs(rep), info.failRepMsg || (KIND_META[mg.kind].icon + ' ' + KIND_META[mg.kind].title + ' failed!'), S.player.x, S.player.y - 60);
        }
        if (typeof FX !== 'undefined') FX.shake = Math.max(FX.shake || 0, 0.3);
        if (typeof sfx === 'function') sfx('error');
      }
      if (typeof MP !== 'undefined' && MP.recordAction) {
        MP.recordAction('minigame', {
          item: mg.kind,
          name: info.headline || KIND_META[mg.kind].title,
          icon: KIND_META[mg.kind].icon,
          earned: won ? cash : 0,
          cost: actualFine,
          shave: won ? shave : 0,
          perfect: !!won,
        });
      }
      if (typeof saveGame === 'function') saveGame();
    }

    var rewardsHtml = '';
    if (won) {
      var chips = [];
      if (cash > 0) chips.push('<span class="mg-rew good">+' + fmtMoney(cash) + '</span>');
      if (hearts > 0) chips.push('<span class="mg-rew heart">+' + hearts + '💛</span>');
      if (rep > 0) chips.push('<span class="mg-rew star">+' + rep.toFixed(2) + '★</span>');
      if (shave > 0 && typeof activeBuildCount === 'function' && activeBuildCount() > 0) {
        chips.push('<span class="mg-rew time">⏱ -' + fmtDur(shave) + '</span>');
      }
      rewardsHtml = '<div class="mg-rew-row">' + chips.join('') + '</div>';
    } else {
      var fChips = [];
      if (actualFine > 0) fChips.push('<span class="mg-rew bad">-' + fmtMoney(actualFine) + ' ' + esc(info.fineLabel || 'Fine') + '</span>');
      if (rep < 0) fChips.push('<span class="mg-rew bad">' + rep.toFixed(2) + '★</span>');
      if (actualHeartsLost > 0) fChips.push('<span class="mg-rew bad">-' + actualHeartsLost + '💛</span>');
      if (poopsAdded > 0) fChips.push('<span class="mg-rew bad">+' + poopsAdded + '💩 Yard Mess</span>');
      if (dogsMuddied > 0) fChips.push('<span class="mg-rew bad">' + dogsMuddied + '🛁 Muddy Pup' + (dogsMuddied > 1 ? 's' : '') + '</span>');
      if (dogsMoodHit > 0 && info.moodDrop > 0) fChips.push('<span class="mg-rew bad">-' + info.moodDrop + '😿 Pup Mood</span>');
      if (ownersHit > 0) fChips.push('<span class="mg-rew bad">⏱️ Queue Impatient</span>');
      if (fChips.length) rewardsHtml = '<div class="mg-rew-row">' + fChips.join('') + '</div>';
    }

    var card = document.querySelector('#modal .card');
    if (card) {
      card.innerHTML =
        '<div class="mg-res">' +
          '<div class="mg-res-ico">' + (won ? '🏆' : KIND_META[mg.kind].icon) + '</div>' +
          '<div class="mg-res-pill">' + diffPillHtml(mg.diff) + '</div>' +
          '<h2>' + esc(info.headline || (won ? 'Challenge Complete!' : 'Challenge Failed!')) + '</h2>' +
          '<p>' + esc(info.detail || '') + '</p>' +
          rewardsHtml +
          '<div class="row"><button id="mgDoneBtn" class="primary big">Back to Daycare</button></div>' +
        '</div>';
      var doneBtn = document.getElementById('mgDoneBtn');
      if (doneBtn) {
        doneBtn.onclick = function () {
          if (typeof sfx === 'function') sfx('click');
          active = null;
          rollTimer = ROLL_INTERVAL;
          if (typeof closeModal === 'function') closeModal();
        };
      }
    } else {
      active = null;
      rollTimer = ROLL_INTERVAL;
    }
  }

  // ============================================================================================
  // 1. COMPANY ACCOUNTS AUDIT (Math & Order of Operations)
  // ============================================================================================
  var AUDIT_CFG = {
    easy:   { count: 4, time: 25, wrongPen: 2.0, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 30,  failRep: -0.08, loseHearts: 0 },
    medium: { count: 5, time: 30, wrongPen: 2.5, cash: 90,  hearts: 5, rep: 0.15, shave: 1500, fine: 60,  failRep: -0.15, loseHearts: 1 },
    hard:   { count: 6, time: 40, wrongPen: 3.0, cash: 175, hearts: 9, rep: 0.24, shave: 3000, fine: 105, failRep: -0.24, loseHearts: 2 },
  };

  function startAudit(diff) {
    var cfg = AUDIT_CFG[diff.id];
    var questions = buildAuditQuestions(diff.id, cfg.count);
    active = {
      kind: 'audit',
      diff: diff,
      cfg: cfg,
      questions: questions,
      idx: 0,
      wrong: 0,
      timeLeft: cfg.time,
      maxTime: cfg.time,
      finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>📊 Company Audit</span>' +
        diffPillHtml(diff) +
        '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-dots" id="mgDots"></div>' +
      '<div class="mg-math-box" id="mgMathBox">' +
        '<div class="mg-math-q" id="mgMathExpr"></div>' +
        '<div class="mg-math-hint" id="mgMathHint"></div>' +
      '</div>' +
      '<div class="mg-choices" id="mgChoices"></div>' +
      '<p class="mg-sub">Balance all ' + cfg.count + ' books before time runs out! Wrong tap: −' + cfg.wrongPen.toFixed(1) + 's. Fail = tax fine &amp; ★ loss.</p>',
      'minigame', 'mg-card'
    );
    renderAuditQuestion();
  }

  function renderAuditQuestion() {
    if (!active || active.kind !== 'audit' || active.finished) return;
    var q = active.questions[active.idx];
    var dots = document.getElementById('mgDots');
    if (dots) {
      var dh = '';
      for (var i = 0; i < active.questions.length; i++) {
        dh += '<i class="' + (i < active.idx ? 'done' : i === active.idx ? 'now' : '') + '"></i>';
      }
      dots.innerHTML = dh + '<span>Q' + (active.idx + 1) + ' / ' + active.questions.length + '</span>';
    }
    var exprEl = document.getElementById('mgMathExpr');
    var hintEl = document.getElementById('mgMathHint');
    var chEl = document.getElementById('mgChoices');
    if (exprEl) exprEl.textContent = q.expr + ' = ?';
    if (hintEl) hintEl.textContent = q.hint || 'Tap the right answer';
    if (chEl) {
      chEl.innerHTML = q.choices.map(function (ch, idx) {
        return '<button type="button" class="wood mg-ch-btn" data-mgi="' + idx + '">' + esc(ch.label) + '</button>';
      }).join('');
      chEl.querySelectorAll('[data-mgi]').forEach(function (btn) {
        btn.onclick = function () {
          if (!active || active.finished) return;
          if (typeof initAudio === 'function') initAudio();
          var ci = +btn.getAttribute('data-mgi');
          var picked = q.choices[ci];
          if (picked && picked.correct) {
            btn.classList.add('right');
            playNote(660 + active.idx * 75, 0.14, 0.22);
            active.idx++;
            if (active.idx >= active.questions.length) {
              var c = active.cfg;
              finishMinigame(true, {
                headline: active.diff.label + ' Audit Passed!',
                detail: 'All ' + c.count + ' books balanced with ' + active.timeLeft.toFixed(1) + 's left!' + (active.wrong === 0 ? ' Spotless record!' : ''),
                cash: c.cash + (active.wrong === 0 ? 15 : 0),
                hearts: c.hearts,
                rep: c.rep,
                shave: c.shave,
                xp: 12 + c.hearts * 2,
                shortTag: 'Audit Pass!',
              });
            } else {
              setTimeout(renderAuditQuestion, 130);
            }
          } else {
            btn.classList.add('wrong');
            btn.disabled = true;
            active.wrong++;
            active.timeLeft = Math.max(0.2, active.timeLeft - active.cfg.wrongPen);
            if (typeof sfx === 'function') sfx('error');
            var box = document.getElementById('mgMathBox');
            if (box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
          }
        };
      });
    }
  }

  // ============================================================================================
  // 2. SPEED PHOTO CHECK (Spot Target Dogs One at a Time)
  // ============================================================================================
  var FIND_CFG = {
    easy:   { crowd: 10, targets: 3, perDogSec: 10.0, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, failRep: -0.12, loseHearts: 1 },
    medium: { crowd: 14, targets: 4, perDogSec: 8.5,  cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 40, failRep: -0.20, loseHearts: 2 },
    hard:   { crowd: 16, targets: 5, perDogSec: 6.5,  cash: 165, hearts: 8, rep: 0.22, shave: 2700, fine: 70, failRep: -0.30, loseHearts: 3 },
  };

  function startFindDog(diff) {
    var cfg = FIND_CFG[diff.id];
    var allBreeds = (typeof BREEDS !== 'undefined' && BREEDS.length) ? BREEDS : [{ id: 'golden', name: 'Golden Retriever', coats: [{ name: 'Golden' }] }];
    var chosen = shuffle(allBreeds).slice(0, Math.min(cfg.crowd, allBreeds.length));
    var CW = 336, CH = 264;

    var slots = [];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        slots.push({ cx: 42 + c * 84 + randRange(-10, 10), cy: 42 + r * 60 + randRange(-6, 6) });
      }
    }
    slots = shuffle(slots);

    var dogs = chosen.map(function (b, i) {
      var coatCount = (b.coats && b.coats.length) ? b.coats.length : 1;
      var coat = randInt(0, coatCount - 1);
      var coatName = (b.coats && b.coats[coat] && b.coats[coat].name) ? b.coats[coat].name : '';
      return {
        id: i, breed: b.id, breedName: b.name, coat: coat, coatName: coatName,
        x: slots[i].cx, y: slots[i].cy, r: 25, found: false,
        seed: randInt(1, 9999), mood: pickOne(['happy', 'happy', 'excited', 'neutral']),
      };
    });

    var targets = shuffle(dogs.map(function (d) { return d.id; })).slice(0, Math.min(cfg.targets, dogs.length));
    var bushes = [];
    for (var bi = 0; bi < 7; bi++) bushes.push({ x: randRange(18, CW - 18), y: randRange(24, CH - 16), rx: randRange(14, 24), ry: randRange(9, 14), col: pickOne(['#4e8d3d', '#5d9f48', '#447c36']) });
    var flowers = [];
    for (var fl = 0; fl < 18; fl++) flowers.push({ x: randRange(10, CW - 10), y: randRange(14, CH - 10), col: pickOne(['#ffe066', '#ff8fb1', '#ffffff', '#b3e5fc']) });

    active = {
      kind: 'find_dog', diff: diff, cfg: cfg, cw: CW, ch: CH,
      dogs: dogs, targets: targets, tIdx: 0,
      timeLeft: cfg.perDogSec, maxTime: cfg.perDogSec,
      foundCount: 0, fx: [], bushes: bushes, flowers: flowers, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>📸 Photo Check</span>' +
        diffPillHtml(diff) +
        '<span class="mg-timer" id="mgTimer">' + cfg.perDogSec.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-target-bar" id="mgFindTarget"></div>' +
      '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px"></canvas></div>' +
      '<p class="mg-sub">Spot each dog in ' + cfg.perDogSec.toFixed(1) + 's! Wrong tap: −1.5s. Fail = refund &amp; ★ drop.</p>',
      'minigame', 'mg-card'
    );

    renderFindTarget();
    drawFindPhoto();

    var cv = document.getElementById('mgCanvas');
    if (cv) {
      cv.addEventListener('pointerdown', function (ev) {
        if (!active || active.kind !== 'find_dog' || active.finished) return;
        if (typeof initAudio === 'function') initAudio();
        var rect = cv.getBoundingClientRect();
        var px = (ev.clientX - rect.left) * (active.cw / rect.width);
        var py = (ev.clientY - rect.top) * (active.ch / rect.height);
        var best = null, bd = 34;
        for (var i = 0; i < active.dogs.length; i++) {
          var dg = active.dogs[i];
          var d = Math.hypot(px - dg.x, py - dg.y);
          if (d < bd) { bd = d; best = dg; }
        }
        if (!best) return;

        var wantId = active.targets[active.tIdx];
        if (best.id === wantId) {
          best.found = true;
          active.foundCount++;
          active.fx.push({ x: best.x, y: best.y - 14, text: '✓ Found!', col: '#7ef27a', life: 0.9 });
          playNote(740 + active.tIdx * 80, 0.16, 0.24);
          active.tIdx++;
          if (active.tIdx >= active.targets.length) {
            drawFindPhoto();
            var c = active.cfg;
            setTimeout(function () {
              finishMinigame(true, {
                headline: 'Eagle-Eyed Keeper!',
                detail: 'Spotted all ' + active.targets.length + ' dogs in the daycare group photo!',
                cash: c.cash, hearts: c.hearts, rep: c.rep, shave: c.shave, xp: 14 + c.hearts * 2,
                shortTag: 'Photo Check!',
              });
            }, 200);
          } else {
            active.timeLeft = active.cfg.perDogSec;
            renderFindTarget();
            drawFindPhoto();
          }
        } else if (!best.found) {
          active.timeLeft = Math.max(0.2, active.timeLeft - 1.5);
          active.fx.push({ x: best.x, y: best.y - 12, text: '✗ -1.5s', col: '#ff7b72', life: 0.75 });
          if (typeof sfx === 'function') sfx('error');
          drawFindPhoto();
        }
      });
    }
  }

  function renderFindTarget() {
    if (!active || active.kind !== 'find_dog') return;
    var el = document.getElementById('mgFindTarget');
    if (!el) return;
    var dg = active.dogs[active.targets[active.tIdx]];
    if (!dg) return;
    var imgUrl = typeof dogPortraitURL === 'function'
      ? dogPortraitURL(dg.breed, dg.coat, 96, { bg: 'badge', mood: dg.mood, seed: dg.seed })
      : '';
    el.innerHTML =
      (imgUrl ? '<img src="' + imgUrl + '" alt="">' : '<span class="mg-fb-ico">🐶</span>') +
      '<div class="mg-target-txt">' +
        '<small>FIND DOG ' + (active.tIdx + 1) + ' OF ' + active.targets.length + '</small>' +
        '<b>' + esc(dg.breedName) + '</b>' +
        (dg.coatName ? '<span>' + esc(dg.coatName) + ' coat</span>' : '') +
      '</div>';
  }

  function drawFindPhoto() {
    if (!active || active.kind !== 'find_dog') return;
    var cv = document.getElementById('mgCanvas');
    if (!cv) return;
    var c = cv.getContext('2d');
    var cw = active.cw, ch = active.ch;
    c.save(); c.scale(2, 2);

    var grd = c.createLinearGradient(0, 0, 0, ch);
    grd.addColorStop(0, '#78be5a'); grd.addColorStop(0.22, '#6cb250'); grd.addColorStop(1, '#589c42');
    c.fillStyle = grd; c.fillRect(0, 0, cw, ch);

    c.fillStyle = '#a8743f'; c.fillRect(0, 4, cw, 10);
    c.fillStyle = '#c9935a';
    for (var fx = 4; fx < cw; fx += 18) {
      c.fillRect(fx, 0, 12, 18);
      c.strokeStyle = '#4a3426'; c.lineWidth = 1; c.strokeRect(fx, 0, 12, 18);
    }

    (active.bushes || []).forEach(function (b) {
      c.fillStyle = b.col; c.beginPath(); c.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2); c.fill();
    });
    (active.flowers || []).forEach(function (f) {
      c.fillStyle = f.col; c.beginPath(); c.arc(f.x, f.y, 2.3, 0, Math.PI * 2); c.fill();
    });

    var sorted = active.dogs.slice().sort(function (a, b) { return a.y - b.y; });
    sorted.forEach(function (dg) {
      c.fillStyle = 'rgba(30, 20, 10, 0.22)';
      c.beginPath(); c.ellipse(dg.x, dg.y + 18, 17, 7, 0, 0, Math.PI * 2); c.fill();
      var sz = 46;
      if (typeof drawDogPortrait === 'function') {
        try { drawDogPortrait(c, dg.breed, dg.coat, dg.x - sz / 2, dg.y - sz / 2 - 2, sz, { mood: dg.mood, seed: dg.seed }); }
        catch (e) { c.font = '26px sans-serif'; c.textAlign = 'center'; c.fillText('🐶', dg.x, dg.y + 8); }
      } else {
        c.font = '26px sans-serif'; c.textAlign = 'center'; c.fillText('🐶', dg.x, dg.y + 8);
      }
      if (dg.found) {
        c.strokeStyle = '#7ef27a'; c.lineWidth = 2.5;
        c.beginPath(); c.arc(dg.x, dg.y, 22, 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#3f8f37'; c.beginPath(); c.arc(dg.x + 15, dg.y - 15, 8, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('✓', dg.x + 15, dg.y - 14.5);
      }
    });

    (active.fx || []).forEach(function (p) {
      c.save(); c.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = '#2a1a10';
      c.strokeText(p.text, p.x, p.y); c.fillStyle = p.col; c.fillText(p.text, p.x, p.y);
      c.restore();
    });
    c.restore();
  }

  // ============================================================================================
  // 3. TREAT DELIVERY SPILL (15s Reflex Basket Catch)
  // ============================================================================================
  var TREAT_CFG = {
    easy:   { goal: 13, basketW: 66, spawnA: 0.42, spawnB: 0.60, junk: 0.20, spdMul: 0.90, cash: 50,  hearts: 3, rep: 0.09, shave: 900,  fine: 25, poops: 1, moodDrop: 6,  failRep: 0 },
    medium: { goal: 18, basketW: 58, spawnA: 0.34, spawnB: 0.48, junk: 0.28, spdMul: 1.10, cash: 90,  hearts: 5, rep: 0.14, shave: 1500, fine: 45, poops: 2, moodDrop: 12, failRep: -0.06 },
    hard:   { goal: 24, basketW: 50, spawnA: 0.26, spawnB: 0.40, junk: 0.36, spdMul: 1.32, cash: 155, hearts: 8, rep: 0.20, shave: 2400, fine: 75, poops: 3, moodDrop: 18, failRep: -0.12 },
  };

  function startTreatCatch(diff) {
    var cfg = TREAT_CFG[diff.id];
    var CW = 330, CH = 256;
    active = {
      kind: 'treat_catch', diff: diff, cfg: cfg, cw: CW, ch: CH,
      basketX: CW / 2, basketW: cfg.basketW, score: 0, goal: cfg.goal,
      bonusHearts: 0, timeLeft: 15.0, maxTime: 15.0, spawnT: 0.18,
      items: [], fx: [], dragging: false, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🍪 Treat Spill</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
        '<span class="mg-timer" id="mgTimer">15.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
      '<p class="mg-sub">Slide to catch ' + cfg.goal + '+ treats (🦴🍪🥩💛) &amp; dodge 🥾🧦! Fail = restock cost &amp; yard mess.</p>',
      'minigame', 'mg-card'
    );

    var cv = document.getElementById('mgCanvas');
    if (cv) {
      var moveBasket = function (ev) {
        if (!active || active.kind !== 'treat_catch' || active.finished) return;
        var rect = cv.getBoundingClientRect();
        var px = (ev.clientX - rect.left) * (active.cw / rect.width);
        active.basketX = Math.max(active.basketW / 2 + 4, Math.min(active.cw - active.basketW / 2 - 4, px));
      };
      cv.addEventListener('pointerdown', function (ev) {
        if (typeof initAudio === 'function') initAudio();
        if (active) active.dragging = true;
        moveBasket(ev);
      });
      cv.addEventListener('pointermove', function (ev) { if (active && active.dragging) moveBasket(ev); });
      cv.addEventListener('pointerup', function () { if (active) active.dragging = false; });
      cv.addEventListener('pointercancel', function () { if (active) active.dragging = false; });
    }
    drawTreatCatch();
  }

  function updateTreatCatch(dt) {
    var a = active, cfg = a.cfg;
    a.spawnT -= dt;
    if (a.spawnT <= 0) {
      a.spawnT = randRange(cfg.spawnA, cfg.spawnB);
      var roll = Math.random();
      var spec;
      if (roll < cfg.junk * 0.65) spec = { ico: '🥾', pts: -2, bad: true, spd: randRange(130, 172) * cfg.spdMul };
      else if (roll < cfg.junk) spec = { ico: '🧦', pts: -2, bad: true, spd: randRange(125, 165) * cfg.spdMul };
      else if (roll < cfg.junk + 0.12) spec = { ico: '💛', pts: 2, heart: true, spd: randRange(145, 188) * cfg.spdMul };
      else if (roll < cfg.junk + 0.34) spec = { ico: '🥩', pts: 2, spd: randRange(135, 178) * cfg.spdMul };
      else if (roll < cfg.junk + 0.66) spec = { ico: '🍪', pts: 1, spd: randRange(115, 152) * cfg.spdMul };
      else spec = { ico: '🦴', pts: 1, spd: randRange(115, 152) * cfg.spdMul };
      a.items.push({ x: randRange(24, a.cw - 24), y: -16, ico: spec.ico, pts: spec.pts, bad: !!spec.bad, heart: !!spec.heart, spd: spec.spd, rot: randRange(-0.3, 0.3) });
    }

    var by = a.ch - 32;
    for (var i = a.items.length - 1; i >= 0; i--) {
      var it = a.items[i];
      it.y += it.spd * dt;
      if (Math.abs(it.y - by) < 22 && Math.abs(it.x - a.basketX) < a.basketW * 0.56) {
        a.items.splice(i, 1);
        a.score = Math.max(0, a.score + it.pts);
        if (it.heart) a.bonusHearts++;
        a.fx.push({ x: it.x, y: by - 18, text: it.bad ? 'Yuck! -2' : ('+' + it.pts + (it.heart ? '💛' : '')), col: it.bad ? '#ff7b72' : '#ffe066', life: 0.7 });
        if (it.bad) { if (typeof sfx === 'function') sfx('error'); }
        else playNote(it.heart ? 880 : (it.pts > 1 ? 660 : 540), 0.11, 0.18);
        var sc = document.getElementById('mgScore');
        if (sc) sc.textContent = a.score + ' / ' + a.goal;
        continue;
      }
      if (it.y > a.ch + 24) a.items.splice(i, 1);
    }

    for (var j = a.fx.length - 1; j >= 0; j--) {
      a.fx[j].y -= 28 * dt;
      a.fx[j].life -= dt;
      if (a.fx[j].life <= 0) a.fx.splice(j, 1);
    }
    drawTreatCatch();
  }

  function drawTreatCatch() {
    var a = active, cv = document.getElementById('mgCanvas');
    if (!a || !cv) return;
    var c = cv.getContext('2d');
    c.save(); c.scale(2, 2);

    var g = c.createLinearGradient(0, 0, 0, a.ch);
    g.addColorStop(0, '#fff4d6'); g.addColorStop(0.75, '#f5e1b8'); g.addColorStop(1, '#d8b67b');
    c.fillStyle = g; c.fillRect(0, 0, a.cw, a.ch);
    c.fillStyle = 'rgba(122, 78, 42, 0.12)'; c.fillRect(0, 58, a.cw, 6); c.fillRect(0, 134, a.cw, 6);

    c.textAlign = 'center'; c.textBaseline = 'middle';
    a.items.forEach(function (it) {
      c.save(); c.translate(it.x, it.y); c.rotate(it.rot);
      c.font = '24px sans-serif'; c.fillText(it.ico, 0, 0);
      c.restore();
    });

    var bx = a.basketX - a.basketW / 2, by = a.ch - 40;
    c.fillStyle = '#c48342'; c.strokeStyle = '#3b2a20'; c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(bx, by); c.lineTo(bx + a.basketW, by);
    c.lineTo(bx + a.basketW - 9, by + 26); c.lineTo(bx + 9, by + 26);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#e3a862'; c.fillRect(bx - 3, by - 5, a.basketW + 6, 8); c.strokeRect(bx - 3, by - 5, a.basketW + 6, 8);
    c.font = '13px sans-serif'; c.fillText('🐾', a.basketX, by + 13);

    a.fx.forEach(function (f) {
      c.save(); c.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      c.font = 'bold 13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#2a1a10';
      c.strokeText(f.text, f.x, f.y); c.fillStyle = f.col; c.fillText(f.text, f.x, f.y);
      c.restore();
    });
    c.restore();
  }

  // ============================================================================================
  // 4. TALENT SCOUT AUDITION (Musical Puppy Trick Memory)
  // ============================================================================================
  var ALL_TRICKS = [
    { id: 0, icon: '🐾', name: 'Sit',       col: '#e8796c', freq: 440 },
    { id: 1, icon: '🔄', name: 'Roll Over', col: '#f2c14e', freq: 523.25 },
    { id: 2, icon: '🗣️', name: 'Speak',     col: '#42b8a8', freq: 659.25 },
    { id: 3, icon: '🦴', name: 'Jump',      col: '#78c85e', freq: 783.99 },
    { id: 4, icon: '🌀', name: 'Spin',      col: '#9c7ce8', freq: 880 },
    { id: 5, icon: '🤝', name: 'Shake',     col: '#ef9348', freq: 987.77 },
  ];

  var TRICK_CFG = {
    easy:   { pads: 4, lens: [2, 3, 4],    showStep: 0.58, inputSec: 13.0, cash: 55,  hearts: 3, rep: 0.11, shave: 900,  fine: 0,  failRep: -0.12, loseHearts: 1 },
    medium: { pads: 4, lens: [3, 4, 5],    showStep: 0.50, inputSec: 11.0, cash: 100, hearts: 6, rep: 0.16, shave: 1800, fine: 25, failRep: -0.20, loseHearts: 2 },
    hard:   { pads: 6, lens: [3, 4, 5, 6], showStep: 0.42, inputSec: 10.0, cash: 175, hearts: 9, rep: 0.25, shave: 3000, fine: 50, failRep: -0.32, loseHearts: 3 },
  };

  function startTrickMemory(diff) {
    var cfg = TRICK_CFG[diff.id];
    var maxLen = cfg.lens[cfg.lens.length - 1];
    var seq = [];
    for (var i = 0; i < maxLen; i++) seq.push(randInt(0, cfg.pads - 1));
    var tricks = ALL_TRICKS.slice(0, cfg.pads);

    active = {
      kind: 'trick_memory', diff: diff, cfg: cfg, tricks: tricks,
      seq: seq, round: 0, roundLens: cfg.lens,
      phase: 'show', showStep: 0, showT: 0.45,
      litPad: -1, litT: 0, inputIdx: 0,
      timeLeft: cfg.inputSec, maxTime: cfg.inputSec, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🎵 Talent Audition</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">R1 / ' + cfg.lens.length + '</span>' +
        '<span class="mg-timer" id="mgTimer">' + cfg.inputSec.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-trick-status" id="mgTrickStat">👀 Watch the scout\'s trick routine…</div>' +
      '<div class="mg-trick-grid' + (cfg.pads > 4 ? ' six' : '') + '" id="mgTrickGrid">' +
        tricks.map(function (tr) {
          return '<button type="button" class="mg-trick-pad" data-tpad="' + tr.id + '" style="--pcol:' + tr.col + '">' +
            '<span class="tico">' + tr.icon + '</span><b>' + tr.name + '</b></button>';
        }).join('') +
      '</div>' +
      '<p class="mg-sub">Repeat all ' + cfg.lens.length + ' trick routines in order! Fail = bad press &amp; ★ loss.</p>',
      'minigame', 'mg-card'
    );

    var grid = document.getElementById('mgTrickGrid');
    if (grid) {
      grid.querySelectorAll('[data-tpad]').forEach(function (btn) {
        btn.onclick = function () {
          if (!active || active.kind !== 'trick_memory' || active.finished || active.phase !== 'input') return;
          if (typeof initAudio === 'function') initAudio();
          var pid = +btn.getAttribute('data-tpad');
          flashTrickPad(pid, 0.22);
          if (pid === active.seq[active.inputIdx]) {
            active.inputIdx++;
            if (active.inputIdx >= active.roundLens[active.round]) {
              active.round++;
              if (active.round >= active.roundLens.length) {
                var c = active.cfg;
                finishMinigame(true, {
                  headline: 'Standing Ovation!',
                  detail: 'Your pups nailed all ' + c.lens.length + ' trick routines for the Talent Scout!',
                  cash: c.cash, hearts: c.hearts, rep: c.rep, shave: c.shave, xp: 14 + c.hearts * 2,
                  shortTag: 'Talent Show!',
                });
              } else {
                active.phase = 'show'; active.showStep = 0; active.showT = 0.65;
                active.inputIdx = 0; active.timeLeft = active.cfg.inputSec;
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = 'R' + (active.round + 1) + ' / ' + active.roundLens.length;
                var st = document.getElementById('mgTrickStat');
                if (st) st.textContent = '✨ Nice! Watch Round ' + (active.round + 1) + '…';
              }
            }
          } else {
            var c2 = active.cfg;
            finishMinigame(false, {
              headline: 'Stage Fright!',
              detail: 'Wrong trick on Round ' + (active.round + 1) + ' — the Talent Scout wrote a harsh Bark Weekly blurb!',
              fine: c2.fine, fineLabel: 'Entry Fee',
              rep: c2.failRep, loseHearts: c2.loseHearts,
              failRepMsg: '🎵 Talent Scout audition flopped!',
            });
          }
        };
      });
    }
  }

  function flashTrickPad(pid, dur) {
    if (!active) return;
    active.litPad = pid;
    active.litT = dur || 0.30;
    if (ALL_TRICKS[pid]) playNote(ALL_TRICKS[pid].freq, dur || 0.24, 0.24);
    var grid = document.getElementById('mgTrickGrid');
    if (grid) {
      grid.querySelectorAll('[data-tpad]').forEach(function (b) {
        b.classList.toggle('lit', +b.getAttribute('data-tpad') === pid);
      });
    }
  }

  function updateTrickMemory(dt) {
    var a = active;
    if (a.litT > 0) {
      a.litT -= dt;
      if (a.litT <= 0) {
        a.litPad = -1;
        var grid = document.getElementById('mgTrickGrid');
        if (grid) grid.querySelectorAll('.lit').forEach(function (b) { b.classList.remove('lit'); });
      }
    }
    if (a.phase === 'show') {
      a.showT -= dt;
      if (a.showT <= 0) {
        var len = a.roundLens[a.round];
        if (a.showStep < len) {
          flashTrickPad(a.seq[a.showStep], Math.max(0.24, a.cfg.showStep * 0.65));
          a.showStep++;
          a.showT = a.cfg.showStep;
        } else {
          a.phase = 'input'; a.inputIdx = 0; a.timeLeft = a.cfg.inputSec;
          var st = document.getElementById('mgTrickStat');
          if (st) st.textContent = '🐾 Your turn! Tap ' + len + ' tricks in order!';
        }
      }
    }
  }

  // ============================================================================================
  // 5. SUDSY BUBBLE BLITZ (14s Speed Tap Popper)
  // ============================================================================================
  var BUBBLE_CFG = {
    easy:   { goal: 13, spawnA: 0.32, spawnB: 0.48, badP: 0.14, spdMul: 0.85, rMin: 22, rMax: 29, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, muddy: 1, failRep: -0.06 },
    medium: { goal: 19, spawnA: 0.25, spawnB: 0.40, badP: 0.22, spdMul: 1.08, rMin: 19, rMax: 26, cash: 90,  hearts: 5, rep: 0.14, shave: 1500, fine: 40, muddy: 2, failRep: -0.12 },
    hard:   { goal: 25, spawnA: 0.19, spawnB: 0.32, badP: 0.30, spdMul: 1.32, rMin: 17, rMax: 23, cash: 155, hearts: 8, rep: 0.20, shave: 2400, fine: 70, muddy: 3, failRep: -0.20 },
  };

  function startBubblePop(diff) {
    var cfg = BUBBLE_CFG[diff.id];
    var CW = 330, CH = 256;
    active = {
      kind: 'bubble_pop', diff: diff, cfg: cfg, cw: CW, ch: CH,
      score: 0, goal: cfg.goal, timeLeft: 14.0, maxTime: 14.0,
      spawnT: 0.08, bubbles: [], fx: [], finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🛁 Bubble Blitz</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
        '<span class="mg-timer" id="mgTimer">14.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
      '<p class="mg-sub">Pop ' + cfg.goal + '+ soap bubbles &amp; 🦆 duckies! Avoid 🌶️ pepper! Fail = tub flood &amp; muddy pups.</p>',
      'minigame', 'mg-card'
    );

    var cv = document.getElementById('mgCanvas');
    if (cv) {
      cv.addEventListener('pointerdown', function (ev) {
        if (!active || active.kind !== 'bubble_pop' || active.finished) return;
        if (typeof initAudio === 'function') initAudio();
        var rect = cv.getBoundingClientRect();
        var px = (ev.clientX - rect.left) * (active.cw / rect.width);
        var py = (ev.clientY - rect.top) * (active.ch / rect.height);
        for (var i = active.bubbles.length - 1; i >= 0; i--) {
          var b = active.bubbles[i];
          if (Math.hypot(px - b.x, py - b.y) <= b.r + 10) {
            active.bubbles.splice(i, 1);
            active.score = Math.max(0, active.score + b.pts);
            active.fx.push({ x: b.x, y: b.y, text: b.bad ? 'Achoo! -2' : ('+' + b.pts), col: b.bad ? '#ff7b72' : '#ffe066', life: 0.65 });
            if (b.bad) { if (typeof sfx === 'function') sfx('error'); }
            else playNote(b.pts > 1 ? 840 : 620, 0.09, 0.18);
            var sc = document.getElementById('mgScore');
            if (sc) sc.textContent = active.score + ' / ' + active.goal;
            break;
          }
        }
      });
    }
    drawBubblePop();
  }

  function updateBubblePop(dt) {
    var a = active, cfg = a.cfg;
    a.spawnT -= dt;
    if (a.spawnT <= 0 && a.bubbles.length < 16) {
      a.spawnT = randRange(cfg.spawnA, cfg.spawnB);
      var roll = Math.random();
      var bad = roll < cfg.badP;
      var duck = !bad && roll < cfg.badP + 0.18;
      var r = duck ? Math.max(19, cfg.rMin) : bad ? Math.max(18, cfg.rMin) : randRange(cfg.rMin, cfg.rMax);
      a.bubbles.push({
        x: randRange(r + 8, a.cw - r - 8), y: a.ch + r, r: r,
        vy: (duck ? randRange(82, 110) : randRange(58, 90)) * cfg.spdMul,
        wob: Math.random() * 6.28, pts: bad ? -2 : duck ? 2 : 1, bad: bad, duck: duck,
      });
    }
    for (var i = a.bubbles.length - 1; i >= 0; i--) {
      var b = a.bubbles[i];
      b.y -= b.vy * dt; b.wob += dt * 3; b.x += Math.sin(b.wob) * 18 * dt;
      if (b.y < -b.r - 8) a.bubbles.splice(i, 1);
    }
    for (var j = a.fx.length - 1; j >= 0; j--) {
      a.fx[j].y -= 24 * dt; a.fx[j].life -= dt;
      if (a.fx[j].life <= 0) a.fx.splice(j, 1);
    }
    drawBubblePop();
  }

  function drawBubblePop() {
    var a = active, cv = document.getElementById('mgCanvas');
    if (!a || !cv) return;
    var c = cv.getContext('2d');
    c.save(); c.scale(2, 2);

    var g = c.createLinearGradient(0, 0, 0, a.ch);
    g.addColorStop(0, '#c8eeff'); g.addColorStop(1, '#79c7eb');
    c.fillStyle = g; c.fillRect(0, 0, a.cw, a.ch);
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1;
    for (var tx = 0; tx < a.cw; tx += 36) { c.beginPath(); c.moveTo(tx, 0); c.lineTo(tx, a.ch); c.stroke(); }
    for (var ty = 0; ty < a.ch; ty += 36) { c.beginPath(); c.moveTo(0, ty); c.lineTo(a.cw, ty); c.stroke(); }

    c.textAlign = 'center'; c.textBaseline = 'middle';
    a.bubbles.forEach(function (b) {
      c.save();
      c.fillStyle = b.bad ? 'rgba(255, 130, 120, 0.55)' : b.duck ? 'rgba(255, 232, 130, 0.65)' : 'rgba(255, 255, 255, 0.52)';
      c.strokeStyle = b.bad ? '#c2483c' : b.duck ? '#d48b1c' : '#ffffff';
      c.lineWidth = 2; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath(); c.arc(b.x - b.r * 0.32, b.y - b.r * 0.32, b.r * 0.22, 0, Math.PI * 2); c.fill();
      if (b.bad || b.duck) { c.font = '19px sans-serif'; c.fillText(b.bad ? '🌶️' : '🦆', b.x, b.y + 1); }
      c.restore();
    });

    a.fx.forEach(function (f) {
      c.save(); c.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      c.font = 'bold 13px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#2a1a10';
      c.strokeText(f.text, f.x, f.y); c.fillStyle = f.col; c.fillText(f.text, f.x, f.y);
      c.restore();
    });
    c.restore();
  }

  // ============================================================================================
  // 6. SAFE SNACK INSPECTOR (Fast Safe vs Toxic Dog Food Sorter)
  // ============================================================================================
  var SNACK_ITEMS = [
    { ico: '🍖', name: 'Kibble Bowl',   safe: true,  tip: 'Balanced dog meal' },
    { ico: '🦴', name: 'Dog Biscuit',   safe: true,  tip: 'Crunchy pup treat' },
    { ico: '🥕', name: 'Baby Carrots',  safe: true,  tip: 'Great for teeth!' },
    { ico: '🍎', name: 'Apple Slices',  safe: true,  tip: 'Seedless & crisp' },
    { ico: '🐟', name: 'Cooked Salmon', safe: true,  tip: 'Shiny coat omega-3' },
    { ico: '🎃', name: 'Plain Pumpkin', safe: true,  tip: 'Gentle on tummies' },
    { ico: '🫐', name: 'Blueberries',   safe: true,  tip: 'Pup-safe antioxidants' },
    { ico: '🍗', name: 'Plain Chicken', safe: true,  tip: 'Lean protein snack' },
    { ico: '🍫', name: 'Chocolate Bar', safe: false, tip: 'Toxic to dogs!' },
    { ico: '🍇', name: 'Grapes',        safe: false, tip: 'Harmful to kidneys!' },
    { ico: '🧅', name: 'Red Onion',     safe: false, tip: 'Unsafe for pups!' },
    { ico: '🥑', name: 'Avocado Pit',   safe: false, tip: 'Keep out of bowls!' },
    { ico: '☕', name: 'Espresso Cup',  safe: false, tip: 'No caffeine for dogs!' },
    { ico: '🍬', name: 'Mint Gum',      safe: false, tip: 'Xylitol is toxic!' },
    { ico: '🧄', name: 'Garlic Clove',  safe: false, tip: 'Unsafe for dogs!' },
    { ico: '🧦', name: 'Muddy Sock',    safe: false, tip: 'Definitely not food!' },
  ];

  var SORT_CFG = {
    easy:   { goal: 10, time: 18.0, wrongPen: 2.0, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 30, moodDrop: 10, failRep: -0.08 },
    medium: { goal: 14, time: 18.0, wrongPen: 2.5, cash: 90,  hearts: 5, rep: 0.15, shave: 1500, fine: 55, moodDrop: 16, failRep: -0.14 },
    hard:   { goal: 18, time: 17.0, wrongPen: 3.0, cash: 160, hearts: 8, rep: 0.22, shave: 2700, fine: 90, moodDrop: 22, failRep: -0.22 },
  };

  function startKibbleSort(diff) {
    var cfg = SORT_CFG[diff.id];
    var queue = [];
    while (queue.length < cfg.goal) {
      queue = queue.concat(shuffle(SNACK_ITEMS));
    }
    queue = queue.slice(0, cfg.goal);

    active = {
      kind: 'kibble_sort', diff: diff, cfg: cfg, queue: queue,
      idx: 0, wrong: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🍖 Snack Sort</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
        '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-sort-card" id="mgSortCard">' +
        '<div class="mg-sort-ico" id="mgSortIco"></div>' +
        '<div class="mg-sort-name" id="mgSortName"></div>' +
        '<div class="mg-sort-tip" id="mgSortTip"></div>' +
      '</div>' +
      '<div class="mg-sort-btns">' +
        '<button type="button" id="mgSortSafe" class="mg-sort-btn safe">🍖 Safe for Pups</button>' +
        '<button type="button" id="mgSortTrash" class="mg-sort-btn bad">🚫 Toss in Trash</button>' +
      '</div>' +
      '<p class="mg-sub">Sort ' + cfg.goal + ' snacks! Wrong bin: −' + cfg.wrongPen.toFixed(1) + 's. Fail = vet bill &amp; grumpy pups.</p>',
      'minigame', 'mg-card'
    );

    renderKibbleItem();

    var handleSort = function (chooseSafe) {
      if (!active || active.kind !== 'kibble_sort' || active.finished) return;
      if (typeof initAudio === 'function') initAudio();
      var item = active.queue[active.idx];
      var card = document.getElementById('mgSortCard');
      if (item && item.safe === chooseSafe) {
        playNote(chooseSafe ? 720 : 580, 0.11, 0.20);
        active.idx++;
        var sc = document.getElementById('mgScore');
        if (sc) sc.textContent = active.idx + ' / ' + active.cfg.goal;
        if (active.idx >= active.queue.length) {
          var c = active.cfg;
          finishMinigame(true, {
            headline: 'Kitchen Cleared!',
            detail: 'Sorted all ' + c.goal + ' snacks safely with ' + active.timeLeft.toFixed(1) + 's to spare!',
            cash: c.cash + (active.wrong === 0 ? 15 : 0),
            hearts: c.hearts, rep: c.rep, shave: c.shave, xp: 13 + c.hearts * 2,
            shortTag: 'Safe Kitchen!',
          });
        } else {
          renderKibbleItem();
        }
      } else {
        active.wrong++;
        active.timeLeft = Math.max(0.2, active.timeLeft - active.cfg.wrongPen);
        if (typeof sfx === 'function') sfx('error');
        var tip = document.getElementById('mgSortTip');
        if (tip && item) tip.textContent = '⚠️ ' + item.tip;
        if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
      }
    };

    var bSafe = document.getElementById('mgSortSafe');
    var bTrash = document.getElementById('mgSortTrash');
    if (bSafe) bSafe.onclick = function () { handleSort(true); };
    if (bTrash) bTrash.onclick = function () { handleSort(false); };
  }

  function renderKibbleItem() {
    if (!active || active.kind !== 'kibble_sort') return;
    var item = active.queue[active.idx];
    if (!item) return;
    var ico = document.getElementById('mgSortIco');
    var name = document.getElementById('mgSortName');
    var tip = document.getElementById('mgSortTip');
    if (ico) ico.textContent = item.ico;
    if (name) name.textContent = item.name;
    if (tip) tip.textContent = 'Safe to serve or toss?';
  }

  // ============================================================================================
  // 7. LAWN PEST PATROL (3×3 Whack-a-Mole Garden Defense)
  // ============================================================================================
  var WHACK_CFG = {
    easy:   { goal: 10, stay: 1.25, spawnEvery: 0.68, decoyP: 0.15, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, poops: 1, muddy: 1, failRep: 0 },
    medium: { goal: 15, stay: 0.95, spawnEvery: 0.50, decoyP: 0.25, cash: 90,  hearts: 5, rep: 0.15, shave: 1500, fine: 50, poops: 2, muddy: 1, failRep: -0.08 },
    hard:   { goal: 21, stay: 0.72, spawnEvery: 0.37, decoyP: 0.33, cash: 160, hearts: 8, rep: 0.22, shave: 2700, fine: 80, poops: 3, muddy: 2, failRep: -0.15 },
  };

  function startWhackMole(diff) {
    var cfg = WHACK_CFG[diff.id];
    var holes = [];
    for (var i = 0; i < 9; i++) holes.push({ occupant: null, t: 0, hit: false });

    active = {
      kind: 'whack_mole', diff: diff, cfg: cfg, holes: holes,
      score: 0, goal: cfg.goal, timeLeft: 15.0, maxTime: 15.0,
      spawnT: 0.12, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🐿️ Lawn Patrol</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
        '<span class="mg-timer" id="mgTimer">15.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-mole-grid" id="mgMoleGrid">' +
        holes.map(function (_, idx) {
          return '<button type="button" class="mg-mole-hole" data-mh="' + idx + '"><span class="mh-pop"></span></button>';
        }).join('') +
      '</div>' +
      '<p class="mg-sub">Shoo ' + cfg.goal + '+ garden pests (🐿️🦡 &amp; 🦝=+2)! Don\'t bonk peeking 🐶 pups (−2)! Fail = lawn repair &amp; mud.</p>',
      'minigame', 'mg-card'
    );

    var grid = document.getElementById('mgMoleGrid');
    if (grid) {
      grid.querySelectorAll('[data-mh]').forEach(function (btn) {
        btn.addEventListener('pointerdown', function () {
          if (!active || active.kind !== 'whack_mole' || active.finished) return;
          if (typeof initAudio === 'function') initAudio();
          var hi = +btn.getAttribute('data-mh');
          var h = active.holes[hi];
          if (!h || !h.occupant || h.hit) return;
          h.hit = true;
          var pts = h.occupant.pts;
          active.score = Math.max(0, active.score + pts);
          if (pts < 0) {
            if (typeof sfx === 'function') sfx('error');
            btn.classList.add('bad-hit');
          } else {
            playNote(pts > 1 ? 860 : 620, 0.09, 0.20);
            btn.classList.add('good-hit');
          }
          h.t = Math.min(h.t, 0.16);
          var sc = document.getElementById('mgScore');
          if (sc) sc.textContent = active.score + ' / ' + active.goal;
          renderWhackGrid();
        });
      });
    }
    renderWhackGrid();
  }

  function updateWhackMole(dt) {
    var a = active, cfg = a.cfg, dirty = false;
    for (var i = 0; i < a.holes.length; i++) {
      var h = a.holes[i];
      if (h.occupant) {
        h.t -= dt;
        if (h.t <= 0) { h.occupant = null; h.hit = false; dirty = true; }
      }
    }
    a.spawnT -= dt;
    if (a.spawnT <= 0) {
      a.spawnT = cfg.spawnEvery * randRange(0.78, 1.18);
      var empties = [];
      for (var ei = 0; ei < a.holes.length; ei++) if (!a.holes[ei].occupant) empties.push(ei);
      if (empties.length) {
        var idx = pickOne(empties);
        var r = Math.random();
        var occ = r < cfg.decoyP ? { ico: '🐶', pts: -2, decoy: true }
          : r < cfg.decoyP + 0.16 ? { ico: '🦝', pts: 2, bonus: true }
          : { ico: pickOne(['🐿️', '🦡']), pts: 1 };
        a.holes[idx].occupant = occ;
        a.holes[idx].t = cfg.stay * (occ.bonus ? 0.85 : randRange(0.88, 1.12));
        a.holes[idx].hit = false;
        dirty = true;
      }
    }
    if (dirty) renderWhackGrid();
  }

  function renderWhackGrid() {
    if (!active || active.kind !== 'whack_mole') return;
    var grid = document.getElementById('mgMoleGrid');
    if (!grid) return;
    grid.querySelectorAll('[data-mh]').forEach(function (btn) {
      var h = active.holes[+btn.getAttribute('data-mh')];
      var pop = btn.querySelector('.mh-pop');
      if (!h.occupant) {
        btn.classList.remove('up', 'decoy', 'bonus', 'good-hit', 'bad-hit');
        if (pop) pop.textContent = '';
      } else {
        btn.classList.add('up');
        btn.classList.toggle('decoy', !!h.occupant.decoy);
        btn.classList.toggle('bonus', !!h.occupant.bonus);
        if (pop) pop.textContent = h.hit ? (h.occupant.pts < 0 ? '😢' : '💨') : h.occupant.ico;
      }
    });
  }

  // ============================================================================================
  // 8. CUBBY PAIR MATCH (Timed Breed Portrait Memory Cards)
  // ============================================================================================
  var PAIR_CFG = {
    easy:   { cols: 3, pairs: 3, time: 16.0, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, failRep: -0.10, loseHearts: 1 },
    medium: { cols: 4, pairs: 6, time: 26.0, cash: 95,  hearts: 5, rep: 0.16, shave: 1800, fine: 45, failRep: -0.18, loseHearts: 2 },
    hard:   { cols: 4, pairs: 8, time: 34.0, cash: 170, hearts: 9, rep: 0.24, shave: 3000, fine: 80, failRep: -0.26, loseHearts: 3 },
  };

  function startPairMatch(diff) {
    var cfg = PAIR_CFG[diff.id];
    var allBreeds = (typeof BREEDS !== 'undefined' && BREEDS.length) ? BREEDS : [
      { id: 'golden', name: 'Golden', coats: [{}] }, { id: 'corgi', name: 'Corgi', coats: [{}] },
      { id: 'husky', name: 'Husky', coats: [{}] }, { id: 'pug', name: 'Pug', coats: [{}] },
      { id: 'beagle', name: 'Beagle', coats: [{}] }, { id: 'poodle', name: 'Poodle', coats: [{}] },
      { id: 'shiba', name: 'Shiba', coats: [{}] }, { id: 'dalmatian', name: 'Dalmatian', coats: [{}] },
    ];
    var emojis = ['🐶', '🐕', '🦮', '🐩', '🐾', '🦴', '🧸', '🎀'];
    var picked = shuffle(allBreeds).slice(0, cfg.pairs);
    var deck = [];
    picked.forEach(function (b, idx) {
      var coat = (b.coats && b.coats.length) ? randInt(0, b.coats.length - 1) : 0;
      var img = typeof dogPortraitURL === 'function' ? dogPortraitURL(b.id, coat, 84, { bg: 'badge', mood: 'happy', seed: idx + 11 }) : '';
      var base = { pairId: idx, img: img, emoji: emojis[idx % emojis.length], label: b.name || 'Pup' };
      deck.push(Object.assign({ flipped: false, matched: false }, base));
      deck.push(Object.assign({ flipped: false, matched: false }, base));
    });
    deck = shuffle(deck);

    active = {
      kind: 'pair_match', diff: diff, cfg: cfg, deck: deck,
      open: [], mismatchT: 0, matchedPairs: 0,
      timeLeft: cfg.time, maxTime: cfg.time, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🃏 Cubby Match</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.pairs + '</span>' +
        '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-pair-grid cols-' + cfg.cols + (cfg.pairs >= 8 ? ' compact' : '') + '" id="mgPairGrid"></div>' +
      '<p class="mg-sub">Flip cards to match all ' + cfg.pairs + ' puppy cubby pairs! Fail = refund &amp; ★ drop.</p>',
      'minigame', 'mg-card'
    );

    renderPairGrid();
  }

  function renderPairGrid() {
    if (!active || active.kind !== 'pair_match') return;
    var grid = document.getElementById('mgPairGrid');
    if (!grid) return;
    grid.innerHTML = active.deck.map(function (c, idx) {
      var show = c.flipped || c.matched;
      var face = show
        ? (c.img ? '<img src="' + c.img + '" alt="">' : '<span class="mg-pair-em">' + c.emoji + '</span>')
        : '<span class="mg-pair-back">🐾</span>';
      return '<button type="button" class="mg-pair-card' + (show ? ' open' : '') + (c.matched ? ' matched' : '') + '" data-pi="' + idx + '">' + face + '</button>';
    }).join('');

    grid.querySelectorAll('[data-pi]').forEach(function (btn) {
      btn.onclick = function () {
        if (!active || active.kind !== 'pair_match' || active.finished) return;
        if (typeof initAudio === 'function') initAudio();
        // If two mismatched cards are waiting to flip back, close them right away so fast tapping stays snappy!
        if (active.mismatchT > 0 && active.open.length === 2) {
          active.deck[active.open[0]].flipped = false;
          active.deck[active.open[1]].flipped = false;
          active.open = [];
          active.mismatchT = 0;
        }
        var idx = +btn.getAttribute('data-pi');
        var card = active.deck[idx];
        if (!card || card.flipped || card.matched) return;
        card.flipped = true;
        active.open.push(idx);
        playNote(520 + active.open.length * 90, 0.08, 0.16);

        if (active.open.length === 2) {
          var a = active.deck[active.open[0]], b = active.deck[active.open[1]];
          if (a.pairId === b.pairId) {
            a.matched = b.matched = true;
            active.open = [];
            active.matchedPairs++;
            playNote(760 + active.matchedPairs * 35, 0.14, 0.22);
            var sc = document.getElementById('mgScore');
            if (sc) sc.textContent = active.matchedPairs + ' / ' + active.cfg.pairs;
            renderPairGrid();
            if (active.matchedPairs >= active.cfg.pairs) {
              var c = active.cfg;
              setTimeout(function () {
                finishMinigame(true, {
                  headline: 'Cubbies Organized!',
                  detail: 'Matched all ' + c.pairs + ' puppy pairs with ' + active.timeLeft.toFixed(1) + 's left!',
                  cash: c.cash, hearts: c.hearts, rep: c.rep, shave: c.shave, xp: 14 + c.hearts * 2,
                  shortTag: 'Pair Match!',
                });
              }, 180);
            }
            return;
          } else {
            active.mismatchT = 0.55;
            if (typeof sfx === 'function') sfx('error');
          }
        }
        renderPairGrid();
      };
    });
  }

  function updatePairMatch(dt) {
    var a = active;
    if (a.mismatchT > 0) {
      a.mismatchT -= dt;
      if (a.mismatchT <= 0 && a.open.length === 2) {
        a.deck[a.open[0]].flipped = false;
        a.deck[a.open[1]].flipped = false;
        a.open = [];
        renderPairGrid();
      }
    }
  }

  // ============================================================================================
  // 9. SHOW-DOG SALON TRIM (Precision Sweeping Needle Gauge)
  // ============================================================================================
  var GROOM_CFG = {
    easy:   { goal: 4, time: 18.0, zoneW: 0.28, spd: 0.85, missPen: 1.5, cash: 55,  hearts: 3, rep: 0.11, shave: 900,  fine: 25, failRep: -0.12, loseHearts: 0 },
    medium: { goal: 5, time: 18.0, zoneW: 0.19, spd: 1.22, missPen: 2.0, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 50, failRep: -0.22, loseHearts: 1 },
    hard:   { goal: 6, time: 18.0, zoneW: 0.12, spd: 1.62, missPen: 2.5, cash: 165, hearts: 9, rep: 0.24, shave: 2700, fine: 85, failRep: -0.32, loseHearts: 2 },
  };

  function placeGroomZone(a) {
    var w = a.cfg.zoneW;
    a.zoneStart = randRange(0.08, 0.92 - w);
    a.zoneEnd = a.zoneStart + w;
  }

  function startGroomTiming(diff) {
    var cfg = GROOM_CFG[diff.id];
    var allBreeds = (typeof BREEDS !== 'undefined' && BREEDS.length) ? BREEDS : [{ id: 'poodle', name: 'Poodle', coats: [{}] }];
    var b = pickOne(allBreeds);
    var coat = (b.coats && b.coats.length) ? randInt(0, b.coats.length - 1) : 0;
    var img = typeof dogPortraitURL === 'function' ? dogPortraitURL(b.id, coat, 108, { bg: 'badge', mood: 'excited', seed: randInt(1, 999) }) : '';

    active = {
      kind: 'groom_timing', diff: diff, cfg: cfg,
      breedName: b.name || 'Show Pup', img: img,
      snips: 0, goal: cfg.goal, misses: 0,
      pos: 0.05, dir: 1, zoneStart: 0.35, zoneEnd: 0.35 + cfg.zoneW,
      feedback: 'Tap SNIP when the marker enters the green zone!',
      timeLeft: cfg.time, maxTime: cfg.time, finished: false,
    };
    placeGroomZone(active);

    openModal(
      '<div class="mg-head">' +
        '<span>✂️ Salon Trim</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
        '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-groom-stage" id="mgGroomStage">' +
        (img ? '<img src="' + img + '" alt="">' : '<div class="mg-groom-fb">🐩</div>') +
        '<div class="mg-groom-name">VIP ' + esc(active.breedName) + '</div>' +
        '<div class="mg-groom-msg" id="mgGroomMsg">' + esc(active.feedback) + '</div>' +
      '</div>' +
      '<div class="mg-gauge" id="mgGauge">' +
        '<div class="mg-gauge-zone" id="mgGaugeZone"></div>' +
        '<div class="mg-gauge-needle" id="mgGaugeNeedle"></div>' +
      '</div>' +
      '<button type="button" id="mgSnipBtn" class="primary big mg-snip-btn">✂️ SNIP!</button>' +
      '<p class="mg-sub">Land ' + cfg.goal + ' clean snips! Miss: −' + cfg.missPen.toFixed(1) + 's. Fail = refund &amp; bad salon review.</p>',
      'minigame', 'mg-card'
    );

    renderGroomGauge();

    var btn = document.getElementById('mgSnipBtn');
    if (btn) {
      btn.addEventListener('pointerdown', function () {
        if (!active || active.kind !== 'groom_timing' || active.finished) return;
        if (typeof initAudio === 'function') initAudio();
        var hit = active.pos >= active.zoneStart - 0.015 && active.pos <= active.zoneEnd + 0.015;
        var msg = document.getElementById('mgGroomMsg');
        var stage = document.getElementById('mgGroomStage');
        if (hit) {
          active.snips++;
          playNote(680 + active.snips * 70, 0.14, 0.24);
          var sc = document.getElementById('mgScore');
          if (sc) sc.textContent = active.snips + ' / ' + active.goal;
          if (msg) msg.textContent = '✨ Clean trim! (' + active.snips + '/' + active.goal + ')';
          if (active.snips >= active.goal) {
            var c = active.cfg;
            finishMinigame(true, {
              headline: 'Best in Show!',
              detail: 'Gave the VIP ' + active.breedName + ' a flawless salon cut with ' + active.timeLeft.toFixed(1) + 's left!',
              cash: c.cash + (active.misses === 0 ? 15 : 0),
              hearts: c.hearts, rep: c.rep, shave: c.shave, xp: 14 + c.hearts * 2,
              shortTag: 'Salon Trim!',
            });
          } else {
            placeGroomZone(active);
            renderGroomGauge();
          }
        } else {
          active.misses++;
          active.timeLeft = Math.max(0.2, active.timeLeft - active.cfg.missPen);
          if (typeof sfx === 'function') sfx('error');
          if (msg) msg.textContent = '😬 Snagged a tuft! −' + active.cfg.missPen.toFixed(1) + 's';
          if (stage) { stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
        }
      });
    }
  }

  function updateGroomTiming(dt) {
    var a = active;
    var jitter = a.diff.id === 'hard' ? (1 + Math.sin(a.timeLeft * 5.2) * 0.18) : 1;
    a.pos += a.dir * a.cfg.spd * jitter * dt;
    if (a.pos >= 0.98) { a.pos = 0.98; a.dir = -1; }
    else if (a.pos <= 0.02) { a.pos = 0.02; a.dir = 1; }
    renderGroomGauge();
  }

  function renderGroomGauge() {
    if (!active || active.kind !== 'groom_timing') return;
    var z = document.getElementById('mgGaugeZone');
    var n = document.getElementById('mgGaugeNeedle');
    if (z) {
      z.style.left = (active.zoneStart * 100).toFixed(1) + '%';
      z.style.width = ((active.zoneEnd - active.zoneStart) * 100).toFixed(1) + '%';
    }
    if (n) {
      n.style.left = (active.pos * 100).toFixed(1) + '%';
    }
  }

  // ============================================================================================
  // 10. PAW-PHONE BOOKING RUSH (Fast Care-Kit Order Packing)
  // ============================================================================================
  var CARE_KIT_ITEMS = [
    { id: 'food',    ico: '🍖', name: 'Kibble' },
    { id: 'treat',   ico: '🍪', name: 'Treat' },
    { id: 'ball',    ico: '🎾', name: 'Ball' },
    { id: 'soap',    ico: '🛁', name: 'Shampoo' },
    { id: 'brush',   ico: '🪮', name: 'Brush' },
    { id: 'blanket', ico: '🛏️', name: 'Blanket' },
  ];

  var ORDER_CFG = {
    easy:   { orders: 3, itemsPer: 2, time: 18.0, wrongPen: 1.5, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, failRep: -0.10, patienceDrop: 0.20, loseHearts: 0 },
    medium: { orders: 4, itemsPer: 3, time: 22.0, wrongPen: 2.0, cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 50, failRep: -0.18, patienceDrop: 0.30, loseHearts: 1 },
    hard:   { orders: 5, itemsPer: 4, time: 24.0, wrongPen: 2.5, cash: 165, hearts: 8, rep: 0.22, shave: 2700, fine: 85, failRep: -0.26, patienceDrop: 0.40, loseHearts: 2 },
  };

  function makeOrderTickets(count, itemsPer) {
    var callers = ['Bella\'s Mom', 'Max\'s Dad', 'Luna\'s Owner', 'Charlie\'s Family', 'Milo\'s Dad', 'Daisy\'s Mom'];
    var out = [];
    for (var i = 0; i < count; i++) {
      var list = shuffle(CARE_KIT_ITEMS).slice(0, itemsPer);
      out.push({ caller: callers[i % callers.length], items: list });
    }
    return out;
  }

  function startOrderRush(diff) {
    var cfg = ORDER_CFG[diff.id];
    var tickets = makeOrderTickets(cfg.orders, cfg.itemsPer);
    active = {
      kind: 'order_rush', diff: diff, cfg: cfg, tickets: tickets,
      tIdx: 0, stepIdx: 0, wrong: 0,
      timeLeft: cfg.time, maxTime: cfg.time, finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>📞 Booking Rush</span>' +
        diffPillHtml(diff) +
        '<span class="mg-score" id="mgScore">0 / ' + cfg.orders + '</span>' +
        '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-order-box" id="mgOrderBox">' +
        '<div class="mg-order-who" id="mgOrderWho"></div>' +
        '<div class="mg-order-seq" id="mgOrderSeq"></div>' +
      '</div>' +
      '<div class="mg-order-grid" id="mgOrderGrid">' +
        CARE_KIT_ITEMS.map(function (it) {
          return '<button type="button" class="wood mg-kit-btn" data-kit="' + it.id + '"><span>' + it.ico + '</span><b>' + it.name + '</b></button>';
        }).join('') +
      '</div>' +
      '<p class="mg-sub">Tap each requested care item in order! Wrong tap: −' + cfg.wrongPen.toFixed(1) + 's. Fail = lost bookings &amp; impatient queue.</p>',
      'minigame', 'mg-card'
    );

    renderOrderTicket();

    var grid = document.getElementById('mgOrderGrid');
    if (grid) {
      grid.querySelectorAll('[data-kit]').forEach(function (btn) {
        btn.onclick = function () {
          if (!active || active.kind !== 'order_rush' || active.finished) return;
          if (typeof initAudio === 'function') initAudio();
          var kitId = btn.getAttribute('data-kit');
          var ticket = active.tickets[active.tIdx];
          var want = ticket && ticket.items[active.stepIdx];
          if (want && want.id === kitId) {
            playNote(620 + active.stepIdx * 85, 0.11, 0.20);
            active.stepIdx++;
            if (active.stepIdx >= ticket.items.length) {
              active.tIdx++;
              active.stepIdx = 0;
              var sc = document.getElementById('mgScore');
              if (sc) sc.textContent = active.tIdx + ' / ' + active.cfg.orders;
              if (active.tIdx >= active.tickets.length) {
                var c = active.cfg;
                finishMinigame(true, {
                  headline: 'Front Desk Pro!',
                  detail: 'Packed all ' + c.orders + ' VIP welcome kits with ' + active.timeLeft.toFixed(1) + 's left!',
                  cash: c.cash + (active.wrong === 0 ? 15 : 0),
                  hearts: c.hearts, rep: c.rep, shave: c.shave, xp: 14 + c.hearts * 2,
                  shortTag: 'Booking Pro!',
                });
                return;
              }
            }
            renderOrderTicket();
          } else {
            active.wrong++;
            active.timeLeft = Math.max(0.2, active.timeLeft - active.cfg.wrongPen);
            if (typeof sfx === 'function') sfx('error');
            var box = document.getElementById('mgOrderBox');
            if (box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
          }
        };
      });
    }
  }

  function renderOrderTicket() {
    if (!active || active.kind !== 'order_rush') return;
    var ticket = active.tickets[active.tIdx];
    if (!ticket) return;
    var who = document.getElementById('mgOrderWho');
    var seq = document.getElementById('mgOrderSeq');
    if (who) who.textContent = '📞 ' + ticket.caller + ' (Order ' + (active.tIdx + 1) + '/' + active.tickets.length + ')';
    if (seq) {
      seq.innerHTML = ticket.items.map(function (it, idx) {
        var cls = idx < active.stepIdx ? 'done' : idx === active.stepIdx ? 'now' : '';
        return '<div class="mg-order-chip ' + cls + '"><span>' + it.ico + '</span><small>' + it.name + '</small></div>';
      }).join('<span class="mg-order-arr">→</span>');
    }
  }

  // ---------------- Launcher & Per-Frame Tick ----------------
  function launch(kind, forcedDiffId) {
    if (active) return false;
    pending = null;
    hideBanner();
    var k = kind && KIND_META[kind] ? kind : pickNextKind();
    var diff = rollDifficulty(forcedDiffId);
    rememberKind(k);

    if (k === 'audit') startAudit(diff);
    else if (k === 'find_dog') startFindDog(diff);
    else if (k === 'treat_catch') startTreatCatch(diff);
    else if (k === 'trick_memory') startTrickMemory(diff);
    else if (k === 'bubble_pop') startBubblePop(diff);
    else if (k === 'kibble_sort') startKibbleSort(diff);
    else if (k === 'whack_mole') startWhackMole(diff);
    else if (k === 'pair_match') startPairMatch(diff);
    else if (k === 'groom_timing') startGroomTiming(diff);
    else startOrderRush(diff);
    return true;
  }

  function updateTimerBar() {
    if (!active) return;
    var tEl = document.getElementById('mgTimer');
    var fEl = document.getElementById('mgTbarFill');
    if (tEl) {
      tEl.textContent = Math.max(0, active.timeLeft).toFixed(1) + 's';
      tEl.classList.toggle('low', active.timeLeft <= 4.0);
    }
    if (fEl) {
      var pct = Math.max(0, Math.min(100, (active.timeLeft / active.maxTime) * 100));
      fEl.style.width = pct.toFixed(1) + '%';
      fEl.classList.toggle('low', active.timeLeft <= 4.0);
    }
  }

  function tick(dt) {
    // 1. Active minigame modal loop (runs while daycare world is paused in UI.mode === 'minigame')
    if (active) {
      if (active.finished) return;
      if (typeof UI !== 'undefined' && UI.mode !== 'minigame') {
        active = null;
        return;
      }

      if (active.kind === 'trick_memory') {
        updateTrickMemory(dt);
        if (active.phase === 'input') {
          active.timeLeft -= dt;
          updateTimerBar();
          if (active.timeLeft <= 0) {
            var tc = active.cfg;
            finishMinigame(false, {
              headline: 'Audition Timed Out!',
              detail: 'The Talent Scout walked out mid-routine and panned the show!',
              fine: tc.fine, fineLabel: 'Entry Fee',
              rep: tc.failRep, loseHearts: tc.loseHearts,
              failRepMsg: '🎵 Talent Scout audition timed out!',
            });
          }
        }
        return;
      }

      active.timeLeft -= dt;
      updateTimerBar();

      if (active.kind === 'find_dog') {
        var fxMoved = false;
        for (var i = active.fx.length - 1; i >= 0; i--) {
          active.fx[i].y -= 20 * dt;
          active.fx[i].life -= dt;
          fxMoved = true;
          if (active.fx[i].life <= 0) active.fx.splice(i, 1);
        }
        if (fxMoved) drawFindPhoto();
        if (active.timeLeft <= 0) {
          var fc = active.cfg;
          finishMinigame(false, {
            headline: 'Photo Check Missed!',
            detail: 'Only spotted ' + active.foundCount + ' / ' + active.targets.length + ' pups — upset owners demanded a refund!',
            fine: fc.fine, fineLabel: 'Refund',
            rep: fc.failRep, loseHearts: fc.loseHearts,
            failRepMsg: '📸 Mixed-up daycare report photo!',
          });
        }
      } else if (active.kind === 'audit') {
        if (active.timeLeft <= 0) {
          var ac = active.cfg;
          finishMinigame(false, {
            headline: 'Audit Failed!',
            detail: 'Completed ' + active.idx + ' / ' + active.questions.length + ' checks on the ' + active.diff.label + ' audit — tax penalty issued!',
            fine: ac.fine, fineLabel: 'Tax Fine',
            rep: ac.failRep, loseHearts: ac.loseHearts,
            failRepMsg: '📊 Company accounts audit failed!',
          });
        }
      } else if (active.kind === 'treat_catch') {
        updateTreatCatch(dt);
        if (active.timeLeft <= 0) {
          var trc = active.cfg;
          if (active.score >= active.goal) {
            var extra = Math.max(0, active.score - active.goal) * 3;
            finishMinigame(true, {
              headline: 'Snack Delivery Saved!',
              detail: 'Caught ' + active.score + ' gourmet treats before they hit the floor!',
              cash: trc.cash + extra, hearts: trc.hearts + active.bonusHearts,
              rep: trc.rep, shave: trc.shave, xp: 14 + trc.hearts * 2, shortTag: 'Treat Rush!',
            });
          } else {
            finishMinigame(false, {
              headline: 'Treat Spill Disaster!',
              detail: 'Caught ' + active.score + ' / ' + active.goal + ' treats — wasted stock & messy yard tummies!',
              fine: trc.fine, fineLabel: 'Restock',
              spawnPoops: trc.poops, moodDrop: trc.moodDrop, rep: trc.failRep,
              failRepMsg: '🍪 Spilled treat delivery ruined snack time!',
            });
          }
        }
      } else if (active.kind === 'bubble_pop') {
        updateBubblePop(dt);
        if (active.timeLeft <= 0) {
          var bc = active.cfg;
          if (active.score >= active.goal) {
            var bExtra = Math.max(0, active.score - active.goal) * 2;
            finishMinigame(true, {
              headline: 'Grooming Room Rescued!',
              detail: 'Popped ' + active.score + ' soap bubbles & duckies in time!',
              cash: bc.cash + bExtra, hearts: bc.hearts,
              rep: bc.rep, shave: bc.shave, xp: 14 + bc.hearts * 2, shortTag: 'Bubble Blitz!',
            });
          } else {
            finishMinigame(false, {
              headline: 'Tub Overflowed!',
              detail: 'Popped ' + active.score + ' / ' + active.goal + ' bubbles — sudsy water flooded the yard & got pups muddy!',
              fine: bc.fine, fineLabel: 'Cleanup',
              muddyDogs: bc.muddy, rep: bc.failRep,
              failRepMsg: '🛁 Grooming tub overflowed into the yard!',
            });
          }
        }
      } else if (active.kind === 'kibble_sort') {
        if (active.timeLeft <= 0) {
          var sc = active.cfg;
          finishMinigame(false, {
            headline: 'Spoiled Snack Mix-Up!',
            detail: 'Only sorted ' + active.idx + ' / ' + sc.goal + ' items — vet check & spoiled food cost you!',
            fine: sc.fine, fineLabel: 'Vet Bill',
            moodDrop: sc.moodDrop, rep: sc.failRep,
            failRepMsg: '🍖 Bad snacks slipped into lunch!',
          });
        }
      } else if (active.kind === 'whack_mole') {
        updateWhackMole(dt);
        if (active.timeLeft <= 0) {
          var wc = active.cfg;
          if (active.score >= active.goal) {
            var wExtra = Math.max(0, active.score - active.goal) * 3;
            finishMinigame(true, {
              headline: 'Lawn Protected!',
              detail: 'Shooed ' + active.score + ' mischievous garden pests away from the yard!',
              cash: wc.cash + wExtra, hearts: wc.hearts,
              rep: wc.rep, shave: wc.shave, xp: 14 + wc.hearts * 2, shortTag: 'Lawn Patrol!',
            });
          } else {
            finishMinigame(false, {
              headline: 'Gophers Wrecked the Lawn!',
              detail: 'Scored ' + active.score + ' / ' + active.goal + ' — pests dug holes and got pups muddy!',
              fine: wc.fine, fineLabel: 'Lawn Repair',
              spawnPoops: wc.poops, muddyDogs: wc.muddy, rep: wc.failRep,
              failRepMsg: '🐿️ Gophers tore up the daycare lawn!',
            });
          }
        }
      } else if (active.kind === 'pair_match') {
        updatePairMatch(dt);
        if (active.timeLeft <= 0) {
          var pc = active.cfg;
          finishMinigame(false, {
            headline: 'Cubby Mix-Up!',
            detail: 'Matched ' + active.matchedPairs + ' / ' + pc.pairs + ' pairs — owners were unhappy with scrambled cubbies!',
            fine: pc.fine, fineLabel: 'Refund',
            rep: pc.failRep, loseHearts: pc.loseHearts,
            failRepMsg: '🃏 Scrambled daycare cubbies upset owners!',
          });
        }
      } else if (active.kind === 'groom_timing') {
        updateGroomTiming(dt);
        if (active.timeLeft <= 0) {
          var gc = active.cfg;
          finishMinigame(false, {
            headline: 'Bad Haircut!',
            detail: 'Landed ' + active.snips + ' / ' + gc.goal + ' trims — the VIP ' + active.breedName + '\'s owner demanded a refund & left a bad review!',
            fine: gc.fine, fineLabel: 'Salon Refund',
            rep: gc.failRep, loseHearts: gc.loseHearts,
            failRepMsg: '✂️ Crooked show-dog trim hurt your star rating!',
          });
        }
      } else if (active.kind === 'order_rush') {
        if (active.timeLeft <= 0) {
          var oc = active.cfg;
          finishMinigame(false, {
            headline: 'Missed Phone Bookings!',
            detail: 'Packed ' + active.tIdx + ' / ' + oc.orders + ' kits — missed callers & the front queue grew impatient!',
            fine: oc.fine, fineLabel: 'Lost Booking',
            rep: oc.failRep, patienceDrop: oc.patienceDrop, loseHearts: oc.loseHearts,
            failRepMsg: '📞 Missed bookings backed up the front desk!',
          });
        }
      }
      return;
    }

    // 2. Only roll / count down during active post-tutorial play
    if (typeof S === 'undefined' || !S || !S.tutorialDone || (typeof UI !== 'undefined' && (UI.inTitle || UI.mode !== 'play'))) {
      if (pending && typeof S !== 'undefined' && S && S.closing) {
        pending = null;
        hideBanner();
      }
      return;
    }
    if (S.closing) {
      if (pending) { pending = null; hideBanner(); }
      return;
    }

    // 3. Active 5..4..3..2..1 countdown warning
    if (pending) {
      pending.timeLeft -= dt;
      var curSec = Math.max(0, Math.ceil(pending.timeLeft));
      if (curSec !== pending.lastSec && curSec > 0) {
        pending.lastSec = curSec;
        renderBanner();
        playNote(curSec === 1 ? 880 : 520 + (5 - curSec) * 45, 0.09, 0.16);
      }
      if (pending.timeLeft <= 0) {
        var k2 = pending.kind, d2 = pending.diff;
        pending = null;
        hideBanner();
        launch(k2, d2 ? d2.id : null);
      }
      return;
    }

    // 4. Every 10 seconds during active play, 20% chance to trigger a random minigame!
    if (!S.repEvent) {
      rollTimer -= dt;
      while (rollTimer <= 0) {
        rollTimer += ROLL_INTERVAL;
        if (Math.random() < ROLL_CHANCE) {
          startCountdown();
          break;
        }
      }
    }
  }

  function reset() {
    pending = null;
    active = null;
    hideBanner();
    rollTimer = ROLL_INTERVAL;
  }

  return {
    tick: tick,
    reset: reset,
    startCountdown: startCountdown,
    launch: launch,
    rollDifficulty: rollDifficulty,
    generateMathQuestion: generateMathQuestion,
    buildAuditQuestions: buildAuditQuestions,
    DIFFICULTIES: DIFFICULTIES,
    ALL_KINDS: ALL_KINDS,
    ROLL_INTERVAL: ROLL_INTERVAL,
    ROLL_CHANCE: ROLL_CHANCE,
    get isActive() { return !!active; },
    get isPending() { return !!pending; },
    get activeKind() { return active ? active.kind : null; },
    get activeDiff() { return active && active.diff ? active.diff.id : null; },
    get rollTimer() { return rollTimer; },
  };
})();
