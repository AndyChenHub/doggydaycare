'use strict';
/* ============================================================================================
   minigames.js — Randomly Timed Surprise Mini-Games for Paws & Play
   - Triggers at random intervals during post-tutorial gameplay with a 5..4..3..2..1 countdown
   - Pauses the daycare simulation cleanly while the minigame modal is active
   - 5 distinct portrait iPhone-friendly mini-games:
       1. Company Accounts Audit  (random Easy / Medium / Hard / Extreme math challenge)
       2. Speed Photo Check       (find 4 target dogs one at a time in a busy park photo, 10s each)
       3. Treat Delivery Spill    (15s reflex basket-catch arcade)
       4. Talent Scout Audition   (3-round musical puppy trick memory sequence)
       5. Sudsy Bubble Blitz      (14s speed-tap soap bubble & ducky popper)
   ============================================================================================ */

var MINIGAMES = (function () {
  var ALL_KINDS = ['audit', 'find_dog', 'treat_catch', 'trick_memory', 'bubble_pop'];

  var KIND_META = {
    audit: {
      icon: '📊',
      title: 'Company Accounts Audit',
      warn: 'Random audit on the company accounts in {s}…',
    },
    find_dog: {
      icon: '📸',
      title: 'Speed Photo Check',
      warn: 'Speed photo check! Find the pups in {s}…',
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
  };

  var AUDIT_TIERS = [
    { id: 'easy',    label: 'Easy Audit',    badge: '🟢 Easy',    weight: 30, count: 5, time: 26, cash: 45,  hearts: 3, rep: 0.10, shave: 900,  fine: 12 },
    { id: 'medium',  label: 'Medium Audit',  badge: '🟡 Medium',  weight: 32, count: 5, time: 32, cash: 75,  hearts: 5, rep: 0.14, shave: 1500, fine: 18 },
    { id: 'hard',    label: 'Hard Audit',    badge: '🟠 Hard',    weight: 23, count: 5, time: 38, cash: 120, hearts: 7, rep: 0.18, shave: 2400, fine: 22 },
    { id: 'extreme', label: 'Extreme Audit', badge: '🔥 EXTREME', weight: 15, count: 5, time: 46, cash: 200, hearts: 10, rep: 0.24, shave: 3600, fine: 25 },
  ];

  // Runtime state (never persisted in S)
  var nextDelay = randRange(58, 98); // first random popup appears ~1-1.5m after tutorial
  var lastKind = null;
  var pending = null;    // { kind, timeLeft, lastSec, auditTier }
  var active = null;     // live minigame instance while UI.mode === 'minigame'

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

  function rollAuditTier(forcedId) {
    if (forcedId) {
      for (var fi = 0; fi < AUDIT_TIERS.length; fi++) {
        if (AUDIT_TIERS[fi].id === forcedId) return AUDIT_TIERS[fi];
      }
    }
    var tot = 0;
    for (var i = 0; i < AUDIT_TIERS.length; i++) tot += AUDIT_TIERS[i].weight;
    var r = Math.random() * tot;
    for (var j = 0; j < AUDIT_TIERS.length; j++) {
      r -= AUDIT_TIERS[j].weight;
      if (r <= 0) return AUDIT_TIERS[j];
    }
    return AUDIT_TIERS[0];
  }

  function pickNextKind(forcedKind) {
    if (forcedKind && KIND_META[forcedKind]) return forcedKind;
    // Slightly higher weight for Audit & Speed Photo Check since they're headline features
    var pool = ['audit', 'audit', 'find_dog', 'find_dog', 'treat_catch', 'trick_memory', 'bubble_pop']
      .filter(function (k) { return k !== lastKind; });
    return pickOne(pool);
  }

  // ---------------- Math Audit Question Generator ----------------
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

  function generateMathQuestion(tierId) {
    var a, b, c, ans, expr, hint = '';
    if (tierId === 'easy') {
      var op = randInt(0, 3);
      if (op === 0) { // simple multiply like 4 x 2
        a = randInt(2, 9); b = randInt(2, 9); ans = a * b;
        expr = a + ' × ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + a, ans - b, a + b]) };
      } else if (op === 1) { // add
        a = randInt(6, 28); b = randInt(4, 19); ans = a + b;
        expr = a + ' + ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 10, ans - 2, ans + 1]) };
      } else if (op === 2) { // subtract
        a = randInt(14, 42); b = randInt(4, a - 3); ans = a - b;
        expr = a + ' − ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 2, ans - 3, ans + 10]) };
      } else { // clean divide
        b = randInt(2, 8); ans = randInt(2, 9); a = b * ans;
        expr = a + ' ÷ ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 1, ans - 1, ans + 2]) };
      }
    }

    if (tierId === 'medium') {
      var mop = randInt(0, 3);
      if (mop === 0) {
        a = randInt(11, 19); b = randInt(3, 9); ans = a * b;
        expr = a + ' × ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + b, ans - a, ans + 10]) };
      } else if (mop === 1) {
        a = randInt(4, 9); b = randInt(4, 9); c = randInt(6, 25); ans = a * b + c;
        expr = a + ' × ' + b + ' + ' + c;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [a * (b + c), ans + 4, ans - 6]) };
      } else if (mop === 2) {
        b = randInt(6, 13); ans = randInt(6, 14); a = b * ans;
        expr = a + ' ÷ ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 2, ans - 1, ans + 3]) };
      } else {
        a = randInt(62, 135); b = randInt(24, 58); ans = a - b;
        expr = a + ' − ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 10, ans - 10, ans + 2]) };
      }
    }

    if (tierId === 'hard') {
      var hop = randInt(0, 3);
      if (hop === 0) { // Order of operations like 100 - 2 x 4
        a = pickOne([80, 90, 100, 120, 150]);
        b = randInt(2, 9); c = randInt(3, 9);
        ans = a - b * c;
        expr = a + ' − ' + b + ' × ' + c;
        return { expr: expr, hint: 'Remember order of operations (× before −)', choices: makeIntChoices(ans, [(a - b) * c, ans + b, ans - c]) };
      } else if (hop === 1) { // Exact square root + offset
        var r = randInt(8, 15);
        c = randInt(5, 22);
        ans = r + c;
        expr = '√' + (r * r) + ' + ' + c;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [r + c + 2, r + c - 1, r * 2 + c]) };
      } else if (hop === 2) { // Square minus number
        a = randInt(9, 15); b = randInt(12, 35);
        ans = a * a - b;
        expr = a + '² − ' + b;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [a * 2 - b, ans + 10, ans - 6]) };
      } else { // Parentheses divide
        c = randInt(3, 8);
        ans = randInt(7, 16);
        var sum = c * ans;
        a = randInt(12, sum - 8); b = sum - a;
        expr = '(' + a + ' + ' + b + ') ÷ ' + c;
        return { expr: expr, hint: hint, choices: makeIntChoices(ans, [Math.round(a + b / c), ans + 2, ans - 2]) };
      }
    }

    // EXTREME tier: tricky PEMDAS, non-perfect square roots like √125, squares, percentages!
    var eop = randInt(0, 3);
    if (eop === 0) { // Non-perfect square root (e.g. √125 ≈ 11.2!)
      var rads = [50, 75, 80, 90, 110, 125, 135, 150, 180, 200, 240, 300];
      var rad = pickOne(rads);
      var exact = Math.round(Math.sqrt(rad) * 10) / 10;
      expr = '√' + rad;
      return {
        expr: expr,
        hint: 'Round to 1 decimal place',
        choices: makeDecimalChoices(exact, [exact + 0.6, exact - 0.5, Math.round((rad / 10) * 10) / 10])
      };
    } else if (eop === 1) { // Heavy PEMDAS: e.g. 200 - 7 x 13
      a = pickOne([150, 180, 200, 240, 250]);
      b = randInt(6, 12); c = randInt(7, 14);
      ans = a - b * c;
      expr = a + ' − ' + b + ' × ' + c;
      return { expr: expr, hint: 'Order of operations applies!', choices: makeIntChoices(ans, [(a - b) * c, ans + b, ans - c]) };
    } else if (eop === 2) { // Square minus product: 13² - 8 × 7
      a = randInt(11, 17); b = randInt(5, 9); c = randInt(6, 9);
      ans = a * a - b * c;
      expr = a + '² − ' + b + ' × ' + c;
      return { expr: expr, hint: 'Square & multiply before subtracting', choices: makeIntChoices(ans, [a * a - b + c, ans + 12, ans - 8]) };
    } else { // Percentage calculation: 15% of 240
      var pct = pickOne([15, 25, 35, 40, 60]);
      var base = pickOne([120, 160, 180, 200, 240, 280, 320]);
      ans = Math.round(base * pct / 100);
      expr = pct + '% of ' + base;
      return { expr: expr, hint: hint, choices: makeIntChoices(ans, [ans + 12, ans - 6, Math.round(base * (pct + 5) / 100)]) };
    }
  }

  function buildAuditQuestions(tier) {
    var qs = [], seen = {}, tries = 0;
    while (qs.length < tier.count && tries < 60) {
      tries++;
      var q = generateMathQuestion(tier.id);
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
    var extra = pending.kind === 'audit' && pending.auditTier
      ? ' <span class="mg-tier-pill ' + pending.auditTier.id + '">' + pending.auditTier.badge + '</span>'
      : '';
    el.hidden = false;
    el.innerHTML =
      '<div class="mg-warn-inner">' +
        '<span class="mg-warn-ico">' + meta.icon + '</span>' +
        '<div class="mg-warn-txt"><b>' + esc(meta.warn.replace('{s}', String(sec))) + '</b>' + extra + '</div>' +
        '<span class="mg-warn-num">' + sec + '</span>' +
        '<button type="button" id="mgStartNowBtn" class="mg-warn-go">Go!</button>' +
      '</div>';
    var btn = document.getElementById('mgStartNowBtn');
    if (btn) {
      btn.onclick = function () {
        if (typeof initAudio === 'function') initAudio();
        if (pending) {
          var k = pending.kind, tier = pending.auditTier;
          pending = null;
          hideBanner();
          launch(k, tier ? tier.id : null);
        }
      };
    }
  }

  function startCountdown(forcedKind, forcedTier) {
    if (active || pending) return false;
    var kind = pickNextKind(forcedKind);
    var tier = kind === 'audit' ? rollAuditTier(forcedTier) : null;
    pending = { kind: kind, timeLeft: 5.0, lastSec: 6, auditTier: tier };
    lastKind = kind;
    renderBanner();
    if (typeof sfx === 'function') sfx('bell');
    return true;
  }

  // ---------------- Reward & Outcome Finalizer ----------------
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
    var fine = info.fine || 0;
    var actualFine = 0;

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
        if (cash > 0) { // small consolation bonus for partial arcade score
          S.cash += cash;
          if (S.stats) S.stats.earned = (S.stats.earned || 0) + cash;
          if (S.life) S.life.earned = (S.life.earned || 0) + cash;
        }
        if (fine > 0) {
          actualFine = Math.min(S.cash, fine);
          S.cash -= actualFine;
          if (S.stats) S.stats.spent = (S.stats.spent || 0) + actualFine;
        }
        if (rep < 0 && typeof dropRep === 'function') dropRep(Math.abs(rep), info.failRepMsg || 'Mini-game missed!', S.player.x, S.player.y - 60);
        if (typeof sfx === 'function') sfx('error');
      }
      if (typeof MP !== 'undefined' && MP.recordAction) {
        MP.recordAction('minigame', {
          item: mg.kind,
          name: info.headline || KIND_META[mg.kind].title,
          icon: KIND_META[mg.kind].icon,
          earned: cash,
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
      if (cash > 0) fChips.push('<span class="mg-rew good">+' + fmtMoney(cash) + ' Consolation</span>');
      if (actualFine > 0) fChips.push('<span class="mg-rew bad">-' + fmtMoney(actualFine) + ' Fine</span>');
      if (rep < 0) fChips.push('<span class="mg-rew bad">' + rep.toFixed(2) + '★</span>');
      if (fChips.length) rewardsHtml = '<div class="mg-rew-row">' + fChips.join('') + '</div>';
    }

    var card = document.querySelector('#modal .card');
    if (card) {
      card.innerHTML =
        '<div class="mg-res">' +
          '<div class="mg-res-ico">' + (won ? '🏆' : KIND_META[mg.kind].icon) + '</div>' +
          '<h2>' + esc(info.headline || (won ? 'Challenge Complete!' : 'Time\'s Up!')) + '</h2>' +
          '<p>' + esc(info.detail || '') + '</p>' +
          rewardsHtml +
          '<div class="row"><button id="mgDoneBtn" class="primary big">Back to Daycare</button></div>' +
        '</div>';
      var doneBtn = document.getElementById('mgDoneBtn');
      if (doneBtn) {
        doneBtn.onclick = function () {
          if (typeof sfx === 'function') sfx('click');
          active = null;
          nextDelay = randRange(95, 165);
          if (typeof closeModal === 'function') closeModal();
        };
      }
    } else {
      active = null;
      nextDelay = randRange(95, 165);
    }
  }

  // ---------------- 1. COMPANY ACCOUNTS AUDIT (MATH) ----------------
  function startAudit(forcedTierId) {
    var tier = rollAuditTier(forcedTierId);
    var questions = buildAuditQuestions(tier);
    active = {
      kind: 'audit',
      tier: tier,
      questions: questions,
      idx: 0,
      wrong: 0,
      timeLeft: tier.time,
      maxTime: tier.time,
      flashT: 0,
      finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>📊 Company Audit</span>' +
        '<span class="mg-tier-pill ' + tier.id + '">' + tier.badge + '</span>' +
        '<span class="mg-timer" id="mgTimer">' + tier.time.toFixed(1) + 's</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-dots" id="mgDots"></div>' +
      '<div class="mg-math-box" id="mgMathBox">' +
        '<div class="mg-math-q" id="mgMathExpr"></div>' +
        '<div class="mg-math-hint" id="mgMathHint"></div>' +
      '</div>' +
      '<div class="mg-choices" id="mgChoices"></div>' +
      '<p class="mg-sub">Answer all ' + tier.count + ' accounting checks before the auditor\'s timer runs out! Wrong tap: −2.5s.</p>',
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
              var t = active.tier;
              finishMinigame(true, {
                headline: t.label + ' Passed!',
                detail: 'All ' + t.count + ' books balanced with ' + active.timeLeft.toFixed(1) + 's left!' + (active.wrong === 0 ? ' Spotless record!' : ''),
                cash: t.cash + (active.wrong === 0 ? 15 : 0),
                hearts: t.hearts,
                rep: t.rep,
                shave: t.shave,
                xp: 12 + t.hearts * 2,
                shortTag: 'Audit Pass!',
              });
            } else {
              setTimeout(renderAuditQuestion, 140);
            }
          } else {
            btn.classList.add('wrong');
            btn.disabled = true;
            active.wrong++;
            active.timeLeft = Math.max(0.2, active.timeLeft - 2.5);
            if (typeof sfx === 'function') sfx('error');
            var box = document.getElementById('mgMathBox');
            if (box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
          }
        };
      });
    }
  }

  // ---------------- 2. SPEED PHOTO CHECK ("FIND THE DOG!" - 10s EACH) ----------------
  function startFindDog() {
    var allBreeds = (typeof BREEDS !== 'undefined' && BREEDS.length) ? BREEDS : [{ id: 'golden', name: 'Golden Retriever', coats: [{ name: 'Golden' }] }];
    var chosen = shuffle(allBreeds).slice(0, Math.min(14, allBreeds.length));
    var CW = 336, CH = 264;

    // Place dogs on a jittered 4x4 grid (with 2 empty scenic slots) so every dog is clearly visible & clickable
    var slots = [];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        slots.push({
          cx: 42 + c * 84 + randRange(-11, 11),
          cy: 42 + r * 60 + randRange(-7, 7),
        });
      }
    }
    slots = shuffle(slots);

    var dogs = chosen.map(function (b, i) {
      var coatCount = (b.coats && b.coats.length) ? b.coats.length : 1;
      var coat = randInt(0, coatCount - 1);
      var coatName = (b.coats && b.coats[coat] && b.coats[coat].name) ? b.coats[coat].name : '';
      return {
        id: i,
        breed: b.id,
        breedName: b.name,
        coat: coat,
        coatName: coatName,
        x: slots[i].cx,
        y: slots[i].cy,
        r: 25,
        found: false,
        seed: randInt(1, 9999),
        mood: pickOne(['happy', 'happy', 'excited', 'neutral']),
      };
    });

    // Pick 4 target dogs to find one at a time (10s each!)
    var targets = shuffle(dogs.map(function (d) { return d.id; })).slice(0, Math.min(4, dogs.length));

    // Scenic yard photo decorations
    var bushes = [];
    for (var bi = 0; bi < 7; bi++) {
      bushes.push({ x: randRange(18, CW - 18), y: randRange(24, CH - 16), rx: randRange(14, 24), ry: randRange(9, 14), col: pickOne(['#4e8d3d', '#5d9f48', '#447c36']) });
    }
    var flowers = [];
    for (var fl = 0; fl < 18; fl++) {
      flowers.push({ x: randRange(10, CW - 10), y: randRange(14, CH - 10), col: pickOne(['#ffe066', '#ff8fb1', '#ffffff', '#b3e5fc']) });
    }

    active = {
      kind: 'find_dog',
      cw: CW,
      ch: CH,
      dogs: dogs,
      targets: targets,
      tIdx: 0,
      timeLeft: 10.0,
      maxTime: 10.0,
      foundCount: 0,
      fx: [], // { x, y, text, col, life }
      finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>📸 Speed Photo Check</span>' +
        '<span class="mg-timer" id="mgTimer">10.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-target-bar" id="mgFindTarget"></div>' +
      '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px"></canvas></div>' +
      '<p class="mg-sub">Tap the matching dog in the park photo within 10s! Wrong tap: −1.5s.</p>',
      'minigame', 'mg-card'
    );

    active.bushes = bushes;
    active.flowers = flowers;
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

        // Find closest dog tapped within generous hit radius (32px)
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
            setTimeout(function () {
              finishMinigame(true, {
                headline: 'Eagle-Eyed Keeper!',
                detail: 'Spotted all ' + active.targets.length + ' dogs in the daycare group photo!',
                cash: 85,
                hearts: 5,
                rep: 0.14,
                shave: 1500,
                xp: 18,
                shortTag: 'Photo Check!',
              });
            }, 220);
          } else {
            active.timeLeft = 10.0; // Fresh 10s timer for the next dog!
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
    var wantId = active.targets[active.tIdx];
    var dg = active.dogs[wantId];
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
    c.save();
    c.scale(2, 2);

    // Sunny daycare lawn photo backdrop
    var grd = c.createLinearGradient(0, 0, 0, ch);
    grd.addColorStop(0, '#78be5a');
    grd.addColorStop(0.22, '#6cb250');
    grd.addColorStop(1, '#589c42');
    c.fillStyle = grd;
    c.fillRect(0, 0, cw, ch);

    // Wooden fence across top edge of photo
    c.fillStyle = '#a8743f';
    c.fillRect(0, 4, cw, 10);
    c.fillStyle = '#c9935a';
    for (var fx = 4; fx < cw; fx += 18) {
      c.fillRect(fx, 0, 12, 18);
      c.strokeStyle = '#4a3426';
      c.lineWidth = 1;
      c.strokeRect(fx, 0, 12, 18);
    }

    // Bushes & wildflower dots
    (active.bushes || []).forEach(function (b) {
      c.fillStyle = b.col;
      c.beginPath(); c.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2); c.fill();
    });
    (active.flowers || []).forEach(function (f) {
      c.fillStyle = f.col;
      c.beginPath(); c.arc(f.x, f.y, 2.3, 0, Math.PI * 2); c.fill();
    });

    // Draw all 14 dogs using existing crisp dog portrait art!
    var sorted = active.dogs.slice().sort(function (a, b) { return a.y - b.y; });
    sorted.forEach(function (dg) {
      // Soft ground shadow
      c.fillStyle = 'rgba(30, 20, 10, 0.22)';
      c.beginPath(); c.ellipse(dg.x, dg.y + 18, 17, 7, 0, 0, Math.PI * 2); c.fill();

      var sz = 46;
      if (typeof drawDogPortrait === 'function') {
        try {
          drawDogPortrait(c, dg.breed, dg.coat, dg.x - sz / 2, dg.y - sz / 2 - 2, sz, { mood: dg.mood, seed: dg.seed });
        } catch (e) {
          c.font = '26px sans-serif'; c.textAlign = 'center'; c.fillText('🐶', dg.x, dg.y + 8);
        }
      } else {
        c.font = '26px sans-serif'; c.textAlign = 'center'; c.fillText('🐶', dg.x, dg.y + 8);
      }

      if (dg.found) {
        c.strokeStyle = '#7ef27a';
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(dg.x, dg.y, 22, 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#3f8f37';
        c.beginPath(); c.arc(dg.x + 15, dg.y - 15, 8, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff';
        c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('✓', dg.x + 15, dg.y - 14.5);
      }
    });

    // Hit / Miss floating indicators
    (active.fx || []).forEach(function (p) {
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      c.font = 'bold 13px sans-serif';
      c.textAlign = 'center';
      c.lineWidth = 3;
      c.strokeStyle = '#2a1a10';
      c.strokeText(p.text, p.x, p.y);
      c.fillStyle = p.col;
      c.fillText(p.text, p.x, p.y);
      c.restore();
    });

    c.restore();
  }

  // ---------------- 3. TREAT DELIVERY SPILL (15s REFLEX CATCH) ----------------
  function startTreatCatch() {
    var CW = 330, CH = 260;
    active = {
      kind: 'treat_catch',
      cw: CW,
      ch: CH,
      basketX: CW / 2,
      basketW: 68,
      score: 0,
      goal: 14,
      bonusHearts: 0,
      timeLeft: 15.0,
      maxTime: 15.0,
      spawnT: 0.2,
      items: [],
      fx: [],
      dragging: false,
      finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🍪 Treat Delivery Spill</span>' +
        '<span class="mg-score" id="mgScore">0 / 14</span>' +
        '<span class="mg-timer" id="mgTimer">15.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
      '<p class="mg-sub">Slide your thumb to catch 🦴🍪🥩💛 treats (goal: 14+) and dodge muddy 🥾🧦!</p>',
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
      cv.addEventListener('pointermove', function (ev) {
        if (active && active.dragging) moveBasket(ev);
      });
      cv.addEventListener('pointerup', function () { if (active) active.dragging = false; });
      cv.addEventListener('pointercancel', function () { if (active) active.dragging = false; });
    }
    drawTreatCatch();
  }

  function updateTreatCatch(dt) {
    var a = active;
    a.spawnT -= dt;
    if (a.spawnT <= 0) {
      a.spawnT = randRange(0.36, 0.58);
      var roll = Math.random();
      var spec = roll < 0.22 ? { ico: '🥾', pts: -2, bad: true, spd: randRange(130, 175) }
        : roll < 0.30 ? { ico: '🧦', pts: -2, bad: true, spd: randRange(125, 165) }
        : roll < 0.42 ? { ico: '💛', pts: 2, heart: true, spd: randRange(145, 195) }
        : roll < 0.62 ? { ico: '🥩', pts: 2, spd: randRange(135, 180) }
        : roll < 0.82 ? { ico: '🍪', pts: 1, spd: randRange(115, 155) }
        : { ico: '🦴', pts: 1, spd: randRange(115, 155) };
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
    g.addColorStop(0, '#fff4d6');
    g.addColorStop(0.75, '#f5e1b8');
    g.addColorStop(1, '#d8b67b');
    c.fillStyle = g;
    c.fillRect(0, 0, a.cw, a.ch);

    // Subtle pantry shelves
    c.fillStyle = 'rgba(122, 78, 42, 0.12)';
    c.fillRect(0, 58, a.cw, 6);
    c.fillRect(0, 134, a.cw, 6);

    // Falling items
    c.textAlign = 'center'; c.textBaseline = 'middle';
    a.items.forEach(function (it) {
      c.save(); c.translate(it.x, it.y); c.rotate(it.rot);
      c.font = '24px sans-serif';
      c.fillText(it.ico, 0, 0);
      c.restore();
    });

    // Woven treat basket
    var bx = a.basketX - a.basketW / 2, by = a.ch - 40;
    c.fillStyle = '#c48342';
    c.strokeStyle = '#3b2a20';
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(bx, by);
    c.lineTo(bx + a.basketW, by);
    c.lineTo(bx + a.basketW - 9, by + 26);
    c.lineTo(bx + 9, by + 26);
    c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#e3a862';
    c.fillRect(bx - 3, by - 5, a.basketW + 6, 8);
    c.strokeRect(bx - 3, by - 5, a.basketW + 6, 8);
    c.font = '13px sans-serif';
    c.fillText('🐾', a.basketX, by + 13);

    a.fx.forEach(function (f) {
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      c.font = 'bold 13px sans-serif';
      c.lineWidth = 3; c.strokeStyle = '#2a1a10';
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.col;
      c.fillText(f.text, f.x, f.y);
      c.restore();
    });
    c.restore();
  }

  // ---------------- 4. TALENT SCOUT AUDITION (PUPPY TRICK MEMORY) ----------------
  var TRICKS = [
    { id: 0, icon: '🐾', name: 'Sit',       col: '#e8796c', freq: 440 },
    { id: 1, icon: '🔄', name: 'Roll Over', col: '#f2c14e', freq: 554.37 },
    { id: 2, icon: '🗣️', name: 'Speak',     col: '#42b8a8', freq: 659.25 },
    { id: 3, icon: '🦴', name: 'Jump',      col: '#78c85e', freq: 880 },
  ];

  function startTrickMemory() {
    var seq = [];
    for (var i = 0; i < 5; i++) seq.push(randInt(0, 3));
    active = {
      kind: 'trick_memory',
      seq: seq,
      round: 0,        // 0->len 3, 1->len 4, 2->len 5
      roundLens: [3, 4, 5],
      phase: 'show',   // 'show' | 'input'
      showStep: 0,
      showT: 0.45,
      litPad: -1,
      litT: 0,
      inputIdx: 0,
      timeLeft: 12.0,
      maxTime: 12.0,
      finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🎵 Talent Scout Audition</span>' +
        '<span class="mg-score" id="mgScore">Round 1 / 3</span>' +
        '<span class="mg-timer" id="mgTimer">12.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-trick-status" id="mgTrickStat">👀 Watch the scout\'s trick routine…</div>' +
      '<div class="mg-trick-grid" id="mgTrickGrid">' +
        TRICKS.map(function (tr) {
          return '<button type="button" class="mg-trick-pad" data-tpad="' + tr.id + '" style="--pcol:' + tr.col + '">' +
            '<span class="tico">' + tr.icon + '</span><b>' + tr.name + '</b></button>';
        }).join('') +
      '</div>' +
      '<p class="mg-sub">Repeat all 3 trick sequences in order to win over the Puppy Talent Scout!</p>',
      'minigame', 'mg-card'
    );

    var grid = document.getElementById('mgTrickGrid');
    if (grid) {
      grid.querySelectorAll('[data-tpad]').forEach(function (btn) {
        btn.onclick = function () {
          if (!active || active.kind !== 'trick_memory' || active.finished || active.phase !== 'input') return;
          if (typeof initAudio === 'function') initAudio();
          var pid = +btn.getAttribute('data-tpad');
          flashTrickPad(pid, 0.24);
          var expect = active.seq[active.inputIdx];
          if (pid === expect) {
            active.inputIdx++;
            var targetLen = active.roundLens[active.round];
            if (active.inputIdx >= targetLen) {
              active.round++;
              if (active.round >= active.roundLens.length) {
                finishMinigame(true, {
                  headline: 'Standing Ovation!',
                  detail: 'Your pups nailed all 3 trick routines for the Talent Scout!',
                  cash: 95,
                  hearts: 6,
                  rep: 0.16,
                  shave: 1800,
                  xp: 20,
                  shortTag: 'Talent Show!',
                });
              } else {
                active.phase = 'show';
                active.showStep = 0;
                active.showT = 0.7;
                active.inputIdx = 0;
                active.timeLeft = 12.0;
                var sc = document.getElementById('mgScore');
                if (sc) sc.textContent = 'Round ' + (active.round + 1) + ' / 3';
                var st = document.getElementById('mgTrickStat');
                if (st) st.textContent = '✨ Nice! Watch Round ' + (active.round + 1) + '…';
              }
            }
          } else {
            if (typeof sfx === 'function') sfx('error');
            finishMinigame(false, {
              headline: 'Stage Fright!',
              detail: 'Wrong trick on Round ' + (active.round + 1) + ' — the pups got the zoomies instead!',
              cash: active.round >= 1 ? 20 : 0,
            });
          }
        };
      });
    }
  }

  function flashTrickPad(pid, dur) {
    if (!active) return;
    active.litPad = pid;
    active.litT = dur || 0.34;
    if (TRICKS[pid]) playNote(TRICKS[pid].freq, dur || 0.28, 0.24);
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
          flashTrickPad(a.seq[a.showStep], 0.36);
          a.showStep++;
          a.showT = 0.56;
        } else {
          a.phase = 'input';
          a.inputIdx = 0;
          a.timeLeft = 12.0;
          var st = document.getElementById('mgTrickStat');
          if (st) st.textContent = '🐾 Your turn! Tap ' + len + ' tricks in order!';
        }
      }
    }
  }

  // ---------------- 5. SUDSY BUBBLE BLITZ (14s SPEED TAP) ----------------
  function startBubblePop() {
    var CW = 330, CH = 260;
    active = {
      kind: 'bubble_pop',
      cw: CW,
      ch: CH,
      score: 0,
      goal: 18,
      timeLeft: 14.0,
      maxTime: 14.0,
      spawnT: 0.1,
      bubbles: [],
      fx: [],
      finished: false,
    };

    openModal(
      '<div class="mg-head">' +
        '<span>🛁 Sudsy Bubble Blitz</span>' +
        '<span class="mg-score" id="mgScore">0 / 18</span>' +
        '<span class="mg-timer" id="mgTimer">14.0s</span>' +
      '</div>' +
      '<div class="mg-tbar"><div id="mgTbarFill" style="width:100%"></div></div>' +
      '<div class="mg-photo-wrap"><canvas id="mgCanvas" width="' + (CW * 2) + '" height="' + (CH * 2) + '" style="width:' + CW + 'px;height:' + CH + 'px;touch-action:none"></canvas></div>' +
      '<p class="mg-sub">Tap soap bubbles &amp; golden 🦆 duckies (goal: 18+)! Don\'t pop sneaky 🌶️ pepper bubbles!</p>',
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
    var a = active;
    a.spawnT -= dt;
    if (a.spawnT <= 0 && a.bubbles.length < 14) {
      a.spawnT = randRange(0.28, 0.48);
      var roll = Math.random();
      var bad = roll < 0.18;
      var duck = !bad && roll < 0.36;
      var r = duck ? 22 : bad ? 21 : randRange(20, 27);
      a.bubbles.push({
        x: randRange(r + 8, a.cw - r - 8),
        y: a.ch + r,
        r: r,
        vy: duck ? randRange(82, 112) : randRange(58, 92),
        wob: Math.random() * 6.28,
        pts: bad ? -2 : duck ? 2 : 1,
        bad: bad,
        duck: duck,
      });
    }
    for (var i = a.bubbles.length - 1; i >= 0; i--) {
      var b = a.bubbles[i];
      b.y -= b.vy * dt;
      b.wob += dt * 3;
      b.x += Math.sin(b.wob) * 18 * dt;
      if (b.y < -b.r - 8) a.bubbles.splice(i, 1);
    }
    for (var j = a.fx.length - 1; j >= 0; j--) {
      a.fx[j].y -= 24 * dt;
      a.fx[j].life -= dt;
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
    g.addColorStop(0, '#c8eeff');
    g.addColorStop(1, '#79c7eb');
    c.fillStyle = g;
    c.fillRect(0, 0, a.cw, a.ch);

    // Subtle tile lines
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 1;
    for (var tx = 0; tx < a.cw; tx += 36) { c.beginPath(); c.moveTo(tx, 0); c.lineTo(tx, a.ch); c.stroke(); }
    for (var ty = 0; ty < a.ch; ty += 36) { c.beginPath(); c.moveTo(0, ty); c.lineTo(a.cw, ty); c.stroke(); }

    c.textAlign = 'center'; c.textBaseline = 'middle';
    a.bubbles.forEach(function (b) {
      c.save();
      c.fillStyle = b.bad ? 'rgba(255, 130, 120, 0.55)' : b.duck ? 'rgba(255, 232, 130, 0.65)' : 'rgba(255, 255, 255, 0.52)';
      c.strokeStyle = b.bad ? '#c2483c' : b.duck ? '#d48b1c' : '#ffffff';
      c.lineWidth = 2;
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill(); c.stroke();
      // Bubble specular glint
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath(); c.arc(b.x - b.r * 0.32, b.y - b.r * 0.32, b.r * 0.22, 0, Math.PI * 2); c.fill();
      if (b.bad || b.duck) {
        c.font = '19px sans-serif';
        c.fillText(b.bad ? '🌶️' : '🦆', b.x, b.y + 1);
      }
      c.restore();
    });

    a.fx.forEach(function (f) {
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      c.font = 'bold 13px sans-serif';
      c.lineWidth = 3; c.strokeStyle = '#2a1a10';
      c.strokeText(f.text, f.x, f.y);
      c.fillStyle = f.col;
      c.fillText(f.text, f.x, f.y);
      c.restore();
    });
    c.restore();
  }

  // ---------------- Launcher & Per-Frame Tick ----------------
  function launch(kind, forcedTierId) {
    if (active) return false;
    pending = null;
    hideBanner();
    var k = kind && KIND_META[kind] ? kind : pickNextKind();
    lastKind = k;
    if (k === 'audit') startAudit(forcedTierId);
    else if (k === 'find_dog') startFindDog();
    else if (k === 'treat_catch') startTreatCatch();
    else if (k === 'trick_memory') startTrickMemory();
    else startBubblePop();
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
            finishMinigame(false, {
              headline: 'Out of Time!',
              detail: 'The Talent Scout had to catch a cab before the routine finished.',
              cash: active.round >= 1 ? 20 : 0,
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
          finishMinigame(false, {
            headline: 'Photo Check Timed Out!',
            detail: 'You found ' + active.foundCount + ' of ' + active.targets.length + ' dogs before the 10s timer ran out.',
            cash: active.foundCount >= 2 ? active.foundCount * 10 : 0,
          });
        }
      } else if (active.kind === 'audit') {
        if (active.timeLeft <= 0) {
          var t = active.tier;
          finishMinigame(false, {
            headline: 'Audit Failed!',
            detail: 'Completed ' + active.idx + ' / ' + active.questions.length + ' questions on the ' + t.label + '.',
            fine: t.fine,
            rep: -0.06,
            failRepMsg: '📊 Company accounts audit timed out!',
          });
        }
      } else if (active.kind === 'treat_catch') {
        updateTreatCatch(dt);
        if (active.timeLeft <= 0) {
          if (active.score >= active.goal) {
            var extra = Math.max(0, active.score - active.goal) * 3;
            finishMinigame(true, {
              headline: 'Snack Delivery Saved!',
              detail: 'Caught ' + active.score + ' gourmet treats before they hit the floor!',
              cash: 70 + extra,
              hearts: 4 + active.bonusHearts,
              rep: 0.12,
              shave: 1200,
              xp: 16,
              shortTag: 'Treat Rush!',
            });
          } else {
            finishMinigame(false, {
              headline: 'Messy Floor!',
              detail: 'Caught ' + active.score + ' / ' + active.goal + ' treats — so close!',
              cash: active.score >= 7 ? 15 : 0,
            });
          }
        }
      } else if (active.kind === 'bubble_pop') {
        updateBubblePop(dt);
        if (active.timeLeft <= 0) {
          if (active.score >= active.goal) {
            var bExtra = Math.max(0, active.score - active.goal) * 2;
            finishMinigame(true, {
              headline: 'Grooming Room Rescued!',
              detail: 'Popped ' + active.score + ' soap bubbles & rubber duckies in time!',
              cash: 75 + bExtra,
              hearts: 5,
              rep: 0.13,
              shave: 1200,
              xp: 16,
              shortTag: 'Bubble Blitz!',
            });
          } else {
            finishMinigame(false, {
              headline: 'Suds Everywhere!',
              detail: 'Popped ' + active.score + ' / ' + active.goal + ' bubbles before the tub overflowed.',
              cash: active.score >= 9 ? 15 : 0,
            });
          }
        }
      }
      return;
    }

    // 2. Only count down / schedule random minigames during active post-tutorial play
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
        var k2 = pending.kind, t2 = pending.auditTier;
        pending = null;
        hideBanner();
        launch(k2, t2 ? t2.id : null);
      }
      return;
    }

    // 4. Random scheduling countdown while dogs are in the daycare and no spot repEvent is active
    if (!S.repEvent && S.dogs && S.dogs.length >= 1) {
      nextDelay -= dt;
      if (nextDelay <= 0) {
        nextDelay = randRange(95, 175);
        startCountdown();
      }
    }
  }

  function reset() {
    pending = null;
    active = null;
    hideBanner();
    nextDelay = randRange(58, 98);
  }

  return {
    tick: tick,
    reset: reset,
    startCountdown: startCountdown,
    launch: launch,
    generateMathQuestion: generateMathQuestion,
    buildAuditQuestions: buildAuditQuestions,
    AUDIT_TIERS: AUDIT_TIERS,
    ALL_KINDS: ALL_KINDS,
    get isActive() { return !!active; },
    get isPending() { return !!pending; },
    get activeKind() { return active ? active.kind : null; },
    get nextDelay() { return nextDelay; },
  };
})();
