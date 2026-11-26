'use strict';
/* ============================================================================================
   minigames_extra.js — 20 Additional Portrait Mini-Games for Paws & Play (Total: 30 Games!)
   Registers cleanly into MINIGAMES.register(...) — every game supports Easy / Medium / Hard
   adaptive difficulty scaling and game-adapted failure consequences.
   ============================================================================================ */
(function () {
  if (typeof MINIGAMES === 'undefined' || typeof MINIGAMES.register !== 'function') return;

  function safeBreeds() {
    if (typeof BREEDS !== 'undefined' && BREEDS.length >= 6) return BREEDS;
    return [
      { id: 'golden', name: 'Golden Retriever', coats: [{ name: 'Golden' }, { name: 'Cream' }] },
      { id: 'corgi', name: 'Welsh Corgi', coats: [{ name: 'Red' }, { name: 'Tri' }] },
      { id: 'husky', name: 'Siberian Husky', coats: [{ name: 'Grey' }, { name: 'Black' }] },
      { id: 'pug', name: 'Pug', coats: [{ name: 'Fawn' }, { name: 'Black' }] },
      { id: 'beagle', name: 'Beagle', coats: [{ name: 'Tri' }, { name: 'Lemon' }] },
      { id: 'poodle', name: 'Poodle', coats: [{ name: 'Apricot' }, { name: 'White' }] },
      { id: 'shiba', name: 'Shiba Inu', coats: [{ name: 'Red' }, { name: 'Black' }] },
      { id: 'dalmatian', name: 'Dalmatian', coats: [{ name: 'Spotted' }] },
    ];
  }

  function shakeEl(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  }

  function portraitImg(breedId, coat, size, seed) {
    if (typeof dogPortraitURL === 'function') {
      try { return dogPortraitURL(breedId, coat || 0, size || 96, { bg: 'badge', mood: 'happy', seed: seed || 17 }); }
      catch (e) {}
    }
    return '';
  }

  // ============================================================================================
  // 11. BREED FLASH QUIZ (Portrait Breed Recognition Trivia)
  // ============================================================================================
  var BREED_QUIZ_CFG = {
    easy:   { goal: 4, time: 22, pen: 1.5, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, failRep: -0.10, loseHearts: 1 },
    medium: { goal: 6, time: 24, pen: 2.0, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 45, failRep: -0.18, loseHearts: 2 },
    hard:   { goal: 8, time: 24, pen: 2.5, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 80, failRep: -0.26, loseHearts: 3 },
  };

  MINIGAMES.register('breed_quiz', {
    icon: '📖',
    title: 'Breed Flash Quiz',
    warn: 'Breed inspector pop quiz in {s}…',
    start: function (diff, api) {
      var cfg = BREED_QUIZ_CFG[diff.id], list = safeBreeds();
      var targets = api.shuffle(list).slice(0, Math.min(cfg.goal, list.length));
      while (targets.length < cfg.goal) targets.push(api.pickOne(list));
      var qs = targets.map(function (b) {
        var coat = (b.coats && b.coats.length) ? api.randInt(0, b.coats.length - 1) : 0;
        var wrongs = api.shuffle(list.filter(function (x) { return x.id !== b.id; })).slice(0, 3);
        var opts = api.shuffle([b].concat(wrongs)).map(function (x) { return { name: x.name, correct: x.id === b.id }; });
        return { breed: b, coat: coat, img: portraitImg(b.id, coat, 108, api.randInt(1, 999)), opts: opts };
      });
      var a = { kind: 'breed_quiz', diff: diff, cfg: cfg, qs: qs, idx: 0, wrong: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>📖 Breed Quiz</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-quiz-box" id="mgQuizBox"></div>' +
        '<div class="mg-choices mg-choices-sm" id="mgChoices"></div>' +
        '<p class="mg-sub">Name all ' + cfg.goal + ' dog breeds! Wrong tap: −' + cfg.pen.toFixed(1) + 's. Fail = refund &amp; ★ loss.</p>',
        'minigame', 'mg-card'
      );
      function renderQ() {
        var cur = api.getActive();
        if (!cur || cur.kind !== 'breed_quiz' || cur.finished) return;
        var q = cur.qs[cur.idx];
        var box = document.getElementById('mgQuizBox');
        if (box) box.innerHTML = (q.img ? '<img src="' + q.img + '" alt="">' : '<div class="mg-groom-fb">🐶</div>') + '<div class="mg-quiz-cap">Who\'s this good pup?</div>';
        var ch = document.getElementById('mgChoices');
        if (ch) {
          ch.innerHTML = q.opts.map(function (o, i) { return '<button type="button" class="wood mg-ch-btn sm" data-qi="' + i + '">' + esc(o.name) + '</button>'; }).join('');
          ch.querySelectorAll('[data-qi]').forEach(function (btn) {
            btn.onclick = function () {
              if (!cur || cur.finished) return;
              if (typeof initAudio === 'function') initAudio();
              var opt = q.opts[+btn.getAttribute('data-qi')];
              if (opt && opt.correct) {
                btn.classList.add('right');
                api.playNote(640 + cur.idx * 55, 0.12, 0.2);
                cur.idx++;
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = cur.idx + ' / ' + cur.cfg.goal;
                if (cur.idx >= cur.qs.length) {
                  api.finish(true, {
                    headline: 'Breed Encyclopedia!',
                    detail: 'Identified all ' + cur.cfg.goal + ' breeds with ' + cur.timeLeft.toFixed(1) + 's left!',
                    cash: cur.cfg.cash + (cur.wrong === 0 ? 15 : 0), hearts: cur.cfg.hearts, rep: cur.cfg.rep, shave: cur.cfg.shave,
                    xp: 14 + cur.cfg.hearts * 2, shortTag: 'Breed Quiz!',
                  });
                } else setTimeout(renderQ, 120);
              } else {
                btn.classList.add('wrong'); btn.disabled = true;
                cur.wrong++; cur.timeLeft = Math.max(0.2, cur.timeLeft - cur.cfg.pen);
                if (typeof sfx === 'function') sfx('error');
                shakeEl('mgQuizBox');
              }
            };
          });
        }
      }
      renderQ();
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Mixed Up the Breeds!',
          detail: 'Named ' + a.idx + ' / ' + a.cfg.goal + ' pups — owners questioned your breed knowledge!',
          fine: a.cfg.fine, fineLabel: 'Refund', rep: a.cfg.failRep, loseHearts: a.cfg.loseHearts,
          failRepMsg: '📖 Breed inspector quiz failed!',
        });
      }
    },
  });

  // ============================================================================================
  // 12. REGISTER CHANGE RUSH (Exact Cashier Change Counter)
  // ============================================================================================
  var CHANGE_CFG = {
    easy:   { goal: 3, time: 24, maxPaid: 20,  cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 30,  failRep: -0.08, patDrop: 0.20 },
    medium: { goal: 4, time: 26, maxPaid: 50,  cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 60,  failRep: -0.14, patDrop: 0.30 },
    hard:   { goal: 5, time: 28, maxPaid: 100, cash: 170, hearts: 8, rep: 0.22, shave: 2700, fine: 100, failRep: -0.22, patDrop: 0.40 },
  };

  MINIGAMES.register('cash_change', {
    icon: '💵',
    title: 'Register Change Rush',
    warn: 'Cashier checkout rush in {s}…',
    start: function (diff, api) {
      var cfg = CHANGE_CFG[diff.id];
      var orders = [];
      for (var i = 0; i < cfg.goal; i++) {
        var paid = cfg.maxPaid === 20 ? 20 : cfg.maxPaid === 50 ? api.pickOne([20, 50]) : api.pickOne([50, 100]);
        var bill = api.randInt(Math.max(4, Math.floor(paid * 0.22)), paid - 2);
        orders.push({ bill: bill, paid: paid, need: paid - bill });
      }
      var a = { kind: 'cash_change', diff: diff, cfg: cfg, orders: orders, idx: 0, cur: 0, wrong: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>💵 Change Rush</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-cash-box" id="mgCashBox"></div>' +
        '<div class="mg-cash-bills" id="mgCashBills">' +
          '<button type="button" class="wood mg-bill-btn" data-add="1">+$1</button>' +
          '<button type="button" class="wood mg-bill-btn" data-add="5">+$5</button>' +
          '<button type="button" class="wood mg-bill-btn" data-add="10">+$10</button>' +
          '<button type="button" class="wood mg-bill-btn" data-add="20">+$20</button>' +
        '</div>' +
        '<div class="mg-sort-btns">' +
          '<button type="button" id="mgCashClear" class="mg-sort-btn bad">↩️ Clear</button>' +
          '<button type="button" id="mgCashGive" class="mg-sort-btn safe">💵 Give Change</button>' +
        '</div>' +
        '<p class="mg-sub">Count exact change for ' + cfg.goal + ' customers! Fail = short register &amp; impatient queue.</p>',
        'minigame', 'mg-card'
      );
      function renderBill() {
        var cur = api.getActive();
        if (!cur || cur.finished) return;
        var o = cur.orders[cur.idx];
        var box = document.getElementById('mgCashBox');
        if (box) {
          box.innerHTML =
            '<div class="mg-cash-row"><span>Bill: <b>$' + o.bill + '</b></span><span>Paid: <b>$' + o.paid + '</b></span></div>' +
            '<div class="mg-cash-given">Your Change: <b id="mgCashCur">$' + cur.cur + '</b></div>';
        }
      }
      renderBill();
      var bWrap = document.getElementById('mgCashBills');
      if (bWrap) {
        bWrap.querySelectorAll('[data-add]').forEach(function (btn) {
          btn.onclick = function () {
            if (!a || a.finished) return;
            if (typeof initAudio === 'function') initAudio();
            a.cur += +btn.getAttribute('data-add');
            api.playNote(520 + Math.min(300, a.cur * 4), 0.08, 0.16);
            var el = document.getElementById('mgCashCur');
            if (el) el.textContent = '$' + a.cur;
          };
        });
      }
      var clr = document.getElementById('mgCashClear');
      if (clr) clr.onclick = function () { if (!a || a.finished) return; a.cur = 0; var el = document.getElementById('mgCashCur'); if (el) el.textContent = '$0'; };
      var give = document.getElementById('mgCashGive');
      if (give) give.onclick = function () {
        if (!a || a.finished) return;
        if (typeof initAudio === 'function') initAudio();
        var o = a.orders[a.idx];
        if (a.cur === o.need) {
          api.playNote(780 + a.idx * 60, 0.14, 0.22);
          a.idx++; a.cur = 0;
          var sc = document.getElementById('mgScore');
          if (sc) sc.textContent = a.idx + ' / ' + a.cfg.goal;
          if (a.idx >= a.orders.length) {
            api.finish(true, {
              headline: 'Register Balanced!',
              detail: 'Counted exact change for all ' + a.cfg.goal + ' customers!',
              cash: a.cfg.cash + (a.wrong === 0 ? 15 : 0), hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
              xp: 14 + a.cfg.hearts * 2, shortTag: 'Fast Cashier!',
            });
          } else renderBill();
        } else {
          a.wrong++; a.cur = 0; a.timeLeft = Math.max(0.2, a.timeLeft - 2.0);
          if (typeof sfx === 'function') sfx('error');
          shakeEl('mgCashBox'); renderBill();
        }
      };
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Register Short!',
          detail: 'Served ' + a.idx + ' / ' + a.cfg.goal + ' checkouts — till came up short & the queue grew restless!',
          fine: a.cfg.fine, fineLabel: 'Short Till', rep: a.cfg.failRep, patienceDrop: a.cfg.patDrop,
          failRepMsg: '💵 Front register checkout fell behind!',
        });
      }
    },
  });

  // ============================================================================================
  // 13. SPOT THE ODD PUP (Visual Odd-One-Out Grid)
  // ============================================================================================
  var ODD_CFG = {
    easy:   { rounds: 3, cols: 3, cells: 9,  time: 16, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, failRep: -0.10, loseHearts: 1 },
    medium: { rounds: 4, cols: 4, cells: 12, time: 18, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 40, failRep: -0.18, loseHearts: 2 },
    hard:   { rounds: 5, cols: 4, cells: 16, time: 20, cash: 165, hearts: 8, rep: 0.24, shave: 2700, fine: 70, failRep: -0.28, loseHearts: 3 },
  };

  MINIGAMES.register('odd_pup', {
    icon: '🔍',
    title: 'Spot the Odd Pup',
    warn: 'Sneaky look-alike pup in {s}…',
    start: function (diff, api) {
      var cfg = ODD_CFG[diff.id];
      var a = { kind: 'odd_pup', diff: diff, cfg: cfg, round: 0, oddIdx: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🔍 Odd Pup Out</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.rounds + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-pair-grid cols-' + cfg.cols + (cfg.cells >= 16 ? ' compact' : '') + '" id="mgOddGrid"></div>' +
        '<p class="mg-sub">Tap the ONE pup that looks different! Wrong tap: −1.5s. Fail = refund &amp; ★ drop.</p>',
        'minigame', 'mg-card'
      );
      function renderRound() {
        var cur = api.getActive();
        if (!cur || cur.finished) return;
        var bs = api.shuffle(safeBreeds());
        var mainB = bs[0], oddB = bs[1];
        var mainCoat = 0, oddCoat = 0;
        if (diff.id === 'hard' && mainB.coats && mainB.coats.length > 1) {
          oddB = mainB;
          oddCoat = 1;
        }
        var mainImg = portraitImg(mainB.id, mainCoat, 80, 11 + cur.round);
        var oddImg = portraitImg(oddB.id, oddCoat, 80, 55 + cur.round);
        cur.oddIdx = api.randInt(0, cur.cfg.cells - 1);
        var grid = document.getElementById('mgOddGrid');
        if (!grid) return;
        var html = '';
        for (var i = 0; i < cur.cfg.cells; i++) {
          var isOdd = i === cur.oddIdx;
          var img = isOdd ? oddImg : mainImg;
          var face = img ? '<img src="' + img + '" alt="">' : '<span class="mg-pair-em">' + (isOdd ? '🦊' : '🐶') + '</span>';
          html += '<button type="button" class="mg-pair-card open" data-oi="' + i + '">' + face + '</button>';
        }
        grid.innerHTML = html;
        grid.querySelectorAll('[data-oi]').forEach(function (btn) {
          btn.onclick = function () {
            if (!cur || cur.finished) return;
            if (typeof initAudio === 'function') initAudio();
            if (+btn.getAttribute('data-oi') === cur.oddIdx) {
              api.playNote(720 + cur.round * 70, 0.12, 0.2);
              cur.round++;
              var sc = document.getElementById('mgScore');
              if (sc) sc.textContent = cur.round + ' / ' + cur.cfg.rounds;
              if (cur.round >= cur.cfg.rounds) {
                api.finish(true, {
                  headline: 'Sharp Spotter!',
                  detail: 'Spotted the odd pup in all ' + cur.cfg.rounds + ' lineups!',
                  cash: cur.cfg.cash, hearts: cur.cfg.hearts, rep: cur.cfg.rep, shave: cur.cfg.shave,
                  xp: 14 + cur.cfg.hearts * 2, shortTag: 'Odd Pup!',
                });
              } else renderRound();
            } else {
              cur.timeLeft = Math.max(0.2, cur.timeLeft - 1.5);
              if (typeof sfx === 'function') sfx('error');
              shakeEl('mgOddGrid');
            }
          };
        });
      }
      renderRound();
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Look-Alike Mix-Up!',
          detail: 'Cleared ' + a.round + ' / ' + a.cfg.rounds + ' lineups — twins got mixed up at pickup!',
          fine: a.cfg.fine, fineLabel: 'Refund', rep: a.cfg.failRep, loseHearts: a.cfg.loseHearts,
          failRepMsg: '🔍 Mixed up look-alike dogs!',
        });
      }
    },
  });

  // ============================================================================================
  // 14. TUG-OF-WAR SHOWDOWN (Rapid Tap-Mash Rope Tug)
  // ============================================================================================
  var TUG_CFG = {
    easy:   { time: 12, pullBack: 0.22, tapGain: 0.085, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, muddy: 1, moodDrop: 6 },
    medium: { time: 12, pullBack: 0.34, tapGain: 0.075, cash: 90,  hearts: 5, rep: 0.15, shave: 1500, fine: 35, muddy: 2, moodDrop: 10 },
    hard:   { time: 12, pullBack: 0.48, tapGain: 0.068, cash: 160, hearts: 8, rep: 0.22, shave: 2400, fine: 60, muddy: 3, moodDrop: 15 },
  };

  MINIGAMES.register('tug_war', {
    icon: '🪢',
    title: 'Tug-of-War Showdown',
    warn: 'Super-strong pup wants tug-of-war in {s}…',
    start: function (diff, api) {
      var cfg = TUG_CFG[diff.id];
      var a = { kind: 'tug_war', diff: diff, cfg: cfg, pos: 0.45, taps: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🪢 Tug-of-War</span>' + api.diffPill(diff) +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-tug-arena">' +
          '<div class="mg-tug-sides"><span>🐕 Champ Pup</span><span>🏆 YOU</span></div>' +
          '<div class="mg-tug-track"><div class="mg-tug-mud"></div><div class="mg-tug-knot" id="mgTugKnot" style="left:45%">🪢</div></div>' +
        '</div>' +
        '<button type="button" id="mgTugBtn" class="primary big mg-snip-btn">🪢 PULL! PULL! PULL!</button>' +
        '<p class="mg-sub">Tap rapidly to yank the rope knot to the right! Don\'t get pulled into the mud!</p>',
        'minigame', 'mg-card'
      );
      var btn = document.getElementById('mgTugBtn');
      if (btn) {
        btn.addEventListener('pointerdown', function () {
          if (!a || a.finished) return;
          if (typeof initAudio === 'function') initAudio();
          a.taps++;
          a.pos = Math.min(1, a.pos + a.cfg.tapGain);
          api.playNote(420 + a.pos * 360, 0.06, 0.16);
          var k = document.getElementById('mgTugKnot');
          if (k) k.style.left = (a.pos * 100).toFixed(1) + '%';
          if (a.pos >= 0.96) {
            api.finish(true, {
              headline: 'Tug-of-War Champ!',
              detail: 'Out-tugged the champion pup in ' + a.taps + ' pulls!',
              cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
              xp: 14 + a.cfg.hearts * 2, shortTag: 'Tug Champ!',
            });
          }
        });
      }
    },
    tick: function (a, dt, api) {
      var surge = 1 + Math.sin(a.timeLeft * 4.5) * 0.18;
      a.pos = Math.max(0, a.pos - a.cfg.pullBack * surge * dt);
      var k = document.getElementById('mgTugKnot');
      if (k) k.style.left = (a.pos * 100).toFixed(1) + '%';
      if (a.pos <= 0.03 || a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Dragged in the Mud!',
          detail: 'The champion pup won tug-of-war and splashed mud everywhere!',
          fine: a.cfg.fine, fineLabel: 'Laundry', muddyDogs: a.cfg.muddy, moodDrop: a.cfg.moodDrop,
          failRepMsg: '🪢 Muddy tug-of-war wipeout!',
        });
      }
    },
  });

  // ============================================================================================
  // 15. HYDRATION POUR GAUGE (Hold-and-Release Water Fill)
  // ============================================================================================
  var POUR_CFG = {
    easy:   { goal: 3, time: 18, zoneW: 0.24, rate: 0.52, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, muddy: 1, failRep: -0.06 },
    medium: { goal: 4, time: 20, zoneW: 0.17, rate: 0.72, cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 40, muddy: 2, failRep: -0.12 },
    hard:   { goal: 5, time: 22, zoneW: 0.11, rate: 0.96, cash: 165, hearts: 8, rep: 0.22, shave: 2700, fine: 70, muddy: 3, failRep: -0.20 },
  };

  MINIGAMES.register('water_pour', {
    icon: '💧',
    title: 'Hydration Pour Gauge',
    warn: 'Thirsty pack needs water bowls in {s}…',
    start: function (diff, api) {
      var cfg = POUR_CFG[diff.id];
      var a = { kind: 'water_pour', diff: diff, cfg: cfg, done: 0, fill: 0, pouring: false, z0: 0.55, z1: 0.55 + cfg.zoneW, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      function nextZone() { a.fill = 0; a.z0 = api.randRange(0.35, 0.88 - cfg.zoneW); a.z1 = a.z0 + cfg.zoneW; }
      nextZone();
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>💧 Water Pour</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-pour-wrap">' +
          '<div class="mg-pour-cup" id="mgPourCup">' +
            '<div class="mg-pour-zone" id="mgPourZone"></div>' +
            '<div class="mg-pour-water" id="mgPourWater" style="height:0%"></div>' +
          '</div>' +
          '<div class="mg-pour-msg" id="mgPourMsg">Hold POUR and release inside the green band!</div>' +
        '</div>' +
        '<button type="button" id="mgPourBtn" class="primary big mg-snip-btn">💧 HOLD TO POUR</button>' +
        '<p class="mg-sub">Fill ' + cfg.goal + ' water bowls cleanly! Overflow or miss: −1.5s. Fail = wet floor &amp; muddy pups.</p>',
        'minigame', 'mg-card'
      );
      function renderCup() {
        var z = document.getElementById('mgPourZone'), w = document.getElementById('mgPourWater');
        if (z) { z.style.bottom = (a.z0 * 100).toFixed(1) + '%'; z.style.height = ((a.z1 - a.z0) * 100).toFixed(1) + '%'; }
        if (w) w.style.height = Math.min(100, a.fill * 100).toFixed(1) + '%';
      }
      renderCup();
      var btn = document.getElementById('mgPourBtn');
      function finishPour() {
        if (!a || a.finished || !a.pouring) return;
        a.pouring = false;
        var msg = document.getElementById('mgPourMsg');
        if (a.fill >= a.z0 - 0.02 && a.fill <= a.z1 + 0.02) {
          a.done++;
          api.playNote(680 + a.done * 65, 0.14, 0.22);
          var sc = document.getElementById('mgScore');
          if (sc) sc.textContent = a.done + ' / ' + a.cfg.goal;
          if (msg) msg.textContent = '✨ Perfect pour!';
          if (a.done >= a.cfg.goal) {
            api.finish(true, {
              headline: 'Hydration Hero!',
              detail: 'Filled all ' + a.cfg.goal + ' bowls without spilling a drop!',
              cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
              xp: 14 + a.cfg.hearts * 2, shortTag: 'Water Pour!',
            });
          } else { nextZone(); renderCup(); }
        } else {
          a.timeLeft = Math.max(0.2, a.timeLeft - 1.5);
          if (typeof sfx === 'function') sfx('error');
          if (msg) msg.textContent = a.fill > a.z1 ? '💦 Overflowed! −1.5s' : '💧 Too shallow! −1.5s';
          shakeEl('mgPourCup'); a.fill = 0; renderCup();
        }
      }
      if (btn) {
        btn.addEventListener('pointerdown', function () { if (!a || a.finished) return; if (typeof initAudio === 'function') initAudio(); a.pouring = true; });
        btn.addEventListener('pointerup', finishPour);
        btn.addEventListener('pointerleave', finishPour);
        btn.addEventListener('pointercancel', finishPour);
      }
      a._renderCup = renderCup;
      a._finishPour = finishPour;
    },
    tick: function (a, dt, api) {
      if (a.pouring) {
        a.fill += a.cfg.rate * dt;
        if (a._renderCup) a._renderCup();
        if (a.fill >= 1.0) a._finishPour();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Water Everywhere!',
          detail: 'Only filled ' + a.done + ' / ' + a.cfg.goal + ' bowls — puddles turned the yard muddy!',
          fine: a.cfg.fine, fineLabel: 'Mop-Up', muddyDogs: a.cfg.muddy, rep: a.cfg.failRep,
          failRepMsg: '💧 Water station spilled across the yard!',
        });
      }
    },
  });

  // ============================================================================================
  // 16. AGILITY HURDLE DASH (Canvas Side-Scrolling Jumper)
  // ============================================================================================
  var AGIL_CFG = {
    easy:   { goal: 5,  time: 15, spd: 148, gapA: 1.55, gapB: 2.05, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  muddy: 1, moodDrop: 8,  failRep: -0.08 },
    medium: { goal: 8,  time: 16, spd: 185, gapA: 1.15, gapB: 1.60, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, muddy: 2, moodDrop: 14, failRep: -0.14 },
    hard:   { goal: 11, time: 17, spd: 225, gapA: 0.88, gapB: 1.25, cash: 165, hearts: 8, rep: 0.24, shave: 2700, muddy: 3, moodDrop: 20, failRep: -0.22 },
  };

  MINIGAMES.register('agility_hop', {
    icon: '🚧',
    title: 'Agility Hurdle Dash',
    warn: 'Agility course time trial in {s}…',
    start: function (diff, api) {
      var cfg = AGIL_CFG[diff.id], CW = 330, CH = 210;
      var a = {
        kind: 'agility_hop', diff: diff, cfg: cfg, cw: CW, ch: CH,
        py: 0, vy: 0, cleared: 0, hits: 0, obs: [], spawnT: 0.7,
        timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🚧 Agility Dash</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
        '<button type="button" id="mgJumpBtn" class="primary big mg-snip-btn">🐾 JUMP!</button>' +
        '<p class="mg-sub">Tap canvas or JUMP to clear ' + cfg.goal + ' hurdles (3 hits = wipeout)!</p>',
        'minigame', 'mg-card'
      );
      function doJump() {
        if (!a || a.finished) return;
        if (typeof initAudio === 'function') initAudio();
        if (a.py <= 2) { a.vy = 395; api.playNote(620, 0.1, 0.18); }
      }
      var cv = document.getElementById('mgCanvas'), jb = document.getElementById('mgJumpBtn');
      if (cv) cv.addEventListener('pointerdown', doJump);
      if (jb) jb.addEventListener('pointerdown', doJump);
    },
    tick: function (a, dt, api) {
      a.vy -= 1180 * dt;
      a.py += a.vy * dt;
      if (a.py < 0) { a.py = 0; a.vy = 0; }
      a.spawnT -= dt;
      if (a.spawnT <= 0) {
        a.spawnT = api.randRange(a.cfg.gapA, a.cfg.gapB);
        a.obs.push({ x: a.cw + 20, w: 22, h: 30, scored: false, hit: false, ico: Math.random() < 0.7 ? '🚧' : '🪵' });
      }
      var dogX = 64;
      for (var i = a.obs.length - 1; i >= 0; i--) {
        var o = a.obs[i];
        o.x -= a.cfg.spd * dt;
        if (!o.hit && Math.abs(o.x - dogX) < 18 && a.py < 24) {
          o.hit = true; a.hits++;
          if (typeof sfx === 'function') sfx('error');
          if (a.hits >= 3) {
            api.finish(false, {
              headline: 'Agility Wipeout!',
              detail: 'Knocked over 3 hurdles and slid into the mud!',
              muddyDogs: a.cfg.muddy, moodDrop: a.cfg.moodDrop, rep: a.cfg.failRep,
              failRepMsg: '🚧 Agility demo ended in a muddy tumble!',
            });
            return;
          }
        }
        if (!o.scored && !o.hit && o.x < dogX - 20) {
          o.scored = true; a.cleared++;
          api.playNote(760, 0.08, 0.16);
          var sc = document.getElementById('mgScore');
          if (sc) sc.textContent = a.cleared + ' / ' + a.cfg.goal;
          if (a.cleared >= a.cfg.goal) {
            api.finish(true, {
              headline: 'Agility Superstar!',
              detail: 'Cleared all ' + a.cfg.goal + ' hurdles like a champion!',
              cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
              xp: 15 + a.cfg.hearts * 2, shortTag: 'Agility Star!',
            });
            return;
          }
        }
        if (o.x < -30) a.obs.splice(i, 1);
      }
      // Draw canvas
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d'), gy = a.ch - 38;
        c.save(); c.scale(2, 2);
        var sky = c.createLinearGradient(0, 0, 0, gy);
        sky.addColorStop(0, '#a6ddff'); sky.addColorStop(1, '#e8f7ff');
        c.fillStyle = sky; c.fillRect(0, 0, a.cw, gy);
        c.fillStyle = '#6ab550'; c.fillRect(0, gy, a.cw, a.ch - gy);
        c.fillStyle = '#4e8f3a'; c.fillRect(0, gy, a.cw, 4);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        // Lives
        c.font = '14px sans-serif'; c.fillText('❤️'.repeat(Math.max(0, 3 - a.hits)) + '🖤'.repeat(a.hits), 42, 16);
        // Obstacles
        a.obs.forEach(function (ob) { c.font = '26px sans-serif'; c.fillText(ob.ico, ob.x, gy - 12); });
        // Running pup
        c.fillStyle = 'rgba(30,20,10,0.22)'; c.beginPath(); c.ellipse(dogX, gy + 3, Math.max(8, 16 - a.py * 0.12), 5, 0, 0, Math.PI * 2); c.fill();
        c.font = '30px sans-serif'; c.fillText('🐕', dogX, gy - 15 - a.py);
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Course Timed Out!',
          detail: 'Cleared ' + a.cleared + ' / ' + a.cfg.goal + ' hurdles before the whistle blew!',
          muddyDogs: a.cfg.muddy, moodDrop: a.cfg.moodDrop, rep: a.cfg.failRep,
          failRepMsg: '🚧 Agility time trial came up short!',
        });
      }
    },
  });

  // ============================================================================================
  // 17. COLLAR STROOP BLITZ (Ink Color vs Word Brain-Teaser)
  // ============================================================================================
  var STROOP_COLS = [
    { id: 'red',    name: 'RED',    hex: '#d9483b' },
    { id: 'blue',   name: 'BLUE',   hex: '#3178d6' },
    { id: 'green',  name: 'GREEN',  hex: '#379c47' },
    { id: 'yellow', name: 'YELLOW', hex: '#d49a14' },
  ];
  var STROOP_CFG = {
    easy:   { goal: 6,  time: 18, pen: 1.5, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, failRep: -0.10, loseHearts: 1 },
    medium: { goal: 9,  time: 18, pen: 2.0, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 50, failRep: -0.18, loseHearts: 2 },
    hard:   { goal: 12, time: 17, pen: 2.5, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 85, failRep: -0.28, loseHearts: 3 },
  };

  MINIGAMES.register('collar_match', {
    icon: '🎀',
    title: 'Collar Color Blitz',
    warn: 'Collar color mix-up test in {s}…',
    start: function (diff, api) {
      var cfg = STROOP_CFG[diff.id];
      var a = { kind: 'collar_match', diff: diff, cfg: cfg, done: 0, want: null, wrong: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🎀 Collar Blitz</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-math-box" id="mgStroopBox">' +
          '<div class="mg-math-hint">Tap the <b>INK COLOR</b> (ignore the word!):</div>' +
          '<div class="mg-stroop-word" id="mgStroopWord"></div>' +
        '</div>' +
        '<div class="mg-choices" id="mgStroopBtns">' +
          STROOP_COLS.map(function (c) {
            return '<button type="button" class="mg-collar-btn" data-scol="' + c.id + '" style="--ccol:' + c.hex + '">🎀 ' + c.name + '</button>';
          }).join('') +
        '</div>' +
        '<p class="mg-sub">Match ' + cfg.goal + ' collar ink colors! Wrong tap: −' + cfg.pen.toFixed(1) + 's. Fail = refund &amp; ★ drop.</p>',
        'minigame', 'mg-card'
      );
      function nextWord() {
        var ink = api.pickOne(STROOP_COLS);
        var others = STROOP_COLS.filter(function (x) { return x.id !== ink.id; });
        var word = (diff.id === 'easy' && Math.random() < 0.3) ? ink : api.pickOne(others);
        a.want = ink.id;
        var wEl = document.getElementById('mgStroopWord');
        if (wEl) { wEl.textContent = word.name; wEl.style.color = ink.hex; }
      }
      nextWord();
      var wrap = document.getElementById('mgStroopBtns');
      if (wrap) {
        wrap.querySelectorAll('[data-scol]').forEach(function (btn) {
          btn.onclick = function () {
            if (!a || a.finished) return;
            if (typeof initAudio === 'function') initAudio();
            if (btn.getAttribute('data-scol') === a.want) {
              a.done++; api.playNote(620 + a.done * 35, 0.1, 0.2);
              var sc = document.getElementById('mgScore');
              if (sc) sc.textContent = a.done + ' / ' + a.cfg.goal;
              if (a.done >= a.cfg.goal) {
                api.finish(true, {
                  headline: 'Collar Color Master!',
                  detail: 'Matched all ' + a.cfg.goal + ' tricky collar colors without falling for the trap!',
                  cash: a.cfg.cash + (a.wrong === 0 ? 15 : 0), hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
                  xp: 14 + a.cfg.hearts * 2, shortTag: 'Collar Blitz!',
                });
              } else nextWord();
            } else {
              a.wrong++; a.timeLeft = Math.max(0.2, a.timeLeft - a.cfg.pen);
              if (typeof sfx === 'function') sfx('error');
              shakeEl('mgStroopBox');
            }
          };
        });
      }
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Collars Swapped!',
          detail: 'Matched ' + a.done + ' / ' + a.cfg.goal + ' collars — dogs went home with the wrong tags!',
          fine: a.cfg.fine, fineLabel: 'Refund', rep: a.cfg.failRep, loseHearts: a.cfg.loseHearts,
          failRepMsg: '🎀 Collar color mix-up at pickup!',
        });
      }
    },
  });

  // ============================================================================================
  // 18. PUPPY NAME UNSCRAMBLE (Tap-Letter Word Puzzle)
  // ============================================================================================
  var SCRAMBLE_WORDS = {
    easy:   ['LUNA', 'MILO', 'COCO', 'RUBY', 'DUKE', 'BEAR', 'ZUES', 'TOBY', 'KODA', 'LOLA'],
    medium: ['DAISY', 'BELLA', 'ROCKY', 'MOCHI', 'SUNNY', 'BUDDY', 'TEDDY', 'OLIVE', 'PENNY', 'SCOUT'],
    hard:   ['BISCUIT', 'CHARLIE', 'PEANUTS', 'WAFFLES', 'NOODLES', 'MUFFINS', 'POPCORN', 'PRETZEL', 'PANCAKE'],
  };
  var SCRAMBLE_CFG = {
    easy:   { goal: 3, time: 22, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, failRep: -0.08, patDrop: 0.20 },
    medium: { goal: 4, time: 26, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 45, failRep: -0.15, patDrop: 0.30 },
    hard:   { goal: 4, time: 28, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 75, failRep: -0.24, patDrop: 0.40 },
  };

  MINIGAMES.register('paw_scramble', {
    icon: '🔤',
    title: 'Puppy Name Unscramble',
    warn: 'Collar name tags scrambled in {s}…',
    start: function (diff, api) {
      var cfg = SCRAMBLE_CFG[diff.id];
      var words = api.shuffle(SCRAMBLE_WORDS[diff.id]).slice(0, cfg.goal);
      var a = { kind: 'paw_scramble', diff: diff, cfg: cfg, words: words, idx: 0, letters: [], typed: '', timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🔤 Name Scramble</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-math-box" id="mgScrBox">' +
          '<div class="mg-math-hint">Unscramble the puppy\'s name tag:</div>' +
          '<div class="mg-scr-word" id="mgScrSlots"></div>' +
        '</div>' +
        '<div class="mg-scr-tiles" id="mgScrTiles"></div>' +
        '<p class="mg-sub">Tap letters in order to spell ' + cfg.goal + ' puppy names! Fail = lost tag fee &amp; queue delay.</p>',
        'minigame', 'mg-card'
      );
      function loadWord() {
        var w = a.words[a.idx];
        var arr = w.split('');
        var sh = api.shuffle(arr);
        if (sh.join('') === w && arr.length > 1) { var t = sh[0]; sh[0] = sh[1]; sh[1] = t; }
        a.letters = sh.map(function (ch, i) { return { ch: ch, used: false, id: i }; });
        a.typed = '';
        renderScr();
      }
      function renderScr() {
        var w = a.words[a.idx];
        var slots = document.getElementById('mgScrSlots');
        if (slots) {
          var s = '';
          for (var i = 0; i < w.length; i++) s += '<span class="mg-scr-slot' + (i < a.typed.length ? ' filled' : '') + '">' + (a.typed[i] || '_') + '</span>';
          slots.innerHTML = s;
        }
        var tiles = document.getElementById('mgScrTiles');
        if (tiles) {
          tiles.innerHTML = a.letters.map(function (lt) {
            return '<button type="button" class="wood mg-scr-tile' + (lt.used ? ' used' : '') + '" data-lt="' + lt.id + '"' + (lt.used ? ' disabled' : '') + '>' + lt.ch + '</button>';
          }).join('');
          tiles.querySelectorAll('[data-lt]').forEach(function (btn) {
            btn.onclick = function () {
              if (!a || a.finished) return;
              if (typeof initAudio === 'function') initAudio();
              var lt = a.letters[+btn.getAttribute('data-lt')];
              if (!lt || lt.used) return;
              var wantChar = a.words[a.idx][a.typed.length];
              if (lt.ch === wantChar) {
                lt.used = true; a.typed += lt.ch;
                api.playNote(580 + a.typed.length * 60, 0.09, 0.18);
                if (a.typed === a.words[a.idx]) {
                  a.idx++;
                  var sc = document.getElementById('mgScore');
                  if (sc) sc.textContent = a.idx + ' / ' + a.cfg.goal;
                  if (a.idx >= a.words.length) {
                    api.finish(true, {
                      headline: 'Name Tag Pro!',
                      detail: 'Unscrambled all ' + a.cfg.goal + ' puppy name tags in time!',
                      cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
                      xp: 14 + a.cfg.hearts * 2, shortTag: 'Name Tags!',
                    });
                    return;
                  }
                  loadWord(); return;
                }
                renderScr();
              } else {
                a.timeLeft = Math.max(0.2, a.timeLeft - 1.5);
                if (typeof sfx === 'function') sfx('error');
                shakeEl('mgScrBox');
              }
            };
          });
        }
      }
      loadWord();
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Scrambled Tags!',
          detail: 'Fixed ' + a.idx + ' / ' + a.cfg.goal + ' name tags — had to buy replacements!',
          fine: a.cfg.fine, fineLabel: 'New Tags', rep: a.cfg.failRep, patienceDrop: a.cfg.patDrop,
          failRepMsg: '🔤 Scrambled collar tags slowed down pickup!',
        });
      }
    },
  });

  // ============================================================================================
  // 19. SWEET-SPOT BELLY RUB (Hot-or-Cold Tummy Search Canvas)
  // ============================================================================================
  var BELLY_CFG = {
    easy:   { goal: 2, time: 16, rad: 38, holdSec: 0.75, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  moodDrop: 10, loseHearts: 1, failRep: -0.08 },
    medium: { goal: 3, time: 18, rad: 28, holdSec: 0.85, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, moodDrop: 18, loseHearts: 2, failRep: -0.14 },
    hard:   { goal: 4, time: 20, rad: 21, holdSec: 0.95, cash: 165, hearts: 8, rep: 0.24, shave: 2700, moodDrop: 25, loseHearts: 3, failRep: -0.22 },
  };

  MINIGAMES.register('belly_rub', {
    icon: '🖐️',
    title: 'Sweet-Spot Belly Rub',
    warn: 'Ticklish pup wants belly rubs in {s}…',
    start: function (diff, api) {
      var cfg = BELLY_CFG[diff.id], CW = 320, CH = 200;
      var a = {
        kind: 'belly_rub', diff: diff, cfg: cfg, cw: CW, ch: CH,
        done: 0, sx: 160, sy: 100, px: -99, py: -99, down: false, prog: 0,
        timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      function placeSpot() { a.sx = api.randRange(64, CW - 64); a.sy = api.randRange(46, CH - 46); a.prog = 0; }
      placeSpot();
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🖐️ Belly Rub</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-trick-status" id="mgBellyTemp">🖐️ Drag over the belly to find the sweet spot!</div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
        '<p class="mg-sub">Follow the Hot/Cold meter &amp; hold on the ticklish spot to fill the heart meter!</p>',
        'minigame', 'mg-card'
      );
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var upd = function (ev) {
          var r = cv.getBoundingClientRect();
          a.px = (ev.clientX - r.left) * (a.cw / r.width);
          a.py = (ev.clientY - r.top) * (a.ch / r.height);
        };
        cv.addEventListener('pointerdown', function (ev) { if (typeof initAudio === 'function') initAudio(); a.down = true; upd(ev); });
        cv.addEventListener('pointermove', function (ev) { if (a.down) upd(ev); });
        cv.addEventListener('pointerup', function () { a.down = false; });
        cv.addEventListener('pointercancel', function () { a.down = false; });
      }
      a._placeSpot = placeSpot;
    },
    tick: function (a, dt, api) {
      var temp = document.getElementById('mgBellyTemp');
      var d = a.down ? Math.hypot(a.px - a.sx, a.py - a.sy) : 999;
      if (a.down) {
        if (d <= a.cfg.rad) {
          a.prog += dt / a.cfg.holdSec;
          if (temp) temp.textContent = '🔥 SWEET SPOT! Keep scratching! (' + Math.min(100, Math.round(a.prog * 100)) + '%)';
          if (Math.random() < dt * 8) api.playNote(740 + a.prog * 180, 0.06, 0.14);
          if (a.prog >= 1) {
            a.done++;
            api.playNote(880, 0.16, 0.24);
            var sc = document.getElementById('mgScore');
            if (sc) sc.textContent = a.done + ' / ' + a.cfg.goal;
            if (a.done >= a.cfg.goal) {
              api.finish(true, {
                headline: 'Ultimate Belly Scratcher!',
                detail: 'Found all ' + a.cfg.goal + ' ticklish sweet spots — leg kicking with joy!',
                cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
                xp: 14 + a.cfg.hearts * 2, shortTag: 'Belly Rubs!',
              });
              return;
            }
            a._placeSpot();
          }
        } else if (d <= a.cfg.rad * 2.1) {
          if (temp) temp.textContent = '🥵 VERY WARM! Almost right there…';
        } else if (d <= a.cfg.rad * 3.6) {
          if (temp) temp.textContent = '🌤️ Getting warmer…';
        } else {
          if (temp) temp.textContent = '❄️ Cold — try another area of the belly!';
        }
      }
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d');
        c.save(); c.scale(2, 2);
        c.fillStyle = '#f6dfbe'; c.fillRect(0, 0, a.cw, a.ch);
        // Fluffy tummy oval
        c.fillStyle = '#e2b278'; c.beginPath(); c.ellipse(a.cw / 2, a.ch / 2, 134, 78, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#3b2a20'; c.lineWidth = 2.5; c.stroke();
        c.fillStyle = '#f7d8b0'; c.beginPath(); c.ellipse(a.cw / 2, a.ch / 2 + 4, 102, 56, 0, 0, Math.PI * 2); c.fill();
        // Little paws on edges
        c.font = '24px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('🐾', 38, 42); c.fillText('🐾', a.cw - 38, 42); c.fillText('🐾', 42, a.ch - 38); c.fillText('🐾', a.cw - 42, a.ch - 38);
        if (a.down) {
          var glowCol = d <= a.cfg.rad ? 'rgba(255,105,135,0.45)' : d <= a.cfg.rad * 2.1 ? 'rgba(255,180,70,0.35)' : 'rgba(120,190,255,0.28)';
          c.fillStyle = glowCol; c.beginPath(); c.arc(a.px, a.py, 26, 0, Math.PI * 2); c.fill();
          c.font = '22px sans-serif'; c.fillText(d <= a.cfg.rad ? '💖' : '🖐️', a.px, a.py);
        }
        // Progress ring if scratching sweet spot
        if (a.prog > 0) {
          c.strokeStyle = '#ff5e8e'; c.lineWidth = 5;
          c.beginPath(); c.arc(a.sx, a.sy, a.cfg.rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.prog)); c.stroke();
        }
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Unimpressed Belly!',
          detail: 'Only found ' + a.done + ' / ' + a.cfg.goal + ' sweet spots — the pups pouted!',
          moodDrop: a.cfg.moodDrop, loseHearts: a.cfg.loseHearts, rep: a.cfg.failRep,
          failRepMsg: '🖐️ Missed the belly-rub sweet spot!',
        });
      }
    },
  });

  // ============================================================================================
  // 20. TENNIS BALL KEEP-UP (Canvas Gravity Volley Juggler)
  // ============================================================================================
  var BOUNCE_CFG = {
    easy:   { goal: 8,  time: 14, grav: 420, kick: 340, rad: 28, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 20, moodDrop: 8 },
    medium: { goal: 12, time: 15, grav: 560, kick: 390, rad: 24, cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 40, moodDrop: 14 },
    hard:   { goal: 16, time: 16, grav: 710, kick: 440, rad: 21, cash: 165, hearts: 8, rep: 0.22, shave: 2700, fine: 65, moodDrop: 20 },
  };

  MINIGAMES.register('ball_bounce', {
    icon: '🎾',
    title: 'Tennis Ball Keep-Up',
    warn: 'Tennis ball keep-up challenge in {s}…',
    start: function (diff, api) {
      var cfg = BOUNCE_CFG[diff.id], CW = 320, CH = 240;
      var a = {
        kind: 'ball_bounce', diff: diff, cfg: cfg, cw: CW, ch: CH,
        bx: CW / 2, by: 70, vx: api.randRange(-70, 70), vy: -80,
        bounces: 0, drops: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🎾 Ball Keep-Up</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
        '<p class="mg-sub">Tap the tennis ball ' + cfg.goal + ' times to keep it airborne (3 drops = game over)!</p>',
        'minigame', 'mg-card'
      );
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        cv.addEventListener('pointerdown', function (ev) {
          if (!a || a.finished) return;
          if (typeof initAudio === 'function') initAudio();
          var r = cv.getBoundingClientRect();
          var px = (ev.clientX - r.left) * (a.cw / r.width), py = (ev.clientY - r.top) * (a.ch / r.height);
          if (Math.hypot(px - a.bx, py - a.by) <= a.cfg.rad + 22) {
            a.vy = -a.cfg.kick;
            a.vx = Math.max(-160, Math.min(160, (a.bx - px) * 4.5 + api.randRange(-40, 40)));
            a.bounces++;
            api.playNote(520 + Math.min(360, a.bounces * 22), 0.09, 0.2);
            var sc = document.getElementById('mgScore');
            if (sc) sc.textContent = a.bounces + ' / ' + a.cfg.goal;
            if (a.bounces >= a.cfg.goal) {
              api.finish(true, {
                headline: 'Keep-Up Legend!',
                detail: 'Juggled the tennis ball ' + a.bounces + ' times without losing it!',
                cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
                xp: 14 + a.cfg.hearts * 2, shortTag: 'Keep-Up!',
              });
            }
          }
        });
      }
    },
    tick: function (a, dt, api) {
      a.vy += a.cfg.grav * dt;
      a.bx += a.vx * dt; a.by += a.vy * dt;
      if (a.bx < a.cfg.rad) { a.bx = a.cfg.rad; a.vx = Math.abs(a.vx) * 0.9; }
      if (a.bx > a.cw - a.cfg.rad) { a.bx = a.cw - a.cfg.rad; a.vx = -Math.abs(a.vx) * 0.9; }
      if (a.by < a.cfg.rad) { a.by = a.cfg.rad; a.vy = Math.abs(a.vy) * 0.5; }
      if (a.by > a.ch - 26) {
        a.drops++;
        if (typeof sfx === 'function') sfx('error');
        if (a.drops >= 3) {
          api.finish(false, {
            headline: 'Ball Over the Fence!',
            detail: 'Dropped the ball 3 times — had to replace the chewed tennis balls!',
            fine: a.cfg.fine, fineLabel: 'New Balls', moodDrop: a.cfg.moodDrop,
            failRepMsg: '🎾 Tennis balls lost over the fence!',
          });
          return;
        }
        a.by = 65; a.bx = a.cw / 2; a.vy = -120; a.vx = api.randRange(-60, 60);
      }
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d');
        c.save(); c.scale(2, 2);
        var g = c.createLinearGradient(0, 0, 0, a.ch);
        g.addColorStop(0, '#c8ebff'); g.addColorStop(0.84, '#eef8ff'); g.addColorStop(0.85, '#68b24c'); g.addColorStop(1, '#50943a');
        c.fillStyle = g; c.fillRect(0, 0, a.cw, a.ch);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '14px sans-serif'; c.fillText('❤️'.repeat(Math.max(0, 3 - a.drops)) + '🖤'.repeat(a.drops), 42, 16);
        c.fillStyle = 'rgba(30,20,10,0.18)'; c.beginPath(); c.ellipse(a.bx, a.ch - 18, Math.max(8, 20 - (a.ch - a.by) * 0.05), 5, 0, 0, Math.PI * 2); c.fill();
        c.font = Math.round(a.cfg.rad * 1.45) + 'px sans-serif'; c.fillText('🎾', a.bx, a.by);
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Time Up on Keep-Up!',
          detail: 'Got ' + a.bounces + ' / ' + a.cfg.goal + ' volleys before the buzzer!',
          fine: a.cfg.fine, fineLabel: 'New Balls', moodDrop: a.cfg.moodDrop,
          failRepMsg: '🎾 Tennis ball keep-up timed out!',
        });
      }
    },
  });
})();

(function () {
  if (typeof MINIGAMES === 'undefined' || typeof MINIGAMES.register !== 'function') return;

  function shakeEl(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  }

  // ============================================================================================
  // 21. YARD POOP PATROL (4x4 Wave Tile Sweeper — Tap Poops, Never Squish Flowers!)
  // ============================================================================================
  var SWEEP_CFG = {
    easy:   { waves: 3, perWave: 4, flowers: 3, time: 16, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  poops: 2, fine: 20, failRep: -0.06 },
    medium: { waves: 4, perWave: 6, flowers: 4, time: 18, cash: 95,  hearts: 5, rep: 0.15, shave: 1500, poops: 3, fine: 40, failRep: -0.12 },
    hard:   { waves: 5, perWave: 8, flowers: 5, time: 19, cash: 165, hearts: 8, rep: 0.22, shave: 2700, poops: 4, fine: 70, failRep: -0.20 },
  };

  MINIGAMES.register('poop_sweep', {
    icon: '🧹',
    title: 'Yard Poop Patrol',
    warn: 'Emergency poop sweep on the lawn in {s}…',
    start: function (diff, api) {
      var cfg = SWEEP_CFG[diff.id];
      var a = { kind: 'poop_sweep', diff: diff, cfg: cfg, wave: 0, cells: [], left: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🧹 Poop Patrol</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">W1 / ' + cfg.waves + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-sweep-grid" id="mgSweepGrid"></div>' +
        '<p class="mg-sub">Tap every 💩 across ' + cfg.waves + ' waves! Don\'t squish 🌷 flowers (−2s)! Fail = yard mess &amp; fine.</p>',
        'minigame', 'mg-card'
      );
      function loadWave() {
        var idx = api.shuffle([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
        a.cells = new Array(16).fill('');
        for (var i = 0; i < cfg.perWave; i++) a.cells[idx[i]] = 'poop';
        for (var j = 0; j < cfg.flowers; j++) a.cells[idx[cfg.perWave + j]] = 'flower';
        a.left = cfg.perWave;
        renderGrid();
      }
      function renderGrid() {
        var grid = document.getElementById('mgSweepGrid');
        if (!grid) return;
        grid.innerHTML = a.cells.map(function (c, i) {
          return '<button type="button" class="mg-sweep-cell ' + (c || 'grass') + '" data-sc="' + i + '">' +
            (c === 'poop' ? '💩' : c === 'flower' ? '🌷' : '') + '</button>';
        }).join('');
        grid.querySelectorAll('[data-sc]').forEach(function (btn) {
          btn.addEventListener('pointerdown', function () {
            if (!a || a.finished) return;
            if (typeof initAudio === 'function') initAudio();
            var idx = +btn.getAttribute('data-sc'), typ = a.cells[idx];
            if (typ === 'poop') {
              a.cells[idx] = ''; a.left--;
              api.playNote(580 + (cfg.perWave - a.left) * 45, 0.08, 0.18);
              if (a.left <= 0) {
                a.wave++;
                if (a.wave >= cfg.waves) {
                  api.finish(true, {
                    headline: 'Spotless Lawn!',
                    detail: 'Swept all ' + cfg.waves + ' messy waves without crushing a single flower!',
                    cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
                    xp: 14 + cfg.hearts * 2, shortTag: 'Clean Lawn!',
                  });
                  return;
                }
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = 'W' + (a.wave + 1) + ' / ' + cfg.waves;
                loadWave(); return;
              }
              renderGrid();
            } else if (typ === 'flower') {
              a.timeLeft = Math.max(0.2, a.timeLeft - 2.0);
              if (typeof sfx === 'function') sfx('error');
              shakeEl('mgSweepGrid');
            }
          });
        });
      }
      loadWave();
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Messy Yard Emergency!',
          detail: 'Cleared ' + a.wave + ' / ' + a.cfg.waves + ' waves — leftover messes piled up on the lawn!',
          spawnPoops: a.cfg.poops, fine: a.cfg.fine, fineLabel: 'Cleanup', rep: a.cfg.failRep,
          failRepMsg: '🧹 Lawn poop patrol fell behind!',
        });
      }
    },
  });

  // ============================================================================================
  // 22. BARK BEAT TAPPER (3-Lane Falling Note Rhythm Arcade)
  // ============================================================================================
  var RHYTHM_CFG = {
    easy:   { goal: 8,  time: 16, spd: 115, spawnA: 0.72, spawnB: 1.00, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  failRep: -0.10, moodDrop: 8,  loseHearts: 1 },
    medium: { goal: 13, time: 16, spd: 150, spawnA: 0.50, spawnB: 0.74, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, failRep: -0.18, moodDrop: 12, loseHearts: 2 },
    hard:   { goal: 18, time: 16, spd: 190, spawnA: 0.36, spawnB: 0.56, cash: 170, hearts: 8, rep: 0.24, shave: 2700, failRep: -0.28, moodDrop: 18, loseHearts: 3 },
  };
  var LANE_META = [
    { col: '#e8796c', freq: 523.25, ico: '🐾' },
    { col: '#f2c14e', freq: 659.25, ico: '🦴' },
    { col: '#42b8a8', freq: 783.99, ico: '🎵' },
  ];

  MINIGAMES.register('bark_rhythm', {
    icon: '🥁',
    title: 'Bark Beat Tapper',
    warn: 'Puppy rhythm concert starting in {s}…',
    start: function (diff, api) {
      var cfg = RHYTHM_CFG[diff.id], CW = 312, CH = 200;
      var a = {
        kind: 'bark_rhythm', diff: diff, cfg: cfg, cw: CW, ch: CH,
        notes: [], hits: 0, spawnT: 0.2, flash: [0, 0, 0],
        timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🥁 Bark Beat</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px"></canvas></div>' +
        '<div class="mg-rhythm-btns" id="mgRhythmBtns">' +
          LANE_META.map(function (lm, i) { return '<button type="button" class="mg-lane-btn" data-ln="' + i + '" style="--lcol:' + lm.col + '">' + lm.ico + '</button>'; }).join('') +
        '</div>' +
        '<p class="mg-sub">Tap each lane button as notes cross the glowing bar (' + cfg.goal + '+ hits)!</p>',
        'minigame', 'mg-card'
      );
      var wrap = document.getElementById('mgRhythmBtns');
      if (wrap) {
        wrap.querySelectorAll('[data-ln]').forEach(function (btn) {
          btn.addEventListener('pointerdown', function () {
            if (!a || a.finished) return;
            if (typeof initAudio === 'function') initAudio();
            var ln = +btn.getAttribute('data-ln'), hitY = a.ch - 32;
            a.flash[ln] = 0.2;
            var bestIdx = -1, bestD = 34;
            for (var i = 0; i < a.notes.length; i++) {
              var n = a.notes[i];
              if (n.lane !== ln) continue;
              var d = Math.abs(n.y - hitY);
              if (d < bestD) { bestD = d; bestIdx = i; }
            }
            if (bestIdx >= 0) {
              a.notes.splice(bestIdx, 1);
              a.hits++;
              api.playNote(LANE_META[ln].freq, 0.12, 0.22);
              var sc = document.getElementById('mgScore');
              if (sc) sc.textContent = a.hits + ' / ' + a.cfg.goal;
              if (a.hits >= a.cfg.goal) {
                api.finish(true, {
                  headline: 'Bark Beat Encore!',
                  detail: 'Nailed ' + a.hits + ' beats in perfect puppy rhythm!',
                  cash: a.cfg.cash, hearts: a.cfg.hearts, rep: a.cfg.rep, shave: a.cfg.shave,
                  xp: 14 + a.cfg.hearts * 2, shortTag: 'Bark Beat!',
                });
              }
            } else {
              if (typeof sfx === 'function') sfx('error');
            }
          });
        });
      }
    },
    tick: function (a, dt, api) {
      a.spawnT -= dt;
      if (a.spawnT <= 0) {
        a.spawnT = api.randRange(a.cfg.spawnA, a.cfg.spawnB);
        a.notes.push({ lane: api.randInt(0, 2), y: -12 });
      }
      for (var k = 0; k < 3; k++) if (a.flash[k] > 0) a.flash[k] -= dt;
      for (var i = a.notes.length - 1; i >= 0; i--) {
        a.notes[i].y += a.cfg.spd * dt;
        if (a.notes[i].y > a.ch + 16) a.notes.splice(i, 1);
      }
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d'), lw = a.cw / 3, hitY = a.ch - 32;
        c.save(); c.scale(2, 2);
        c.fillStyle = '#2c2233'; c.fillRect(0, 0, a.cw, a.ch);
        for (var l = 0; l < 3; l++) {
          c.fillStyle = a.flash[l] > 0 ? 'rgba(255,255,255,0.16)' : (l % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.08)');
          c.fillRect(l * lw, 0, lw, a.ch);
          c.strokeStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.moveTo(l * lw, 0); c.lineTo(l * lw, a.ch); c.stroke();
        }
        c.fillStyle = 'rgba(255,230,109,0.22)'; c.fillRect(0, hitY - 14, a.cw, 28);
        c.strokeStyle = '#ffe66d'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, hitY); c.lineTo(a.cw, hitY); c.stroke();
        c.textAlign = 'center'; c.textBaseline = 'middle';
        a.notes.forEach(function (n) {
          var lm = LANE_META[n.lane], cx = (n.lane + 0.5) * lw;
          c.fillStyle = lm.col; c.beginPath(); c.arc(cx, n.y, 16, 0, Math.PI * 2); c.fill();
          c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
          c.font = '16px sans-serif'; c.fillText(lm.ico, cx, n.y + 1);
        });
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Off-Beat Howls!',
          detail: 'Hit ' + a.hits + ' / ' + a.cfg.goal + ' beats — the pups howled out of tune!',
          rep: a.cfg.failRep, moodDrop: a.cfg.moodDrop, loseHearts: a.cfg.loseHearts,
          failRepMsg: '🥁 Puppy rhythm show went off-beat!',
        });
      }
    },
  });

  // ============================================================================================
  // 23. ROLL-CALL HEADCOUNT (Moving Yard Pup Counter)
  // ============================================================================================
  var COUNT_CFG = {
    easy:   { rounds: 3, minP: 5,  maxP: 9,  spd: 24, filterCol: false, time: 22, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, failRep: -0.12 },
    medium: { rounds: 4, minP: 8,  maxP: 13, spd: 38, filterCol: false, time: 24, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 55, failRep: -0.20 },
    hard:   { rounds: 4, minP: 10, maxP: 16, spd: 50, filterCol: true,  time: 26, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 90, failRep: -0.30 },
  };

  MINIGAMES.register('crate_count', {
    icon: '🔢',
    title: 'Roll-Call Headcount',
    warn: 'Daycare headcount safety check in {s}…',
    start: function (diff, api) {
      var cfg = COUNT_CFG[diff.id], CW = 320, CH = 185;
      var a = {
        kind: 'crate_count', diff: diff, cfg: cfg, cw: CW, ch: CH,
        round: 0, pups: [], ans: 0, targetCol: null,
        timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🔢 Roll Call</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.rounds + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-trick-status" id="mgCntPrompt"></div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px"></canvas></div>' +
        '<div class="mg-choices" id="mgCntChoices"></div>' +
        '<p class="mg-sub">Count quickly &amp; tap the right headcount! Wrong tap: −2s. Fail = safety fine &amp; ★ drop.</p>',
        'minigame', 'mg-card'
      );
      function loadRound() {
        var total = api.randInt(cfg.minP, cfg.maxP);
        a.pups = [];
        var wantRed = cfg.filterCol;
        var redCount = 0;
        for (var i = 0; i < total; i++) {
          var isRed = wantRed ? (i < Math.max(3, Math.floor(total * 0.45)) || Math.random() < 0.35) : false;
          if (isRed) redCount++;
          var ang = Math.random() * Math.PI * 2;
          a.pups.push({
            x: api.randRange(26, CW - 26), y: api.randRange(26, CH - 26),
            vx: Math.cos(ang) * cfg.spd, vy: Math.sin(ang) * cfg.spd,
            red: isRed, ico: api.pickOne(['🐶', '🐕', '🐩', '🦮']),
          });
        }
        a.ans = wantRed ? redCount : total;
        var pr = document.getElementById('mgCntPrompt');
        if (pr) pr.textContent = wantRed ? '🔴 Count ONLY pups with RED collars!' : '🐾 Count ALL pups running in the yard!';
        var set = {}; set[a.ans] = 1;
        var opts = [a.ans];
        var offs = api.shuffle([-2, -1, 1, 2, 3, -3]);
        for (var k = 0; k < offs.length && opts.length < 4; k++) {
          var v = Math.max(1, a.ans + offs[k]);
          if (!set[v]) { set[v] = 1; opts.push(v); }
        }
        opts = api.shuffle(opts);
        var ch = document.getElementById('mgCntChoices');
        if (ch) {
          ch.innerHTML = opts.map(function (v) { return '<button type="button" class="wood mg-ch-btn" data-cv="' + v + '">' + v + '</button>'; }).join('');
          ch.querySelectorAll('[data-cv]').forEach(function (btn) {
            btn.onclick = function () {
              if (!a || a.finished) return;
              if (typeof initAudio === 'function') initAudio();
              if (+btn.getAttribute('data-cv') === a.ans) {
                api.playNote(700 + a.round * 70, 0.12, 0.2);
                a.round++;
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = a.round + ' / ' + cfg.rounds;
                if (a.round >= cfg.rounds) {
                  api.finish(true, {
                    headline: 'All Pups Accounted For!',
                    detail: 'Aced all ' + cfg.rounds + ' roll-call counts!',
                    cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
                    xp: 14 + cfg.hearts * 2, shortTag: 'Roll Call!',
                  });
                } else loadRound();
              } else {
                btn.classList.add('wrong'); btn.disabled = true;
                a.timeLeft = Math.max(0.2, a.timeLeft - 2.0);
                if (typeof sfx === 'function') sfx('error');
                shakeEl('mgCntPrompt');
              }
            };
          });
        }
      }
      loadRound();
    },
    tick: function (a, dt, api) {
      a.pups.forEach(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 22 || p.x > a.cw - 22) p.vx *= -1;
        if (p.y < 22 || p.y > a.ch - 22) p.vy *= -1;
      });
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d');
        c.save(); c.scale(2, 2);
        c.fillStyle = '#6db852'; c.fillRect(0, 0, a.cw, a.ch);
        c.strokeStyle = '#a8743f'; c.lineWidth = 6; c.strokeRect(3, 3, a.cw - 6, a.ch - 6);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        a.pups.forEach(function (p) {
          if (a.cfg.filterCol) {
            c.fillStyle = p.red ? '#e04238' : '#3d85d6';
            c.beginPath(); c.arc(p.x, p.y, 16, 0, Math.PI * 2); c.fill();
            c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
          }
          c.font = '22px sans-serif'; c.fillText(p.ico, p.x, p.y + 1);
        });
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Headcount Missed!',
          detail: 'Completed ' + a.round + ' / ' + a.cfg.rounds + ' roll calls — safety inspector issued a fine!',
          fine: a.cfg.fine, fineLabel: 'Safety Fine', rep: a.cfg.failRep,
          failRepMsg: '🔢 Failed daycare roll-call safety check!',
        });
      }
    },
  });

  // ============================================================================================
  // 24. FIND THE LOST PUP MAZE (Guaranteed-Solvable Hedge Maze)
  // ============================================================================================
  var MAZE_CFG = {
    easy:   { size: 5, time: 16, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, failRep: -0.10, patDrop: 0.25 },
    medium: { size: 6, time: 19, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 50, failRep: -0.18, patDrop: 0.35 },
    hard:   { size: 7, time: 22, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 80, failRep: -0.26, patDrop: 0.45 },
  };

  function buildGuaranteedMaze(N, api) {
    // Grid of walls (1) and open cells (0); carve a guaranteed wandering path + random extra open cells
    var g = [];
    for (var y = 0; y < N; y++) { g.push([]); for (var x = 0; x < N; x++) g[y].push(1); }
    var cx = 0, cy = 0; g[0][0] = 0;
    var guard = 0;
    while ((cx !== N - 1 || cy !== N - 1) && guard < 200) {
      guard++;
      var moves = [];
      if (cx + 1 < N) moves.push([1, 0], [1, 0]);
      if (cy + 1 < N) moves.push([0, 1], [0, 1]);
      if (cx > 0 && Math.random() < 0.25) moves.push([-1, 0]);
      if (cy > 0 && Math.random() < 0.25) moves.push([0, -1]);
      var mv = api.pickOne(moves);
      cx += mv[0]; cy += mv[1]; g[cy][cx] = 0;
    }
    g[N - 1][N - 1] = 0;
    // Open a few dead-end branches for fun maze look while keeping walls
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      if (g[r][c] === 1 && Math.random() < 0.36) g[r][c] = 0;
    }
    return g;
  }

  MINIGAMES.register('leash_maze', {
    icon: '🧭',
    title: 'Hedge Maze Rescue',
    warn: 'Playful pup hid in the hedge maze in {s}…',
    start: function (diff, api) {
      var cfg = MAZE_CFG[diff.id], N = cfg.size;
      var a = {
        kind: 'leash_maze', diff: diff, cfg: cfg, n: N, grid: buildGuaranteedMaze(N, api),
        px: 0, py: 0, gx: N - 1, gy: N - 1, timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🧭 Hedge Maze</span>' + api.diffPill(diff) +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-maze-grid" id="mgMazeGrid" style="grid-template-columns:repeat(' + N + ',1fr)"></div>' +
        '<div class="mg-dpad">' +
          '<button type="button" class="wood" data-dm="0,-1">⬆️</button>' +
          '<div class="mg-dpad-row">' +
            '<button type="button" class="wood" data-dm="-1,0">⬅️</button>' +
            '<button type="button" class="wood" data-dm="0,1">⬇️</button>' +
            '<button type="button" class="wood" data-dm="1,0">➡️</button>' +
          '</div>' +
        '</div>' +
        '<p class="mg-sub">Tap adjacent paths or arrows to reach the hiding 🐶 pup before pickup!</p>',
        'minigame', 'mg-card'
      );
      function tryStep(dx, dy) {
        if (!a || a.finished) return;
        if (typeof initAudio === 'function') initAudio();
        var nx = a.px + dx, ny = a.py + dy;
        if (nx < 0 || ny < 0 || nx >= a.n || ny >= a.n || a.grid[ny][nx] === 1) {
          if (typeof sfx === 'function') sfx('error');
          return;
        }
        a.px = nx; a.py = ny;
        api.playNote(500 + (nx + ny) * 25, 0.06, 0.14);
        renderMaze();
        if (a.px === a.gx && a.py === a.gy) {
          api.finish(true, {
            headline: 'Pup Found!',
            detail: 'Navigated the hedge maze with ' + a.timeLeft.toFixed(1) + 's left!',
            cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
            xp: 14 + cfg.hearts * 2, shortTag: 'Maze Rescue!',
          });
        }
      }
      function renderMaze() {
        var el = document.getElementById('mgMazeGrid');
        if (!el) return;
        var html = '';
        for (var y = 0; y < a.n; y++) {
          for (var x = 0; x < a.n; x++) {
            var wall = a.grid[y][x] === 1;
            var isP = x === a.px && y === a.py, isG = x === a.gx && y === a.gy;
            var adj = !wall && (Math.abs(x - a.px) + Math.abs(y - a.py) === 1);
            html += '<button type="button" class="mg-mz-cell' + (wall ? ' wall' : '') + (isP ? ' me' : '') + (adj ? ' adj' : '') + '" data-mx="' + x + '" data-my="' + y + '">' +
              (isP ? '🧑‍🌾' : isG ? '🐶' : wall ? '🌿' : '') + '</button>';
          }
        }
        el.innerHTML = html;
        el.querySelectorAll('[data-mx]').forEach(function (b) {
          b.onclick = function () {
            var tx = +b.getAttribute('data-mx'), ty = +b.getAttribute('data-my');
            if (Math.abs(tx - a.px) + Math.abs(ty - a.py) === 1) tryStep(tx - a.px, ty - a.py);
          };
        });
      }
      renderMaze();
      var dp = document.querySelector('#modal .mg-dpad');
      if (dp) dp.querySelectorAll('[data-dm]').forEach(function (b) {
        b.addEventListener('pointerdown', function () {
          var p = b.getAttribute('data-dm').split(',');
          tryStep(+p[0], +p[1]);
        });
      });
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Lost in the Hedges!',
          detail: 'Took too long finding the hiding pup — waiting owners grew impatient!',
          fine: a.cfg.fine, fineLabel: 'Refund', rep: a.cfg.failRep, patienceDrop: a.cfg.patDrop,
          failRepMsg: '🧭 Lost pup delayed front desk pickup!',
        });
      }
    },
  });

  // ============================================================================================
  // 25. FLEA FLICKER SPRAY (Fast-Hopping Canvas Swatter)
  // ============================================================================================
  var FLEA_CFG = {
    easy:   { goal: 8,  time: 14, spd: 82,  maxOn: 4, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 30, muddy: 1, failRep: -0.08 },
    medium: { goal: 13, time: 14, spd: 125, maxOn: 5, cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 55, muddy: 2, failRep: -0.14 },
    hard:   { goal: 18, time: 14, spd: 168, maxOn: 6, cash: 165, hearts: 8, rep: 0.22, shave: 2700, fine: 90, muddy: 3, failRep: -0.22 },
  };

  MINIGAMES.register('flea_zap', {
    icon: '🦟',
    title: 'Flea Flicker Spray',
    warn: 'Itchy fleas spotted on a coat in {s}…',
    start: function (diff, api) {
      var cfg = FLEA_CFG[diff.id], CW = 320, CH = 230;
      var a = {
        kind: 'flea_zap', diff: diff, cfg: cfg, cw: CW, ch: CH,
        fleas: [], fx: [], zapped: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      function addFlea() {
        var ang = Math.random() * Math.PI * 2;
        a.fleas.push({ x: api.randRange(28, CW - 28), y: api.randRange(28, CH - 28), vx: Math.cos(ang) * cfg.spd, vy: Math.sin(ang) * cfg.spd, hopT: api.randRange(0.4, 1.1) });
      }
      for (var i = 0; i < cfg.maxOn; i++) addFlea();
      a._addFlea = addFlea;
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🦟 Flea Spray</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
        '<p class="mg-sub">Tap hopping 🦟 fleas to spritz ' + cfg.goal + ' of them! Fail = vet shampoo bill &amp; baths needed.</p>',
        'minigame', 'mg-card'
      );
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        cv.addEventListener('pointerdown', function (ev) {
          if (!a || a.finished) return;
          if (typeof initAudio === 'function') initAudio();
          var r = cv.getBoundingClientRect();
          var px = (ev.clientX - r.left) * (a.cw / r.width), py = (ev.clientY - r.top) * (a.ch / r.height);
          for (var i = a.fleas.length - 1; i >= 0; i--) {
            if (Math.hypot(px - a.fleas[i].x, py - a.fleas[i].y) <= 28) {
              var fl = a.fleas.splice(i, 1)[0];
              a.fx.push({ x: fl.x, y: fl.y, life: 0.45 });
              a.zapped++;
              api.playNote(660 + a.zapped * 25, 0.08, 0.18);
              var sc = document.getElementById('mgScore');
              if (sc) sc.textContent = a.zapped + ' / ' + cfg.goal;
              if (a.zapped >= cfg.goal) {
                api.finish(true, {
                  headline: 'Itch-Free Coat!',
                  detail: 'Spritzed all ' + cfg.goal + ' pesky fleas with lavender mist!',
                  cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
                  xp: 14 + cfg.hearts * 2, shortTag: 'Flea Free!',
                });
                return;
              }
              addFlea();
              break;
            }
          }
        });
      }
    },
    tick: function (a, dt, api) {
      a.fleas.forEach(function (f) {
        f.hopT -= dt;
        if (f.hopT <= 0) {
          f.hopT = api.randRange(0.35, 0.95);
          var ang = Math.random() * Math.PI * 2;
          f.vx = Math.cos(ang) * a.cfg.spd; f.vy = Math.sin(ang) * a.cfg.spd;
        }
        f.x += f.vx * dt; f.y += f.vy * dt;
        if (f.x < 20 || f.x > a.cw - 20) f.vx *= -1;
        if (f.y < 20 || f.y > a.ch - 20) f.vy *= -1;
      });
      for (var j = a.fx.length - 1; j >= 0; j--) { a.fx[j].life -= dt; if (a.fx[j].life <= 0) a.fx.splice(j, 1); }
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d');
        c.save(); c.scale(2, 2);
        c.fillStyle = '#e8c796'; c.fillRect(0, 0, a.cw, a.ch);
        c.strokeStyle = 'rgba(130,86,44,0.18)'; c.lineWidth = 2;
        for (var fy = 14; fy < a.ch; fy += 24) for (var fx = 14; fx < a.cw; fx += 34) {
          c.beginPath(); c.arc(fx, fy, 9, 0.2, 1.3); c.stroke();
        }
        c.textAlign = 'center'; c.textBaseline = 'middle';
        a.fx.forEach(function (p) { c.fillStyle = 'rgba(195,155,255,' + (p.life * 1.6) + ')'; c.beginPath(); c.arc(p.x, p.y, 24 * (1.2 - p.life), 0, Math.PI * 2); c.fill(); });
        a.fleas.forEach(function (f) { c.font = '23px sans-serif'; c.fillText('🦟', f.x, f.y); });
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Itchy Outbreak!',
          detail: 'Only spritzed ' + a.zapped + ' / ' + a.cfg.goal + ' fleas — vet shampoo & baths needed!',
          fine: a.cfg.fine, fineLabel: 'Vet Spray', muddyDogs: a.cfg.muddy, rep: a.cfg.failRep,
          failRepMsg: '🦟 Flea outbreak required emergency baths!',
        });
      }
    },
  });

  // ============================================================================================
  // 26. KIBBLE SCALE WEIGH-IN (Exact Binary/Scoop Weight Math)
  // ============================================================================================
  var SCALE_CFG = {
    easy:   { goal: 3, minW: 5,  maxW: 15, scoops: [1, 2, 4, 8],         time: 22, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, moodDrop: 8 },
    medium: { goal: 4, minW: 11, maxW: 29, scoops: [1, 2, 4, 8, 16],     time: 25, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 50, moodDrop: 14 },
    hard:   { goal: 5, minW: 18, maxW: 45, scoops: [1, 2, 4, 8, 12, 20], time: 28, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 85, moodDrop: 20 },
  };

  MINIGAMES.register('treat_balance', {
    icon: '⚖️',
    title: 'Kibble Scale Weigh-In',
    warn: 'Custom diet weigh-in order in {s}…',
    start: function (diff, api) {
      var cfg = SCALE_CFG[diff.id];
      var targets = [];
      for (var i = 0; i < cfg.goal; i++) targets.push(api.randInt(cfg.minW, cfg.maxW));
      var a = {
        kind: 'treat_balance', diff: diff, cfg: cfg, targets: targets, idx: 0,
        picked: {}, timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>⚖️ Kibble Scale</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-cash-box" id="mgScaleBox"></div>' +
        '<div class="mg-scale-grid" id="mgScaleGrid"></div>' +
        '<p class="mg-sub">Toggle scoop weights to match the exact target ounces for ' + cfg.goal + ' bowls!</p>',
        'minigame', 'mg-card'
      );
      function curWeight() {
        var s = 0;
        cfg.scoops.forEach(function (w, i) { if (a.picked[i]) s += w; });
        return s;
      }
      function renderScale() {
        var want = a.targets[a.idx], cur = curWeight();
        var box = document.getElementById('mgScaleBox');
        if (box) {
          box.innerHTML =
            '<div class="mg-cash-row"><span>Order: <b>' + want + ' oz</b></span><span>Scale: <b style="color:' + (cur > want ? '#d9483b' : '#2e7d32') + '">' + cur + ' oz</b></span></div>' +
            '<div class="mg-math-hint">' + (cur === want ? '✅ Balanced!' : cur > want ? '⬇️ Too heavy! Tap a scoop to remove it.' : '⬆️ Add ' + (want - cur) + ' more oz') + '</div>';
        }
        var grid = document.getElementById('mgScaleGrid');
        if (grid) {
          grid.innerHTML = cfg.scoops.map(function (w, i) {
            return '<button type="button" class="wood mg-scoop-btn' + (a.picked[i] ? ' on' : '') + '" data-si="' + i + '">🥣 ' + w + ' oz</button>';
          }).join('');
          grid.querySelectorAll('[data-si]').forEach(function (btn) {
            btn.onclick = function () {
              if (!a || a.finished) return;
              if (typeof initAudio === 'function') initAudio();
              var idx = +btn.getAttribute('data-si');
              a.picked[idx] = !a.picked[idx];
              var curNow = curWeight(), wantNow = a.targets[a.idx];
              api.playNote(curNow === wantNow ? 820 : 540, 0.1, 0.18);
              if (curNow === wantNow) {
                a.idx++; a.picked = {};
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = a.idx + ' / ' + cfg.goal;
                if (a.idx >= a.targets.length) {
                  api.finish(true, {
                    headline: 'Master Nutritionist!',
                    detail: 'Weighed all ' + cfg.goal + ' gourmet bowls to the exact ounce!',
                    cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
                    xp: 14 + cfg.hearts * 2, shortTag: 'Exact Scale!',
                  });
                  return;
                }
              }
              renderScale();
            };
          });
        }
      }
      renderScale();
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Portion Mix-Up!',
          detail: 'Weighed ' + a.idx + ' / ' + a.cfg.goal + ' bowls — wasted gourmet kibble!',
          fine: a.cfg.fine, fineLabel: 'Wasted Kibble', moodDrop: a.cfg.moodDrop,
          failRepMsg: '⚖️ Gourmet kibble portions were off!',
        });
      }
    },
  });

  // ============================================================================================
  // 27. KENNEL PIN CODE FLASH (Short-Term Numeric Memory Keypad)
  // ============================================================================================
  var LOCK_CFG = {
    easy:   { rounds: 2, digits: 4, flashSec: 2.2, time: 16, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 30,  patDrop: 0.20 },
    medium: { rounds: 3, digits: 5, flashSec: 2.0, time: 20, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 60,  patDrop: 0.30 },
    hard:   { rounds: 3, digits: 6, flashSec: 1.8, time: 22, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 100, patDrop: 0.40 },
  };

  MINIGAMES.register('gate_lock', {
    icon: '🔐',
    title: 'Kennel Pin Code Flash',
    warn: 'Kennel gate keypad reset in {s}…',
    customTimer: true,
    start: function (diff, api) {
      var cfg = LOCK_CFG[diff.id];
      var a = {
        kind: 'gate_lock', diff: diff, cfg: cfg, round: 0, code: '', typed: '',
        phase: 'show', flashT: cfg.flashSec, timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🔐 Gate Pin</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">1 / ' + cfg.rounds + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-math-box" id="mgPinBox"><div class="mg-math-q" id="mgPinDisp"></div><div class="mg-math-hint" id="mgPinHint"></div></div>' +
        '<div class="mg-pin-pad" id="mgPinPad">' +
          ['1','2','3','4','5','6','7','8','9','0'].map(function (d) { return '<button type="button" class="wood mg-pin-btn" data-pd="' + d + '">' + d + '</button>'; }).join('') +
        '</div>' +
        '<p class="mg-sub">Memorize each ' + cfg.digits + '-digit gate PIN &amp; punch it in! Fail = locksmith bill.</p>',
        'minigame', 'mg-card'
      );
      function nextCode() {
        var c = '';
        for (var i = 0; i < cfg.digits; i++) c += String(api.randInt(0, 9));
        a.code = c; a.typed = ''; a.phase = 'show'; a.flashT = cfg.flashSec;
        renderPin();
      }
      function renderPin() {
        var disp = document.getElementById('mgPinDisp'), hint = document.getElementById('mgPinHint');
        if (a.phase === 'show') {
          if (disp) disp.textContent = a.code.split('').join(' ');
          if (hint) hint.textContent = '👀 Memorize this PIN quickly!';
        } else {
          var s = '';
          for (var i = 0; i < a.code.length; i++) s += (i < a.typed.length ? a.typed[i] : '•') + (i < a.code.length - 1 ? ' ' : '');
          if (disp) disp.textContent = s;
          if (hint) hint.textContent = '🔢 Enter the ' + a.code.length + '-digit PIN!';
        }
      }
      a._renderPin = renderPin;
      nextCode();
      var pad = document.getElementById('mgPinPad');
      if (pad) {
        pad.querySelectorAll('[data-pd]').forEach(function (btn) {
          btn.onclick = function () {
            if (!a || a.finished || a.phase !== 'input') return;
            if (typeof initAudio === 'function') initAudio();
            var d = btn.getAttribute('data-pd');
            var expect = a.code[a.typed.length];
            if (d === expect) {
              a.typed += d;
              api.playNote(560 + a.typed.length * 60, 0.08, 0.18);
              if (a.typed.length >= a.code.length) {
                a.round++;
                if (a.round >= cfg.rounds) {
                  api.finish(true, {
                    headline: 'Gates Unlocked!',
                    detail: 'Entered all ' + cfg.rounds + ' kennel security codes flawlessly!',
                    cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
                    xp: 14 + cfg.hearts * 2, shortTag: 'Security Pro!',
                  });
                  return;
                }
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = (a.round + 1) + ' / ' + cfg.rounds;
                nextCode(); return;
              }
              renderPin();
            } else {
              a.timeLeft = Math.max(0.2, a.timeLeft - 2.0);
              if (typeof sfx === 'function') sfx('error');
              shakeEl('mgPinBox');
              a.phase = 'show'; a.flashT = 1.1; a.typed = ''; renderPin();
            }
          };
        });
      }
    },
    tick: function (a, dt, api) {
      if (a.phase === 'show') {
        a.flashT -= dt;
        if (a.flashT <= 0) { a.phase = 'input'; if (a._renderPin) a._renderPin(); }
        return;
      }
      a.timeLeft -= dt;
      api.updateTimerBar();
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Locked Out!',
          detail: 'Gate keypad timed out — had to call the locksmith while owners waited!',
          fine: a.cfg.fine, fineLabel: 'Locksmith', patienceDrop: a.cfg.patDrop,
          failRepMsg: '🔐 Kennel gate lockout delayed customers!',
        });
      }
    },
  });

  // ============================================================================================
  // 28. TREAT BOX STACKER (Oscillating Timing Tower)
  // ============================================================================================
  var TOWER_CFG = {
    easy:   { goal: 5, time: 18, baseW: 130, spd: 120, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, poops: 1 },
    medium: { goal: 7, time: 20, baseW: 112, spd: 160, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, fine: 50, poops: 2 },
    hard:   { goal: 9, time: 22, baseW: 96,  spd: 205, cash: 170, hearts: 8, rep: 0.24, shave: 2700, fine: 85, poops: 3 },
  };

  MINIGAMES.register('toy_tower', {
    icon: '🗼',
    title: 'Treat Box Stacker',
    warn: 'Stack the delivery boxes in {s}…',
    start: function (diff, api) {
      var cfg = TOWER_CFG[diff.id], CW = 320, CH = 210;
      var a = {
        kind: 'toy_tower', diff: diff, cfg: cfg, cw: CW, ch: CH,
        stack: [{ x: (CW - cfg.baseW) / 2, w: cfg.baseW }],
        curX: 20, curW: cfg.baseW, dir: 1,
        timeLeft: cfg.time, maxTime: cfg.time, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🗼 Box Stacker</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
        '<button type="button" id="mgDropBtn" class="primary big mg-snip-btn">📦 DROP BOX!</button>' +
        '<p class="mg-sub">Stack ' + cfg.goal + ' supply boxes neatly! Missing the stack topples the boxes!</p>',
        'minigame', 'mg-card'
      );
      function dropBox() {
        if (!a || a.finished) return;
        if (typeof initAudio === 'function') initAudio();
        var top = a.stack[a.stack.length - 1];
        var left = Math.max(a.curX, top.x), right = Math.min(a.curX + a.curW, top.x + top.w);
        var overlap = right - left;
        if (overlap < 12) {
          api.finish(false, {
            headline: 'Tower Toppled!',
            detail: 'Supply boxes crashed to the floor — damaged stock & spilled kibble!',
            fine: cfg.fine, fineLabel: 'Damaged Stock', spawnPoops: cfg.poops,
            failRepMsg: '🗼 Delivery stack toppled!',
          });
          return;
        }
        a.stack.push({ x: left, w: overlap });
        a.curW = overlap;
        var built = a.stack.length - 1;
        api.playNote(520 + built * 50, 0.11, 0.2);
        var sc = document.getElementById('mgScore');
        if (sc) sc.textContent = built + ' / ' + cfg.goal;
        if (built >= cfg.goal) {
          api.finish(true, {
            headline: 'Sky-High Stack!',
            detail: 'Stacked all ' + cfg.goal + ' supply crates without a single crash!',
            cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
            xp: 14 + cfg.hearts * 2, shortTag: 'Box Stacker!',
          });
        }
      }
      var db = document.getElementById('mgDropBtn'), cv = document.getElementById('mgCanvas');
      if (db) db.addEventListener('pointerdown', dropBox);
      if (cv) cv.addEventListener('pointerdown', dropBox);
    },
    tick: function (a, dt, api) {
      var spd = a.cfg.spd * (1 + (a.stack.length - 1) * 0.06);
      a.curX += a.dir * spd * dt;
      if (a.curX <= 8) { a.curX = 8; a.dir = 1; }
      if (a.curX + a.curW >= a.cw - 8) { a.curX = a.cw - 8 - a.curW; a.dir = -1; }
      var cv = document.getElementById('mgCanvas');
      if (cv) {
        var c = cv.getContext('2d'), bh = 18;
        c.save(); c.scale(2, 2);
        c.fillStyle = '#fff5dc'; c.fillRect(0, 0, a.cw, a.ch);
        var cols = ['#d49450', '#c48342', '#e0a55e', '#b87638'];
        a.stack.forEach(function (b, idx) {
          var y = a.ch - 14 - (idx + 1) * bh;
          c.fillStyle = cols[idx % cols.length]; c.fillRect(b.x, y, b.w, bh - 2);
          c.strokeStyle = '#3b2a20'; c.lineWidth = 1.6; c.strokeRect(b.x, y, b.w, bh - 2);
        });
        var cy = a.ch - 14 - (a.stack.length + 1) * bh;
        c.fillStyle = '#f2c14e'; c.fillRect(a.curX, cy, a.curW, bh - 2);
        c.strokeStyle = '#3b2a20'; c.lineWidth = 1.8; c.strokeRect(a.curX, cy, a.curW, bh - 2);
        c.restore();
      }
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Unloading Delayed!',
          detail: 'Stacked ' + (a.stack.length - 1) + ' / ' + a.cfg.goal + ' boxes before the delivery van left!',
          fine: a.cfg.fine, fineLabel: 'Late Fee', spawnPoops: a.cfg.poops,
          failRepMsg: '🗼 Delivery boxes left scattered!',
        });
      }
    },
  });

  // ============================================================================================
  // 29. PUP CHECKUP TRIAGE (Symptom-to-Remedy Matching)
  // ============================================================================================
  var TRIAGE_CASES = [
    { id: 'water',  sym: '🥵 Panting & Overheated', rem: '💧 Cold Water' },
    { id: 'bath',   sym: '🟤 Covered in Mud',       rem: '🛁 Warm Bath' },
    { id: 'nap',    sym: '🥱 Sleepy & Yawning',     rem: '🛏️ Cozy Nap' },
    { id: 'cuddle', sym: '🥺 Nervous & Shivering',  rem: '❤️ Gentle Hug' },
    { id: 'food',   sym: '🤤 Rumbling Tummy',       rem: '🍖 Kibble Bowl' },
    { id: 'play',   sym: '⚡ Hyper Zoomies!',       rem: '🎾 Fetch Ball' },
  ];
  var TRIAGE_CFG = {
    easy:   { goal: 5,  time: 18, pen: 1.5, cash: 50,  hearts: 3, rep: 0.10, shave: 900,  fine: 25, moodDrop: 10, failRep: -0.08 },
    medium: { goal: 8,  time: 20, pen: 2.0, cash: 95,  hearts: 5, rep: 0.15, shave: 1500, fine: 50, moodDrop: 16, failRep: -0.14 },
    hard:   { goal: 11, time: 20, pen: 2.5, cash: 165, hearts: 8, rep: 0.22, shave: 2700, fine: 85, moodDrop: 24, failRep: -0.22 },
  };

  MINIGAMES.register('mood_doctor', {
    icon: '🩺',
    title: 'Pup Checkup Triage',
    warn: 'Wellness checkup line forming in {s}…',
    start: function (diff, api) {
      var cfg = TRIAGE_CFG[diff.id];
      var queue = [];
      for (var i = 0; i < cfg.goal; i++) queue.push(api.pickOne(TRIAGE_CASES));
      var a = { kind: 'mood_doctor', diff: diff, cfg: cfg, queue: queue, idx: 0, wrong: 0, timeLeft: cfg.time, maxTime: cfg.time, finished: false };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>🩺 Pup Triage</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.time.toFixed(1) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<div class="mg-sort-card" id="mgDocCard"><div class="mg-doc-sym" id="mgDocSym"></div><div class="mg-sort-tip">Pick the best remedy right away!</div></div>' +
        '<div class="mg-order-grid" id="mgDocGrid">' +
          TRIAGE_CASES.map(function (c) { return '<button type="button" class="wood mg-kit-btn" data-rem="' + c.id + '"><b>' + c.rem + '</b></button>'; }).join('') +
        '</div>' +
        '<p class="mg-sub">Treat all ' + cfg.goal + ' pups! Wrong care: −' + cfg.pen.toFixed(1) + 's. Fail = vet fee &amp; mood drop.</p>',
        'minigame', 'mg-card'
      );
      function renderSym() {
        var el = document.getElementById('mgDocSym');
        if (el && a.queue[a.idx]) el.textContent = a.queue[a.idx].sym;
      }
      renderSym();
      var grid = document.getElementById('mgDocGrid');
      if (grid) {
        grid.querySelectorAll('[data-rem]').forEach(function (btn) {
          btn.onclick = function () {
            if (!a || a.finished) return;
            if (typeof initAudio === 'function') initAudio();
            if (btn.getAttribute('data-rem') === a.queue[a.idx].id) {
              api.playNote(640 + a.idx * 40, 0.1, 0.2);
              a.idx++;
              var sc = document.getElementById('mgScore');
              if (sc) sc.textContent = a.idx + ' / ' + cfg.goal;
              if (a.idx >= a.queue.length) {
                api.finish(true, {
                  headline: 'Top Pup Medic!',
                  detail: 'Cared for all ' + cfg.goal + ' checkup pups with ' + a.timeLeft.toFixed(1) + 's left!',
                  cash: cfg.cash + (a.wrong === 0 ? 15 : 0), hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
                  xp: 14 + cfg.hearts * 2, shortTag: 'Pup Medic!',
                });
              } else renderSym();
            } else {
              a.wrong++; a.timeLeft = Math.max(0.2, a.timeLeft - cfg.pen);
              if (typeof sfx === 'function') sfx('error');
              shakeEl('mgDocCard');
            }
          };
        });
      }
    },
    tick: function (a, dt, api) {
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Checkup Backed Up!',
          detail: 'Treated ' + a.idx + ' / ' + a.cfg.goal + ' pups — needed an on-call vet!',
          fine: a.cfg.fine, fineLabel: 'Vet Fee', moodDrop: a.cfg.moodDrop, rep: a.cfg.failRep,
          failRepMsg: '🩺 Wellness triage fell behind!',
        });
      }
    },
  });

  // ============================================================================================
  // 30. GOLDEN FRISBEE REFLEX (Wait-for-GREEN Reaction Speed Test!)
  // ============================================================================================
  var DRAW_CFG = {
    easy:   { goal: 3, winSec: 0.78, cash: 55,  hearts: 3, rep: 0.10, shave: 900,  failRep: -0.10, loseHearts: 1, moodDrop: 8 },
    medium: { goal: 4, winSec: 0.56, cash: 95,  hearts: 5, rep: 0.16, shave: 1500, failRep: -0.18, loseHearts: 2, moodDrop: 12 },
    hard:   { goal: 5, winSec: 0.40, cash: 170, hearts: 8, rep: 0.24, shave: 2700, failRep: -0.28, loseHearts: 3, moodDrop: 18 },
  };

  MINIGAMES.register('quick_draw', {
    icon: '⚡',
    title: 'Golden Frisbee Reflex',
    warn: 'Golden Frisbee reflex catch in {s}…',
    customTimer: true,
    start: function (diff, api) {
      var cfg = DRAW_CFG[diff.id];
      var a = {
        kind: 'quick_draw', diff: diff, cfg: cfg, catches: 0,
        phase: 'wait', waitT: api.randRange(1.2, 2.6),
        timeLeft: cfg.winSec, maxTime: cfg.winSec, finished: false,
      };
      api.setActive(a);
      openModal(
        '<div class="mg-head"><span>⚡ Frisbee Reflex</span>' + api.diffPill(diff) +
          '<span class="mg-score" id="mgScore">0 / ' + cfg.goal + '</span>' +
          '<span class="mg-timer" id="mgTimer">' + cfg.winSec.toFixed(2) + 's</span></div>' +
        '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
        '<button type="button" id="mgDrawPad" class="mg-draw-pad wait">' +
          '<span class="mg-draw-ico" id="mgDrawIco">🔴</span>' +
          '<b id="mgDrawTxt">WAIT FOR THE THROW…</b>' +
        '</button>' +
        '<p class="mg-sub">Hold still on RED, then tap the instant it turns GREEN 🥏 (' + cfg.winSec.toFixed(2) + 's window)!</p>',
        'minigame', 'mg-card'
      );
      function setPad(state) {
        var p = document.getElementById('mgDrawPad'), ico = document.getElementById('mgDrawIco'), txt = document.getElementById('mgDrawTxt');
        if (!p) return;
        p.classList.toggle('wait', state === 'wait');
        p.classList.toggle('go', state === 'go');
        if (ico) ico.textContent = state === 'go' ? '🥏' : '🔴';
        if (txt) txt.textContent = state === 'go' ? 'CATCH NOW!!' : 'WAIT FOR THE THROW…';
      }
      a._setPad = setPad;
      var pad = document.getElementById('mgDrawPad');
      if (pad) {
        pad.addEventListener('pointerdown', function () {
          if (!a || a.finished) return;
          if (typeof initAudio === 'function') initAudio();
          if (a.phase === 'wait') {
            api.finish(false, {
              headline: 'False Start!',
              detail: 'Jumped too early before the Golden Frisbee was thrown!',
              rep: cfg.failRep, loseHearts: cfg.loseHearts, moodDrop: cfg.moodDrop,
              failRepMsg: '⚡ Jumped the gun on Golden Frisbee!',
            });
            return;
          }
          a.catches++;
          api.playNote(780 + a.catches * 65, 0.14, 0.24);
          var sc = document.getElementById('mgScore');
          if (sc) sc.textContent = a.catches + ' / ' + cfg.goal;
          if (a.catches >= cfg.goal) {
            api.finish(true, {
              headline: 'Lightning Paws!',
              detail: 'Snagged all ' + cfg.goal + ' Golden Frisbees mid-air!',
              cash: cfg.cash, hearts: cfg.hearts, rep: cfg.rep, shave: cfg.shave,
              xp: 15 + cfg.hearts * 2, shortTag: 'Quick Draw!',
            });
          } else {
            a.phase = 'wait'; a.waitT = api.randRange(1.0, 2.5);
            a.timeLeft = cfg.winSec; a.maxTime = cfg.winSec;
            setPad('wait'); api.updateTimerBar();
          }
        });
      }
    },
    tick: function (a, dt, api) {
      if (a.phase === 'wait') {
        a.waitT -= dt;
        if (a.waitT <= 0) {
          a.phase = 'go'; a.timeLeft = a.cfg.winSec; a.maxTime = a.cfg.winSec;
          if (a._setPad) a._setPad('go');
          api.playNote(920, 0.1, 0.22);
          api.updateTimerBar();
        }
        return;
      }
      a.timeLeft -= dt;
      api.updateTimerBar();
      if (a.timeLeft <= 0) {
        api.finish(false, {
          headline: 'Frisbee Whiffed!',
          detail: 'Caught ' + a.catches + ' / ' + a.cfg.goal + ' — too slow on the Golden Frisbee!',
          rep: a.cfg.failRep, loseHearts: a.cfg.loseHearts, moodDrop: a.cfg.moodDrop,
          failRepMsg: '⚡ Missed the Golden Frisbee catch!',
        });
      }
    },
  });
})();
